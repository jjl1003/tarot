import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";
import { createServer } from "../server.mjs";
import {
  loadDeployment,
  createHostedAccess,
  UsageStore,
} from "../server/hosted.mjs";
import { readingPayload, quotaText } from "../public/access.js";
import { createSession, contextMessages } from "../public/core.js";
import { createSpirit, chooseSpirit, MAJOR_IDS, SPIRITS } from "../public/spirit.js";
const code = "test-invitation-code-01",
  code2 = "test-invitation-code-02",
  key = "server-only-test-api-key",
  secret = "session-test-secret-with-more-than-32-characters";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const envFor = (file) => ({
  TAROT_MODE: "hosted",
  APP_ORIGIN: "https://tarot.example",
  TAROT_API_BASE_URL: "https://provider.example/v1",
  TAROT_API_KEY: key,
  TAROT_MODEL: "test-model",
  TAROT_INVITE_CODES: JSON.stringify([code, code2]),
  TAROT_SESSION_SECRET: secret,
  TAROT_USAGE_FILE: file,
});
const messages = [
  { role: "system", content: "客户端不能替换服务端规则" },
  { role: "user", content: "当前问题和已抽牌面" },
];
async function fixture(
  overrides = {},
  fetchImpl = async () =>
    Response.json({ choices: [{ message: { content: "测试回答" } }] }),
  now = Date.now,
) {
  const dir = await mkdtemp(join(tmpdir(), "tarot-hosted-"));
  const env = { ...envFor(join(dir, "usage.json")), ...overrides };
  const deployment = loadDeployment(env);
  const hosted = createHostedAccess(deployment, { now });
  await hosted.ready;
  const server = createServer({ hosted, fetchImpl });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = "GET", body, cookie, headers = {}) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        url + path,
        {
          method,
          headers: {
            Host: "tarot.example",
            ...(method === "GET"
              ? {}
              : {
                  Origin: deployment.origin,
                  "Content-Type": "application/json",
                }),
            ...(cookie ? { Cookie: cookie } : {}),
            ...headers,
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve(
              new Response(Buffer.concat(chunks), {
                status: res.statusCode,
                headers: Object.fromEntries(
                  Object.entries(res.headers).map(([k, v]) => [
                    k,
                    Array.isArray(v) ? v.join(",") : v,
                  ]),
                ),
              }),
            ),
          );
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const login = async (invite = code) => {
    const response = await request("/api/access", "POST", { code: invite });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  return {
    dir,
    env,
    deployment,
    hosted,
    server,
    url,
    request,
    login,
    close: async () => {
      await new Promise((r) => server.close(r));
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("部署配置拒绝公开本地代理、缺少密钥／邀请码／持久存储以及不安全地址", () => {
  assert.equal(loadDeployment({}), null);
  assert.throws(() =>
    loadDeployment({ NODE_ENV: "production", TAROT_MODE: "local" }),
  );
  assert.throws(() => loadDeployment({ HOST: "0.0.0.0" }));
  const good = envFor("/tmp/usage-test.json");
  for (const bad of [
    { TAROT_API_KEY: "" },
    { TAROT_MODEL: "" },
    { TAROT_INVITE_CODES: "[]" },
    { TAROT_INVITE_CODES: '["short"]' },
    { TAROT_INVITE_CODES: JSON.stringify([code, code]) },
    { TAROT_SESSION_SECRET: "short" },
    { TAROT_USAGE_FILE: "" },
    { APP_ORIGIN: "http://public.example" },
    { APP_ORIGIN: "http://127.0.0.1:3002", NODE_ENV: "production" },
    { APP_ORIGIN: "https://tarot.example/path" },
    { TAROT_API_BASE_URL: "http://internal" },
    { TAROT_API_BASE_URL: "https://user:secret@example.com" },
    { TAROT_DAILY_LIMIT: "-1" },
    { TAROT_MAX_OUTPUT_TOKENS: "50000" },
  ])
    assert.throws(() => loadDeployment({ ...good, ...bad }));
  assert.equal(
    loadDeployment({ ...good, APP_ORIGIN: "http://127.0.0.1:3002" }).origin,
    "http://127.0.0.1:3002",
  );
  assert.equal(
    loadDeployment({
      ...good,
      APP_ORIGIN: undefined,
      RENDER_EXTERNAL_URL: "https://render.example",
    }).origin,
    "https://render.example",
  );
});
test("线上浏览器只发送对话，不包含 API 密钥、模型地址或邀请码", () => {
  const config = {
    apiKey: key,
    baseUrl: "https://private.example",
    model: "private-model",
  };
  assert.deepEqual(readingPayload("hosted", config, messages), { messages });
  assert.deepEqual(readingPayload("local", config, messages), {
    config,
    messages,
  });
  assert.throws(() => readingPayload("loading", config, messages));
  assert.match(
    quotaText({ dailyRemaining: 3, totalRemaining: 10 }),
    /今日剩余 3 次/,
  );
});
test("公开运行信息无敏感配置，未受邀请求不调用模型", async () => {
  let calls = 0;
  const f = await fixture({}, async () => {
    calls++;
    throw Error();
  });
  try {
    const response = await f.request("/api/runtime");
    assert.deepEqual(await response.json(), {
      mode: "hosted",
      model: "test-model",
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      (await f.request("/api/reading", "POST", { messages })).status,
      401,
    );
    assert.equal(
      (await f.request("/api/access", "POST", { code: "incorrect" })).status,
      401,
    );
    assert.equal(calls, 0);
    assert.equal((await f.request("/.env")).status, 404);
    assert.equal((await f.request("/healthz")).status, 200);
  } finally {
    await f.close();
  }
});
test("邀请码会话使用 HttpOnly、Secure、SameSite Cookie，篡改、过期和退出后不能使用", async () => {
  let clock = Date.now();
  const f = await fixture({}, undefined, () => clock);
  try {
    const response = await f.request("/api/access", "POST", { code });
    const fullCookie = response.headers.get("set-cookie");
    assert.match(fullCookie, /HttpOnly/);
    assert.match(fullCookie, /; Secure/);
    assert.match(fullCookie, /SameSite=Strict/);
    assert.ok(!fullCookie.includes(code));
    const cookie = fullCookie.split(";")[0];
    assert.equal(
      (await (await f.request("/api/access", "GET", undefined, cookie)).json())
        .authenticated,
      true,
    );
    assert.equal(
      (
        await (
          await f.request("/api/access", "GET", undefined, cookie + "x")
        ).json()
      ).authenticated,
      false,
    );
    clock += 7 * 86400000 + 1;
    assert.equal(
      (await (await f.request("/api/access", "GET", undefined, cookie)).json())
        .authenticated,
      false,
    );
    assert.match(
      (await f.request("/api/access", "DELETE", undefined, cookie)).headers.get(
        "set-cookie",
      ),
      /Max-Age=0/,
    );
  } finally {
    await f.close();
  }
});
test("线上仅转发服务端固定模型与地址，覆盖客户端系统指令且响应脱敏", async () => {
  let calls = 0;
  const f = await fixture({}, async (url, options) => {
    calls++;
    assert.equal(url.href, "https://provider.example/v1/chat/completions");
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    const input = JSON.parse(options.body);
    assert.equal(input.model, "test-model");
    assert.equal(input.max_tokens, 2048);
    assert.match(input.messages[0].content, /禁止抽牌/);
    assert.ok(
      !input.messages.some((m) => m.content === "客户端不能替换服务端规则"),
    );
    assert.equal(options.redirect, "error");
    return Response.json({
      choices: [{ message: { content: `回答 ${key} ${code} ${secret}` } }],
    });
  });
  try {
    const cookie = await f.login();
    const r = await f.request(
      "/api/reading",
      "POST",
      {
        messages,
        config: {
          baseUrl: "http://127.0.0.1/admin",
          apiKey: "attacker-key",
          model: "unbounded",
        },
      },
      cookie,
    );
    assert.equal(r.status, 200);
    const result = await r.json();
    for (const privateValue of [key, code, secret])
      assert.ok(!JSON.stringify(result).includes(privateValue));
    assert.equal(result.quota.dailyRemaining, 4);
    assert.equal(calls, 1);
    const state = await readFile(f.deployment.usageFile, "utf8");
    for (const privateValue of [key, code, secret, "当前问题"])
      assert.ok(!state.includes(privateValue));
    assert.equal(JSON.parse(state).invites[hash(code)].total, 1);
  } finally {
    await f.close();
  }
});
test("生产域名和来源校验适配 HTTPS，其他域名和无来源写请求被拒绝", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.request("/api/access", "POST", { code }, undefined, {
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("/api/runtime", "GET", undefined, undefined, {
          Host: "evil.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(f.url + "/api/access", {
          method: "POST",
          headers: {
            Host: "tarot.example",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ code }),
        })
      ).status,
      403,
    );
    assert.equal((await f.request("/api/runtime")).status, 200);
  } finally {
    await f.close();
  }
});
test("无效对话与超长输入不消耗额度，上游失败保守计次，防止重试绕过预算", async () => {
  let calls = 0;
  const f = await fixture({ TAROT_INVITE_TOTAL_LIMIT: "1" }, async () => {
    calls++;
    return new Response("private-provider-detail", { status: 500 });
  });
  try {
    const cookie = await f.login();
    assert.equal(
      (await f.request("/api/reading", "POST", { messages: [null] }, cookie))
        .status,
      400,
    );
    assert.equal(
      (
        await f.request(
          "/api/reading",
          "POST",
          { messages: [{ role: "user", content: "x".repeat(20001) }] },
          cookie,
        )
      ).status,
      413,
    );
    assert.equal(
      (await (await f.request("/api/access", "GET", undefined, cookie)).json())
        .quota.totalRemaining,
      1,
    );
    assert.equal(
      (await f.request("/api/reading", "POST", { messages }, cookie)).status,
      502,
    );
    assert.equal(
      (await f.request("/api/reading", "POST", { messages }, cookie)).status,
      429,
    );
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});
test("同邀请码不能并发生成，处理中不重复扣费", async () => {
  let unblock, started;
  const gate = new Promise((r) => (unblock = r)),
    entered = new Promise((r) => (started = r));
  const f = await fixture({}, async () => {
    started();
    await gate;
    return Response.json({ choices: [{ message: { content: "完成" } }] });
  });
  try {
    const cookie = await f.login();
    const first = f.request("/api/reading", "POST", { messages }, cookie);
    await entered;
    assert.equal(
      (await f.request("/api/reading", "POST", { messages }, cookie)).status,
      409,
    );
    unblock();
    assert.equal((await first).status, 200);
    assert.equal(
      (await (await f.request("/api/access", "GET", undefined, cookie)).json())
        .quota.totalRemaining,
      19,
    );
  } finally {
    unblock();
    await f.close();
  }
});
test("不同邀请码争用最后一次全站额度时只有一个模型请求成功", async () => {
  let calls = 0;
  const f = await fixture({ TAROT_TOTAL_LIMIT: "1" }, async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: "成功" } }] });
  });
  try {
    const a = await f.login(),
      b = await f.login(code2);
    const results = await Promise.all([
      f.request("/api/reading", "POST", { messages }, a),
      f.request("/api/reading", "POST", { messages }, b),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 429]);
    assert.equal(calls, 1);
  } finally {
    await f.close();
  }
});
test("邀请码请求频率与失败登录次数受到限制", async () => {
  const f = await fixture({ TAROT_REQUESTS_PER_MINUTE: "1" });
  try {
    const cookie = await f.login();
    assert.equal(
      (await f.request("/api/reading", "POST", { messages }, cookie)).status,
      200,
    );
    assert.equal(
      (await f.request("/api/reading", "POST", { messages }, cookie)).status,
      429,
    );
    for (let i = 0; i < 9; i++)
      assert.equal(
        (await f.request("/api/access", "POST", { code: "bad" })).status,
        401,
      );
    assert.equal(
      (await f.request("/api/access", "POST", { code: "bad" })).status,
      429,
    );
  } finally {
    await f.close();
  }
});
test("重启后额度保持且在北京时间零点只重置每日额度", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tarot-quota-"));
  let clock = Date.parse("2026-11-06T15:59:59Z");
  const file = join(dir, "usage.json"),
    limits = { daily: 1, total: 3, globalDaily: 10, globalTotal: 100 };
  try {
    const a = new UsageStore(file, limits, () => clock);
    await a.ready;
    await a.reserve(hash(code));
    const b = new UsageStore(file, limits, () => clock);
    await b.ready;
    assert.equal(b.quota(hash(code)).dailyRemaining, 0);
    assert.equal(b.quota(hash(code)).totalRemaining, 2);
    await assert.rejects(b.reserve(hash(code)), /今日/);
    clock += 2000;
    assert.equal(b.quota(hash(code)).dailyRemaining, 1);
    await b.reserve(hash(code));
    assert.equal(b.quota(hash(code)).totalRemaining, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("额度文件损坏或无法写入时停止调用，写入失败不推进内存计数", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tarot-corrupt-"));
  const file = join(dir, "usage.json");
  try {
    await writeFile(file, "corrupted");
    const store = new UsageStore(file, {
      daily: 5,
      total: 20,
      globalDaily: 100,
      globalTotal: 1000,
    });
    await assert.rejects(store.ready);
    await rm(file);
    const good = new UsageStore(file, {
      daily: 5,
      total: 20,
      globalDaily: 100,
      globalTotal: 1000,
    });
    await good.ready;
    good.save = async () => {
      throw Error("disk unavailable");
    };
    await assert.rejects(good.reserve(hash(code)), /disk/);
    assert.equal(good.quota(hash(code)).dailyRemaining, 5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("移除邀请码后旧会话立即失效，重新加入时额度不重置", async () => {
  const f = await fixture();
  try {
    const cookie = await f.login();
    await f.request("/api/reading", "POST", { messages }, cookie);
    const revoked = createHostedAccess({ ...f.deployment, codes: [code2] });
    await revoked.ready;
    assert.equal(revoked.authenticate({ headers: { cookie } }), null);
    const restored = createHostedAccess(f.deployment);
    await restored.ready;
    assert.equal(
      (await restored.status({ headers: { cookie } })).quota.totalRemaining,
      19,
    );
  } finally {
    await f.close();
  }
});

test("全站每日额度限制不同邀请码，达到上限后不再发起模型调用", async () => {
  let calls = 0;
  const f = await fixture({ TAROT_DAILY_LIMIT: "1" }, async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: "完成" } }] });
  });
  try {
    const a = await f.login(),
      b = await f.login(code2);
    assert.equal(
      (await f.request("/api/reading", "POST", { messages }, a)).status,
      200,
    );
    assert.equal(
      (await f.request("/api/reading", "POST", { messages }, b)).status,
      429,
    );
    assert.equal(calls, 1);
    assert.equal(
      (await (await f.request("/api/access", "GET", undefined, b)).json()).quota
        .dailyRemaining,
      0,
    );
  } finally {
    await f.close();
  }
});
test("全站并发上限跨邀请码生效，完成后释放名额", async () => {
  let start, release;
  const began = new Promise((r) => (start = r)),
    gate = new Promise((r) => (release = r));
  const f = await fixture({ TAROT_CONCURRENT_LIMIT: "1" }, async () => {
    start();
    await gate;
    return Response.json({ choices: [{ message: { content: "完成" } }] });
  });
  try {
    const a = await f.login(),
      b = await f.login(code2);
    const first = f.request("/api/reading", "POST", { messages }, a);
    await began;
    assert.equal(
      (await f.request("/api/reading", "POST", { messages }, b)).status,
      429,
    );
    release();
    assert.equal((await first).status, 200);
    assert.equal(
      (await f.request("/api/reading", "POST", { messages }, b)).status,
      200,
    );
  } finally {
    release();
    await f.close();
  }
});
test("服务端密钥失效时提示联系邀请人，不让访客配置模型", async () => {
  const f = await fixture({}, async () => new Response(key, { status: 401 }));
  try {
    const cookie = await f.login();
    const r = await f.request("/api/reading", "POST", { messages }, cookie);
    assert.equal(r.status, 502);
    const text = JSON.stringify(await r.json());
    assert.match(text, /联系邀请人/);
    assert.ok(!text.includes(key));
  } finally {
    await f.close();
  }
});
test("部署产物包含持久化磁盘、健康检查、测试构建和秘密生成工具", async () => {
  const { readFileSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const yaml = readFileSync(new URL("../render.yaml", import.meta.url), "utf8");
  assert.match(yaml, /numInstances: 1/);
  assert.match(yaml, /healthCheckPath: \/healthz/);
  assert.match(yaml, /buildCommand: npm test/);
  assert.match(yaml, /mountPath: \/var\/data\/tarot/);
  assert.match(yaml, /sync: false/);
  assert.ok(!yaml.includes(key));
  const output = execFileSync(
    process.execPath,
    [fileURLToPath(new URL("../scripts/create-secrets.mjs", import.meta.url))],
    { encoding: "utf8" },
  );
  const lines = Object.fromEntries(
    output
      .trim()
      .split("\n")
      .map((line) => {
        const pos = line.indexOf("=");
        return [line.slice(0, pos), line.slice(pos + 1)];
      }),
  );
  assert.ok(JSON.parse(lines.TAROT_INVITE_CODES)[0].length >= 16);
  assert.ok(lines.TAROT_SESSION_SECRET.length >= 32);
  const dir = await mkdtemp(join(tmpdir(), "tarot-deploy-check-"));
  try {
    const checked = execFileSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../scripts/check-deployment.mjs", import.meta.url),
        ),
      ],
      {
        encoding: "utf8",
        env: { ...process.env, ...envFor(join(dir, "usage.json")), DATABASE_URL: "", VERCEL: "" },
      },
    );
    assert.match(checked, /检查通过/);
    assert.ok(!checked.includes(key));
    assert.equal(
      JSON.parse(await readFile(join(dir, "usage.json"), "utf8")).global.total,
      0,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DeepSeek 官方线上接口关闭默认思考，避免短篇叙事额度耗在思考过程", async () => {
  const f = await fixture(
    { TAROT_API_BASE_URL: "https://api.deepseek.com" },
    async (url, options) => {
      assert.deepEqual(JSON.parse(options.body).thinking, { type: "disabled" });
      return Response.json({ choices: [{ message: { content: "有效来信" } }] });
    },
  );
  try {
    const cookie = await f.login();
    assert.equal(
      (await f.request("/api/reading", "POST", { messages }, cookie)).status,
      200,
    );
  } finally {
    await f.close();
  }
});


