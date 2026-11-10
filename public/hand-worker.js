// Classic worker: MediaPipe's WASM loader uses importScripts. All JavaScript is
// served from this site; only pinned WASM/model weights are downloaded externally.
self.exports = {};
let detector;
self.onmessage = async event => {
  const { type, image, timestamp } = event.data;
  try {
    if (type === "init") {
      importScripts("/vendor/vision-0.10.32.js");
      const { HandLandmarker, FilesetResolver } = self.exports;
      const files = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm");
      files.wasmLoaderPath = files.wasmLoaderPath.includes("nosimd") ? "/vendor/vision-wasm-nosimd.js" : "/vendor/vision-wasm.js";
      detector = await HandLandmarker.createFromOptions(files, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "VIDEO", numHands: 2,
        minHandDetectionConfidence: .65, minHandPresenceConfidence: .65, minTrackingConfidence: .65,
      });
      self.postMessage({ type: "ready" });
    } else if (type === "frame" && detector) {
      try {
        const result = detector.detectForVideo(image, timestamp);
        self.postMessage({ type: "result", landmarks: result.landmarks[0] || null, hands: result.landmarks, timestamp });
      } finally { image.close(); }
    }
  } catch {
    image?.close();
    self.postMessage({ type: "error", code: type === "init" ? "model_load_failed" : "tracking_failed" });
  }
};
