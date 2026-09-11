function parseClock(value) {
  const match = String(value).trim().match(/^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match) return NaN;
  const milliseconds = Number(match[4].padEnd(3, "0").slice(0, 3));
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + milliseconds / 1000;
}

export function parseSrt(content) {
  const normalized = String(content ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new Error("File SRT trống.");
  const chunks = [];
  for (const block of normalized.split(/\n{2,}/)) {
    const lines = block.split("\n").map((line) => line.trim());
    const timelineIndex = lines.findIndex((line) => line.includes("-->"));
    if (timelineIndex < 0) continue;
    const timeline = lines[timelineIndex].match(/(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})/);
    if (!timeline) continue;
    const start = parseClock(timeline[1]), end = parseClock(timeline[2]);
    const text = lines.slice(timelineIndex + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) continue;
    chunks.push({ start, end, text });
  }
  chunks.sort((a, b) => a.start - b.start);
  if (!chunks.length) throw new Error("SRT không có cue timestamp hợp lệ.");
  return chunks;
}

