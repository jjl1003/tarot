import { createSweep, cutPoint, angleDelta } from "./ritual.js";

const back = '<span class="ritual-back-design"><i>☾</i><b>✧</b></span>';
export function ritualMarkup(session) {
  if (["meditate", "mixing"].includes(session.phase)) {
    return `<div class="hand-ritual"><div class="ritual-table" id="shuffle-table" role="group" tabindex="0" aria-label="洗牌牌桌，按住牌堆绕动，或使用左右方向键" aria-describedby="shuffle-help"><div class="ritual-orbit" aria-hidden="true"><span>↶</span><span>↷</span></div><div class="ritual-pile" aria-hidden="true">${Array.from({ length: 78 }, (_, i) => `<div class="ritual-card" style="--layer:${i};transform:translate(${(i % 5) * .7}px,${i * .13}px) rotate(-5deg)">${back}</div>`).join("")}</div><span class="ritual-table-label">YOUR HANDS · YOUR RHYTHM</span></div><p id="shuffle-help" class="ritual-hint">按住牌堆，顺时针或逆时针绕动<span class="ritual-keyboard">也可聚焦牌桌，按 ← / → 洗牌</span></p><p class="ritual-status" id="shuffle-status" aria-live="polite">${session.mixCount ? `已经洗动 ${session.mixCount} 次 · 随时可以停下` : "慢慢绕动，让牌随你的手散开"}</p><button id="shuffle" class="primary" ${session.mixCount ? "" : "disabled"}>洗好了，收拢切牌 <span>→</span></button></div>`;
  }
  if (session.phase !== "cut") return "";
  const point = session.cutPreview;
  if (point) return `<div class="hand-ritual"><div class="cut-packets" aria-label="已从第 ${point} 张处切成两叠"><div class="packet packet-upper">${back}<span>上叠 · ${point} 张</span></div><span class="packet-arrow" aria-hidden="true">↶</span><div class="packet packet-lower">${back}<span>下叠 · ${78 - point} 张</span></div></div><p class="ritual-hint">牌已分开。将下叠放到上面，让顺序在这里转个弯。</p><button id="cut" class="primary">合拢牌堆，铺开选牌 <span>→</span></button><button id="recut" class="text-button">重新选择切牌位置</button></div>`;
  return `<div class="hand-ritual"><div class="cut-table"><div class="cut-pile" id="cut-pile" role="slider" tabindex="0" aria-label="切牌位置，点击牌堆或按方向键选择，回车切开" aria-valuemin="1" aria-valuemax="77" aria-valuenow="39"><div class="cut-edges" aria-hidden="true">${Array.from({ length: 78 }, (_, i) => `<i style="--edge:${i}"></i>`).join("")}</div><div class="cut-face" aria-hidden="true">${back}</div><span class="cut-guide" aria-hidden="true"></span></div></div><p class="ritual-hint">沿牌堆上下移动，点击你想切开的位置<span class="ritual-keyboard">也可按 ↑ / ↓ 调整，按回车切开</span></p><p class="ritual-status" id="cut-status" aria-live="polite">从第 39 张处切开</p>${session.cutCount ? `<p class="ritual-status">已切牌 ${session.cutCount} 次 · 可继续捏合切牌</p><button id="finish-cut" class="primary">切好了，铺开选牌 <span>→</span></button>` : ""}</div>`;
}

