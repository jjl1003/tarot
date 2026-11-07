import { loadDeployment, createHostedAccess } from "../server/hosted.mjs";
try {
  const config = loadDeployment();
  if (!config) throw Error("请设置 TAROT_MODE=hosted");
  const access = createHostedAccess(config);
  await access.ready;
  console.log("部署配置与额度持久化存储检查通过。未调用模型。");
} catch (error) {
  console.error("部署检查未通过：" + error.message);
  process.exitCode = 1;
}
