import {
  createHash,
  createHmac,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { readFile, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const day = (now) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
export class AccessError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function integer(value, fallback, max = 1000000) {
  const n = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < 1 || n > max)
    throw Error("部署额度配置必须为范围内的正整数");
  return n;
}
export function loadDeployment(env = process.env) {
  const mode =
    env.TAROT_MODE || (env.NODE_ENV === "production" ? "hosted" : "local");
  if (!["local", "hosted"].includes(mode))
    throw Error("TAROT_MODE 只能为 local 或 hosted");
  if (mode === "local") {
    if (
      env.NODE_ENV === "production" ||
      (env.HOST && !["127.0.0.1", "localhost", "::1"].includes(env.HOST))
    )
      throw Error("公开部署必须启用 hosted 模式");
    return null;
  }
  let origin, upstream, codes;
  try {
    origin = new URL(env.APP_ORIGIN || env.RENDER_EXTERNAL_URL);
    upstream = new URL(env.TAROT_API_BASE_URL);
    codes = JSON.parse(env.TAROT_INVITE_CODES || "[]");
  } catch {
    throw Error("请配置有效的 APP_ORIGIN、模型服务地址及邀请码列表");
  }
  if (
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    !["http:", "https:"].includes(origin.protocol)
  )
    throw Error("APP_ORIGIN 必须为网站根地址");
  if (
    origin.protocol !== "https:" &&
    (env.NODE_ENV === "production" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
  )
    throw Error("公开网站必须使用 HTTPS");
  if (
    upstream.protocol !== "https:" ||
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash
  )
    throw Error("线上模型服务必须使用不含账号或查询参数的 HTTPS 地址");
  if (!env.TAROT_API_KEY?.trim() || !env.TAROT_MODEL?.trim())
    throw Error("请在服务端配置模型密钥与模型名");
  if (!env.TAROT_SESSION_SECRET || env.TAROT_SESSION_SECRET.length < 32)
    throw Error("会话签名密钥至少需要 32 个字符");
  if (
    !Array.isArray(codes) ||
    codes.length < 1 ||
    codes.length > 100 ||
    codes.some(
      (c) =>
        typeof c !== "string" ||
        c.length < 16 ||
        c.length > 128 ||
        c.trim() !== c,
    ) ||
    new Set(codes).size !== codes.length
  )
    throw Error("需要 1 至 100 个互不重复、至少 16 字符的邀请码");
  if (!env.TAROT_USAGE_FILE)
    throw Error("请配置持久化额度文件 TAROT_USAGE_FILE");
  return {
    origin: origin.origin,
    config: {
      baseUrl: upstream.href,
      model: env.TAROT_MODEL.trim(),
      apiKey: env.TAROT_API_KEY.trim(),
    },
    codes,
    secret: env.TAROT_SESSION_SECRET,
    usageFile: resolve(env.TAROT_USAGE_FILE),
    limits: {
      daily: integer(env.TAROT_INVITE_DAILY_LIMIT, 5),
      total: integer(env.TAROT_INVITE_TOTAL_LIMIT, 20),
      globalDaily: integer(env.TAROT_DAILY_LIMIT, 100),
      globalTotal: integer(env.TAROT_TOTAL_LIMIT, 1000),
      perMinute: integer(env.TAROT_REQUESTS_PER_MINUTE, 2, 60),
      concurrent: integer(env.TAROT_CONCURRENT_LIMIT, 3, 20),
      maxInput: integer(env.TAROT_MAX_INPUT_CHARS, 20000, 100000),
      maxTokens: integer(env.TAROT_MAX_OUTPUT_TOKENS, 2048, 4096),
    },
  };
}
function validateState(state) {
  const counter = (c) =>
    c &&
    typeof c.day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(c.day) &&
    Number.isSafeInteger(c.used) &&
    c.used >= 0 &&
    Number.isSafeInteger(c.total) &&
    c.total >= c.used;
  if (
    state?.version !== 1 ||
    !counter(state.global) ||
    !state.invites ||
    typeof state.invites !== "object" ||
    Array.isArray(state.invites) ||
    Object.entries(state.invites).some(
      ([key, c]) => !/^[a-f0-9]{64}$/.test(key) || !counter(c),
    )
  )
    throw Error("额度记录损坏，已停止模型调用");
}
export class UsageStore {
  constructor(file, limits, now = Date.now) {
    this.file = file;
    this.limits = limits;
    this.now = now;
    this.tail = Promise.resolve();
    this.ready = this.load();
  }
  async load() {
    try {
      this.state = JSON.parse(await readFile(this.file, "utf8"));
      validateState(this.state);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      this.state = {
        version: 1,
        global: { day: day(this.now()), used: 0, total: 0 },
        invites: {},
      };
      await this.save(this.state);
    }
  }
  async save(state) {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = this.file + "." + randomUUID() + ".tmp";
    let file;
    try {
      file = await open(temp, "wx", 0o600);
      await file.writeFile(JSON.stringify(state));
      await file.sync();
      await file.close();
      file = null;
      await rename(temp, this.file);
    } finally {
      if (file) await file.close();
      await rm(temp, { force: true });
    }
  }
  quota(hash, state = this.state) {
    const today = day(this.now());
    const invite = state.invites[hash] || { day: today, used: 0, total: 0 };
    return {
      dailyRemaining: Math.max(
        0,
        Math.min(
          this.limits.daily - (invite.day === today ? invite.used : 0),
          this.limits.globalDaily -
            (state.global.day === today ? state.global.used : 0),
        ),
      ),
      totalRemaining: Math.max(
        0,
        Math.min(
          this.limits.total - invite.total,
          this.limits.globalTotal - state.global.total,
        ),
      ),
      dailyLimit: this.limits.daily,
      totalLimit: this.limits.total,
      resetsAt: "北京时间每天零点",
    };
  }
  reserve(hash) {
    const work = this.tail.then(async () => {
      await this.ready;
      const quota = this.quota(hash);
      if (!quota.dailyRemaining)
        throw new AccessError(429, "今日体验额度已用完，请明天再来");
      if (!quota.totalRemaining)
        throw new AccessError(429, "本期体验额度已用完，请联系邀请人");
      const next = structuredClone(this.state),
        today = day(this.now());
      for (const c of [
        next.global,
        (next.invites[hash] ??= { day: today, used: 0, total: 0 }),
      ]) {
        if (c.day !== today) {
          c.day = today;
          c.used = 0;
        }
        c.used++;
        c.total++;
      }
      await this.save(next);
      this.state = next;
      return this.quota(hash);
    });
    this.tail = work.catch(() => {});
    return work;
  }
}
class WindowRate {
  constructor(now) {
    this.now = now;
    this.entries = new Map();
  }
  take(key, max) {
    const now = this.now(),
      entry = this.entries.get(key);
    if (!entry || now - entry.start >= 60000) {
      if (this.entries.size >= 1000)
        this.entries.delete(this.entries.keys().next().value);
      this.entries.set(key, { start: now, count: 1 });
      return;
    }
    if (entry.count >= max)
      throw new AccessError(429, "操作太频繁，请一分钟后再试");
    entry.count++;
  }
}
export function createHostedAccess(
  deployment,
  {
    now = Date.now,
    store = new UsageStore(deployment.usageFile, deployment.limits, now),
  } = {},
) {
  const hashes = new Set(deployment.codes.map(digest)),
    rate = new WindowRate(now),
    active = new Set();
  const secure = new URL(deployment.origin).protocol === "https:";
  const cookieName = secure ? "__Host-tarot_session" : "tarot_session";
  const sign = (body) =>
    createHmac("sha256", deployment.secret).update(body).digest("base64url");
  function authenticate(req) {
    const token = (req.headers.cookie || "")
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (!token || token.length > 1000) return null;
    try {
      const [body, signature, ...extra] = token.split(".");
      if (extra.length) return null;
      const a = Buffer.from(signature || ""),
        b = Buffer.from(sign(body));
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const value = JSON.parse(Buffer.from(body, "base64url").toString());
      if (
        !Number.isFinite(value.exp) ||
        value.exp <= now() ||
        !hashes.has(value.invite)
      )
        return null;
      return value.invite;
    } catch {
      return null;
    }
  }
  function cookie(value, maxAge = 604800) {
    return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  }
  return {
    deployment,
    ready: store.ready,
    authenticate,
    publicStatus: () => ({ mode: "hosted", model: deployment.config.model }),
    status: async (req) => {
      await store.ready;
      const hash = authenticate(req);
      return hash
        ? { authenticated: true, quota: store.quota(hash) }
        : { authenticated: false };
    },
    async login(req, code) {
      rate.take("login-global", 60);
      rate.take("login:" + req.socket.remoteAddress, 10);
      await store.ready;
      if (
        typeof code !== "string" ||
        code.length > 128 ||
        !hashes.has(digest(code))
      )
        throw new AccessError(401, "邀请码不正确或已失效");
      const hash = digest(code);
      const body = Buffer.from(
        JSON.stringify({ invite: hash, exp: now() + 604800000 }),
      ).toString("base64url");
      return {
        cookie: cookie(body + "." + sign(body)),
        status: { authenticated: true, quota: store.quota(hash) },
      };
    },
    logout: () => cookie("", 0),
    async begin(req) {
      const hash = authenticate(req);
      if (!hash) throw new AccessError(401, "请先输入有效邀请码");
      if (active.has(hash))
        throw new AccessError(409, "上一封来信仍在生成，请稍候");
      if (active.size >= deployment.limits.concurrent)
        throw new AccessError(429, "现在有些忙，请稍后再试");
      rate.take("reading:" + hash, deployment.limits.perMinute);
      active.add(hash);
      try {
        const quota = await store.reserve(hash);
        return { quota, release: () => active.delete(hash) };
      } catch (e) {
        active.delete(hash);
        throw e;
      }
    },
    redact(text) {
      for (const secret of [
        deployment.config.apiKey,
        deployment.secret,
        ...deployment.codes,
      ])
        text = text.split(secret).join("[已隐藏密钥]");
      return text;
    },
  };
}
