import test from "node:test";
import assert from "node:assert/strict";
import { CARDS } from "../public/cards.js";
import { mixDeck, angleDelta, createSweep, cutPoint } from "../public/ritual.js";
import { createSession, transition, saveSessions, loadSessions, STORE } from "../public/core.js";
import { ritualMarkup, mountRitual } from "../public/ritual-ui.js";
const ids = CARDS.map(c => c.id);
const rng = () => .3;
function restore(session) {
  const storage = { value: null, setItem(_key, value) { this.value = value; }, getItem() { return this.value; } };
  saveSessions(storage, [session], session.id);
  return loadSessions(storage).sessions[0];
}
test("顺逆时针洗动保留全部牌、不改原数组，且产生不同的实际牌序", () => {
  const before = [...ids];
  const clockwise = mixDeck(ids, 1, rng), counter = mixDeck(ids, -1, rng);
  assert.deepEqual(ids, before);
  assert.deepEqual(new Set(clockwise), new Set(ids));
  assert.deepEqual(new Set(counter), new Set(ids));
  assert.notDeepEqual(clockwise, ids);
  assert.notDeepEqual(clockwise, counter);
  assert.throws(() => mixDeck(ids, 0, rng));
});
test("真实环绕手势识别两个方向与跨越角度边界，中心抖动或直线跳跃不算洗牌", () => {
  assert.ok(Math.abs(angleDelta(Math.PI - .1, -Math.PI + .1) - .2) < .0001);
  for (const direction of [1, -1]) {
    const sweep = createSweep();
    let steps = 0;
    for (let i = 0; i <= 48; i++) {
      const angle = direction * i * Math.PI / 24;
      steps += sweep.move(Math.cos(angle) * 80, Math.sin(angle) * 80);
    }
    assert.equal(Math.sign(steps), direction);
    assert.ok(Math.abs(steps) >= 7);
  }
  const sweep = createSweep();
  assert.equal(sweep.move(0, 0), 0);
  assert.equal(sweep.move(4, 7), 0);
  assert.equal(sweep.move(80, 0), 0);
  assert.equal(sweep.move(-80, 0), 0);
});
test("每次绕动后牌序与进度可恢复，完成洗牌不二次随机重排", () => {
  let session = createSession("仪式恢复", "single");
  session = transition(session, "mix", 1, rng);
  assert.equal(session.phase, "mixing");
  assert.equal(session.mixCount, 1);
  assert.deepEqual(restore(session), session);
  session = transition(session, "mix", -1, rng);
  assert.equal(session.mixCount, 2);
  assert.deepEqual(restore(session), session);
  const cut = transition(session, "shuffle", null, () => { throw Error("不应再次洗牌"); });
  assert.equal(cut.phase, "cut");
  assert.deepEqual(cut.deck, session.deck);
  assert.throws(() => transition(cut, "mix", 1));
});
test("点击切点预览不改变牌序；确认才交换两叠，并可从预览恢复", () => {
  let session = transition(createSession("切牌", "insight"), "mix", 1, rng);
  session = transition(session, "shuffle");
  const deck = [...session.deck];
  for (const point of [1, 27, 77]) {
    const preview = transition(session, "preview-cut", point);
    assert.deepEqual(preview.deck, deck);
    assert.deepEqual(restore(preview), preview);
    const chosen = transition(preview, "cut", point);
    assert.deepEqual(chosen.deck, [...deck.slice(point), ...deck.slice(0, point)]);
    assert.equal(chosen.phase, "select");
  }
  for (const point of [0, 78, 1.5, NaN]) assert.throws(() => transition(session, "preview-cut", point));
  assert.equal(transition(transition(session, "preview-cut", 12), "preview-cut", null).cutPreview, null);
  assert.equal(cutPoint(-.3), 1);
  assert.equal(cutPoint(1.3), 77);
  assert.equal(cutPoint(.5), 39);
  assert.throws(() => cutPoint(NaN));
});
test("损坏的洗牌和切点状态不被恢复，旧的仪式会话仍可继续", () => {
  const session = transition(createSession("校验", "single"), "mix", 1, rng);
  for (const bad of [{ ...session, mixCount: 0 }, { ...session, cutPreview: 78 }, { ...session, mixCount: "1" }]) assert.equal(restore(bad), undefined);
  const old = transition(createSession("旧会话", "single"), "shuffle", null, rng);
  assert.deepEqual(restore(old), old);
});
test("仪式有可操作的整副牌、键盘替代、切点和双叠预览，无滑块和自动完成按钮", () => {
  let session = createSession("交互", "single");
  const markup = ritualMarkup(session);
  assert.equal((markup.match(/class="ritual-card"/g) || []).length, 78);
  assert.match(markup, /tabindex="0"/);
  assert.match(markup, /id="shuffle" class="primary" disabled/);
  session = transition(transition(session, "mix", 1, rng), "shuffle");
  assert.match(ritualMarkup(session), /id="cut-pile"/);
  assert.ok(!ritualMarkup(session).includes('type="range"'));
  const preview = ritualMarkup(transition(session, "preview-cut", 23));
  assert.match(preview, /上叠 · 23 张/);
  assert.match(preview, /下叠 · 55 张/);
});

