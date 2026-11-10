// Percentages describe sweep progress or finger opening, never confidence.
export function handFeedback(pose) {
  const reasons = { no_hand:"未检测到手 · 请将手放进画面", no_hands:"等待手掌 · 单手张开即可洗牌", palm_closed:"请张开手掌 · 洗牌已暂停", out_of_frame:"手超出画面 · 请稍微后退", too_small:"手离得太远 · 请靠近摄像头", hands_overlapping:"双手重叠 · 请留一点空隙" };
  if (!pose?.visible) return { label:reasons[pose?.reason] || reasons.no_hand, step:pose?.mode === "palms" ? "本轮绕动" : "两指开合", percent:0, progress:0, ready:false };
  if (!pose.ready) {
    const prompts = { center:["张开手掌放在镜头前，保持片刻","定位牌桌中心"], closed:["拇指与食指捏合，保持片刻","校准捏合位置"], opened:["自然张开两指，保持片刻","校准张开范围"] };
    const [label,step]=prompts[pose.calibrationStep] || prompts.center;
    return { label,step,percent:0,progress:Math.round(pose.calibrationProgress*100),ready:false };
  }
  return { label:pose.mode === "palms" ? (!pose.moving ? "已识别手掌 · 等待绕动" : pose.direction > 0 ? "顺时针洗牌中" : "逆时针洗牌中") : (pose.pinching ? "已识别：两指捏合" : "已识别：两指张开"),
    step:pose.mode === "palms" ? "本轮绕动" : "两指开合", percent:Math.round(pose.openness*100),progress:100,ready:true };
}
export const HAND_CONNECTIONS=[[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
export function drawHand(canvas, input, {width=640,height=480}={}) {
  if (!canvas) return;
  if (canvas.width!==width || canvas.height!==height) { canvas.width=width; canvas.height=height; }
  const ctx=canvas.getContext("2d"); if (!ctx) return;
  ctx.clearRect(0,0,width,height);
  const hands=(Array.isArray(input?.[0]) ? input : [input]).filter(points => Array.isArray(points) && points.length===21 && points.every(p=>p && Number.isFinite(p.x) && Number.isFinite(p.y)));
  const palms=[];
  hands.slice(0,2).forEach((points,hand) => {
    const point=i=>({x:(1-points[i].x)*width,y:points[i].y*height});
    ctx.lineWidth=Math.max(2,width/180); ctx.lineCap="round"; ctx.strokeStyle=hand ? "#8acffc" : "#87e7b0";
    for (const [from,to] of HAND_CONNECTIONS) {
      const a=point(from), b=point(to);
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
    const a=point(4), b=point(8);
    ctx.setLineDash([7,6]); ctx.strokeStyle="#f4d06f";
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); ctx.setLineDash([]);
    points.forEach((_,i)=>{
      const p=point(i); ctx.beginPath(); ctx.arc(p.x,p.y,[4,8].includes(i)?8:4,0,Math.PI*2);
      ctx.fillStyle=[4,8].includes(i)?"#ffe5a2":"#f3fff5"; ctx.fill();
    });
    const palm=[0,5,9,13,17].map(point).reduce((sum,p)=>({x:sum.x+p.x/5,y:sum.y+p.y/5}),{x:0,y:0});
    palms.push(palm); ctx.fillStyle=hand ? "#8acffc" : "#87e7b0"; ctx.font="bold 18px sans-serif"; ctx.fillText(String(hand+1).padStart(2,"0"),palm.x+12,palm.y);
  });
  if (palms.length===2) {
    ctx.strokeStyle="#f4d06f"; ctx.setLineDash([9,7]);
    ctx.beginPath(); ctx.moveTo(palms[0].x,palms[0].y); ctx.lineTo(palms[1].x,palms[1].y); ctx.stroke(); ctx.setLineDash([]);
  }
}
