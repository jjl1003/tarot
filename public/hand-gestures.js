const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = value => Math.max(0, Math.min(1, value));
const DEFAULT_PROFILE = { closed: .10, opened: 1.25 };
export function inspectHand(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21 ||
      landmarks.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    return { pose: null, reason: "no_hand" };
  if (landmarks.some(p => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1))
    return { pose: null, reason: "out_of_frame" };
  const width = distance(landmarks[5], landmarks[17]);
  if (width < .035) return { pose: null, reason: "too_small" };
  const palm = [0, 5, 9, 13, 17].map(i => landmarks[i]);
  return { reason: "tracked", pose: {
    x: clamp((1 - landmarks[8].x - .12) / .76),
    y: clamp((landmarks[8].y - .10) / .8),
    palmX: 1 - palm.reduce((sum, p) => sum + p.x, 0) / 5,
    palmY: palm.reduce((sum, p) => sum + p.y, 0) / 5,
    ratio: distance(landmarks[4], landmarks[8]) / width,
    open: [8, 12, 16, 20].filter(i => distance(landmarks[i], landmarks[0]) > distance(landmarks[i - 2], landmarks[0]) + .025).length >= 3,
  } };
}
export function handPose(landmarks) { return inspectHand(landmarks).pose; }

export function createHandGestures({ requireCalibration = false } = {}) {
  let profile = requireCalibration ? null : { ...DEFAULT_PROFILE };
  let stage = "closed", holdSince = null, samples = [], closed = 0;
  let smooth = null, pinching = false, stableSince = null, lastTime = null;
  let armed = false, openness = null;
  const resetHold = () => { holdSince = null; samples = []; };
  return {
    reset() { smooth = null; pinching = false; stableSince = null; lastTime = null; armed = false; openness = null; resetHold(); },
    recalibrate() { profile = null; stage = "closed"; closed = 0; this.reset(); },
    update(landmarks, now) {
      const observation = inspectHand(landmarks), pose = observation.pose;
      if (!pose) {
        this.reset();
        return { visible: false, ready: !!profile, reason: observation.reason, mix: 0, pinchStart: false, pinchEnd: false, openness: 0, calibrationStep: profile ? "done" : stage, calibrationProgress: 0 };
      }
      if (lastTime === null || now - lastTime > 1000) { this.reset(); stableSince = now; }
      lastTime = now;
      smooth = smooth ? { x: smooth.x * .4 + pose.x * .6, y: smooth.y * .4 + pose.y * .6 } : { x: pose.x, y: pose.y };
      const base = { ...smooth, visible: true, reason: "tracked", mix: 0, pinchStart: false, pinchEnd: false, pinching: false };
      if (!profile) {
        const valid = stage === "closed" ? pose.ratio < .45 : pose.ratio > closed + .45;
        if (!valid || (samples.length && Math.abs(pose.ratio - samples[0]) > .24)) resetHold();
        if (valid) {
          holdSince ??= now;
          samples.push(pose.ratio);
        }
        const progress = holdSince === null ? 0 : Math.min(clamp((now - holdSince) / 600), samples.length / 4);
        if (progress === 1 && samples.length >= 4) {
          const median = [...samples].sort((a,b) => a-b)[Math.floor(samples.length / 2)];
          if (stage === "closed") { closed = median; stage = "opened"; }
          else { profile = { closed, opened: median }; this.reset(); stableSince = now; lastTime = now; }
          resetHold();
        }
        if (!profile) return { ...base, ready: false, openness: 0, calibrationStep: stage, calibrationProgress: stage === "opened" && holdSince === null ? 0 : progress, open: false };
      }
      const normalized = clamp((pose.ratio - profile.closed) / (profile.opened - profile.closed));
      openness = openness === null ? normalized : openness * .3 + normalized * .7;
      const was = pinching;
      // Keep confirmation responsive; smooth the visual meter independently.
      if (normalized > .72) { pinching = false; armed = true; }
      else if (normalized < .22 && armed && now - stableSince >= 250) pinching = true;
      const pinchStart = !was && pinching;
      return { ...base, ready: true, openness, calibrationStep: "done", calibrationProgress: 1,
        pinching, pinchStart, pinchEnd: was && !pinching, open: !pinching && openness > .05,
      };
    },
  };
}