test("键盘洗牌、切牌以及指针取消不产生额外动作，清理后定时器不再修改牌桌", () => {
  const saved = { matchMedia: globalThis.matchMedia, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  globalThis.matchMedia = () => ({ matches: true });
  globalThis.requestAnimationFrame = fn => { fn(); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  let captured = null, mixes = [], chosen = [];
  const elements = {
    "#shuffle-status": { textContent: "" }, "#shuffle": { disabled: true },
    "#cut-status": { textContent: "" },
  };
  const table = {
    querySelectorAll: () => [], getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 250 }),
    classList: { add() {}, remove() {} }, focus() {},
    setPointerCapture(id) { captured = id; }, hasPointerCapture(id) { return captured === id; }, releasePointerCapture() { captured = null; },
  };
  const cut = { getBoundingClientRect: () => ({ top: 0, height: 200 }), setAttribute() {}, style: { setProperty() {} } };
  const root = { querySelector: selector => selector === "#shuffle-table" ? table : selector === "#cut-pile" ? cut : elements[selector] };
  try {
    const dispose = mountRitual(root, { onMix: value => mixes.push(value), onCut: value => chosen.push(value), current: () => ({ mixCount: mixes.length }) });
    const preventDefault = () => {};
    table.onkeydown({ key: "ArrowRight", preventDefault });
    table.onkeydown({ key: "ArrowLeft", preventDefault });
    assert.deepEqual(mixes, [1, -1]);
    table.onpointerdown({ pointerId: 1, pointerType: "mouse", button: 0, clientX: 230, clientY: 125, preventDefault });
    table.onpointermove({ pointerId: 1, clientX: 206, clientY: 181 });
    table.onpointercancel({ pointerId: 1 });
    const length = mixes.length;
    table.onpointermove({ pointerId: 1, clientX: 150, clientY: 205 });
    assert.equal(mixes.length, length);
    assert.equal(captured, null);
    cut.onkeydown({ key: "End", preventDefault });
    cut.onkeydown({ key: "Enter", preventDefault });
    assert.deepEqual(chosen, [77]);
    dispose();
    table.onkeydown({ key: "ArrowRight", preventDefault });
    assert.equal(mixes.length, length);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
});

test("双手摄像头和鼠标共用同一桌散牌布局，不按前后半副分成两堆", () => {
  const saved={matchMedia:globalThis.matchMedia,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  globalThis.matchMedia=()=>({matches:false});globalThis.cancelAnimationFrame=()=>{};
  const cards=Array.from({length:78},()=>({style:{}}));
  let captured=null;
  const table={querySelectorAll:()=>cards,getBoundingClientRect:()=>({left:0,top:0,width:300,height:250}),
    classList:{add(){},remove(){},toggle(){}},focus(){},setPointerCapture(id){captured=id;},hasPointerCapture:id=>captured===id,releasePointerCapture(){captured=null;}};
  const root={querySelector:selector=>selector==='#shuffle-table' ? table : null};
  try {
    const dispose=mountRitual(root,{onMix(){},onCut(){},current:()=>({mixCount:0})});
    table.onpointerdown({pointerId:1,pointerType:'mouse',button:0,clientX:150,clientY:125,preventDefault(){}});
    const mouse=cards.map(card=>card.style.transform);
    table.onpointercancel({pointerId:1});
    dispose.handPose({mode:'palms',ready:true,moving:true,x:.5,y:.5,rotationDelta:0});
    assert.deepEqual(cards.map(card=>card.style.transform),mouse);
    assert.equal(new Set(mouse).size,78);
    dispose.handPose({mode:'palms',ready:true,moving:false,x:.5,y:.5,rotationDelta:0});
    assert.notDeepEqual(cards.map(card=>card.style.transform),mouse);
    dispose();
  } finally {
    for(const [key,value] of Object.entries(saved)) {if(value===undefined) delete globalThis[key];else globalThis[key]=value;}
  }
});


test("反复捏合切牌逐次改变当前牌序，可恢复，只有确认完成才进入选牌",()=>{
  let session=transition(createSession("重复切牌","single"),"shuffle",null,rng);
  assert.throws(()=>transition(session,"finish-cut"));
  for(const point of [13,27,6]) {
    const before=[...session.deck];
    session=transition(session,"repeat-cut",point);
    assert.deepEqual(session.deck,[...before.slice(point),...before.slice(0,point)]);
    assert.equal(session.phase,"cut");
    assert.deepEqual(restore(session),session);
    assert.match(ritualMarkup(session),/id="cut-pile"/);
    assert.match(ritualMarkup(session),/id="finish-cut"/);
  }
  assert.equal(session.cutCount,3);
  for(const point of [0,78,NaN,1.5]) assert.throws(()=>transition(session,"repeat-cut",point));
  assert.equal(restore({...session,cutCount:-1}),undefined);
  const done=transition(session,"finish-cut");
  assert.deepEqual(done.deck,session.deck);
  assert.equal(done.phase,"select");
  assert.throws(()=>transition(done,"repeat-cut",10));
});
