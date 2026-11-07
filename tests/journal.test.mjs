import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PAGES,
  defaultPage,
  availablePages,
  paginateText,
  readingPages,
} from "../public/journal.js";
const session = (
  phase = "reading",
  messages = [{ role: "assistant", content: "已完成来信" }],
  pending = null,
) => ({ phase, messages, pending });
test("首次只开放提问和历史，抽牌前不能跳过仪式", () => {
  assert.equal(defaultPage(null), "setup");
  assert.deepEqual(availablePages(null), ["setup", "history"]);
  assert.equal(defaultPage(session("select", [])), "draw");
  assert.deepEqual(availablePages(session("select", [])), [
    "setup",
    "draw",
    "history",
  ]);
});
test("恢复会话时打开正确章节，补牌翻开后仍需在抽牌页手动开始", () => {
  assert.equal(defaultPage(session()), "reading");
  for (const phase of ["supplement-select", "supplement-reveal", "ready"])
    assert.equal(defaultPage(session(phase)), "draw");
  assert.equal(
    defaultPage(session("ready", [], { text: "未完成请求" })),
    "reading",
  );
  assert.deepEqual(availablePages(session()), PAGES);
});
test("长来信分页保持全文、段落和中文标点，无丢字或重复", () => {
  const original =
    "**段落标题**\n这是关于当前问题的具体解读。请保留自主选择！\n\n".repeat(40);
  for (const limit of [230, 440]) {
    const pages = paginateText(original, limit);
    assert.ok(pages.length > 1);
    assert.equal(pages.join(""), original);
    assert.ok(pages.every((p) => p.length <= limit && p.length > 0));
    assert.ok(
      pages.some(
        (p) => p.endsWith("\n") || p.endsWith("。") || p.endsWith("！"),
      ),
    );
  }
});
test("没有断句的长内容也可分页，空文本与非法长度有明确行为", () => {
  assert.deepEqual(paginateText(""), [""]);
  assert.deepEqual(paginateText("短来信"), ["短来信"]);
  assert.deepEqual(paginateText("x".repeat(45), 20), [
    "x".repeat(20),
    "x".repeat(20),
    "x".repeat(5),
  ]);
  for (const limit of [0, 19, 23.5])
    assert.throws(() => paginateText("正文", limit));
});
test("追问与回答的分页保持角色、消息次序和页码，原对话不变", () => {
  const messages = [
    { role: "assistant", content: "甲".repeat(45) },
    { role: "user", content: "我的追问" },
    { role: "assistant", content: "乙".repeat(25) },
  ];
  const before = structuredClone(messages);
  const pages = readingPages(messages, 20);
  assert.equal(pages.length, 6);
  assert.deepEqual(
    pages.map((p) => p.messageIndex),
    [0, 0, 0, 1, 2, 2],
  );
  assert.deepEqual(
    pages.slice(0, 3).map((p) => p.part),
    [1, 2, 3],
  );
  assert.equal(pages[0].total, 3);
  assert.equal(pages[3].role, "user");
  assert.equal(pages[4].role, "assistant");
  assert.deepEqual(messages, before);
  assert.deepEqual(readingPages([]), []);
});
test("主界面用独立书页和顶部章节导航，模型设置是原生弹窗", () => {
  const html = readFileSync(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  for (const page of PAGES) {
    assert.match(html, new RegExp(`id="tab-${page}"`));
    assert.match(html, new RegExp(`id="page-${page}"`));
  }
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 4);
  assert.match(html, /role="tablist"/);
  assert.match(html, /<dialog[^>]*id="settings-dialog"/);
  assert.match(html, /id="settings-open"[^>]*aria-haspopup="dialog"/);
  assert.ok(!html.includes("<details"));
  assert.match(html, /id="remember"/);
});
