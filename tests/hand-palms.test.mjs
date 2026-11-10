import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPalmShuffle, palmPair } from "../public/hand-palms.js";
import { handFeedback, drawHand, HAND_CONNECTIONS } from "../public/hand-feedback.js";
import { createHandGestures } from "../public/hand-gestures.js";
function hand() {
  const points=Array.from({length:21},()=>({x:.5,y:.6}));
  const positions={0:[.5,.82],4:[.25,.55],5:[.42,.65],6:[.4,.5],8:[.38,.32],9:[.49,.62],10:[.48,.48],12:[.48,.28],13:[.56,.64],14:[.56,.49],16:[.57,.3],17:[.62,.67],18:[.64,.52],20:[.67,.35]};
  for(const [i,[x,y]] of Object.entries(positions)) points[i]={x,y};
  return points;
}
function pair(gap) {
  const source=hand(), indices=[0,5,9,13,17];
  const center=indices.reduce((sum,i)=>({x:sum.x+source[i].x/5,y:sum.y+source[i].y/5}),{x:0,y:0});
  const width=Math.hypot(source[5].x-source[17].x,source[5].y-source[17].y)*.65;
  return [-1,1].map(side=>source.map(p=>({x:.5+side*gap*width/2+(p.x-center.x)*.65,y:.5+(p.y-center.y)*.65})));
}
function circle(angle,direction=1) {
  const source=pair(1.8), radians=-direction*angle;
  return source.map(points=>{
    const indices=[0,5,9,13,17];
    const center=indices.reduce((sum,i)=>({x:sum.x+points[i].x/5,y:sum.y+points[i].y/5}),{x:0,y:0});
    const x=center.x-.5,y=center.y-.5;
    const target={x:.5+x*Math.cos(radians)-y*Math.sin(radians),y:.5+x*Math.sin(radians)+y*Math.cos(radians)};
    return points.map(point=>({x:point.x+target.x-center.x,y:point.y+target.y-center.y}));
  });
}
function calibrate(engine) {
  let pose;
  for(let i=0;i<=6;i++) pose=engine.update(pair(1.8),i*100);
  assert.ok(pose.ready);
  return pose;
}
test("一只张开的手即可定位牌桌；无手或收掌时暂停",()=>{
  const engine=createPalmShuffle();
  assert.equal(engine.update([],0).reason,"no_hands");
  assert.equal(engine.update(pair(1.8).slice(0,1),100).visible,true);
  assert.equal(engine.update(pair(.3),200).visible,true);
  const pinched=hand();pinched[4]={...pinched[8]};
  assert.equal(engine.update([pinched],250).reason,"palm_closed");
  engine.recalibrate();
  const first=engine.update(pair(1.8),300);
  assert.equal(first.calibrationProgress,0);
  assert.equal(first.mix,0);
  assert.equal(calibrate(createPalmShuffle()).moving,false);
});
test("双手顺逆时针绕动同一牌桌，与鼠标一样按角度洗动；静止会暂停",()=>{
  for(const direction of [1,-1]) {
    const engine=createPalmShuffle(); calibrate(engine);
    let count=0,pose;
    for(let i=1;i<=48;i++) {
      const hands=circle(i*Math.PI/24,direction);
      if(i%2) hands.reverse();
      pose=engine.update(hands,600+i*100);
      if(pose.mix) assert.equal(pose.mix,direction);
      count+=Math.abs(pose.mix);
    }
    assert.ok(count>=6 && count<=8);
    assert.equal(pose.direction,direction);
    assert.equal(pose.moving,true);
    for(let i=1;i<=6;i++) {pose=engine.update(circle(Math.PI*2,direction),5400+i*100);assert.equal(pose.mix,0);}
    assert.equal(pose.moving,false);
  }
});
test("单纯拉开合拢不再洗牌；手全部离开后不把未完成角度接到下一轮",()=>{
  const engine=createPalmShuffle(); calibrate(engine);
  for(let i=0;i<12;i++) assert.equal(engine.update(pair(i%2 ? 3 : 1.4),700+i*100).mix,0);
  engine.recalibrate();calibrate(engine);
  assert.equal(engine.update(circle(Math.PI/8),700).mix,0);
  assert.equal(engine.update([],800).visible,false);
  assert.equal(engine.update(circle(Math.PI/4),900).mix,0);
  assert.equal(engine.update(circle(Math.PI*3/8),1000).mix,0);
  engine.recalibrate();
  assert.equal(engine.update(pair(1.8),1100).ready,false);
});
test("两指校准只在明确要求时进行；校准期间不能触发选牌",()=>{
  const engine=createHandGestures({requireCalibration:true});
  const closed=hand(); closed[4]={...closed[8]};
  let pose;
  for(let i=0;i<=6;i++) { pose=engine.update(closed,i*100); assert.equal(pose.pinchStart,false); }
  assert.equal(pose.calibrationStep,"opened");
  for(let i=7;i<=13;i++) pose=engine.update(hand(),i*100);
  assert.equal(pose.ready,true);
  engine.recalibrate(); assert.equal(engine.update(hand(),1400).ready,false);
});
test("面板明确区分动作幅度和识别状态，不把百分比当作识别准确率",()=>{
  const initial=handFeedback({visible:false,mode:"palms",reason:"palm_closed"});
  assert.match(initial.label,/张开手掌/);
  assert.equal(initial.percent,0);
  assert.equal(handFeedback({visible:true,ready:true,mode:"palms",openness:.42}).percent,42);
  const calibration=handFeedback({visible:true,ready:false,mode:"palms",calibrationStep:"center",calibrationProgress:.5});
  assert.equal(calibration.percent,0); assert.equal(calibration.progress,50);
  assert.match(calibration.label,/张开手掌放在镜头前/);
});
test("摄像头画面绘制两只手的 21 个骨点、骨架和距离连线，失去跟踪后清空旧骨架",()=>{
  const calls=[];
  const ctx={clearRect:(...a)=>calls.push(['clear',...a]),beginPath(){},moveTo:(...a)=>calls.push(['move',...a]),lineTo(){},stroke:()=>calls.push(['stroke']),setLineDash(){},arc:()=>calls.push(['point']),fill(){},fillText:()=>calls.push(['label'])};
  const canvas={width:640,height:480,getContext:()=>ctx};
  drawHand(canvas,pair(2.2));
  assert.equal(calls.filter(c=>c[0]==='point').length,42);
  assert.equal(calls.filter(c=>c[0]==='label').length,2);
  assert.equal(calls.filter(c=>c[0]==='stroke').length,HAND_CONNECTIONS.length*2+3);
  const length=calls.length; drawHand(canvas,null);
  assert.deepEqual(calls.slice(length),[['clear',0,0,640,480]]);
});
test("Worker 同时检测双手并返回完整坐标给本机面板",async()=>{
  const source=await readFile(new URL('../public/hand-worker.js',import.meta.url),'utf8');
  assert.match(source,/numHands: 2/);
  assert.match(source,/hands: result.landmarks/);
});

