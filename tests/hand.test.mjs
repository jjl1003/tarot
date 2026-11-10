import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HandCamera } from "../public/hand-camera.js";
import { createHandGestures, handPose } from "../public/hand-gestures.js";
function landmarks(pinched = false, gap = .02) {
  const points = Array.from({ length: 21 }, () => ({ x: .5, y: .6 }));
  const positions = { 0: [.5,.82], 4: [.25,.55], 5: [.42,.65], 6: [.4,.5], 8: [.38,.32], 9: [.49,.62], 10: [.48,.48], 12: [.48,.28], 13: [.56,.64], 14: [.56,.49], 16: [.57,.3], 17: [.62,.67], 18: [.64,.52], 20: [.67,.35] };
  for (const [i, [x,y]] of Object.entries(positions)) points[i] = { x, y };
  if (pinched) points[4] = { x: points[8].x + gap, y: points[8].y };
  return points;
}
test("手部坐标拒绝无效画面，光点镜像映射，张掌和捏合有迟滞与稳定时间", () => {
  assert.equal(handPose([]), null);
  const invalid = landmarks(); invalid[8].x = NaN;
  assert.equal(handPose(invalid), null);
  const pose = handPose(landmarks());
  assert.ok(pose.open); assert.ok(pose.x > .5);
  const recognizer = createHandGestures();
  assert.equal(recognizer.update(landmarks(true), 0).pinchStart, false);
  assert.equal(recognizer.update(landmarks(), 100).pinching, false);
  assert.equal(recognizer.update(landmarks(true), 200).pinchStart, false);
  assert.equal(recognizer.update(landmarks(true), 400).pinchStart, true);
  assert.equal(recognizer.update(landmarks(true, .08), 500).pinching, true);
  assert.equal(recognizer.update(landmarks(), 600).pinchEnd, true);
  recognizer.update(landmarks(true), 700);
  assert.equal(recognizer.update(null, 800).visible, false);
  assert.equal(recognizer.update(landmarks(true), 900).pinchStart, false);
  assert.equal(recognizer.update(landmarks(true), 1200).pinchStart, false);
});
test("单手捏合只控制切牌和选牌，不直接改变洗牌次数", () => {
  const recognizer=createHandGestures();
  recognizer.update(landmarks(),0);
  assert.equal(recognizer.update(landmarks(true),400).mix,0);
  recognizer.update(landmarks(),500);
  assert.equal(recognizer.update(landmarks(true),800).mix,0);
});

function fixture({ modelError = false, getMedia } = {}) {
  let workers = 0, requested = 0, stopped = 0, terminated = 0, frames = [], bitmapsClosed = 0;
  const states = [], results = [];
  const stream = { getTracks: () => [{ stop() { stopped++; } }] };
  const video = { readyState: 2, currentTime: 1, play: async () => {}, pause() {} };
  let worker;
  const deps = {
    createWorker() {
      workers++;
      worker = { terminate() { terminated++; }, postMessage(message) {
        if (message.type === "init") queueMicrotask(() => this.onmessage({ data: { type: modelError ? "error" : "ready" } }));
        if (message.type === "frame") { message.image.close(); queueMicrotask(() => this.onmessage({ data: { type: "result", landmarks: landmarks(), timestamp: message.timestamp } })); }
      } };
      return worker;
    },
    async getMedia(constraints) { requested++; assert.equal(constraints.audio, false); return getMedia ? getMedia() : stream; },
    createVideo: () => video,
    requestFrame: fn => { frames.push(fn); return frames.length; }, cancelFrame() {},
    createBitmap: async () => ({ close() { bitmapsClosed++; } }),
  };
  const camera = new HandCamera({ onResult: (...result) => results.push(result), onState: (...state) => states.push(state) }, deps);
  return { camera, stream, deps, results, states, video, step: now => frames.shift()(now),
    counts: () => ({ workers, requested, stopped, terminated, bitmapsClosed }) };
}
test("摄像头必须主动开启；识别在 Worker 中处理，关闭后释放全部资源", async () => {
  const f = fixture();
  assert.deepEqual(f.counts(), { workers:0, requested:0, stopped:0, terminated:0, bitmapsClosed:0 });
  await f.camera.start();
  assert.equal(f.camera.state, "on");
  await f.step(1000);
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(f.results[0][0].length, 21);
  f.camera.stop();
  assert.equal(f.camera.state, "off");
  assert.equal(f.video.srcObject, null);
  assert.deepEqual(f.counts(), { workers:1, requested:1, stopped:1, terminated:1, bitmapsClosed:1 });
});
test("模型下载失败、摄像头拒绝时退回鼠标，停止 Worker 且不保留视频", async () => {
  const missing = fixture({ modelError:true });
  await missing.camera.start();
  assert.match(missing.camera.message, /模型未能加载/);
  assert.equal(missing.counts().requested, 0);
  assert.equal(missing.counts().terminated, 1);
  const denied = fixture({ getMedia: async () => { throw Object.assign(Error(), { name:"NotAllowedError" }); } });
  await denied.camera.start();
  assert.match(denied.camera.message, /未获得摄像头权限/);
  assert.equal(denied.camera.state, "off");
  assert.equal(denied.counts().terminated, 1);
});
test("等待权限期间取消，迟到的摄像头授权也立即停止，不重新开启识别", async () => {
  let resolveMedia;
  const gate = new Promise(resolve => { resolveMedia = resolve; });
  const f = fixture({ getMedia: () => gate });
  const start = f.camera.start();
  while (!f.counts().requested) await new Promise(resolve => queueMicrotask(resolve));
  f.camera.stop();
  resolveMedia(f.stream);
  await start;
  assert.equal(f.camera.state, "off");
  assert.equal(f.counts().stopped, 1);
  assert.equal(f.video.srcObject, undefined);
});
test("线上与本地 CSP 一致，仅为本机 Worker、WASM 和固定模型资源开放所需权限", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const csp = config.headers[0].headers.find(header => header.key === "Content-Security-Policy").value;
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.ok(server.includes(csp));
  assert.match(csp, /worker-src 'self'/);
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.ok(!csp.includes("'unsafe-eval'"));
  const worker = await readFile(new URL("../public/hand-worker.js", import.meta.url), "utf8");
  assert.match(worker, /@0\.10\.32\/wasm/);
  assert.match(worker, /image\.close\(\)/);
  assert.ok(!worker.includes("fetch("));
});

