import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CARDS } from "../public/cards.js";
import { MEANINGS, MEANING_EDITION, MEANING_NOTE, REVERSED_NOTE, findMeaningCards, cardGroup, meaningContext } from "../public/meanings.js";
import { MEANING_SOURCES } from "../public/meaning-sources.js";
import { createSession, contextMessages } from "../public/core.js";

test("78 张牌均有独立的核心主题、正逆位长解释、反思问题与逐牌原始来源", () => {
  assert.equal(Object.keys(MEANINGS).length, 78);
  assert.deepEqual(new Set(Object.keys(MEANINGS)), new Set(CARDS.map(c => c.id)));
  assert.equal(Object.keys(MEANING_SOURCES).length, 78);
  assert.equal(new Set(Object.values(MEANINGS).map(m => m.source.url)).size, 78);
  for (const c of CARDS) {
    const m = MEANINGS[c.id];
    assert.equal(m.id, c.id);
    assert.ok(m.theme.length >= 8, c.name);
    assert.ok(m.reflection.endsWith("？"), c.name);
    assert.equal(m.edition, MEANING_EDITION);
    assert.notEqual(m.upright.text, m.reversed.text);
    for (const direction of ["upright", "reversed"]) {
      assert.ok(m[direction].text.length >= 60, `${c.name}${direction}应提供解释而非只有关键词`);
      assert.ok(m[direction].keywords.length >= 3, c.name);
      assert.equal(new Set(m[direction].keywords).size, m[direction].keywords.length);
    }
    assert.equal(m.source.publisher, "Labyrinthos");
    assert.equal(m.source.author, "Tina Gong");
    assert.equal(m.source.checkedAt, "2026-11-07");
    const url = new URL(m.source.url);
    assert.equal(url.origin, "https://labyrinthos.co");
    assert.ok(url.pathname.startsWith("/blogs/tarot-card-meanings-list/"));
    assert.ok(url.pathname.endsWith("tarot-card-meanings"));
    assert.equal(url.pathname.split("/").at(-1).split("-meaning")[0], m.source.englishName.toLowerCase().replaceAll(" ", "-"));
  }
  assert.match(MEANING_NOTE, /非逐字翻译/);
  assert.match(REVERSED_NOTE, /不自动等于坏结果/);
});
test("来源与实际牌号对应，宫廷牌和四花色不会错配", () => {
  const majors = ["The Fool", "The Magician", "The High Priestess", "The Empress", "The Emperor", "The Hierophant", "The Lovers", "The Chariot", "Strength", "The Hermit", "The Wheel of Fortune", "Justice", "The Hanged Man", "Death", "Temperance", "The Devil", "The Tower", "The Star", "The Moon", "The Sun", "Judgement", "The World"];
  majors.forEach((name, i) => assert.equal(MEANINGS[`m${i}`].source.englishName, name));
  const ranks = ["Ace", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Page", "Knight", "Queen", "King"];
  ["Wands", "Cups", "Swords", "Pentacles"].forEach((suit,s) => ranks.forEach((rank,i) => assert.equal(MEANINGS[`s${s}-${i}`].source.englishName, `${rank} of ${suit}`)));
});
test("分类完整且互不重叠，支持中文、英文、关键词和常见译名", () => {
  assert.equal(findMeaningCards().length, 78);
  assert.equal(findMeaningCards("", "major").length, 22);
  const minor = ["wands", "cups", "swords", "pentacles"];
  for (const group of minor) {
    const found = findMeaningCards("", group);
    assert.equal(found.length, 14);
    assert.ok(found.every(c => cardGroup(c.id) === group));
  }
  for (const [query,id] of [["愚人", "m0"], ["隐士", "m9"], ["女皇", "m3"], ["钱币国王", "s3-13"], ["  THE FOOL  ", "m0"], ["圣杯二", "s1-1"]])
    assert.equal(findMeaningCards(query)[0]?.id, id);
  assert.ok(findMeaningCards("松绑").some(c => c.id === "m15"));
  assert.ok(findMeaningCards("边界").some(c => c.id === "s0-6"));
  assert.deepEqual(findMeaningCards("愚人", "cups"), []);
  assert.deepEqual(findMeaningCards("没有这种牌"), []);
  assert.deepEqual(findMeaningCards("", "__proto__"), []);
  assert.equal(cardGroup("bad"), null);
});
test("AI 使用与手册相同的说明和来源，严格匹配正逆位，无需发送全套资料", () => {
  for (const c of CARDS) for (const reversed of [false,true]) {
    const s = createSession("怎样理解当前状况？", "single");
    s.cards = [{id:c.id, reversed, revealed:true, position:"单张指引"}];
    const before = structuredClone(s);
    const messages = contextMessages(s);
    const data = JSON.parse(messages[1].content);
    assert.equal(data.牌面.length, 1);
    const direction = reversed ? MEANINGS[c.id].reversed : MEANINGS[c.id].upright;
    assert.equal(data.牌面[0].牌义参考.牌义说明, direction.text);
    assert.deepEqual(data.牌面[0].牌义参考.关键词, direction.keywords);
    assert.equal(data.牌面[0].基础牌义, direction.keywords.join("、"));
    assert.equal(data.牌面[0].牌义参考.原文, MEANINGS[c.id].source.url);
    assert.equal(data.牌面[0].牌义参考.资料版本, MEANING_EDITION);
    assert.deepEqual(s,before);
    assert.match(messages[0].content, /禁止把逆位一概解释为坏结果/);
  }
});
test("关键逆位保留不同方向，避免一律把逆位写成负面", () => {
  assert.match(meaningContext("m15",true).牌义说明, /恢复选择权/);
  assert.match(meaningContext("m18",true).牌义说明, /迷雾开始散开/);
  assert.match(meaningContext("s1-6",true).牌义说明, /开始做取舍/);
  assert.match(meaningContext("s2-3",true).牌义说明, /重新参与/);
  assert.equal(meaningContext("bad",true),null);
  assert.equal(meaningContext("__proto__",true),null);
  assert.equal(meaningContext("m0","逆位"),null);
});
test("牌义查阅独立于占卜，只有已翻开的牌展示快捷入口", () => {
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  for(const id of ["meanings-open","meanings-dialog","meaning-search","meaning-group","meaning-detail","meaning-list"])
    assert.ok(html.includes(`id="${id}"`));
  assert.match(app, /c\.revealed \? `<button class="text-button card-meaning"/);
  assert.match(app, /data-reversed="\$\{c.reversed\}"/);
  assert.match(app, /本次抽中/);
  for (const removed of ["meaning-reflection", "meaning-source", "留给自己的一个问题", "资料来源与阅读说明", "m.source.url"])
    assert.ok(!app.includes(removed), `${removed}不应出现在牌义详情界面`);
  assert.ok(!html.includes("meaning-footer"));
  assert.match(app, /section\("upright", "正位"\)/);
  assert.match(app, /section\("reversed", "逆位"\)/);
});
