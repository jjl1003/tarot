import { createHandler } from "../server.mjs";
import { loadDeployment, createHostedAccess } from "../server/hosted.mjs";

export function createVercelHandler(env = process.env, { store, fetchImpl } = {}) {
  const deployment = loadDeployment({ ...env, VERCEL: "1", NODE_ENV: "production", TAROT_MODE: "hosted" });
  const hosted = createHostedAccess(deployment, {
    ...(store ? { store } : {}),
    // Vercel overwrites this header; do not trust visitor-supplied proxy headers.
    clientAddress: req => {
      const value = req.headers["x-vercel-forwarded-for"];
      const address = Array.isArray(value) ? value[0] : value;
      return address?.split(",")[0].trim() || "unknown";
    },
  });
  return createHandler({ hosted, fetchImpl });
}

let handler;
export default async function vercelHandler(req, res) {
  try {
    handler ||= createVercelHandler();
    await handler(req, res);
  } catch {
    if (!res.headersSent) res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "体验服务暂不可用，请联系邀请人" }));
  }
}
