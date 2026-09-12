import crypto from "node:crypto";

export const boundaryNormalizationVersion = 1;

export function boundaryCacheKey(sourceHash, { width, height, fast, encoder }) {
  const signature = JSON.stringify({
    version: boundaryNormalizationVersion,
    sourceHash,
    width,
    height,
    fps: 30,
    pixelFormat: "yuv420p",
    audio: "aac:192k:48000:stereo",
    fast: Boolean(fast),
    encoder,
  });
  return crypto.createHash("sha256").update(signature).digest("hex");
}
