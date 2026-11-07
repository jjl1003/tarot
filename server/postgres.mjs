import { Pool } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { AccessError, UsageStore, validateState } from "./hosted.mjs";

// One locked row is deliberately sufficient for a <=100-invite trial. Transactions
// never span model requests. Both rate limits and leases are shared by all instances.
export const LEASE_MS = 120000;
function validate(state) {
  validateState(state);
  for (const name of ["rates", "leases"]) {
    if (!state[name] || typeof state[name] !== "object" || Array.isArray(state[name]))
      throw Error("数据库额度记录损坏");
  }
  for (const value of Object.values(state.rates)) {
    if (!Number.isSafeInteger(value.start) || !Number.isSafeInteger(value.count) || value.count < 0)
      throw Error("数据库限流记录损坏");
  }
  for (const [hash, lease] of Object.entries(state.leases)) {
    if (!/^[a-f0-9]{64}$/.test(hash) || typeof lease.id !== "string" || !Number.isSafeInteger(lease.expires))
      throw Error("数据库并发记录损坏");
  }
}
export class PostgresStore {
  constructor(connectionString, limits, { pool } = {}) {
    this.limits = limits;
    this.pool = pool || new Pool({
      connectionString, max: 2, idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 15000, statement_timeout: 10000,
      allowExitOnIdle: true,
    });
    // No driver errors or connection strings should enter application logs.
    this.pool.on?.("error", () => {});
    this.readiness = null;
  }
  get ready() {
    // Share an in-flight check, but never cache a rejected initialization forever.
    this.readiness ||= this.check().catch(error => {
      this.readiness = null;
      throw error;
    });
    return this.readiness;
  }
  async check() {
    const result = await this.pool.query("SELECT state FROM tarot_runtime WHERE id = 1");
    if (result.rows.length !== 1)
      throw Object.assign(Error("请先初始化数据库"), { code: "TAROT_STATE_MISSING" });
    try { validate(result.rows[0].state); }
    catch { throw Object.assign(Error("数据库额度记录损坏"), { code: "TAROT_STATE_INVALID" }); }
  }
  quotaFor(state, hash, now) {
    return UsageStore.prototype.quota.call({ state, limits: this.limits, now: () => now }, hash);
  }
  async transaction(change) {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
      const result = await client.query("SELECT state FROM tarot_runtime WHERE id = 1 FOR UPDATE");
      if (result.rows.length !== 1) throw Error("数据库额度记录缺失");
      const state = result.rows[0].state;
      validate(state);
      // Read the database clock after acquiring the lock, never the instance clock.
      const clock = await client.query("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::text AS now");
      const now = Number(clock.rows[0].now);
      for (const [key, rate] of Object.entries(state.rates))
        if (now - rate.start >= 60000) delete state.rates[key];
      for (const [key, lease] of Object.entries(state.leases))
        if (lease.expires <= now) delete state.leases[key];
      const value = change(state, now);
      await client.query("UPDATE tarot_runtime SET state = $1::jsonb WHERE id = 1", [JSON.stringify(state)]);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  async quota(hash) {
    return this.transaction((state, now) => this.quotaFor(state, hash, now));
  }
  take(state, key, max, now) {
    const rate = state.rates[key] || { start: now, count: 0 };
    if (rate.count >= max) throw new AccessError(429, "操作太频繁，请稍后重试");
    rate.count++;
    state.rates[key] = rate;
  }
  async login(address) {
    // Commit the global counter even when an individual address is blocked.
    const blocked = await this.transaction((state, now) => {
      const key = "login:" + createHash("sha256").update(address).digest("hex");
      try {
        this.take(state, "login-global", 60, now);
        this.take(state, key, 10, now);
        return false;
      } catch (error) {
        if (error instanceof AccessError) return true;
        throw error;
      }
    });
    if (blocked) throw new AccessError(429, "操作太频繁，请稍后重试");
  }
  async begin(hash) {
    const id = randomUUID();
    const quota = await this.transaction((state, now) => {
      if (state.leases[hash]) throw new AccessError(409, "上一封来信仍在生成，请稍候");
      if (Object.keys(state.leases).length >= this.limits.concurrent)
        throw new AccessError(429, "现在有些忙，请稍后再试");
      const quota = this.quotaFor(state, hash, now);
      if (!quota.dailyRemaining) throw new AccessError(429, "今日体验额度已用完，请明天再来");
      if (!quota.totalRemaining) throw new AccessError(429, "本期体验额度已用完，请联系邀请人");
      this.take(state, "reading:" + hash, this.limits.perMinute, now);
      const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
      const invite = state.invites[hash] ||= { day: today, used: 0, total: 0 };
      for (const counter of [state.global, invite]) {
        if (counter.day !== today) { counter.day = today; counter.used = 0; }
        counter.used++;
        counter.total++;
      }
      state.leases[hash] = { id, expires: now + LEASE_MS };
      return this.quotaFor(state, hash, now);
    });
    return {
      quota,
      release: () => this.transaction((state) => {
        // An expired request must never release its successor's lease.
        if (state.leases[hash]?.id === id) delete state.leases[hash];
      }),
    };
  }
  async close() { await this.pool.end(); }
}
