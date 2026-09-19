export function buildImageMotionFilter({ index = 0, strength = 8, duration = 1, width, height }) {
  const amount = Math.min(0.18, Math.max(0.03, Number(strength) / 100 || 0.08));
  const frames = Math.max(15, Math.ceil(Number(duration) * 30));
  const p = `min(on/${frames},1)`, mode = Math.abs(Number(index) || 0) % 2;
  const zoomIn = `1+${amount.toFixed(4)}*${p}`;
  const zoomOut = `${(1 + amount).toFixed(4)}-${amount.toFixed(4)}*${p}`;
  const motions = [
    { z:zoomIn, x:"(iw-iw/zoom)/2", y:"(ih-ih/zoom)/2" },
    { z:zoomOut, x:"(iw-iw/zoom)/2", y:"(ih-ih/zoom)/2" },
  ];
  const motion = motions[mode];
  return `zoompan=z='${motion.z}':x='${motion.x}':y='${motion.y}':d=1:s=${width}x${height}:fps=30`;
}
