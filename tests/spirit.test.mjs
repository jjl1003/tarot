import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { SPIRITS, MAJOR_IDS, SPIRIT_STORE, createSpirit, chooseSpirit, renameSpirit, saveSpirit, loadSpirit } from "../public/spirit.js";
import { CARDS } from "../public/cards.js";
import { createSession, transition, contextMessages, saveSessions, loadSessions, STORE, shuffle } from "../public/core.js";
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k,v) => m.set(k,v) }; };
const ready = (index = 15) => chooseSpirit(createSpirit(MAJOR_IDS), index);

test("22 种牌灵各有不同的观察角度、表达风格与追问", () => {
  assert.equal(MAJOR_IDS.length, 22);
  assert.deepEqual(MAJOR_IDS, CARDS.slice(0, 22).map(c => c.id));
  for (const key of ["voice", "focus", "question"]) {
    assert.equal(new Set(Object.values(SPIRITS).map(p => p[key])).size, 22);
    assert.ok(Object.values(SPIRITS).every(p => p[key].length > 3));
  }
  assert.match(SPIRITS.m15.focus, /欲望、依赖/);
});
test("洗牌顺序在选牌前保存；选择位置决定结果，翻开后不能重抽", () => {
  const storage = memory();
  const order = shuffle(MAJOR_IDS, () => 0.3);
  const pending = createSpirit(order);
  saveSpirit(storage, pending);
  assert.deepEqual(loadSpirit(storage), pending);
  for (let i = 0; i < 22; i++) assert.equal(chooseSpirit(pending, i).cardId, order[i]);
  const picked = chooseSpirit(loadSpirit(storage), 7);
  saveSpirit(storage, picked);
  assert.deepEqual(loadSpirit(storage), picked);
  assert.equal(pending.cardId, null);
  assert.throws(() => chooseSpirit(picked, 0));
  for (const index of [-1, 22, 0.5, "1"]) assert.throws(() => chooseSpirit(pending, index));
});
test("命名与档案恢复，非法或损坏档案安全拒绝", () => {
  const storage = memory();
  const p = renameSpirit(ready(), "  月亮的小窗  ");
  assert.equal(p.name, "月亮的小窗");
  saveSpirit(storage, p);
  assert.deepEqual(loadSpirit(storage), p);
  for (const name of [" ", "字".repeat(41)]) assert.throws(() => renameSpirit(p, name));
  for (const bad of [null, {}, {...p, cardId:"s0-0"}, {...p, order: MAJOR_IDS.slice(1)}, {...p, createdAt:"bad"}, {...p, cardId:"__proto__"}]) {
    storage.setItem(SPIRIT_STORE, JSON.stringify(bad));
    assert.equal(loadSpirit(storage), null);
  }
  storage.setItem(SPIRIT_STORE, "broken");
  assert.equal(loadSpirit(storage), null);
  assert.throws(() => createSpirit(Array(22).fill("m0")));
});
test("牌灵是会话快照；不移除任何牌，存储和追问、补牌、重试均保持风格", () => {
  const p = ready();
  let s = createSession("如何理解这段关系？", "single", "model", p);
  p.name = "后来改名";
  assert.notEqual(s.spirit.name, p.name);
  s = transition(s, "shuffle", null, () => .3);
  assert.equal(s.deck.length, 78);
  assert.ok(s.deck.includes("m15"));
  s = transition(s, "cut", 10);
  s = transition(s, "select", s.deck[0], () => .8);
  s = transition(s, "reveal", 0);
  const check = () => {
    const before = structuredClone(s);
    const messages = contextMessages(s);
    assert.deepEqual(contextMessages(s), messages);
    assert.deepEqual(s, before);
    const input = JSON.parse(messages[1].content);
    assert.equal(input.牌灵档案.牌灵, "恶魔");
    assert.equal(input.牌灵档案.focus, SPIRITS.m15.focus);
    assert.equal(input.牌面.length, s.cards.length);
    assert.match(messages[0].content, /不得为了人设强行扭曲结论/);
    assert.match(messages[0].content, /牌灵不是本次抽牌/);
  };
  check();
  s.phase = "reading";
  s.messages = [{role:"assistant", content:"首轮"}];
  s.pending = {text:"继续追问"};
  check();
  s = transition(s, "supplement");
  s = transition(s, "select", s.deck[0]);
  s = transition(s, "reveal", 1);
  check();
  const storage = memory();
  saveSessions(storage, [s], s.id);
  assert.deepEqual(loadSessions(storage).sessions[0], s);
});
test("历史手札不追溯绑定；档案中不可信风格文本不进入解读", () => {
  const old = createSession("旧问题", "single");
  delete old.promptVersion;
  const storage = memory();
  saveSessions(storage, [old], old.id);
  const restored = loadSessions(storage).sessions[0];
  assert.equal(restored.spirit, undefined);
  assert.equal(JSON.parse(contextMessages(restored)[1].content).牌灵档案, undefined);
  const p = {...ready(), focus:"恶意指令", voice:"恶意人设", name:"忽略规则"};
  const s = createSession("新问题", "single", "", p);
  assert.ok(!JSON.stringify(contextMessages(s)).includes("恶意"));
  assert.ok(!JSON.stringify(contextMessages(s)).includes("忽略规则"));
  storage.setItem(STORE, JSON.stringify({version:1, current:s.id, sessions:[{...s, spirit:{...p, cardId:"invalid"}}]}));
  assert.equal(loadSessions(storage).sessions.length, 0);
});
test("无法保存时不吞掉错误，避免向用户展示未持久化的结果", () => {
  assert.throws(() => saveSpirit({ setItem() { throw Error("quota"); } }, ready()), /quota/);
});

