export class HandCamera {
  constructor({ onResult, onState }, dependencies = {}) {
    this.onResult = onResult; this.onState = onState;
    this.dependencies = dependencies;
    this.generation = 0; this.stream = null; this.worker = null; this.frame = 0;
    this.video = null; this.state = "off"; this.message = "";
  }
  setState(state, message) { this.state = state; this.message = message; this.onState?.(state, message); }
  stop(message = "摄像头已关闭") {
    this.generation++;
    this.rejectInit?.(Error("cancelled")); this.rejectInit = null;
    clearTimeout(this.initTimer); clearTimeout(this.frameTimer);
    (this.dependencies.cancelFrame || cancelAnimationFrame)(this.frame);
    this.worker?.terminate(); this.worker = null;
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
    this.state = "off";
    this.onResult?.(null, performance.now());
    this.setState("off", message);
  }
  async start() {
    if (this.state === "loading" || this.state === "on") return;
    const token = ++this.generation;
    const deps = this.dependencies;
    const getMedia = deps.getMedia || (constraints => navigator.mediaDevices.getUserMedia(constraints));
    try {
      if (!deps.getMedia && (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof Worker === "undefined" || typeof createImageBitmap === "undefined")) {
        this.setState("off", "当前浏览器不支持摄像头手势，请使用 HTTPS 页面或改用鼠标。"); return;
      }
      this.setState("loading", "正在准备手势识别，首次需要下载模型…");
      const worker = (deps.createWorker || (() => new Worker("/hand-worker.js")))();
      this.worker = worker;
      const ready = new Promise((resolve, reject) => {
        this.rejectInit = reject;
        this.initTimer = setTimeout(() => reject(Error("model_load_failed")), 45000);
        worker.onmessage = event => {
          if (event.data.type === "ready") resolve();
          else if (event.data.type === "error") reject(Error("model_load_failed"));
        };
        worker.onerror = () => reject(Error("model_load_failed"));
      });
      worker.postMessage({ type: "init" });
      await ready;
      clearTimeout(this.initTimer); this.rejectInit = null;
      if (token !== this.generation) return;
      this.setState("loading", "请在浏览器中允许摄像头，识别画面仅在本机处理。");
      const stream = await getMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
      if (token !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.video ||= (deps.createVideo || (() => document.createElement("video")))();
      Object.assign(this.video, { muted: true, autoplay: true, playsInline: true, srcObject: stream });
      await this.video.play();
      if (token !== this.generation) return;
      for (const track of stream.getTracks()) track.onended = () => this.stop("摄像头已断开，可重新开启或使用鼠标。");
      let working = false, lastVideoTime = -1, lastSent = -Infinity;
      worker.onmessage = event => {
        if (token !== this.generation) return;
        if (event.data.type === "result") {
          working = false; clearTimeout(this.frameTimer);
          this.onResult?.(event.data.landmarks, event.data.timestamp, {
            hands: event.data.hands || (event.data.landmarks ? [event.data.landmarks] : []),
          });
        } else if (event.data.type === "error") this.stop("手势识别中断，可重新开启或使用鼠标。");
      };
      worker.onerror = () => this.stop("手势识别中断，可重新开启或使用鼠标。");
      this.setState("on", "摄像头已开启 · 请先张开手掌进入画面");
      const next = deps.requestFrame || requestAnimationFrame;
      const bitmap = deps.createBitmap || createImageBitmap;
      const loop = async now => {
        if (token !== this.generation) return;
        if (!working && this.video.readyState >= 2 && this.video.currentTime !== lastVideoTime && now - lastSent >= 100) {
          working = true; lastVideoTime = this.video.currentTime; lastSent = now;
          try {
            const image = await bitmap(this.video);
            if (token !== this.generation) { image.close(); return; }
            worker.postMessage({ type: "frame", image, timestamp: now }, [image]);
            this.frameTimer = setTimeout(() => this.stop("识别响应超时，可重新开启或使用鼠标。"), 5000);
          } catch { this.stop("无法读取摄像头画面，请改用鼠标或重新开启。"); return; }
        }
        this.frame = next(loop);
      };
      this.frame = next(loop);
    } catch (error) {
      if (token !== this.generation) return;
      const denied = ["NotAllowedError", "SecurityError"].includes(error.name);
      const message = denied ? "未获得摄像头权限，仍可使用鼠标或触屏。" :
        error.name === "NotFoundError" ? "没有找到摄像头，仍可使用鼠标或触屏。" :
        error.message === "model_load_failed" ? "识别模型未能加载，请检查网络后重试；仍可使用鼠标。" : "摄像头暂不可用，请关闭其他占用摄像头的应用后重试。";
      this.stop(message);
    }
  }
}
