const clamp = (value, minimum, maximum, fallback) => Math.min(maximum, Math.max(minimum, Number(value) || fallback));

export function buildWaveformSourceFilters({ source, name, width, height, rate = 15, color = "ffffff", opacity = 1, style = "solid", thickness = 2 }) {
  const safeColor = String(color || "ffffff").replace("#", "").slice(0, 6);
  const safeOpacity = clamp(opacity, 0, 1, 1).toFixed(2);
  const dilation = ",dilation".repeat(Math.max(0, Math.round(clamp(thickness, 1, 8, 2)) - 1));
  const wave = `[${source}]showwaves=s=${width}x${height}:mode=p2p:colors=white:rate=${rate}:scale=sqrt:draw=full,format=gray${dilation}[${name}mask]`;
  if (style === "rainbow") {
    const gradient = `gradients=s=${width}x${height}:r=${rate}:c0=ff3344:c1=ff9f1c:c2=ffe600:c3=35e86f:c4=20d9f5:c5=315cff:c6=c43cff:nb_colors=7:x0=0:y0=0:x1=${width}:y1=0,format=rgba[${name}gradient]`;
    return [wave, gradient, `[${name}gradient][${name}mask]alphamerge=shortest=1,colorchannelmixer=aa=${safeOpacity}[${name}]`];
  }
  const solid = `color=c=0x${safeColor}:s=${width}x${height}:r=${rate},format=rgba[${name}color]`;
  return [wave, solid, `[${name}color][${name}mask]alphamerge=shortest=1,colorchannelmixer=aa=${safeOpacity}[${name}]`];
}
