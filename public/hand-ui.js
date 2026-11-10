import { HandCamera } from "./hand-camera.js";
import { createHandGestures, handPose } from "./hand-gestures.js";
import { createPalmShuffle } from "./hand-palms.js";
import { handFeedback, drawHand } from "./hand-feedback.js";
import { cutPoint } from "./ritual.js";

export function createHandMode({ onMix, onPose, onCut, cameraDependencies } = {}) {
  const gestures=createHandGestures(), palms=createPalmShuffle();
  let root=null, hover=null, hoverSince=0, held=null, previousHand=null;
  let actionMessage="", actionUntil=0;
  const camera=new HandCamera({onResult:process,onState:updateControls},cameraDependencies);
  const element=selector=>root?.querySelector(selector);
  const text=(selector,value)=>{ const node=element(selector); if(node && node.textContent!==value) node.textContent=value; };
  function clear() {
    hover?.classList.remove("hand-hover"); hover=null; held=null; previousHand=null;
    gestures.reset(); palms.reset();
    element(".hand-cursor")?.remove();
    drawHand(element(".hand-skeleton"),null);
    onPose?.(null);
  }
  function feedback(pose,hands=[]) {
    const value=handFeedback(pose);
    text(".hand-tracking",value.label);
    text(".hand-meter-label",value.step);
    text(".hand-percentage",value.ready ? `${value.percent}%` : "—");
    const meter=element(".hand-opening-meter");
    if(meter) { meter.setAttribute("aria-valuenow",String(value.percent)); meter.setAttribute("aria-label",value.step); meter.style.setProperty("--hand-value",`${value.percent}%`); }
    const calibration=element(".hand-calibration");
    if(calibration) { calibration.hidden=!pose?.visible || !!pose?.ready; calibration.value=value.progress; }
    [0,1].forEach(i=>text(`[data-hand-indicator="${i}"]`,`${String(i+1).padStart(2,"0")} ${handPose(hands[i]) ? "已识别" : i ? "可选" : "等待入镜"}`));
    const canvas=element(".hand-skeleton");
    const width=camera.video?.videoWidth || 640, height=camera.video?.videoHeight || 480;
    const preview=element(".hand-video");
    preview?.style?.setProperty("--video-aspect",`${width} / ${height}`);
    drawHand(canvas,hands,{width,height});
  }
  function updateControls() {
    if(!root) return;
    const button=element("#hand-toggle"), status=element("#hand-state");
    if(!button || !status) return;
    button.textContent=camera.state==="off" ? "开启摄像头手势" : camera.state==="loading" ? "取消开启" : "关闭摄像头";
    button.setAttribute("aria-pressed",String(camera.state==="on"));
    status.textContent=camera.message || "可选 · 单手张掌即可绕动洗牌";
    const panel=element(".hand-panel"); if(panel) panel.hidden=camera.state==="off";
    root.classList?.toggle("hand-enabled",camera.state!=="off");
    const preview=element(".hand-video");
    if(preview) {
      preview.hidden=camera.state!=="on";
      if(camera.state==="on" && camera.video) preview.prepend ? preview.prepend(camera.video) : preview.append(camera.video);
    }
    const calibrate=element("#hand-recalibrate"); if(calibrate) calibrate.disabled=camera.state!=="on";
    const help=element("#shuffle-help");
    if(help) help.innerHTML=camera.state==="on"
      ? '单手张掌，围绕画面中心顺时针或逆时针绕动<span class="ritual-keyboard">也可以使用鼠标绕动洗牌</span>'
      : '按住牌堆，顺时针或逆时针绕动<span class="ritual-keyboard">也可聚焦牌桌，按 ← / → 洗牌</span>';
    if(element("#cut-pile")) text(".ritual-hint",camera.state==="on"
      ? "光点停在牌堆上，捏合再松开；可重复切牌，完成后点击“切好了”"
      : "沿牌堆上下移动，点击切开；也可用方向键和回车选择切点");
    if(camera.state==="off") { palms.recalibrate(); feedback(null); }
  }
  function primary(hands) {
    const candidates=hands.map(points=>({points,pose:handPose(points)})).filter(item=>item.pose);
    if(!candidates.length) { previousHand=null; return null; }
    candidates.sort((a,b)=>previousHand
      ? Math.hypot(a.pose.palmX-previousHand.x,a.pose.palmY-previousHand.y)-Math.hypot(b.pose.palmX-previousHand.x,b.pose.palmY-previousHand.y)
      : b.pose.palmX-a.pose.palmX);
    const chosen=candidates[0];
    if(previousHand && Math.hypot(chosen.pose.palmX-previousHand.x,chosen.pose.palmY-previousHand.y)>.3) { gestures.reset(); held=null; }
    previousHand={x:chosen.pose.palmX,y:chosen.pose.palmY};
    return chosen.points;
  }
  function process(landmarks,now,metadata) {
    if(!root || camera.state!=="on" || root.hidden) { clear(); return; }
    if(document.querySelector("dialog[open]")) { camera.stop("弹窗开启，摄像头已关闭；返回仪式后可重新开启。"); return; }
    const hands=[...(metadata?.hands || (landmarks ? [landmarks] : []))].sort((a,b)=>{
      const first=handPose(a), second=handPose(b);
      return first && second ? first.palmX-second.palmX : 0;
    });
    const washing=!!element("#shuffle-table");
    const pose=gestures.update(primary(hands),now);
    const motion=washing ? palms.update(hands,now) : pose;
    feedback(motion,hands);
    onPose?.(motion.visible && motion.ready ? motion : null);
    if(washing && motion.mix) {
      const count=onMix?.(motion.mix);
      if(Number.isInteger(count)) { actionMessage=`已记录第 ${count} 次洗牌`; actionUntil=now+1400; }
    }
    if(!pose.visible || !pose.ready || (washing && (!motion.ready || !motion.visible))) {
      hover?.classList.remove("hand-hover"); hover=null; held=null;
      element(".hand-cursor")?.remove();
      text("#hand-state",handFeedback(motion).label);
      text(".hand-action",washing ? (motion.ready ? "洗牌暂停 · 手掌入镜并张开后继续，未完成动作已取消" : "先张开手掌自然停留，再绕动洗牌") : "请先张开手，确认骨架和光点出现");
      return;
    }
    const rect=element(".ritual-leaf").getBoundingClientRect();
    const x=rect.left+pose.x*rect.width, y=rect.top+pose.y*rect.height;
    let cursor=element(".hand-cursor");
    if(!cursor) { cursor=document.createElement("div"); cursor.className="hand-cursor"; cursor.setAttribute("aria-hidden","true"); root.append(cursor); }
    cursor.style.left=`${x}px`; cursor.style.top=`${y}px`; cursor.classList.toggle("is-pinching",pose.pinching);
    const hit=document.elementFromPoint(x,y)?.closest("[data-pick], [data-flip], #cut-pile, #shuffle, #cut, #recut, #finish-cut");
    const target=hit && root.contains(hit) && !hit.disabled ? hit : null;
    if(target!==hover && !held) { hover?.classList.remove("hand-hover"); hover=target; hoverSince=now; hover?.classList.add("hand-hover"); }
    const cut=element("#cut-pile");
    if(cut && target===cut) {
      const bounds=cut.getBoundingClientRect(), point=cutPoint((y-bounds.top)/bounds.height);
      cut.setAttribute("aria-valuenow",String(point)); cut.style.setProperty("--cut-position",`${point/78*100}%`);
      text("#cut-status",`从第 ${point} 张处切开`);
    }
    if(pose.pinchStart && hover && target===hover && now-hoverSince>=280) held={node:hover,y,lifted:false,point:cut ? Number(cut.getAttribute("aria-valuenow")) : null};
    if(held && pose.pinching && held.y-y>=26) held.lifted=true;
    if(pose.pinchEnd) {
      const action=held; held=null;
      if(action?.node.isConnected) {
        if(action.node.dataset.pick) { if(action.lifted) action.node.click(); }
        else if(action.node.id==="cut-pile") {
          // Clear references before the callback remounts the ritual after each cut.
          hover?.classList.remove("hand-hover"); hover=null;
          onCut?.(action.point);
          text(".hand-action","切牌已记录 · 张开两指，再次捏合可继续切牌");
          return;
        }
        else if(target===action.node) action.node.click();
      }
    }
    const instruction=held?.node.dataset.pick ? "已抓住牌 · 向上拉出，再松开" :
      washing ? "张掌围绕画面中心绕动，停住即暂停" :
      pose.pinching && !held ? "先张开手，停留在目标上，再捏合" : target ? "目标已高亮 · 捏合后松开确认" : "移动食指选择目标，捏合切牌或提牌";
    text("#hand-state",motion.visible ? instruction : handFeedback(motion).label);
    text(".hand-action",now<actionUntil ? actionMessage : instruction);
    const fan=element(".fan-scroll");
    if(fan && !held) {
      const bounds=fan.getBoundingClientRect();
      if(y>bounds.top && y<bounds.bottom) {
        if(x<bounds.left+26) fan.scrollLeft-=12;
        else if(x>bounds.right-26) fan.scrollLeft+=12;
      }
    }
  }
  const leave=()=>camera.stop("摄像头已关闭，返回仪式后可重新开启。");
  document.addEventListener("visibilitychange",()=>{ if(document.hidden) leave(); });
  window.addEventListener("pagehide",leave);
  return {camera,mount(nextRoot,allowed) {
    clear(); root=nextRoot;
    if(!allowed) { if(camera.state!=="off") camera.stop(); return; }
    const host=element(".hand-controls");
    host.innerHTML='<div class="hand-control-line"><button id="hand-toggle" class="text-button" aria-pressed="false">开启摄像头手势</button><span id="hand-state" role="status"></span></div><section class="hand-panel" hidden aria-label="实时手势识别面板"><header><strong>手势识别</strong><button id="hand-recalibrate" class="text-button">重新校准</button></header><div class="hand-monitor-grid"><div class="hand-video" hidden><canvas class="hand-skeleton" aria-label="实时手部骨架"></canvas><span class="hand-camera-badge">本机识别 · 不上传</span></div><div class="hand-readout"><div class="hand-presence"><span data-hand-indicator="0">01 等待入镜</span><span data-hand-indicator="1">02 可选</span></div><p class="hand-tracking" role="status">单手张掌即可洗牌</p><div class="hand-meter-title"><span class="hand-meter-label">本轮绕动</span><strong class="hand-percentage">—</strong></div><div class="hand-opening-meter" role="meter" aria-label="本轮绕动" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div><progress class="hand-calibration" hidden max="100" value="0" aria-label="当前校准步骤进度"></progress><p class="hand-action" role="status">张开一只手掌，停留片刻，再绕动整桌牌</p></div></div></section><details class="hand-help"><summary>手势与摄像头说明</summary><p>洗牌只需张开一只手掌：像鼠标一样，顺时针或逆时针绕动同一桌散牌。停住即暂停，不用分开、合拢双手。收起手掌或离开画面时暂停。切牌时将光点移到牌堆上，拇指食指捏合再松开，每次都会切牌，可多次重复；按“切好了”进入选牌。按钮和抽牌也使用捏合；选牌时抓住、向上拉出、再松开。百分比表示本轮绕动进度或两指开合程度，不是识别准确率。</p><p>仅主动开启时申请摄像头，视频在本机识别，不录制或上传。首次需联网下载模型；关闭、离开仪式、打开弹窗或切入后台时释放摄像头。鼠标和触屏始终可用。</p></details>';
    const panel=element(".hand-panel"), panelHost=element(".ritual-leaf");
    if(panel && panelHost) panelHost.append(panel);
    host.querySelector("#hand-toggle").onclick=()=>camera.state==="off" ? camera.start() : camera.stop();
    const calibrate=element("#hand-recalibrate");
    if(calibrate) calibrate.onclick=()=>{
      if(element("#shuffle-table")) palms.recalibrate(); else gestures.recalibrate();
      clear(); actionUntil=0;
      text("#hand-state","正在重新校准，请按面板提示操作");
    };
    text(".hand-tracking",element("#shuffle-table") ? "单手张掌即可洗牌" : "移动光点，捏合再松开");
    updateControls();
  }};
}
