// A sweep transfers small packets between two halves. Direction changes which
// half leads, so a gesture changes the saved deck rather than just its animation.
export function mixDeck(ids, direction, rng) {
  if (![1, -1].includes(direction) || ids.length < 2) throw Error("洗牌方向无效");
  const middle = Math.floor(ids.length / 2);
  const halves = [ids.slice(0, middle), ids.slice(middle)];
  let side = direction === 1 ? 0 : 1;
  const mixed = [];
  while (halves[0].length || halves[1].length) {
    const count = 1 + Math.floor(rng() * 5);
    mixed.push(...halves[side].splice(0, count));
    side = 1 - side;
  }
  return mixed;
}
export function angleDelta(previous, next) {
  return Math.atan2(Math.sin(next - previous), Math.cos(next - previous));
}
export function cutPoint(ratio, count = 78) {
  if (!Number.isFinite(ratio) || !Number.isInteger(count) || count < 2)
    throw Error("切牌位置无效");
  return Math.max(1, Math.min(count - 1, Math.round(ratio * count)));
}
export function createSweep() {
  let previous = null, travelled = 0;
  return {
    progress() { return Math.min(1, Math.abs(travelled) / (Math.PI / 4)); },
    move(x, y) {
      if (Math.hypot(x, y) < 20) { previous = null; return 0; }
      const angle = Math.atan2(y, x);
      if (previous === null) { previous = angle; return 0; }
      const delta = angleDelta(previous, angle);
      previous = angle;
      // Ignore jumps across the pile; only continuous circular motion counts.
      if (Math.abs(delta) > Math.PI / 2) { travelled = 0; return 0; }
      travelled += delta;
      if (Math.abs(travelled) < Math.PI / 4) return 0;
      const direction = Math.sign(travelled);
      travelled -= direction * Math.PI / 4;
      return direction;
    },
  };
}
