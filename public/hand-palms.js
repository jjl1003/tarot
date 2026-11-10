import { inspectHand } from "./hand-gestures.js";
import { createSweep, angleDelta } from "./ritual.js";
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function palmPair(hands) {
  const observations=(hands || []).slice(0,2).map(inspectHand);
  const tracked=observations.filter(item=>item.pose);
  const valid=tracked.filter(item=>item.pose.open && item.pose.ratio>.35);
  const base={mode:"palms",handCount:valid.length,visible:false,ready:false,mix:0,openness:0,moving:false,rotationDelta:0,direction:0,pinchStart:false,pinchEnd:false};
  if(!valid.length) return {...base,reason:tracked.length ? "palm_closed" : observations.find(item=>!item.pose)?.reason || "no_hands"};
  const centers=valid.map(({pose})=>({x:pose.palmX,y:pose.palmY}));
  return {...base,visible:true,reason:"tracked",centers,
    x:centers.reduce((sum,p)=>sum+p.x/centers.length,0),
    y:centers.reduce((sum,p)=>sum+p.y/centers.length,0)};
}
export function createPalmShuffle() {
  let center=null,holdSince=null,samples=[],previous=null,lastTime=null;
  let sweep=createSweep(),angle=0,lastMotion=-Infinity,direction=0;
  sweep.move(80,0);
  return {
    reset() {previous=null;lastTime=null;holdSince=null;samples=[];sweep=createSweep();angle=0;sweep.move(80,0);lastMotion=-Infinity;direction=0;},
    recalibrate() {center=null;this.reset();},
    update(hands,now) {
      const pair=palmPair(hands);
      if(!pair.visible) {
        this.reset();
        return {...pair,ready:!!center,calibrationStep:center ? "done" : "center",calibrationProgress:0};
      }
      if(lastTime===null || now-lastTime>1000) this.reset();
      lastTime=now;
      if(!center) {
        if(samples.length && distance(pair,samples[0])>.035) {holdSince=null;samples=[];}
        holdSince ??= now; samples.push({x:pair.x,y:pair.y});
        const progress=Math.min(1,(now-holdSince)/600,samples.length/4);
        if(progress<1) return {...pair,calibrationStep:"center",calibrationProgress:progress};
        // With one hand the visible frame center is the shared table center.
        // Averaging a stationary single palm would put the rotation origin inside it.
        center=pair.handCount===1 ? {x:.5,y:.5} : samples.reduce((sum,p)=>({x:sum.x+p.x/samples.length,y:sum.y+p.y/samples.length}),{x:0,y:0});
        holdSince=null;samples=[];
      }
      let points=pair.centers;
      if(previous && previous.length!==points.length) {
        previous=null;sweep=createSweep();angle=0;sweep.move(80,0);lastMotion=-Infinity;
      }
      if(previous && points.length===2) {
        const keep=distance(points[0],previous[0])+distance(points[1],previous[1]);
        const swap=distance(points[1],previous[0])+distance(points[0],previous[1]);
        if(swap<keep) points=[points[1],points[0]];
      }
      const old=previous;
      let rotationDelta=0;
      if(old) {
        const turns=points.map((p,i)=>{
          if(distance(p,old[i])<.002) return 0;
          if(distance(p,center)<.04 || distance(old[i],center)<.04) return 0;
          const delta=angleDelta(Math.atan2(old[i].y-center.y,old[i].x-center.x),Math.atan2(p.y-center.y,p.x-center.x));
          return Math.abs(delta)<=Math.PI/2 && Math.abs(delta)>=.012 ? delta : 0;
        });
        rotationDelta=turns.reduce((best,turn)=>Math.abs(turn)>Math.abs(best) ? turn : best,0);
        if(rotationDelta) {lastMotion=now;direction=Math.sign(rotationDelta);}
      }
      // Use the same angular sweep as the mouse. Separation/closing alone cannot mix.
      // One shared angular accumulator prevents both palms from double-counting
      // the same sweep when their frame timing differs slightly.
      let mix=0;
      if(rotationDelta) {
        angle+=rotationDelta;
        mix=sweep.move(Math.cos(angle)*80,Math.sin(angle)*80);
      }
      previous=points;
      const moving=now-lastMotion<350;
      return {...pair,ready:true,moving,open:moving,openness:sweep.progress(),
        mix,direction:moving ? direction : 0,rotationDelta,calibrationStep:"done",calibrationProgress:1};
    },
  };
}
