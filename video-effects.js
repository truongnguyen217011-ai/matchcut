export function buildVideoEffectFilter(effect = "none", intensity = 50) {
  const amount = Math.min(1, Math.max(0, Number(intensity) || 0) / 100);
  const value = (base, range) => (base + range * amount).toFixed(3);
  switch (effect) {
    case "cinematic": return `eq=contrast=${value(1, 0.18)}:saturation=${value(1, -0.12)}:brightness=${value(0, -0.035)},colorbalance=rs=${value(0, -0.025)}:bs=${value(0, 0.08)}`;
    case "warm": return `colorbalance=rs=${value(0, 0.12)}:gs=${value(0, 0.025)}:bs=${value(0, -0.09)}`;
    case "cool": return `colorbalance=rs=${value(0, -0.07)}:gs=${value(0, 0.02)}:bs=${value(0, 0.12)}`;
    case "vivid": return `eq=contrast=${value(1, 0.12)}:saturation=${value(1, 0.55)}`;
    case "vintage": return `eq=contrast=${value(1, -0.08)}:saturation=${value(1, -0.35)}:brightness=${value(0, 0.025)},colorbalance=rs=${value(0, 0.08)}:bs=${value(0, -0.06)}`;
    case "black-white": return `eq=contrast=${value(1, 0.18)}:saturation=${value(1, -1)}`;
    case "dramatic": return `eq=contrast=${value(1, 0.38)}:saturation=${value(1, -0.1)}:brightness=${value(0, -0.045)}`;
    case "soft": return `eq=contrast=${value(1, -0.12)}:saturation=${value(1, -0.08)}:brightness=${value(0, 0.035)}`;
    default: return "";
  }
}