export function mountRitual(root, { onMix, onCut, current }) {
  const table = root.querySelector("#shuffle-table");
  const cut = root.querySelector("#cut-pile");
  let disposed = false, frame = 0, pointer = null, sweep, spin = 0;
  let dx = 0, dy = 0, latestX = 0, latestY = 0;
  const cards = table ? [...table.querySelectorAll(".ritual-card")] : [];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function paint(scatter = 0) {
    const amount = typeof scatter === "boolean" ? Number(scatter) : Math.max(0, Math.min(1, scatter));
    const rect = table.getBoundingClientRect();
    const radius = Math.min(rect.width * .27, 90);
    cards.forEach((card, i) => {
      const angle = i * 2.39996 + spin;
      const band = .35 + (i % 11) / 15;
      const x = (i % 5) * .7 * (1-amount) + (Math.cos(angle) * radius * band + dx * .12) * amount;
      const y = i * .13 * (1-amount) + (Math.sin(angle) * radius * band * .65 + dy * .12) * amount;
      const rotation = -5 * (1-amount) + (Math.sin(angle) * 38 + spin * 25) * amount;
      card.style.transform = `translate(${x}px,${y}px) rotate(${rotation}deg)`;
    });
  }
  function mix(direction, label) {
    if (disposed) return;
    onMix(direction);
    const count = current()?.mixCount || 0;
    root.querySelector("#shuffle-status").textContent = `${label || (direction > 0 ? "顺时针" : "逆时针")} · 已经洗动 ${count} 次`;
    root.querySelector("#shuffle").disabled = !count;
    return count;
  }
  function finish() {
    if (!table || pointer === null) return;
    const old = pointer;
    pointer = null;
    if (table.hasPointerCapture(old)) table.releasePointerCapture(old);
    cancelAnimationFrame(frame);
    frame = 0;
    table.classList.remove("is-handling");
    paint(false);
  }
  if (table) {
    table.onpointerdown = event => {
      if (pointer !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
      event.preventDefault();
      table.focus({ preventScroll: true });
      pointer = event.pointerId;
      const rect = table.getBoundingClientRect();
      latestX = event.clientX - rect.left - rect.width / 2;
      latestY = event.clientY - rect.top - rect.height / 2;
      dx = latestX; dy = latestY;
      sweep = createSweep(); sweep.move(latestX, latestY);
      table.setPointerCapture(pointer);
      table.classList.add("is-handling");
      paint(true);
    };
    table.onpointermove = event => {
      if (event.pointerId !== pointer) return;
      const rect = table.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      dx = x; dy = y;
      const direction = sweep.move(x, y);
      if (direction) mix(direction);
      const turn = angleDelta(Math.atan2(latestY, latestX), Math.atan2(y, x));
      if (Math.abs(turn) < Math.PI / 2) spin += turn * .7;
      latestX = x; latestY = y;
      if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!disposed) paint(true); });
    };
    table.onpointerup = event => { if (event.pointerId === pointer) finish(); };
    table.onpointercancel = event => { if (event.pointerId === pointer) finish(); };
    table.onlostpointercapture = finish;
    table.onkeydown = event => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      mix(event.key === "ArrowRight" ? 1 : -1);
      if (!reduced) {
        spin += event.key === "ArrowRight" ? .4 : -.4;
        paint(true);
        clearTimeout(table.settleTimer);
        table.settleTimer = setTimeout(() => { if (!disposed) paint(false); }, 250);
      }
    };
  }
  if (cut) {
    let point = 39;
    function preview(next) {
      point = next;
      cut.setAttribute("aria-valuenow", String(point));
      cut.style.setProperty("--cut-position", `${point / 78 * 100}%`);
      root.querySelector("#cut-status").textContent = `从第 ${point} 张处切开`;
    }
    function fromPointer(event) {
      const rect = cut.getBoundingClientRect();
      return cutPoint((event.clientY - rect.top) / rect.height);
    }
    cut.onpointermove = event => preview(fromPointer(event));
    cut.onclick = event => onCut(event.detail === 0 ? point : fromPointer(event));
    cut.onkeydown = event => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        preview(event.key === "Home" ? 1 : event.key === "End" ? 77 : cutPoint((point + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1)) / 78));
      } else if (["Enter", " "].includes(event.key)) { event.preventDefault(); onCut(point); }
    };
  }
  const dispose = () => {
    finish(); disposed = true;
    cancelAnimationFrame(frame);
    if (table) clearTimeout(table.settleTimer);
  };
  dispose.mix = mix;
  dispose.handPose = pose => {
    if (!table || disposed || pointer !== null) return;
    const spread = pose?.ready ? (pose.mode === "palms" ? Number(pose.moving) : pose.openness) : 0;
    table.classList.toggle("is-handling", spread > .02);
    if (spread > .02) { dx = (pose.x - .5) * 120; dy = (pose.y - .5) * 120; }
    // Camera and mouse both stir the same scattered deck on the same table.
    if (pose?.mode === "palms") spin += (pose.rotationDelta || 0) * .7;
    paint(spread);
  };
  return dispose;
}
