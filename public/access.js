export function readingPayload(mode, config, messages) {
  if (mode === "hosted") return { messages };
  if (mode === "local") return { config, messages };
  throw Error("正在连接体验服务，请稍后再试");
}
export function quotaText(quota) {
  return quota
    ? `今日剩余 ${quota.dailyRemaining} 次 · 累计剩余 ${quota.totalRemaining} 次`
    : "输入邀请码，开启你的手札";
}
