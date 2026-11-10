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
  escapeHTML as esc,
  formatMessage,
  CONFIG,
} from "./core.js";
import { CARD_MAP } from "./cards.js";
import { readingPayload, quotaText } from "./access.js";
import { PAGES, defaultPage, availablePages, readingPages } from "./journal.js";
import { SPIRITS, MAJOR_IDS, createSpirit, chooseSpirit, renameSpirit, saveSpirit, loadSpirit, spiritContext } from "./spirit.js";
import { MEANINGS, findMeaningCards, cardGroup, MEANING_GROUPS } from "./meanings.js";
import { ritualMarkup, mountRitual } from "./ritual-ui.js";
import { createHandMode } from "./hand-ui.js";
let disposeRitual = () => {};
let ritualPicking = false;
const handMode = createHandMode({
  onMix: direction => disposeRitual.mix?.(direction, direction > 0 ? "手掌顺时针" : "手掌逆时针"),
  onPose: pose => disposeRitual.handPose?.(pose),
  onCut: point => act("repeat-cut", point),
});
let meaningChoice = "m0";
let meaningDrawn = null;
let spirit = loadSpirit(localStorage);
const $ = (id) => document.getElementById(id);
const data = loadSessions(localStorage);
let sessions = data.sessions,
  current = data.current,
  busy = false,
  controller = null;
let view = defaultPage(active()),
  readingIndex = null,
  historyIndex = 0;
