import { loadDeployment, createHostedAccess } from "../server/hosted.mjs";
let access;
try {
  const config = loadDeployment();
  if (!config) throw Error("请设置 TAROT_MODE=hosted");
  access = createHostedAccess(config);
  await access.ready;
  console.log("部署配置与额度持久化存储检查通过。未调用模型。");
} catch {
  console.error("部署检查未通过：请检查服务端配置、数据库初始化和存储连接。");
  process.exitCode = 1;
} finally { await access?.close(); }
