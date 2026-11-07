import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { PostgresStore, LEASE_MS } from "../server/postgres.mjs";
import { loadDeployment, createHostedAccess } from "../server/hosted.mjs";
import { createHandler } from "../server.mjs";
import vercelHandler, { createVercelHandler } from "../api/index.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const code = "test-invitation-code-01", code2 = "test-invitation-code-02";
const limits = { daily: 5, total: 20, globalDaily: 100, globalTotal: 1000, perMinute: 2, concurrent: 3 };
const migration = await readFile(new URL("../migrations/001-runtime.sql", import.meta.url), "utf8");
const env = {
  TAROT_MODE: "hosted", APP_ORIGIN: "https://tarot.example",
  TAROT_API_BASE_URL: "https://provider.example/v1", TAROT_API_KEY: "server-only-key",
  TAROT_MODEL: "test-model", TAROT_INVITE_CODES: JSON.stringify([code, code2]),
  TAROT_SESSION_SECRET: "session-secret-with-at-least-32-characters",
  DATABASE_URL: "postgresql://test:secret@localhost/test",
};
// PGlite is real PostgreSQL compiled to WASM with a single connection. The adapter
// serializes connection checkout as a size-one pg Pool would. Production row-lock
// behavior across network connections still needs a deployed Neon smoke test.
async function database() {
  const db = new PGlite();
  await db.exec(migration);
  let tail = Promise.resolve(), clock = Date.parse("2026-11-06T15:59:00Z");
  const query = (sql, params) => sql.startsWith("SELECT floor(extract")
    ? Promise.resolve({ rows: [{ now: String(clock) }] }) : db.query(sql, params);
  const pool = {
    async connect() {
      const previous = tail;
      let unlock;
      tail = new Promise(resolve => { unlock = resolve; });
      await previous;
      return { query, release: unlock };
    },
    async query(sql, params) {
      const client = await this.connect();
      try { return await client.query(sql, params); } finally { client.release(); }
    },
    end() {},
  };
  return { db, pool, advance(ms) { clock += ms; }, close: () => db.close(),
    store(overrides = {}) { return new PostgresStore("unused", { ...limits, ...overrides }, { pool }); } };
}
async function invoke(handler, path, { method = "GET", body, cookie, origin = env.APP_ORIGIN, host = "tarot.example", headers: customHeaders = {} } = {}) {
  let status, headers, text, ended = false;
  const req = { url: path, method, body, socket: { remoteAddress: "127.0.0.1" }, headers: {
    host, ...(method === "GET" ? {} : { origin, "content-type": "application/json" }),
    ...(cookie ? { cookie } : {}), ...customHeaders,
  } };
  const extra = {};
  const res = { headersSent: false, setHeader(k, v) { extra[k.toLowerCase()] = v; },
    writeHead(s, h) { status = s; headers = { ...h, ...extra }; this.headersSent = true; },
    end(value) { text = value; ended = true; } };
  await handler(req, res);
  assert.ok(ended);
  return { status, headers, json: JSON.parse(text) };
}

test("Vercel 必须使用数据库并显式配置正式域名，配置不会降级为文件存储", () => {
  assert.equal(loadDeployment(env).usageFile, null);
  assert.equal(loadDeployment(env).databaseUrl, env.DATABASE_URL);
  assert.throws(() => loadDeployment({ ...env, VERCEL: "1", DATABASE_URL: "", TAROT_USAGE_FILE: "/tmp/test" }));
  assert.throws(() => loadDeployment({ ...env, DATABASE_URL: "https://wrong" }));
  assert.throws(() => loadDeployment({ ...env, APP_ORIGIN: "" }));
});

