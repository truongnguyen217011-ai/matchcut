import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { buildBoundaryConcatArgs, buildConcatManifest } from "../render-utils.js";

function ffmpeg(args, options = {}) {
  const result = spawnSync(ffmpegPath, args, { encoding:"utf8", ...options });
  assert.equal(result.status, 0, result.stderr || `FFmpeg exited ${result.status}`);
  return result;
}

test("nối intro/content/outro không tạo DTS trùng và vẫn giải mã được", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "matchcut-dts-"));
  try {
    const durations = ["0.63", "0.77", "0.69"];
    const files = durations.map((duration, index) => {
      const output = path.join(dir, `part-${index}.mp4`);
      ffmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc2=s=320x180:r=30:d=${duration}`, "-f", "lavfi", "-i", `sine=frequency=${440 + index * 110}:sample_rate=48000:duration=${duration}`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", output]);
      return { file:output, duration:Number(duration) };
    });
    const list = path.join(dir, "segments.txt"), output = path.join(dir, "joined.mp4");
    writeFileSync(list, buildConcatManifest(files), "utf8");
    const joined = ffmpeg(buildBoundaryConcatArgs(list, output));
    assert.doesNotMatch(joined.stderr, /non-monotonic dts|invalid.*timestamp/i);
    const decoded = ffmpeg(["-v", "error", "-i", output, "-f", "null", "-"]);
    assert.equal(decoded.stderr, "");
  } finally {
    rmSync(dir, { recursive:true, force:true });
  }
});