const drafts = new Map();
const requestErrors = new Map();
let config = {
  baseUrl: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
  remember: false,
};
let runtime = { mode: "loading" };
let access = { authenticated: false };
function loadLocalConfig() {
  try {
    config = { ...config, ...JSON.parse(localStorage.getItem(CONFIG) || "{}") };
  } catch {
    notify("模型配置无法恢复，请重新设置连接。");
  }
}
async function refreshAccess() {
  const response = await fetch("/api/access", { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "体验服务暂不可用");
  access = result;
  refreshConnection();
  return access;
}
async function loadRuntime() {
  try {
    const response = await fetch("/api/runtime", {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error("暂时无法连接体验服务");
    const result = await response.json();
    if (!["local", "hosted"].includes(result.mode))
      throw Error("体验服务配置异常");
    runtime = result;
    if (runtime.mode === "local") loadLocalConfig();
    else await refreshAccess();
    render();
    if (runtime.mode === "hosted" && !access.authenticated) openSettings();
  } catch {
    runtime = { mode: "error" };
    refreshConnection();
    notify("暂时无法连接服务，请点击右上角重试");
  }
}
function active() {
  return sessions.find((s) => s.id === current);
}
function notify(text = "") {
  $("notice").textContent = text;
}
function persist() {
  try {
    saveSessions(localStorage, sessions, current);
  } catch {
    notify("浏览器空间不足，手札暂未保存，请保留页面并清理不需要的历史。");
  }
}
function update(s) {
  sessions = sessions.map((old) => (old.id === s.id ? s : old));
  persist();
  render();
}
function getConfig() {
  return {
    baseUrl: $("base-url").value.trim(),
    model: $("model").value.trim(),
    apiKey: $("api-key").value.trim(),
    remember: $("remember").checked,
  };
}
function refreshConnection() {
  const hosted = runtime.mode === "hosted";
  const local = runtime.mode === "local";
  const ready = hosted
    ? access.authenticated
    : local && config.baseUrl && config.model && config.apiKey;
  $("settings-open").classList.toggle("connected", !!ready);
  $("settings-open").disabled = runtime.mode === "loading";
  $("connection-label").textContent = hosted
    ? access.authenticated
      ? "体验额度"
      : "邀请码"
    : local
      ? "模型连接"
      : runtime.mode === "loading"
        ? "连接中…"
        : "重试连接";
  $("settings-open").title = hosted
    ? quotaText(access.quota)
    : ready
      ? `已设置：${config.model}，点击修改`
      : "设置连接";
  $("local-settings").hidden = !local;
  $("hosted-access").hidden = !hosted;
  for (const field of $("local-settings").querySelectorAll("input"))
    field.disabled = !local;
  $("settings-close").setAttribute(
    "aria-label",
    hosted ? "关闭体验设置" : "关闭模型连接",
  );
  $("settings-title").textContent = hosted
    ? access.authenticated
      ? "你的体验额度"
      : "开启月下手札"
    : "模型连接";
  $("connection-description").textContent = hosted
    ? "模型已为你备好，让心事慢慢落在纸上。"
    : "把连接设置好，就可以安心翻阅你的手札。";
  $("invite-entry").hidden = access.authenticated;
  $("invite-status").hidden = !access.authenticated;
  $("quota-status").textContent = quotaText(access.quota);
  $("invite-code").required = hosted && !access.authenticated;
  $("settings-save").hidden = hosted && access.authenticated;
  $("settings-save").innerHTML = hosted
    ? "开启体验 <span>↗</span>"
    : "保存连接 <span>↗</span>";
}
function openSettings(error = "") {
  if (!["local", "hosted"].includes(runtime.mode)) {
    loadRuntime();
    return;
  }
  refreshConnection();
  if (runtime.mode === "local") {
    $("base-url").value = config.baseUrl;
    $("model").value = config.model;
    $("api-key").value = config.apiKey;
    $("remember").checked = config.remember;
  }
  $("settings-error").textContent = error;
  if (!$("settings-dialog").open) $("settings-dialog").showModal();
}
$("settings-open").onclick = () => openSettings();
$("settings-close").onclick = () => $("settings-dialog").close();
$("settings-dialog").addEventListener("click", (e) => {
  if (e.target === $("settings-dialog")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      e.target.close();
  }
});
$("remember").onchange = () => {
  if (!$("remember").checked) {
    config.remember = false;
    try {
      saveConfig(localStorage, config);
    } catch {
      $("settings-error").textContent = "浏览器无法保存配置，请检查存储空间。";
    }
  }
};
$("settings-form").onsubmit = async (e) => {
  e.preventDefault();
  $("settings-save").disabled = true;
  try {
    if (runtime.mode === "hosted") {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: $("invite-code").value.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "暂时无法开启体验");
      access = result;
      $("invite-code").value = "";
      refreshConnection();
      $("settings-dialog").close();
      notify("体验已开启。");
    } else if (runtime.mode === "local") {
      const next = validateConfig(getConfig());
      saveConfig(localStorage, next);
      config = next;
      refreshConnection();
      $("settings-dialog").close();
      notify("连接已保存。");
    }
  } catch (error) {
    $("settings-error").textContent = error.message;
  } finally {
    $("settings-save").disabled = false;
  }
};
$("access-logout").onclick = async () => {
  try {
    const response = await fetch("/api/access", { method: "DELETE" });
    if (!response.ok) throw Error("暂时无法退出，请重试");
    access = { authenticated: false };
    refreshConnection();
    notify("已退出体验，手札仍保存在当前浏览器。");
  } catch (e) {
    $("settings-error").textContent = e.message;
  }
};
function turnTo(page) {
  if (!availablePages(active()).includes(page)) return;
  const previous = view;
  view = page;
  render();
  if (
    previous !== view &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    $(`page-${view}`).animate(
      [
        {
          opacity: 0.25,
          transform: `perspective(1800px) rotateY(${PAGES.indexOf(view) > PAGES.indexOf(previous) ? -7 : 7}deg)`,
        },
        { opacity: 1, transform: "perspective(1800px) rotateY(0deg)" },
      ],
      { duration: 420, easing: "ease-out" },
    );
  }
}
for (const tab of document.querySelectorAll("[data-page]")) {
  tab.onclick = () => turnTo(tab.dataset.page);
  tab.onkeydown = (e) => {
    const allowed = availablePages(active());
    let index = allowed.indexOf(view);
    if (e.key === "ArrowRight") index = (index + 1) % allowed.length;
    else if (e.key === "ArrowLeft")
      index = (index + allowed.length - 1) % allowed.length;
    else if (e.key === "Home") index = 0;
    else if (e.key === "End") index = allowed.length - 1;
    else return;
    e.preventDefault();
    turnTo(allowed[index]);
    $(`tab-${view}`).focus();
  };
}
$("begin").onclick = () => {
  try {
    if (!spirit?.cardId) { openSpirit(); return; }
    const s = createSession(
      $("question").value,
      document.querySelector("[name=spread]:checked").value,
      runtime.mode === "hosted" ? runtime.model : config.model,
      spirit,
    );
    sessions.unshift(s);
    current = s.id;
    readingIndex = null;
    persist();
    notify();
    turnTo("draw");
  } catch (e) {
    notify(e.message);
  }
};
$("new-session").onclick = () => {
  if (busy) return;
  current = null;
  readingIndex = null;
  $("question").value = "";
  persist();
  notify();
  turnTo("setup");
};
function storeSpirit(next) {
  // Persist before revealing: a failed save must not present an unsaved result.
  saveSpirit(localStorage, next);
  spirit = next;
  renderSpirit();
  render();
}
function openSpirit() {
  renderSpirit();
  $("spirit-error").textContent = "";
  if (!$("spirit-dialog").open) $("spirit-dialog").showModal();
}
$("spirit-open").onclick = openSpirit;
$("spirit-close").onclick = () => $("spirit-dialog").close();
function spiritAction(fn) {
  try { fn(); $("spirit-error").textContent = ""; }
  catch (e) { $("spirit-error").textContent = `尚未保存：${e.message}。请检查浏览器存储后重试。`; }
}
function renderSpirit() {
  $("spirit-title").textContent = spirit?.cardId ? "这副牌，与你的相处方式" : "与你的牌，初次相遇";
  const target = $("spirit-content");
  if (!spirit) {
    target.innerHTML = '<p>从 22 张大阿卡纳中，亲手选出这副牌的牌灵。它将有自己的观察角度、说话方式与追问习惯，陪你写下往后的手札。</p><p class="fine">牌灵是一种仪式与性格设定，不代表预测更准确。它不参与正式牌阵，也不改变抽牌结果。</p><button id="spirit-shuffle" class="primary">洗开这 22 张牌，准备相遇 <span>✧</span></button>';
    bind("spirit-shuffle", () => spiritAction(() => storeSpirit(createSpirit(shuffle(MAJOR_IDS)))));
  } else if (spirit.cardId === null) {
    target.innerHTML = '<p>牌序已经保存。凭直觉选一张，点击后翻开；刷新页面也会保留这次顺序。</p><div class="spirit-grid">' + spirit.order.map((_, i) => `<button class="spirit-back" data-spirit-pick="${i}" aria-label="选择第 ${i + 1} 张牌灵牌">✧<small>${i + 1}</small></button>`).join("") + '</div>';
    target.querySelectorAll("[data-spirit-pick]").forEach((b) => b.onclick = () => spiritAction(() => storeSpirit(chooseSpirit(spirit, Number(b.dataset.spiritPick)))));
  } else {
    const card = CARD_MAP[spirit.cardId], traits = SPIRITS[spirit.cardId];
    target.innerHTML = `<div class="spirit-result"><img src="${card.image}" alt="${esc(card.name)}牌灵"><div><span class="overline">你的牌灵 · ${esc(new Date(spirit.createdAt).toLocaleDateString("zh-CN"))}</span><h3>${esc(card.name)} · ${esc(traits.voice)}</h3><p>它会留意：${esc(traits.focus)}。</p><p>它可能这样追问你：“${esc(traits.question)}”</p></div></div><form id="spirit-name-form"><label for="spirit-name">给这副牌起个名字</label><input id="spirit-name" maxlength="40" required value="${esc(spirit.name)}"><button class="primary" type="submit">保存名字，带它开始 <span>→</span></button></form><p class="fine">档案仅保存在当前浏览器，清除站点数据会丢失。每篇新手札沿用这位牌灵，旧手札保留原档案。正式抽牌仍使用全部 78 张牌，包含这张牌灵牌。牌灵影响视角与表达，不改变牌义，也不保证结果。</p>`;
    $("spirit-name-form").onsubmit = (e) => {
      e.preventDefault();
      spiritAction(() => {
        storeSpirit(renameSpirit(spirit, $("spirit-name").value));
        $("spirit-dialog").close();
        notify("牌灵档案已保存。写下心事，和它开始第一段对话吧。");
      });
    };
  }
}
function spiritNote(s) {
  const c = spiritContext(s.spirit);
  return c ? `<p class="spirit-note">✧ ${esc(s.spirit.name)} · ${esc(c.牌灵)}牌灵<br><small>${esc(c.voice)} · 关注${esc(c.focus)}</small></p>` : '<p class="spirit-note"><small>这篇旧手札未绑定牌灵，沿用原来的解读方式。</small></p>';
}
function openMeanings(id = null, reversed = null) {
  if (id && Object.hasOwn(MEANINGS, id)) {
    meaningChoice = id;
    meaningDrawn = { id, reversed };
    $("meaning-search").value = "";
    $("meaning-group").value = "all";
  } else meaningDrawn = null;
  renderMeaningList();
  if (!$("meanings-dialog").open) $("meanings-dialog").showModal();
  $("meaning-list").querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
  if (id) $("meaning-detail").focus();
  else $("meaning-search").focus();
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-meaning]");
  if (button) openMeanings(button.dataset.meaning, button.dataset.reversed === "true");
});
$("meanings-open").onclick = () => openMeanings();
$("meanings-close").onclick = () => $("meanings-dialog").close();
$("meaning-search").oninput = renderMeaningList;
$("meaning-group").onchange = renderMeaningList;
function renderMeaningList() {
  const matches = findMeaningCards($("meaning-search").value, $("meaning-group").value);
  if (!matches.some(c => c.id === meaningChoice)) meaningChoice = matches[0]?.id || null;
  $("meaning-count").textContent = `找到 ${matches.length} / 78 张牌`;
  $("meaning-list").innerHTML = matches.length ? matches.map(c => `<button class="meaning-item" data-meaning-choice="${c.id}" aria-pressed="${c.id === meaningChoice}"><img src="${c.image}" alt="" loading="lazy"><span>${esc(c.name)}<small>${esc(MEANINGS[c.id].upright.keywords.join(" · "))}</small></span></button>`).join("") : '<p class="fine">没有找到匹配的牌，试试其他牌名或清除筛选。</p>';
  $("meaning-list").querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
  $("meaning-list").querySelectorAll("[data-meaning-choice]").forEach(b => b.onclick = () => {
    meaningChoice = b.dataset.meaningChoice;
    $("meaning-list").querySelectorAll("[data-meaning-choice]").forEach(item => item.setAttribute("aria-pressed", String(item.dataset.meaningChoice === meaningChoice)));
    renderMeaningDetail();
  });
  renderMeaningDetail();
}
function renderMeaningDetail() {
  const card = CARD_MAP[meaningChoice], m = MEANINGS[meaningChoice];
  if (!card || !m) {
    $("meaning-detail").innerHTML = '<div class="meaning-empty"><h3>留一点空间，换个词找找</h3><p>可按中文名、英文名或正逆位关键词搜索，也可切换牌组。</p></div>';
    return;
  }
  const selected = meaningDrawn?.id === card.id && typeof meaningDrawn.reversed === "boolean";
  const section = (direction, label) => `<section class="meaning-direction ${selected && meaningDrawn.reversed === (direction === "reversed") ? "is-current" : ""}"><h4>${label}${selected && meaningDrawn.reversed === (direction === "reversed") ? '<span>本次抽中</span>' : ""}</h4><p class="meaning-keywords">${esc(m[direction].keywords.join(" · "))}</p><p>${esc(m[direction].text)}</p></section>`;
  $("meaning-detail").innerHTML = `<header class="meaning-intro"><img src="${card.image}" alt="${esc(card.name)}牌面"><div><span class="overline">${esc(MEANING_GROUPS[cardGroup(card.id)])}</span><h3>${esc(card.name)}<small>${esc(m.source.englishName)}</small></h3><p>${esc(m.theme)}</p></div></header>${section("upright", "正位")}${section("reversed", "逆位")}`;
  $("meaning-detail").scrollTop = 0;
}
const kicker = (title, number) =>
  `<div class="leaf-kicker">${title}<span>${number}</span></div>`;
