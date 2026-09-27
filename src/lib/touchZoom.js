export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function pinchDistance(points) {
  const [a, b] = [...points.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
}
export function clampOffset(offset, scale, image, stage) {
  const x = Math.max(0, (image.width * scale - stage.width) / 2);
  const y = Math.max(0, (image.height * scale - stage.height) / 2);
  return { x: x ? clamp(offset.x, -x, x) : 0, y: y ? clamp(offset.y, -y, y) : 0 };
}
export function zoomAt(offset, current, next, anchor) {
  const ratio = next / current;
  return { x: anchor.x - ratio * (anchor.x - offset.x), y: anchor.y - ratio * (anchor.y - offset.y) };
}