test("控制器支持单手绕动洗牌，手离开时取消动作并显示暂停",async()=>{
  const {createHandMode}=await import('../public/hand-ui.js');
  const originals={document:globalThis.document,window:globalThis.window};
  const state={textContent:''}, label={textContent:''}, action={textContent:''};
  const button={setAttribute(){}}, video={hidden:true,append(){}};
  const host={innerHTML:'',querySelector:()=>button};
  const cursor={style:{},classList:{toggle(){}},remove(){}};
  const root={hidden:false,contains:()=>false,querySelector:selector=>({
    '.hand-controls':host,'#hand-toggle':button,'#hand-state':state,'.hand-video':video,'.hand-cursor':cursor,
    '#shuffle-table':{},'.hand-tracking':label,'.hand-action':action,
    '.ritual-leaf':{getBoundingClientRect:()=>({left:0,top:0,width:600,height:500})},
  }[selector] || null)};
  globalThis.document={addEventListener(){},querySelector:()=>null,elementFromPoint:()=>null};
  globalThis.window={addEventListener(){}};
  let count=0;
  try {
    const mode=createHandMode({onMix:()=>++count,cameraDependencies:{cancelFrame(){}}});
    mode.mount(root,true);mode.camera.state='on';
    const feed=(hands,time)=>mode.camera.onResult(hands[0],time,{hands});
    for(let i=0;i<=6;i++) feed(pair(1.8).slice(0,1),i*100);
    assert.equal(count,0);
    for(let i=1;i<=7;i++) feed(circle(i*Math.PI/24).slice(0,1),600+i*100);
    assert.equal(count,1);
    assert.match(action.textContent,/已记录第 1 次洗牌/);
    feed([],1400);
    assert.match(label.textContent,/等待手掌/);
    assert.match(action.textContent,/暂停/);
    assert.equal(count,1);
    mode.mount(root,false);
  } finally {
    for(const [key,value] of Object.entries(originals)) {if(value===undefined) delete globalThis[key]; else globalThis[key]=value;}
  }
});
test("低帧率仍可定位牌桌，采样不足不提前显示完成",()=>{
  const engine=createPalmShuffle();
  engine.update(pair(1.8),0);engine.update(pair(1.8),500);
  const partial=engine.update(pair(1.8),1000);
  assert.equal(partial.calibrationProgress,.75);
  assert.equal(partial.ready,false);
  assert.equal(engine.update(pair(1.8),1500).ready,true);
});


test("单手张掌支持双向完整绕圈，收掌、中心抖动和手数量变化不误计次",()=>{
  for(const direction of [1,-1]) {
    const engine=createPalmShuffle();
    for(let i=0;i<=6;i++) engine.update(circle(0).slice(0,1),i*100);
    let count=0;
    for(let i=1;i<=48;i++) {
      const pose=engine.update(circle(i*Math.PI/24,direction).slice(0,1),600+i*100);
      if(pose.mix) assert.equal(pose.mix,direction);
      count+=Math.abs(pose.mix);
    }
    assert.ok(count>=6 && count<=8);
    const pinched=circle(0)[0];pinched[4]={...pinched[8]};
    assert.equal(engine.update([pinched],5500).moving,false);
    assert.equal(engine.update(circle(Math.PI/3),5600).mix,0);
    assert.equal(engine.update(circle(Math.PI/3).slice(0,1),5700).mix,0);
  }
  const engine=createPalmShuffle();
  for(let i=0;i<=6;i++) engine.update(pair(0).slice(0,1),i*100);
  for(let i=0;i<20;i++) assert.equal(engine.update(pair(.02).slice(0,1),700+i*100).mix,0);
});
