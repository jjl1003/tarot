import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { CARDS } from "../public/cards.js";
import {
  SPREADS,
  shuffle,
  createSession,
  transition,
  contextMessages,
  validateConfig,
  saveConfig,
  saveSessions,
  loadSessions,
  deleteSession,
  formatMessage,
  STORE,
  CONFIG,
} from "../public/core.js";
const memory = () => {
  const m = new Map();
  return { setItem: (k, v) => m.set(k, v), getItem: (k) => m.get(k) ?? null };
};
function drawn(spread = "insight") {
  let s = createSession("如何面对换工作的顾虑？", spread, "test-model");
  s = transition(s, "shuffle", null, () => 0.3);
  s = transition(s, "cut", 20);
  for (let i = 0; i < SPREADS[spread].positions.length; i++)
    s = transition(s, "select", s.deck[0], () => 0.7);
  return s;
}
test("完整 78 张牌，独立牌名、正逆位牌义和本地图片", () => {
  assert.equal(CARDS.length, 78);
  assert.equal(new Set(CARDS.map((c) => c.id)).size, 78);
  assert.equal(new Set(CARDS.map((c) => c.name)).size, 78);
  for (const c of CARDS) {
    assert.ok(c.upright);
    assert.ok(c.reversed);
    assert.notEqual(c.upright, c.reversed);
    assert.ok(
      statSync(new URL("../public" + c.image, import.meta.url)).size > 1000,
    );
  }
});
test("Fisher–Yates 保留所有牌且不修改输入，切牌真实旋转顺序", () => {
  const ids = CARDS.map((c) => c.id);
  assert.deepEqual(new Set(shuffle(ids, () => 0.2)), new Set(ids));
  assert.deepEqual(
    ids,
    CARDS.map((c) => c.id),
  );
  let s = transition(
    createSession("问题", "single"),
    "shuffle",
    null,
    () => 0.2,
  );
  const old = [...s.deck];
  s = transition(s, "cut", 17);
  assert.deepEqual(s.deck, [...old.slice(17), ...old.slice(0, 17)]);
  assert.equal(s.cut, 17);
});
for (const spread of Object.keys(SPREADS))
  test(`牌阵 ${spread} 数量、牌位、翻牌与不可改牌`, () => {
    let s = drawn(spread);
    assert.equal(s.phase, "reveal");
    assert.deepEqual(
      s.cards.map((c) => c.position),
      SPREADS[spread].positions,
    );
    assert.ok(s.cards.every((c) => !c.revealed && !c.reversed));
    assert.equal(new Set([...s.deck, ...s.cards.map((c) => c.id)]).size, 78);
    assert.throws(() => transition(s, "select", s.deck[0]));
    for (let i = 0; i < s.cards.length; i++) {
      s = transition(s, "reveal", i);
      assert.equal(s.phase, i === s.cards.length - 1 ? "ready" : "reveal");
    }
    assert.throws(() => transition(s, "reveal", 0));
    assert.throws(() => transition(s, "shuffle"));
  });
