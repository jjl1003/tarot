import test from "node:test";
import assert from "node:assert/strict";
import { createServer, endpoint } from "../server.mjs";
async function run(options, fn) {
  const server = createServer(options);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((r) => server.close(r));
  }
}
const body = {
  config: {
    baseUrl: "https://provider.example/v1/",
    model: "model",
    apiKey: "secret-key",
  },
  messages: [{ role: "user", content: "问题与牌面" }],
};
const post = (url, data = body, extra = {}) =>
  fetch(url + "/api/reading", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extra },
    body: JSON.stringify(data),
  });
test("API 地址支持基础和完整路径且保留自定义前缀", () => {
  assert.equal(
    endpoint("https://x.test/v1/").href,
    "https://x.test/v1/chat/completions",
  );
  assert.equal(
    endpoint("https://x.test/custom/chat/completions/").pathname,
    "/custom/chat/completions",
  );
});
test("实际 HTTP 转发，传递模型／上下文／授权，屏蔽响应密钥", async () => {
  await run(
    {
      fetchImpl: async (url, options) => {
        assert.equal(url.href, "https://provider.example/v1/chat/completions");
        assert.equal(options.headers.Authorization, "Bearer secret-key");
        assert.equal(options.redirect, "error");
        assert.ok(!("thinking" in JSON.parse(options.body)));
        assert.deepEqual(JSON.parse(options.body).messages, body.messages);
        assert.equal(JSON.parse(options.body).model, "model");
        return Response.json({
          choices: [{ message: { content: "测试解读 secret-key" } }],
        });
      },
    },
    async (url) => {
      const r = await post(url);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { content: "测试解读 [已隐藏密钥]" });
    },
  );
});
for (const [status, pattern] of [
  [401, /Key 无效/],
  [403, /Key 无效/],
  [402, /额度不足/],
  [400, /模型名区分大小写/],
  [404, /模型名区分大小写/],
  [429, /额度不足/],
  [500, /模型服务返回错误/],
])
  test(`上游 ${status} 错误可理解且不泄露上游内容`, async () => {
    await run(
      {
        fetchImpl: async () =>
          new Response("secret-key confidential", { status }),
      },
      async (url) => {
        const r = await post(url);
        assert.equal(r.status, 502);
        const data = await r.json();
        assert.match(data.error, pattern);
        assert.ok(!JSON.stringify(data).includes("secret-key"));
      },
    );
  });
for (const [value, pattern] of [
  [{}, /有效解读/],
  [{ choices: [{ message: { content: "" } }] }, /有效解读/],
  ["not-json", /格式异常/],
])
  test(`异常模型输出 ${JSON.stringify(value)}`, async () => {
    await run(
      {
        fetchImpl: async () =>
          typeof value === "string"
            ? new Response(value)
            : Response.json(value),
      },
      async (url) => {
        const r = await post(url);
        assert.equal(r.status, 502);
        assert.match((await r.json()).error, pattern);
      },
    );
  });
test("网络与超时异常不泄露秘密，允许重新请求", async () => {
  for (const name of ["TypeError", "TimeoutError"])
    await run(
      {
        fetchImpl: async () => {
          const e = Error("secret-key");
          e.name = name;
          throw e;
        },
      },
      async (url) => {
        for (let i = 0; i < 2; i++) {
          const r = await post(url);
          assert.equal(r.status, 502);
          const msg = (await r.json()).error;
          assert.match(msg, name === "TimeoutError" ? /超时/ : /无法连接/);
          assert.ok(!msg.includes("secret-key"));
        }
      },
    );
});
test("验证请求、大小限制、来源，静态文件不泄露仓库文件", async () => {
  await run(
    {
      fetchImpl: () => {
        throw Error("不得调用");
      },
    },
    async (url) => {
      assert.equal((await post(url, { ...body, config: {} })).status, 400);
      assert.equal(
        (
          await post(url, {
            ...body,
            messages: [{ role: "bad", content: "x" }],
          })
        ).status,
        400,
      );
      assert.equal(
        (await post(url, body, { Origin: "https://evil.example" })).status,
        403,
      );
      assert.equal(
        (
          await post(url, {
            ...body,
            messages: [{ role: "user", content: "x".repeat(270000) }],
          })
        ).status,
        413,
      );
      assert.equal(
        (
          await fetch(url + "/api/reading", {
            method: "POST",
            body: "abc",
            headers: { "Content-Type": "application/json" },
          })
        ).status,
        400,
      );
      assert.equal(
        (await fetch(url + "/api/reading", { method: "POST", body: "abc" }))
          .status,
        415,
      );
      assert.equal((await fetch(url + "/AGENTS.md")).status, 404);
      for (const path of [
        "/",
        "/app.js",
        "/core.js",
        "/cards.js",
        "/journal.js",
        "/style.css",
        "/credits.html",
      ]) {
        const r = await fetch(url + path);
        assert.equal(r.status, 200, path);
        assert.ok(r.headers.get("content-security-policy"));
      }
      assert.equal((await fetch(url + "/missing")).status, 404);
    },
  );
});
test("截断回答不会被保存成成功解读", async () => {
  await run(
    {
      fetchImpl: async () =>
        Response.json({
          choices: [
            { finish_reason: "length", message: { content: "未完成的文字" } },
          ],
        }),
    },
    async (url) => {
      const r = await post(url);
      assert.equal(r.status, 502);
      assert.match((await r.json()).error, /尚未完成/);
    },
  );
});
test("真实慢速 HTTP 服务会被超时中止，并返回可重试提示", async () => {
  const http = await import("node:http");
  const upstream = http.createServer((req, res) => {
    setTimeout(() => {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({ choices: [{ message: { content: "延迟回答" } }] }),
      );
    }, 100);
  });
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  try {
    await run({ timeout: 10 }, async (url) => {
      const r = await post(url, {
        ...body,
        config: {
          ...body.config,
          baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
        },
      });
      assert.equal(r.status, 502);
      assert.match((await r.json()).error, /超时/);
    });
  } finally {
    upstream.closeAllConnections();
    await new Promise((r) => upstream.close(r));
  }
});

test("中文请求即使在 UTF-8 字节中间分块也不会被破坏", async () => {
  const { request } = await import("node:http");
  await run(
    {
      fetchImpl: async (url, options) => {
        assert.equal(JSON.parse(options.body).messages[0].content, "中文问题");
        return Response.json({
          choices: [{ message: { content: "完整回答" } }],
        });
      },
    },
    async (url) => {
      const bytes = Buffer.from(
        JSON.stringify({
          ...body,
          messages: [{ role: "user", content: "中文问题" }],
        }),
      );
      const split = bytes.indexOf(Buffer.from("中")) + 1;
      const response = await new Promise((resolve, reject) => {
        const req = request(
          url + "/api/reading",
          { method: "POST", headers: { "Content-Type": "application/json" } },
          (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () =>
              resolve({
                status: res.statusCode,
                body: Buffer.concat(chunks).toString(),
              }),
            );
          },
        );
        req.on("error", reject);
        req.write(bytes.subarray(0, split));
        setTimeout(() => req.end(bytes.subarray(split)), 5);
      });
      assert.equal(response.status, 200);
      assert.equal(JSON.parse(response.body).content, "完整回答");
    },
  );
});