const bottom = (text, number) =>
  `<div class="leaf-bottom"><span>${text}</span><span>${number}</span></div>`;
function sessionNote(s, chapter, heading, copy) {
  return `<div class="leaf context-leaf">${kicker(chapter, SPREADS[s.spread].name)}<div class="context-content"><span class="overline">这一次，你想探索</span><h2 class="session-question">${esc(s.question)}</h2>${spiritNote(s)}<div class="context-divider">✧</div><h3>${heading}</h3><p>${copy}</p></div>${bottom("每一张牌，都是一次看见自己的机会。", "☽")}</div>`;
}
function fan(s) {
  return `<div class="fan-scroll" aria-label="横向滑动浏览剩余牌"><div class="fan" style="width:${s.deck.length * 38 + 70}px">${s.deck.map((id, i) => `<button class="back" style="left:${i * 38}px;transform:rotate(${(i / (s.deck.length - 1) - 0.5) * 16}deg);top:${Math.pow((i / (s.deck.length - 1) - 0.5) * 2, 2) * 18}px" data-pick="${id}" aria-label="选择第 ${i + 1} 张牌">✧</button>`).join("")}</div></div>`;
}
function cards(s, interactive = false) {
  return `<div class="spread ${s.cards.length === 4 ? "four-cards" : ""}">${s.cards.map((c, i) => `<div class="slot"><div class="position">${esc(c.position)}</div><button class="card ${c.revealed ? "revealed" : "back"}" data-flip="${i}" ${!interactive || c.revealed || busy || !["reveal", "supplement-reveal"].includes(s.phase) ? "disabled" : ""} aria-label="${c.revealed ? esc(CARD_MAP[c.id].name) : "翻开" + esc(c.position)}">${c.revealed ? `<img src="${CARD_MAP[c.id].image}" class="${c.reversed ? "reversed" : ""}" alt="${esc(CARD_MAP[c.id].name)}">` : "✧"}</button><div class="card-name">${c.revealed ? esc(CARD_MAP[c.id].name) : "点击翻开"}</div><div class="orientation">${c.revealed ? (c.reversed ? "逆位" : "正位") : "尚未翻开"}</div>${c.revealed ? `<button class="text-button card-meaning" data-meaning="${c.id}" data-reversed="${c.reversed}" aria-label="查阅${esc(CARD_MAP[c.id].name)}${c.reversed ? "逆位" : "正位"}牌义">查牌义 ↗</button>` : ""}</div>`).join("")}</div>`;
}
function bind(id, fn) {
  if ($(id)) $(id).onclick = fn;
}
function act(action, value) {
  if (busy) return;
  try {
    update(transition(active(), action, value));
    notify();
  } catch (e) {
    notify(e.message);
  }
}
async function pickWithMotion(button) {
  if (busy || ritualPicking) return;
  const start = button.getBoundingClientRect();
  const scroll = button.closest(".fan-scroll");
  const scrollLeft = scroll.scrollLeft;
  const previous = new Map([...scroll.querySelectorAll("[data-pick]")].map(node => [node.dataset.pick, node.getBoundingClientRect()]));
  const ghost = button.cloneNode(true);
  ghost.removeAttribute("data-pick");
  ghost.setAttribute("aria-hidden", "true");
  ghost.tabIndex = -1;
  const id = button.dataset.pick;
  ritualPicking = true;
  try {
    act("select", id);
    const nextScroll = $("page-draw").querySelector(".fan-scroll");
    if (nextScroll) nextScroll.scrollLeft = scrollLeft;
    const target = [...$("page-draw").querySelectorAll(".spread .card")].at(-1);
    if (!target || matchMedia("(prefers-reduced-motion: reduce)").matches || !ghost.animate) return;
    const end = target.getBoundingClientRect();
    ghost.className = "back ritual-flight";
    ghost.style.cssText = `position:fixed;left:${start.left}px;top:${start.top}px;width:${start.width}px;height:${start.height}px;z-index:1000;pointer-events:none;margin:0;transform:none;`;
    document.body.append(ghost);
    target.style.visibility = "hidden";
    if (nextScroll) nextScroll.querySelectorAll("[data-pick]").forEach(node => {
      const before = previous.get(node.dataset.pick), after = node.getBoundingClientRect();
      if (before && after.right > 0 && after.left < innerWidth) node.animate([
        { translate: `${before.left - after.left}px ${before.top - after.top}px` },
        { translate: "0 0" },
      ], { duration: 380, easing: "cubic-bezier(.2,.7,.2,1)" });
    });
    try {
      await ghost.animate([
        { transform: "translate(0,0) scale(1) rotate(-4deg)", opacity: 1 },
        { transform: `translate(${(end.left - start.left) * .55}px,${Math.min(end.top - start.top, 0) - 42}px) scale(1.12) rotate(5deg)`, offset: .48 },
        { transform: `translate(${end.left - start.left}px,${end.top - start.top}px) scale(${end.width / start.width},${end.height / start.height}) rotate(0deg)`, opacity: 1 },
      ], { duration: 560, easing: "cubic-bezier(.22,.75,.15,1)", fill: "forwards" }).finished;
    } finally { target.style.visibility = ""; ghost.remove(); }
    target.animate([{ transform: "translateY(-5px)" }, { transform: "translateY(0)" }], { duration: 180, easing: "ease-out" });
    if (active()?.phase === "reveal") $("page-draw").querySelector('[data-flip="0"]')?.focus({ preventScroll: true });
  } finally { ghost.remove(); ritualPicking = false; }
}
function renderDraw(s) {
  disposeRitual();
  disposeRitual = () => {};
  if (!s) {
    handMode.mount($("page-draw"), false);
    $("page-draw").innerHTML = "";
    return;
  }
  const copy = {
    meditate: [
      "让牌，随你的手流动",
      "在心里慢慢重复你的问题。按住牌堆绕动，顺时针或逆时针都可以，由你决定何时停下。",
    ],
    mixing: ["让牌，随你的手流动", "慢慢绕动，让整副牌在手下散开、交错。松手时牌会重新收拢；准备好了，再亲手切牌。"],
    cut: [
      "在这里，让牌堆转个弯",
      "沿牌堆移动鼠标，在直觉停留的位置点下。看它分成两叠，再将下叠合到上面。",
    ],
    select: [
      "让直觉，替你停留",
      "横向翻看牌背，亲手选出你的牌。选牌顺序对应牌位顺序。",
    ],
    reveal: [
      "答案，在你翻开的瞬间",
      "逐张点击牌背。全部翻开后，再由你开启解读。",
    ],
    ready: [
      "牌已落定，故事待启",
      "先看看眼前的牌。准备好了，翻到下一章，听听它们的来信。",
    ],
    reading: [
      "这一副牌，始终在这里",
      "追问会沿用已抽出的牌，不会改变牌面或方向。",
    ],
    "supplement-select": [
      "由你，再抽一张",
      "从剩余牌中亲手选一张。选中、翻开后，再决定何时开始解读。",
    ],
    "supplement-reveal": [
      "翻开这份补充指引",
      "这张牌由你亲手选定。轻轻翻开，让它加入原来的故事。",
    ],
  }[s.phase];
  let body = ritualMarkup(s);
  const selecting = ["select", "supplement-select"].includes(s.phase);
  if (selecting)
    body += `<section id="draw-ritual" tabindex="-1" aria-label="${s.phase === "supplement-select" ? "手动补抽一张" : "手动选牌"}"><h3>${s.phase === "supplement-select" ? "由你，再抽一张" : "请选择你的牌"}</h3>${fan(s)}<div class="selection-note"><span>← 横向滑动，点击牌背 →</span><span>${s.phase === "supplement-select" ? "补充指引 · 选 1 张" : `已选 ${s.cards.length} / ${SPREADS[s.spread].positions.length}`}</span></div></section>`;
  if (s.cards.length) body += cards(s, true);
  if (["reveal", "supplement-reveal"].includes(s.phase))
    body += '<button class="primary" disabled>全部翻开后开始解读</button>';
  if (s.phase === "ready")
    body += `<button id="interpret" class="primary" ${busy ? "disabled" : ""}>${s.supplementUsed ? "解读补充指引" : "开始解读"} <span>→</span></button>`;
  if (s.phase === "reading")
    body +=
      '<button id="return-reading" class="primary">回到牌间来信 <span>→</span></button>';
  $("page-draw").innerHTML =
    sessionNote(s, "CHAPTER TWO", copy[0], copy[1]) +
    `<div class="leaf ritual-leaf ${selecting ? "has-fan" : ""}">${kicker("THE DRAWING RITUAL", "02 / 抽牌")}<section class="hand-controls" aria-label="可选摄像头手势"></section><div class="ritual-content">${body}</div>${bottom("凭直觉选牌，由你亲手翻开。", "02")}</div>`;
  bind("shuffle", () => act("shuffle"));
  bind("cut", () => act("cut", s.cutPreview));
  bind("finish-cut", () => act("finish-cut"));
  bind("recut", () => { act("preview-cut", null); $("cut-pile")?.focus({ preventScroll: true }); });
  disposeRitual = mountRitual($("page-draw"), {
    current: active,
    onMix: direction => {
      if (busy || active()?.id !== s.id) return;
      try {
        const next = transition(active(), "mix", direction);
        sessions = sessions.map(old => old.id === next.id ? next : old);
        persist();
      } catch (error) { notify(error.message); }
    },
    onCut: point => { act("preview-cut", point); $("cut")?.focus({ preventScroll: true }); },
  });
  handMode.mount($("page-draw"), view === "draw" && !busy && ["meditate", "mixing", "cut", "select", "reveal", "supplement-select", "supplement-reveal"].includes(s.phase));
  $("page-draw")
    .querySelectorAll("[data-pick]")
    .forEach((b) => (b.onclick = () => pickWithMotion(b)));
  $("page-draw")
    .querySelectorAll("[data-flip]")
    .forEach((b) => (b.onclick = () => act("reveal", Number(b.dataset.flip))));
  bind("interpret", () =>
    request(
      s.supplementUsed
        ? "请结合补充指引和原有牌面，继续解读当前问题。"
        : "请开始本次解读。",
    ),
  );
  bind("return-reading", () => turnTo("reading"));
}
function renderReading(s) {
  if (!s) {
    $("page-reading").innerHTML = "";
    return;
  }
  const pages = readingPages(
    s.messages,
    matchMedia("(max-width:600px)").matches ? 230 : 440,
  );
  if (readingIndex === null) {
    const last = s.messages.findLastIndex((m) => m.role === "assistant");
    readingIndex = Math.max(
      0,
      pages.findIndex((p) => p.messageIndex === last),
    );
  }
  readingIndex = Math.max(0, Math.min(readingIndex, pages.length - 1));
  const page = pages[readingIndex];
  const content = page
    ? `<div class="letter-meta"><span>${page.role === "assistant" ? "月下 · 来信" : "你的追问"}</span><span>${page.part} / ${page.total}</span></div><div class="reading-copy ${page.role}" tabindex="0">${formatMessage(page.content)}</div>`
    : '<div class="empty-letter"><span>✧</span><p>牌面已备好，一封来信正在路上。</p></div>';
  const pending = busy
    ? '<div class="pending" role="status">正在细读牌面… <button id="cancel" class="text-button">停止等待</button></div>'
    : s.pending
      ? `<div class="pending" role="alert"><span>${esc(requestErrors.get(s.id) || "上一封来信尚未完成，牌面已保留。")}</span><button id="retry" class="text-button">重试解读 ↗</button></div>`
      : "";
  const composer =
    s.phase === "reading" && !s.pending && !busy
      ? `<div class="composer"><label for="followup">这次牌面，你还想问什么？</label><textarea id="followup" maxlength="2000" placeholder="把想继续探索的话写在这里…">${esc(drafts.get(s.id) || "")}</textarea><div class="composer-actions"><button id="supplement" class="text-button" ${s.supplementUsed ? "disabled" : ""}>${s.supplementUsed ? "补牌已使用" : "＋ 我要补抽一张"}</button><button id="ask" class="primary">寄出追问 <span>↗</span></button></div></div>`
      : "";
  $("page-reading").innerHTML =
    `<div class="leaf reading-context">${kicker("CHAPTER THREE", SPREADS[s.spread].name)}<div class="reading-question"><span class="overline">关于这一次的心事</span><h2 class="session-question">${esc(s.question)}</h2></div>${cards(s)}${spiritNote(s)}<p class="cards-footnote">${s.cards.length} 张已落定的牌 · ${s.supplementUsed ? "补充指引已加入" : "故事可以继续"}</p>${bottom("牌面给出视角，决定始终属于你。", "03")}</div><div class="leaf letter-leaf">${kicker("A LETTER BETWEEN THE CARDS", "牌间来信")}<div class="letter-content">${content}${pending}<div class="pagination"><button id="letter-prev" class="text-button" ${readingIndex <= 0 ? "disabled" : ""} aria-label="上一页来信">← 上一页</button><span>${pages.length ? readingIndex + 1 : 0} / ${pages.length}</span><button id="letter-next" class="text-button" ${readingIndex >= pages.length - 1 ? "disabled" : ""} aria-label="下一页来信">下一页 →</button></div>${composer}</div>${bottom("慢慢读，也慢慢听自己。", "04")}</div>`;
  bind("letter-prev", () => {
    readingIndex--;
    renderReading(s);
  });
  bind("letter-next", () => {
    readingIndex++;
    renderReading(s);
  });
  bind("retry", () => request());
  bind("cancel", () => controller?.abort());
  if ($("followup"))
    $("followup").oninput = () => drafts.set(s.id, $("followup").value);
  bind("ask", () => {
    const text = $("followup").value.trim();
    if (!text) return notify("先写下一句你想继续探索的话。");
    request(text);
  });
  bind("supplement", () => {
    if (busy) return;
    const n = transition(active(), "supplement");
    n.supplementQuestion = $("followup").value.trim();
    view = "draw";
    update(n);
    $("draw-ritual").focus({ preventScroll: true });
  });
}
function renderHistory() {
  const size = 5,
    count = Math.max(1, Math.ceil(sessions.length / size));
  historyIndex = Math.min(historyIndex, count - 1);
  const records = sessions.slice(
    historyIndex * size,
    historyIndex * size + size,
  );
  $("page-history").innerHTML =
    `<div class="leaf archive-cover">${kicker("THE COLLECTED PAGES", "04 / 往日")}<div class="archive-title"><span class="overline">一些心事，值得好好收藏</span><h2>每一页，<br>都是来时的你。</h2><p>从旧问题里，看见新的自己。<br>打开一篇手札，让那段对话继续。</p><div class="archive-number">${String(sessions.length).padStart(2, "0")}<span>篇手札</span></div></div>${bottom("只存于这个浏览器，不随月光远行。", "05")}</div><div class="leaf archive-leaf">${kicker("YOUR PAST CHAPTERS", "往日手札")}<div class="archive-content">${records.length ? records.map((s) => `<article><div class="history-meta">${esc(new Date(s.createdAt).toLocaleDateString("zh-CN"))} · ${esc(SPREADS[s.spread].name)}</div><button class="history-title" data-open="${s.id}" ${busy ? "disabled" : ""}>${esc(s.question)} <span>↗</span></button><div class="history-bottom"><span>${s.messages.length ? "已收到来信" : "抽牌进行中"}</span><button class="text-button" data-delete="${s.id}" ${busy ? "disabled" : ""}>删除</button></div></article>`).join("") : '<div class="empty-letter"><span>☽</span><p>这里还没有故事。<br>从第一页，写下此刻的心事。</p></div>'}</div><div class="pagination"><button id="history-prev" class="text-button" ${historyIndex === 0 ? "disabled" : ""}>← 上一页</button><span>${historyIndex + 1} / ${count}</span><button id="history-next" class="text-button" ${historyIndex >= count - 1 ? "disabled" : ""}>下一页 →</button></div>${bottom("清除浏览器站点数据会丢失手札。", "06")}</div>`;
  bind("history-prev", () => {
    historyIndex--;
    renderHistory();
  });
  bind("history-next", () => {
    historyIndex++;
    renderHistory();
  });
  $("page-history")
    .querySelectorAll("[data-open]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          if (busy) return;
          current = b.dataset.open;
          readingIndex = null;
          persist();
          turnTo(defaultPage(active()));
        }),
    );
  $("page-history")
    .querySelectorAll("[data-delete]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          if (busy || !confirm("删除这篇手札？删除后无法恢复。")) return;
          ({ sessions, current } = deleteSession(
            { sessions, current },
            b.dataset.delete,
          ));
          persist();
          render();
        }),
    );
}
function render() {
  const s = active();
  const allowed = availablePages(s);
  if (!allowed.includes(view)) view = defaultPage(s);
  for (const page of PAGES) {
    $(`page-${page}`).hidden = view !== page;
    const tab = $(`tab-${page}`);
    tab.disabled = !allowed.includes(page);
    tab.setAttribute("aria-selected", String(view === page));
    tab.tabIndex = view === page ? 0 : -1;
  }
  $("book").dataset.page = view;
  $("new-session").hidden = !s;
  $("new-session").disabled = busy;
  $("begin").disabled = busy;
  $("spirit-open").disabled = busy;
  $("spirit-open").textContent = spirit?.cardId ? `✧ ${spirit.name} · ${CARD_MAP[spirit.cardId].name}牌灵` : "✧ 建立我的牌灵";
  $("setup-form").hidden = !!s;
  $("setup-existing").hidden = !s;
  if (s) {
    $("setup-existing").innerHTML =
      `<span class="overline">这篇手札已经开启</span><h2 class="session-question">${esc(s.question)}</h2><p>本次牌阵：${esc(SPREADS[s.spread].name)}<br>把这个问题留在这一页，继续往后翻。</p><button id="resume" class="primary">继续这篇手札 <span>→</span></button><p class="fine">想探索新的问题？点击上方“另起一篇”。</p>`;
    bind("resume", () => turnTo(defaultPage(s)));
  }
  renderDraw(s);
  renderReading(s);
  renderHistory();
  refreshConnection();
}
async function request(text) {
  if (busy) return;
  const s = active();
  try {
    if (runtime.mode === "hosted") {
      await refreshAccess();
      if (!access.authenticated) {
        openSettings("请输入邀请码后继续，牌面会为你保留");
        return;
      }
    } else if (runtime.mode === "local") validateConfig(config);
    else throw Error("正在连接体验服务，请稍后再试");
    if (
      !s ||
      !s.cards.every((c) => c.revealed) ||
      !["ready", "reading"].includes(s.phase)
    )
      throw Error("请先翻开全部牌");
  } catch (e) {
    openSettings(e.message);
    return;
  }
  if (!s.pending)
    s.pending = {
      text: s.supplementQuestion ? `补牌追问：${s.supplementQuestion}` : text,
    };
  s.model = runtime.mode === "hosted" ? runtime.model : config.model;
  s.updatedAt = new Date().toISOString();
  busy = true;
  requestErrors.delete(s.id);
  view = "reading";
  update(s);
  notify();
  const requestConfig = { ...config };
  controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 65000);
  try {
    const response = await fetch("/api/reading", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        readingPayload(runtime.mode, requestConfig, contextMessages(s)),
      ),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) {
      if (runtime.mode === "hosted" && response.status === 401) {
        access = { authenticated: false };
        openSettings(result.error);
      }
      throw Error(result.error || "解读未完成，请重试");
    }
    if (runtime.mode === "hosted" && result.quota) {
      access.quota = result.quota;
      refreshConnection();
    }
    if (typeof result.content !== "string" || !result.content.trim())
      throw Error("模型未返回有效解读");
    if (s.messages.length)
      s.messages.push({ role: "user", content: s.pending.text });
    s.messages.push({ role: "assistant", content: result.content });
    s.pending = null;
    delete s.supplementQuestion;
    drafts.delete(s.id);
    s.phase = "reading";
    s.updatedAt = new Date().toISOString();
    readingIndex = null;
  } catch (e) {
    const message =
      e.name === "AbortError"
        ? "等待已停止或超时，牌面已保存，可重试。"
        : e.message;
    if (runtime.mode === "hosted") await refreshAccess().catch(() => {});
    requestErrors.set(s.id, message);
    notify(message);
  } finally {
    clearTimeout(timer);
    busy = false;
    controller = null;
    update(s);
  }
}
render();
loadRuntime();
