export const PAGES = ["setup", "draw", "reading", "history"];
export function defaultPage(session) {
  if (!session) return "setup";
  if (
    ["supplement-select", "supplement-reveal", "ready"].includes(
      session.phase,
    ) &&
    !session.pending
  )
    return "draw";
  return session.messages.length || session.pending ? "reading" : "draw";
}
export function availablePages(session) {
  return PAGES.filter(
    (page) =>
      page === "setup" ||
      page === "history" ||
      (session &&
        (page === "draw" || session.messages.length || session.pending)),
  );
}
export function paginateText(text, limit = 440) {
  if (!Number.isInteger(limit) || limit < 20) throw Error("分页长度至少为 20");
  if (!text) return [""];
  const pages = [];
  let rest = text;
  while (rest.length > limit) {
    const candidate = rest.slice(0, limit);
    const boundary = Math.max(
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf("。"),
      candidate.lastIndexOf("！"),
      candidate.lastIndexOf("？"),
    );
    const end = boundary >= limit / 2 ? boundary + 1 : limit;
    pages.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  if (rest) pages.push(rest);
  return pages;
}
export function readingPages(messages, limit = 440) {
  return messages.flatMap((m, messageIndex) =>
    paginateText(m.content, limit).map((content, part, parts) => ({
      role: m.role,
      content,
      messageIndex,
      part: part + 1,
      total: parts.length,
    })),
  );
}
