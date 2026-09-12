export function compactVisualScenes(captionScenes, maximumScenes = 96) {
  if (captionScenes.length <= maximumScenes) return captionScenes.map((scene) => ({ ...scene }));
  const groupSize = Math.ceil(captionScenes.length / maximumScenes), visualScenes = [];
  for (let index = 0; index < captionScenes.length; index += groupSize) {
    const group = captionScenes.slice(index, index + groupSize), first = group[0], last = group.at(-1);
    visualScenes.push({ ...first, start: first.start, end: last.end, text: "" });
  }
  return visualScenes;
}

export function buildBoundaryConcatArgs(listPath, outputPath, audioEncoder = "aac") {
  return [
    "-y", "-hide_banner", "-loglevel", "warning",
    "-fflags", "+genpts", "-f", "concat", "-safe", "0", "-i", listPath,
    "-map", "0:v:0", "-map", "0:a:0",
    "-c:v", "copy",
    "-c:a", audioEncoder, "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-af", "aresample=async=1:first_pts=0",
    "-avoid_negative_ts", "make_zero", "-movflags", "+faststart",
    outputPath,
  ];
}

export function buildConcatManifest(segments, fps = 30) {
  const frameDuration = 1 / fps;
  return segments.map((segment, index) => {
    const escaped = segment.file.replaceAll("'", "'\\''");
    if (index === segments.length - 1) return `file '${escaped}'`;
    // AAC priming and rounded MP4 durations can place the next packet on the
    // previous packet's timestamp. A one-frame guard keeps both streams
    // monotonic while adding at most 33 ms per boundary at 30 fps.
    const guardedDuration = Math.ceil((Number(segment.duration) + frameDuration) * fps) / fps;
    return `file '${escaped}'\nduration ${guardedDuration.toFixed(9)}`;
  }).join("\n");
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0, firstError = null;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (!firstError && cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        firstError ||= error;
      }
    }
  }));
  if (firstError) throw firstError;
  return results;
}

export function buildDecodeVerificationSegments(duration, concurrency = 3, threshold = 180) {
  const total = Number(duration);
  if (!Number.isFinite(total) || total <= 0) throw new Error("Thời lượng kiểm tra không hợp lệ.");
  const count = total >= threshold ? Math.max(1, Math.floor(concurrency)) : 1;
  const slice = total / count;
  return Array.from({ length:count }, (_, index) => ({
    start: index * slice,
    // Let the final decoder run to physical EOF so rounding cannot leave an
    // unchecked tail. Earlier ranges end exactly where the next one starts.
    duration: index === count - 1 ? null : slice,
  }));
}
