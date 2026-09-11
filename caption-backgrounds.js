const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));

export function assColor(hex, opacity = 100) {
  const value = String(hex || "#ffffff").replace("#", "").padEnd(6, "f").slice(0, 6).toUpperCase();
  const alpha = Math.round(255 * (1 - clamp(opacity, 0, 100) / 100)).toString(16).padStart(2, "0").toUpperCase();
  return `&H${alpha}${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2)}`;
}

function readableText(hex) {
  const value = String(hex || "#ffffff").replace("#", "").padEnd(6, "f").slice(0, 6).toUpperCase();
  const [red, green, blue] = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
  return red * 0.299 + green * 0.587 + blue * 0.114 > 150 ? "#0A0D0C" : "#FFFFFF";
}

export function resolveCaptionBackground(settings = {}) {
  const style = settings.captionBackgroundStyle || "solid";
  const opacity = clamp(settings.subtitleBg ?? 45, 0, 100);
  const font = settings.fontColor || "#ffffff", accent = settings.accentColor || "#2af0a8";
  const custom = settings.captionBackgroundColor || "#000000", outline = settings.secondaryOutline || "#000000";
  const baseOutline = clamp(settings.outlineSize ?? 2, 0, 12);
  const result = { style, primary: font, secondary: accent, outline, background: custom, opacity, borderStyle: 3, outlineSize: baseOutline, shadow: 1, prefix: "" };
  if (style === "none") Object.assign(result, { borderStyle: 1, opacity: 0, shadow: 0 });
  if (style === "soft-dark") Object.assign(result, { background: "#000000", borderStyle: 3, shadow: 2 });
  if (style === "glass") Object.assign(result, { background: "#17332E", borderStyle: 3, outline: "#8BE8C5", outlineSize: Math.max(1, baseOutline), shadow: 2 });
  // libass needs a non-zero Outline value for BorderStyle=3 to paint the
  // configured box colour. Zero silently falls back to a black rectangle.
  if (style === "highlight") Object.assign(result, { background: accent, primary: readableText(accent), secondary: readableText(accent), borderStyle: 3, outline: accent, outlineSize: Math.max(1, baseOutline), shadow: 1 });
  if (style === "white-card") Object.assign(result, { background: "#FFFFFF", primary: "#101312", secondary: accent, borderStyle: 3, outline: "#FFFFFF", outlineSize: Math.max(1, baseOutline), shadow: 2 });
  if (style === "neon") Object.assign(result, { background: "#000000", opacity: 0, borderStyle: 1, outline: accent, outlineSize: Math.max(4, baseOutline), shadow: 0, prefix: "{\\blur2}" });
  if (style === "cinema") Object.assign(result, { background: "#080A0F", primary: "#FFF1CF", secondary: accent, borderStyle: 3, outline: "#000000", outlineSize: Math.max(1, baseOutline), shadow: 2 });
  if (style === "shadow") Object.assign(result, { background: "#000000", opacity: Math.max(65, opacity), borderStyle: 1, outline: "#000000", outlineSize: Math.max(1, baseOutline), shadow: 5 });
  if (style === "outline-card") Object.assign(result, { background: "#000000", opacity: 0, borderStyle: 1, outline: accent, outlineSize: Math.max(5, baseOutline), shadow: 1 });
  return result;
}
