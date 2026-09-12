import crypto from "node:crypto";

export function overlayCacheKey(sourceHash, width, height) {
  return crypto.createHash("sha256").update(JSON.stringify({ version:1, sourceHash, width, height })).digest("hex");
}

export function findAlphaBounds(data, width, height, channels = 4) {
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + channels - 1] === 0) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left || bottom < top) return { left:0, top:0, width:1, height:1 };
  return { left, top, width:right - left + 1, height:bottom - top + 1 };
}