test("线上覆盖客户端系统消息后，仍保留牌灵视角与防止扭曲牌义的规则", async () => {
  const spirit = chooseSpirit(createSpirit(MAJOR_IDS), 15);
  const conversation = contextMessages(createSession("如何看待目前的关系？", "single", "", spirit));
  let calls = 0;
  const f = await fixture({}, async (_url, options) => {
    calls++;
    const input = JSON.parse(options.body);
    assert.equal(input.messages.filter(m => m.role === "system").length, 1);
    assert.match(input.messages[0].content, /按其中的观察重点、表达风格和追问方式/);
    assert.match(input.messages[0].content, /不得为了人设强行扭曲结论/);
    const payload = JSON.parse(input.messages[1].content);
    assert.equal(payload.牌灵档案.牌灵, "恶魔");
    assert.equal(payload.牌灵档案.focus, SPIRITS.m15.focus);
    assert.equal(payload.牌灵档案.性格依据.牌灵参考.来源.url, "https://017cafe.com/main_card/");
    assert.match(payload.牌灵档案.性格依据.说明, /并非原作者原话/);
    assert.match(input.messages[0].content, /不得把牌义资料冒称/);
    return Response.json({ choices: [{ message: { content: "测试解读" } }] });
  });
  try {
    const cookie = await f.login();
    const response = await f.request("/api/reading", "POST", { messages: conversation }, cookie);
    assert.equal(response.status, 200);
    assert.equal(calls, 1);
  } finally { await f.close(); }
});