test("手势抽牌必须先停留再捏合、抬起、松开；失去跟踪或仅捏合不选牌", async () => {
  const { createHandMode } = await import("../public/hand-ui.js");
  const originals = { document: globalThis.document, window: globalThis.window };
  let clicks = 0;
  const classList = { add() {}, remove() {}, toggle() {} };
  const target = { dataset:{ pick:"m0" }, isConnected:true, classList, click() { clicks++; }, closest() { return this; } };
  const cursor = { style:{}, classList, remove() {} };
  const button = { setAttribute() {} };
  const status = { textContent:"" };
  const video = { hidden:true, append() {} };
  const host = { innerHTML:"", querySelector: () => button };
  const listeners = {};
  const root = { hidden:false, contains: node => node === target, querySelector: selector => ({
    ".hand-controls":host, "#hand-toggle":button, "#hand-state":status, ".hand-video":video,
    ".ritual-leaf":{ getBoundingClientRect: () => ({left:0,top:0,width:1000,height:1000}) }, ".hand-cursor":cursor,
  }[selector] || null) };
  globalThis.document = { addEventListener(type, fn) { listeners[type] = fn; }, querySelector: () => null, elementFromPoint: () => target, hidden:false };
  globalThis.window = { addEventListener(type, fn) { listeners[type] = fn; } };
  try {
    const mode = createHandMode({ cameraDependencies:{ cancelFrame() {} } });
    mode.mount(root,true);
    const feed = (pinched,time,lift=false) => {
      const points = landmarks(pinched);
      if (lift) { points[8].y -= .12; if (pinched) points[4].y = points[8].y; }
      mode.camera.onResult(points,time);
    };
    mode.camera.state = "on";
    feed(false,0); feed(false,300); feed(true,400); feed(true,500,true); feed(false,600,true);
    assert.equal(clicks,1);
    mode.camera.onResult(null,700);
    feed(false,800); feed(false,1100); feed(true,1200); feed(false,1300);
    assert.equal(clicks,1);
    feed(true,1400); feed(true,1500,true); mode.camera.onResult(null,1600); feed(false,1700);
    assert.equal(clicks,1);
    mode.mount(root,false);
    assert.equal(mode.camera.state,"off");
  } finally {
    for (const [name,value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[name]; else globalThis[name] = value;
    }
  }
});

test("捏合松开可重复切牌，长时间捏住不连发；重挂载后仍需重新张开，预览固定在右页", async () => {
  const { createHandMode } = await import("../public/hand-ui.js");
  const originals={document:globalThis.document,window:globalThis.window};
  const classList={add(){},remove(){},toggle(){}};
  let point=39, rightMounts=0, cuts=[];
  const target={id:"cut-pile",dataset:{},isConnected:true,classList,
    getBoundingClientRect:()=>({top:0,height:600}),setAttribute(_key,value){point=Number(value);},
    getAttribute:()=>String(point),style:{setProperty(){}},closest(){return this;}};
  const panel={}, cursor={style:{},classList,remove(){}}, button={setAttribute(){}};
  const host={innerHTML:"",querySelector:()=>button};
  const right={append(node){assert.equal(node,panel);rightMounts++;},getBoundingClientRect:()=>({left:0,top:0,width:600,height:600})};
  const root={hidden:false,contains:node=>node===target,querySelector:selector=>({
    '.hand-controls':host,'#hand-toggle':button,'#hand-state':{textContent:''},'.hand-video':{hidden:true,append(){}},
    '.hand-panel':panel,'.ritual-leaf':right,'.hand-cursor':cursor,'#cut-pile':target,
  }[selector] || null)};
  globalThis.document={addEventListener(){},querySelector:()=>null,elementFromPoint:()=>target};
  globalThis.window={addEventListener(){}};
  try {
    const mode=createHandMode({onCut:value=>{cuts.push(value);mode.mount(root,true);},cameraDependencies:{cancelFrame(){}}});
    mode.mount(root,true);mode.camera.state='on';
    const feed=(pinched,time)=>mode.camera.onResult(landmarks(pinched),time);
    feed(false,0);feed(false,300);feed(true,400);feed(true,500);feed(true,600);
    assert.equal(cuts.length,0);
    feed(false,700);assert.equal(cuts.length,1);
    feed(true,800);feed(true,1100);assert.equal(cuts.length,1);
    feed(false,1200);feed(false,1500);feed(true,1600);feed(false,1700);
    assert.equal(cuts.length,2);
    assert.ok(cuts.every(value=>value>0 && value<78));
    assert.equal(rightMounts,3);
    feed(false,1800);feed(false,2100);feed(true,2200);mode.camera.onResult(null,2300);feed(false,2400);
    assert.equal(cuts.length,2);
    mode.mount(root,false);
  } finally {
    for(const [key,value] of Object.entries(originals)) {if(value===undefined) delete globalThis[key];else globalThis[key]=value;}
  }
});