test("数据库迁移重复执行不清空数据；多实例最后一次额度只有一个成功且重建存储不重置", async () => {
  const f = await database();
  try {
    const a = f.store({ globalTotal: 1 }), b = f.store({ globalTotal: 1 });
    await Promise.all([a.ready, b.ready]);
    const clock = await f.db.query("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::text AS now");
    assert.ok(Number.isSafeInteger(Number(clock.rows[0].now)));
    const results = await Promise.allSettled([a.begin(hash(code)), b.begin(hash(code2))]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    assert.equal(results.find(r => r.status === "rejected").reason.status, 429);
    await f.db.exec(migration);
    const c = f.store({ globalTotal: 1 });
    await c.ready;
    assert.equal((await c.quota(hash(code))).totalRemaining, 0);
    await results.find(r => r.status === "fulfilled").value.release();
  } finally { await f.close(); }
});

test("跨实例同邀请码不能并发；超时租约自动回收，旧请求不能释放新租约", async () => {
  const f = await database();
  try {
    const a = f.store(), b = f.store();
    const first = await a.begin(hash(code));
    await assert.rejects(b.begin(hash(code)), e => e.status === 409);
    assert.equal((await b.quota(hash(code))).totalRemaining, 19);
    f.advance(LEASE_MS + 1);
    const next = await b.begin(hash(code));
    await first.release();
    await assert.rejects(a.begin(hash(code)), e => e.status === 409);
    await next.release();
    assert.equal((await a.quota(hash(code))).totalRemaining, 18);
  } finally { await f.close(); }
});

test("跨实例并发上限和请求频率生效，拒绝的请求不扣额度", async () => {
  const f = await database();
  try {
    const a = f.store({ concurrent: 1, perMinute: 1 }), b = f.store({ concurrent: 1, perMinute: 1 });
    const first = await a.begin(hash(code));
    await assert.rejects(b.begin(hash(code2)), e => e.status === 429);
    await first.release();
    await assert.rejects(b.begin(hash(code)), e => e.status === 429);
    assert.equal((await b.quota(hash(code2))).totalRemaining, 20);
    const other = await b.begin(hash(code2));
    await other.release();
    f.advance(60001);
    await (await b.begin(hash(code))).release();
  } finally { await f.close(); }
});

test("北京时间零点仅重置每日额度，全站每日额度在邀请码间共享", async () => {
  const f = await database();
  try {
    const a = f.store({ daily: 1, globalDaily: 1 });
    await (await a.begin(hash(code))).release();
    await assert.rejects(a.begin(hash(code2)), /今日/);
    f.advance(60001);
    assert.equal((await a.quota(hash(code))).dailyRemaining, 1);
    assert.equal((await a.quota(hash(code))).totalRemaining, 19);
    await (await a.begin(hash(code))).release();
    assert.equal((await a.quota(hash(code))).totalRemaining, 18);
  } finally { await f.close(); }
});

test("失败登录跨实例限流，数据库不保存明文邀请码、IP 或对话", async () => {
  const f = await database();
  try {
    const a = f.store(), b = f.store();
    for (let i = 0; i < 10; i++) await (i % 2 ? a : b).login("192.0.2.1");
    await assert.rejects(b.login("192.0.2.1"), e => e.status === 429);
    await a.login("192.0.2.2");
    await (await b.begin(hash(code))).release();
    const state = JSON.stringify((await f.db.query("SELECT state FROM tarot_runtime WHERE id = 1")).rows[0].state);
    for (const value of [code, "192.0.2.1", env.TAROT_API_KEY]) assert.ok(!state.includes(value));
    f.advance(60001);
    await a.login("192.0.2.1");
    for (let i = 0; i < 59; i++) await a.login(`address-${i}`);
    await assert.rejects(b.login("new-address"), e => e.status === 429);
  } finally { await f.close(); }
});

test("数据库提交失败回滚额度和租约，数据缺失或损坏时拒绝服务", async () => {
  const f = await database();
  try {
    const a = f.store(); await a.ready;
    const original = f.pool.connect;
    f.pool.connect = async function () {
      const client = await original.call(this);
      const query = client.query;
      client.query = (sql, params) => sql.startsWith("UPDATE") ? Promise.reject(Error("write failed")) : query(sql, params);
      return client;
    };
    await assert.rejects(a.begin(hash(code)), /write failed/);
    f.pool.connect = original;
    assert.equal((await a.quota(hash(code))).totalRemaining, 20);
    await (await a.begin(hash(code))).release();
    await f.db.query("UPDATE tarot_runtime SET state = '{}'::jsonb WHERE id = 1");
    await assert.rejects(a.begin(hash(code)), /损坏/);
    await f.db.query("DELETE FROM tarot_runtime");
    await assert.rejects(f.store().ready, /初始化/);
  } finally { await f.close(); }
});

test("函数处理器使用解析后的请求体、固定服务端模型和 Cookie，失败计次并在响应前释放租约", async () => {
  const f = await database();
  try {
    const store = f.store();
    const hosted = createHostedAccess(loadDeployment(env), { store });
    let calls = 0;
    const handler = createHandler({ hosted, fetchImpl: async (_url, options) => {
      calls++;
      assert.equal(options.headers.Authorization, `Bearer ${env.TAROT_API_KEY}`);
      return new Response("provider error", { status: 500 });
    } });
    const login = await invoke(handler, "/api/access", { method: "POST", body: { code } });
    assert.equal(login.status, 200);
    const cookie = login.headers["set-cookie"].split(";")[0];
    assert.equal((await invoke(handler, "/api/reading", { method: "POST", body: { messages: [] }, cookie })).status, 400);
    assert.equal((await invoke(handler, "/api/reading", { method: "POST", body: "{malformed", cookie })).status, 400);
    assert.equal((await invoke(handler, "/api/reading", { method: "POST", body: { messages: [{ role: "user", content: "x".repeat(262145) }] }, cookie })).status, 413);
    assert.equal(calls, 0);
    const response = await invoke(handler, "/api/reading", { method: "POST", body: { messages: [{ role: "user", content: "问题" }] }, cookie });
    assert.equal(response.status, 502);
    assert.equal(calls, 1);
    assert.equal((await store.quota(hash(code))).totalRemaining, 19);
    const state = (await f.db.query("SELECT state FROM tarot_runtime WHERE id = 1")).rows[0].state;
    assert.deepEqual(state.leases, {});
    await f.db.query("DELETE FROM tarot_runtime");
    assert.equal((await invoke(handler, "/healthz")).status, 503);
    const failed = await invoke(handler, "/api/reading", { method: "POST", body: { messages: [{ role: "user", content: "问题" }] }, cookie });
    assert.equal(failed.status, 503);
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test("缺少部署配置的 Vercel 入口返回脱敏 503，部署配置包含测试构建和函数时限", async () => {
  const previous = process.env.TAROT_API_KEY;
  process.env.TAROT_API_KEY = "";
  let result;
  try { result = await invoke(vercelHandler, "/api/runtime"); }
  finally {
    if (previous === undefined) delete process.env.TAROT_API_KEY;
    else process.env.TAROT_API_KEY = previous;
  }
  assert.equal(result.status, 503);
  assert.ok(!JSON.stringify(result.json).includes("postgresql://"));
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.equal(config.buildCommand, "npm test");
  assert.equal(config.outputDirectory, "public");
  assert.ok(config.functions["api/index.mjs"].maxDuration < LEASE_MS / 1000);
  assert.ok(config.rewrites.some(rule => rule.source === "/healthz"));
});

test("Vercel 实际入口保留路由和来源检查，登录限流使用平台地址且忽略伪造 XFF", async () => {
  const f = await database();
  try {
    const store = f.store();
    const handler = createVercelHandler(env, { store, fetchImpl: async () => Response.json({ choices: [{ message: { content: "有效解读" } }] }) });
    assert.equal((await invoke(handler, "/api/runtime")).json.mode, "hosted");
    assert.equal((await invoke(handler, "/healthz")).status, 200);
    const headers = { "x-vercel-forwarded-for": "192.0.2.1", "x-forwarded-for": "forged" };
    const login = await invoke(handler, "/api/access", { method: "POST", body: { code }, headers });
    const cookie = login.headers["set-cookie"].split(";")[0];
    const body = { messages: [{ role: "user", content: "问题" }] };
    assert.equal((await invoke(handler, "/api/reading", { method: "POST", body, cookie, origin: "https://evil.example" })).status, 403);
    assert.equal((await invoke(handler, "/api/runtime", { host: "evil.example" })).status, 403);
    assert.equal((await invoke(handler, "/api/reading", { method: "POST", body, cookie })).status, 200);
    for (let i = 0; i < 9; i++) {
      const result = await invoke(handler, "/api/access", { method: "POST", body: { code: "bad" }, headers: { ...headers, "x-forwarded-for": `forged-${i}` } });
      assert.equal(result.status, 401);
    }
    assert.equal((await invoke(handler, "/api/access", { method: "POST", body: { code }, headers })).status, 429);
    assert.equal((await invoke(handler, "/api/access", { method: "POST", body: { code }, headers: { "x-vercel-forwarded-for": "192.0.2.2" } })).status, 200);
  } finally { await f.close(); }
});
