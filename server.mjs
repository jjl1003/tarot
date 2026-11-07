import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import { validateConfig, contextMessages } from "./public/core.js";
import {
  AccessError,
  loadDeployment,
  createHostedAccess,
} from "./server/hosted.mjs";
const root = fileURLToPath(new URL("./public/", import.meta.url));
export function endpoint(base) {
  const url = new URL(base);
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/chat/completions"))
    url.pathname += "/chat/completions";
  return url;
}
async function parseBody(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new AccessError(415, "请求格式不正确");
  const chunks = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 262144) throw new AccessError(413, "对话过长，请开始新会话");
    chunks.push(part);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
    return body;
  } catch {
    throw new AccessError(400, "请求格式不正确");
  }
}
export function createServer({
  fetchImpl = fetch,
  timeout = 60000,
  hosted = null,
} = {}) {
  hosted?.ready.catch(() => {});
  return http.createServer(async (req, res) => {
    const send = (
      code,
      body,
      type = "application/json",
      cache = "no-store",
    ) => {
      res.writeHead(code, {
        "Content-Type": type,
        "Cache-Control": cache,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
      });
      res.end(type === "application/json" ? JSON.stringify(body) : body);
    };
    if (req.url === "/healthz" && req.method === "GET") {
      try {
        await hosted?.ready;
        return send(200, { status: "ok" });
      } catch {
        return send(503, { status: "unavailable" });
      }
    }
    const expected = hosted?.deployment.origin || `http://${req.headers.host}`;
    const validHost = hosted
      ? req.headers.host === new URL(expected).host
      : /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || "");
    if (!validHost) return send(403, { error: "请求域名不受支持" });
    if (
      (req.headers.origin && req.headers.origin !== expected) ||
      (hosted &&
        ["POST", "DELETE"].includes(req.method) &&
        req.headers.origin !== expected)
    )
      return send(403, { error: "请求来源不受支持" });
    if (req.url === "/api/runtime" && req.method === "GET")
      return send(200, hosted ? hosted.publicStatus() : { mode: "local" });
    if (req.url === "/api/access" && hosted) {
      try {
        if (req.method === "GET") return send(200, await hosted.status(req));
        if (req.method === "POST") {
          const result = await hosted.login(req, (await parseBody(req)).code);
          res.setHeader("Set-Cookie", result.cookie);
          return send(200, result.status);
        }
        if (req.method === "DELETE") {
          res.setHeader("Set-Cookie", hosted.logout());
          return send(200, { authenticated: false });
        }
        return send(405, { error: "不支持此操作" });
      } catch (e) {
        return send(e instanceof AccessError ? e.status : 503, {
          error:
            e instanceof AccessError
              ? e.message
              : "体验服务暂不可用，请稍后再试",
        });
      }
    }
    if (req.url === "/api/reading" && req.method === "POST") {
      let lease;
      try {
        if (hosted && !hosted.authenticate(req))
          return send(401, { error: "请先输入有效邀请码" });
        const body = await parseBody(req);
        const config = hosted ? hosted.deployment.config : body.config;
        let messages = body.messages;
        try {
          validateConfig(config || {});
        } catch (e) {
          return send(400, { error: e.message });
        }
        if (
          !Array.isArray(messages) ||
          !messages.length ||
          messages.length > 200 ||
          messages.some(
            (m) =>
              !m ||
              !["system", "user", "assistant"].includes(m.role) ||
              typeof m.content !== "string",
          )
        )
          return send(400, { error: "对话格式不正确" });
        if (hosted) {
          if (!messages.some((m) => m.role === "user"))
            return send(400, { error: "请提供本次问题" });
          if (
            messages.reduce((sum, m) => sum + m.content.length, 0) >
            hosted.deployment.limits.maxInput
          )
            return send(413, { error: "这篇手札的对话过长，请另起一篇" });
          // Keep the server's narrative rules; browser-supplied system messages cannot replace them.
          const system = contextMessages({
            question: "",
            spread: "single",
            cards: [],
            messages: [],
            pending: null,
          })[0];
          messages = [system, ...messages.filter((m) => m.role !== "system")];
          lease = await hosted.begin(req);
        }
        let upstream;
        try {
          upstream = await fetchImpl(endpoint(config.baseUrl), {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(timeout),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.apiKey}`,
            },
            body: JSON.stringify({
              model: config.model,
              messages,
              stream: false,
              max_tokens: hosted ? hosted.deployment.limits.maxTokens : 4096,
              ...(hosted &&
              new URL(config.baseUrl).hostname === "api.deepseek.com"
                ? { thinking: { type: "disabled" } }
                : {}),
            }),
          });
        } catch (e) {
          return send(502, {
            error:
              e.name === "TimeoutError"
                ? "模型服务响应超时，请重试"
                : "无法连接模型服务，请检查 API 地址和网络",
          });
        }
        if (!upstream.ok)
          return send(502, {
            error:
              hosted && [400, 401, 403, 404, 422].includes(upstream.status)
                ? "体验服务的模型连接暂不可用，请联系邀请人"
                : [401, 403].includes(upstream.status)
                  ? "API Key 无效或无权使用此模型，请修改配置"
                  : [402, 429].includes(upstream.status)
                    ? "模型服务请求过于频繁或额度不足，请稍后重试"
                    : [400, 404, 422].includes(upstream.status)
                      ? "API 路径、模型名称或请求参数不正确，请检查配置（模型名区分大小写）"
                      : "模型服务返回错误，请检查模型配置后重试",
          });
        let data;
        try {
          data = await upstream.json();
        } catch {
          return send(502, { error: "模型服务返回格式异常，请重试" });
        }
        const content = data?.choices?.[0]?.message?.content;
        if (data?.choices?.[0]?.finish_reason === "length")
          return send(502, {
            error: "模型回答超出长度限制，尚未完成，请重试或使用更简短的追问",
          });
        if (
          typeof content !== "string" ||
          !content.trim() ||
          content.length > 100000
        )
          return send(502, { error: "模型未返回有效解读，请重试" });
        // Do not persist or reflect the configured secret, even if a provider echoes it.
        return send(200, {
          content: hosted
            ? hosted.redact(content)
            : content.split(config.apiKey).join("[已隐藏密钥]"),
          ...(hosted ? { quota: (await hosted.status(req)).quota } : {}),
        });
      } catch (e) {
        return send(e instanceof AccessError ? e.status : 503, {
          error:
            e instanceof AccessError ? e.message : "请求未能完成，请稍后重试",
        });
      } finally {
        lease?.release();
      }
    }
    if (!["GET", "HEAD"].includes(req.method))
      return send(405, { error: "不支持此操作" });
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
    } catch {
      return send(400, { error: "无效路径" });
    }
    const path = resolve(
      root,
      pathname === "/" ? "index.html" : `.${pathname}`,
    );
    if (!path.startsWith(root)) return send(404, { error: "页面不存在" });
    try {
      const bytes = await readFile(path);
      return send(
        200,
        req.method === "HEAD" ? Buffer.alloc(0) : bytes,
        {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".jpg": "image/jpeg",
          ".json": "application/json",
        }[extname(path)] || "application/octet-stream",
        extname(path) === ".jpg" ? "public, max-age=86400" : "no-store",
      );
    } catch {
      return send(404, { error: "页面不存在" });
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const deployment = loadDeployment();
    const hosted = deployment ? createHostedAccess(deployment) : null;
    await hosted?.ready;
    const port = Number(process.env.PORT || 3000);
    const host = hosted ? "0.0.0.0" : "127.0.0.1";
    createServer({ hosted }).listen(port, host, () =>
      console.log(
        `月下手札已启动（${hosted ? "邀请码体验" : "本地"}）：${hosted ? deployment.origin : `http://127.0.0.1:${port}`}`,
      ),
    );
  } catch {
    console.error(
      "服务启动失败：请检查部署环境配置和额度文件；未开放模型请求。",
    );
    process.exitCode = 1;
  }
}