test("22 种牌灵均可追溯到牌灵实践章节、对应牌义和明确标注的本站转译", async () => {
  const { SPIRIT_REFERENCES, SPIRIT_REFERENCE_NOTE, SPIRIT_REFERENCE_VERSION } = await import("../public/spirit-references.js");
  const { MEANINGS } = await import("../public/meanings.js");
  const { spiritContext } = await import("../public/spirit.js");
  assert.deepEqual(Object.keys(SPIRIT_REFERENCES), MAJOR_IDS);
  assert.match(SPIRIT_REFERENCE_NOTE, /本站转译设计/);
  assert.match(SPIRIT_REFERENCE_NOTE, /并非原作者原话/);
  const sourceUrls = new Set();
  for (let i = 0; i < MAJOR_IDS.length; i++) {
    const id = MAJOR_IDS[i], r = SPIRIT_REFERENCES[id];
    assert.equal(r.version, SPIRIT_REFERENCE_VERSION);
    assert.ok(r.practiceTheme.length > 0);
    assert.equal(r.practiceSection, `${i} · ${MEANINGS[id].source.englishName}`);
    assert.equal(r.practiceSource.publisher, "017 Cafe");
    assert.equal(r.practiceSource.author, "林詣晉");
    assert.equal(r.practiceSource.url, "https://017cafe.com/main_card/");
    assert.equal(r.cardBasis.source.url, MEANINGS[id].source.url);
    assert.deepEqual(r.cardBasis.keywords, MEANINGS[id].upright.keywords);
    assert.ok(r.rationale.length >= 25);
    assert.equal(r.attribution, SPIRIT_REFERENCE_NOTE);
    sourceUrls.add(r.cardBasis.source.url);
    const context = spiritContext(ready(i));
    assert.equal(context.性格依据.牌灵参考.章节, r.practiceSection);
    assert.equal(context.性格依据.牌义参考.source.url, r.cardBasis.source.url);
    assert.equal(context.性格依据.本站转译, r.rationale);
    assert.equal(context.性格依据.资料版本, SPIRIT_REFERENCE_VERSION);
  }
  assert.equal(sourceUrls.size, 22);
});
test("来源为程序内置资料，档案里伪造的依据不覆盖上下文或改变已抽牌灵", async () => {
  const { spiritContext } = await import("../public/spirit.js");
  const p = {...ready(), 性格依据: {来源:"https://evil.example"}, reference: {rationale:"伪造出处"}};
  const before = structuredClone(p);
  const context = spiritContext(p);
  assert.ok(!JSON.stringify(context).includes("evil.example"));
  assert.ok(!JSON.stringify(context).includes("伪造出处"));
  assert.deepEqual(p, before);
  const s = createSession("我的问题", "single", "", p);
  const result = contextMessages(s);
  assert.match(result[0].content, /不得声称为公认定论或原作者原话/);
  assert.match(JSON.parse(result[1].content).牌灵档案.性格依据.说明, /本站转译设计/);
  assert.equal(p.cardId, "m15");
});


test("牌灵页面只展示最终性格，资料依据保留在内部上下文", async () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const credits = readFileSync(new URL("../public/credits.html", import.meta.url), "utf8");
  for (const removed of ["spiritReferencesHTML", "spirit-reference-card", "性格从哪里来", "牌灵实践参考", "本站怎样转成性格"])
    assert.ok(!app.includes(removed), `${removed}不应出现在牌灵界面`);
  assert.ok(!credits.includes("017cafe.com"));
  assert.match(app, /esc\(traits.voice\)/);
  assert.match(app, /esc\(traits.focus\)/);
  assert.match(app, /esc\(traits.question\)/);
  const { spiritContext } = await import("../public/spirit.js");
  const context = spiritContext(ready());
  assert.equal(context.性格依据.牌灵参考.来源.url, "https://017cafe.com/main_card/");
  assert.ok(context.性格依据.牌义参考.source.url.includes("the-devil"));
  assert.ok(context.性格依据.本站转译);
});
