import { Pool } from "pg";
import { readFile } from "node:fs/promises";
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
try {
  if (!process.env.DATABASE_URL) throw Error();
  await pool.query(await readFile(new URL("../migrations/001-runtime.sql", import.meta.url), "utf8"));
  console.log("数据库初始化完成，已有额度保持不变。");
} catch {
  console.error("数据库初始化失败：请检查 DATABASE_URL、网络和数据库权限。");
  process.exitCode = 1;
} finally { await pool.end(); }