test("非法操作、空问题与非法切牌均拒绝", () => {
  assert.throws(() => createSession("  ", "single"));
  assert.throws(() => createSession("问题", "bad"));
  const s = createSession("问题", "single");
  for (const action of ["cut", "select", "reveal", "supplement"])
    assert.throws(() => transition(s, action, 1));
  const cut = transition(s, "shuffle");
  for (const n of [0, 78, -1, 1.5])
    assert.throws(() => transition(cut, "cut", n));
});
test("正逆位确定并随保存恢复保持，补牌从剩余堆且最多一次", () => {
  let s = drawn();
  for (let i = 0; i < 3; i++) s = transition(s, "reveal", i);
  s.phase = "reading";
  const originals = structuredClone(s.cards);
  s = transition(s, "supplement");
  const chosen = s.deck[4];
  s = transition(s, "select", chosen, () => 0.1);
  assert.equal(s.phase, "supplement-reveal");
  assert.equal(s.cards[3].reversed, true);
  assert.equal(s.cards[3].position, "补充指引");
  assert.equal(s.supplementUsed, true);
  assert.deepEqual(s.cards.slice(0, 3), originals);
  s = transition(s, "reveal", 3);
  s.pending = { text: "补牌追问" };
  const storage = memory();
  saveSessions(storage, [s], s.id);
  const restored = loadSessions(storage).sessions[0];
  assert.deepEqual(restored, s);
  restored.phase = "reading";
  assert.throws(() => transition(restored, "supplement"));
  assert.equal(new Set([...s.deck, ...s.cards.map((c) => c.id)]).size, 78);
});
test("上下文包含问题、所有牌位、方向、独立牌义与完整对话", () => {
  const s = drawn();
  s.messages = [
    { role: "assistant", content: "首轮解读" },
    { role: "user", content: "前次追问" },
    { role: "assistant", content: "前次回答" },
  ];
  s.pending = { text: "本次追问" };
  const messages = contextMessages(s);
  assert.equal(messages.at(-1).content, "本次追问");
  assert.equal(messages[2].content, "首轮解读");
  const data = JSON.parse(messages[1].content);
  assert.equal(data.原问题, s.question);
  assert.equal(data.牌面.length, 3);
  assert.deepEqual(
    data.牌面.map((c) => c.牌位),
    SPREADS.insight.positions,
  );
  assert.ok(data.牌面.every((c) => c.方向 === "正位" && c.基础牌义));
});
test("默认不存密钥，主动保存，取消记住立即清除且不影响历史", () => {
  const storage = memory();
  const cfg = {
    baseUrl: "https://example.com/v1",
    model: "model",
    apiKey: "test-secret",
    remember: false,
  };
  saveConfig(storage, cfg);
  assert.ok(!storage.getItem(CONFIG).includes(cfg.apiKey));
  saveConfig(storage, { ...cfg, remember: true });
  assert.equal(JSON.parse(storage.getItem(CONFIG)).apiKey, cfg.apiKey);
  saveConfig(storage, cfg);
  assert.ok(!storage.getItem(CONFIG).includes(cfg.apiKey));
  const s = drawn();
  saveSessions(storage, [s], s.id);
  assert.ok(!storage.getItem(STORE).includes(cfg.apiKey));
});
test("存储空、损坏、未知版本可安全恢复", () => {
  const storage = memory();
  assert.deepEqual(loadSessions(storage), { sessions: [], current: null });
  for (const value of [
    "not-json",
    "null",
    "{}",
    '{"version":2,"sessions":[]}',
  ]) {
    storage.setItem(STORE, value);
    assert.deepEqual(loadSessions(storage), { sessions: [], current: null });
  }
});
test("配置拒绝缺字段、非 HTTP 协议、嵌入账号和查询参数", () => {
  const c = {
    baseUrl: "https://example.com/v1",
    model: "model",
    apiKey: "test",
  };
  assert.equal(validateConfig(c), c);
  for (const v of [
    { apiKey: "" },
    { model: "" },
    { baseUrl: "oops" },
    { baseUrl: "file:///tmp/file" },
    { baseUrl: "https://user:secret@example.com" },
    { baseUrl: "https://example.com?key=secret" },
  ])
    assert.throws(() => validateConfig({ ...c, ...v }));
});
test("页面有手机视口、减少动画规则，回答使用转义后的纯文本", () => {
  const html = readFileSync(
    new URL("../public/index.html", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../public/style.css", import.meta.url),
    "utf8",
  );
  const app = readFileSync(
    new URL("../public/app.js", import.meta.url),
    "utf8",
  );
  assert.match(html, /width=device-width/);
  assert.match(css, /max-width:\s*600px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(app, /formatMessage\(page.content\)/);
});
test("每个仪式阶段刷新均保存顺序、牌面、状态和未完成请求", () => {
  let s = createSession("恢复流程", "single");
  const storage = memory();
  const verify = () => {
    saveSessions(storage, [s], s.id);
    assert.deepEqual(loadSessions(storage).sessions[0], s);
  };
  verify();
  s = transition(s, "shuffle");
  verify();
  s = transition(s, "cut", 39);
  verify();
  s = transition(s, "select", s.deck[0]);
  verify();
  s = transition(s, "reveal", 0);
  s.pending = { text: "请开始本次解读。" };
  verify();
  s.phase = "reading";
  s.pending = null;
  s.messages = [{ role: "assistant", content: "已完成内容" }];
  verify();
  s = transition(s, "supplement");
  verify();
  s = transition(s, "select", s.deck[0]);
  verify();
  s = transition(s, "reveal", 1);
  s.pending = { text: "补牌后未完成" };
  verify();
  assert.equal(s.supplementUsed, true);
});
test("损坏的会话、重复牌、未知状态和对话结构不会使页面崩溃", () => {
  const s = drawn();
  const storage = memory();
  for (const bad of [
    null,
    { ...s, phase: "unknown" },
    { ...s, cards: [null] },
    { ...s, deck: [s.cards[0].id, ...s.deck.slice(1)] },
    { ...s, messages: [null] },
    { ...s, pending: { text: 17 } },
  ]) {
    storage.setItem(
      STORE,
      JSON.stringify({ version: 1, current: s.id, sessions: [bad] }),
    );
    assert.equal(loadSessions(storage).sessions.length, 0);
    assert.equal(loadSessions(storage).current, null);
  }
});
test("补牌上下文包含四张牌且明确由用户补抽，重试复用同一请求", () => {
  let s = drawn();
  for (let i = 0; i < 3; i++) s = transition(s, "reveal", i);
  s.phase = "reading";
  s.messages = [{ role: "assistant", content: "已完成首轮" }];
  s = transition(s, "supplement");
  s = transition(s, "select", s.deck[2]);
  s = transition(s, "reveal", 3);
  s.pending = { text: "如何理解补牌？" };
  const before = structuredClone(s);
  const first = contextMessages(s);
  const again = contextMessages(s);
  assert.deepEqual(first, again);
  assert.deepEqual(s, before);
  assert.equal(JSON.parse(first[1].content).牌面.length, 4);
  assert.equal(JSON.parse(first[1].content).牌面[3].牌位, "补充指引");
  assert.match(first[0].content, /已经手动补抽/);
});
test("删除单条历史不影响其他记录，删除当前记录会回到新会话", () => {
  const a = createSession("甲问题", "single"),
    b = createSession("乙问题", "insight");
  const data = { sessions: [a, b], current: a.id };
  const result = deleteSession(data, a.id);
  assert.deepEqual(result, { sessions: [b], current: null });
  assert.equal(data.sessions.length, 2);
  const storage = memory();
  saveSessions(storage, result.sessions, result.current);
  assert.deepEqual(loadSessions(storage).sessions, [b]);
  assert.equal(loadSessions(storage).current, null);
  assert.deepEqual(deleteSession(data, b.id), { sessions: [a], current: a.id });
});
test("模型回答只允许安全的加粗展示，不执行 HTML 或脚本", () => {
  assert.equal(formatMessage("**重点**"), "<strong>重点</strong>");
  const html = formatMessage(
    "**<img src=x onerror=alert(1)>** <script>bad()</script> &",
  );
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<strong>&lt;img/);
  assert.ok(html.endsWith("&amp;"));
});

test("补牌入口只进入手动选牌，不抽牌、不消耗额度、不调用随机数", () => {
  let s = drawn();
  for (let i = 0; i < s.cards.length; i++) s = transition(s, "reveal", i);
  s.phase = "reading";
  s.messages = [{ role: "assistant", content: "已完成的原牌解读" }];
  const before = structuredClone(s);
  const selecting = transition(s, "supplement", undefined, () => {
    assert.fail("用户未选牌前不应决定补牌或方向");
  });
  assert.equal(selecting.phase, "supplement-select");
  assert.deepEqual(selecting.cards, before.cards);
  assert.deepEqual(selecting.deck, before.deck);
  assert.deepEqual(selecting.messages, before.messages);
  assert.equal(selecting.supplementUsed, false);
  assert.equal(selecting.pending, null);
  assert.deepEqual(s, before);
  const chosen = selecting.deck[7];
  const revealed = transition(selecting, "select", chosen, () => 0.8);
  assert.equal(revealed.cards.at(-1).id, chosen);
  assert.equal(revealed.cards.at(-1).revealed, false);
  assert.equal(revealed.phase, "supplement-reveal");
  assert.equal(revealed.pending, null);
  assert.deepEqual(revealed.messages, before.messages);
});
