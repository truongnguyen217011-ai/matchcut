const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

function tokenize(text, language = "auto") {
  const clean = String(text || "").replace(/\s+/gu, " ").trim();
  if (!clean) return { tokens: [], separator: " " };
  if (/\s/u.test(clean)) return { tokens: clean.split(/\s+/u), separator: " " };

  try {
    const locale = language === "auto" ? undefined : language;
    const tokens = [...new Intl.Segmenter(locale, { granularity: "word" }).segment(clean)]
      .map(({ segment }) => segment)
      .filter((segment) => segment.trim());
    return { tokens: tokens.length ? tokens : [...clean], separator: "" };
  } catch {
    return { tokens: [...clean], separator: "" };
  }
}

function joinTokens(tokens, separator) {
  return tokens.join(separator).replace(/\s+([,.;:!?%])/gu, "$1");
}

function wrapTokens(tokens, separator, maxLines, wordsPerCaption) {
  if (maxLines <= 1 || tokens.length <= 1) return joinTokens(tokens, separator);
  const targetPerLine = Math.max(1, Math.ceil(wordsPerCaption / maxLines));
  const lineCount = Math.min(maxLines, Math.ceil(tokens.length / targetPerLine));
  if (lineCount <= 1) return joinTokens(tokens, separator);

  const lines = [];
  let cursor = 0;
  for (let line = 0; line < lineCount; line++) {
    const remaining = tokens.length - cursor;
    const take = Math.ceil(remaining / (lineCount - line));
    lines.push(joinTokens(tokens.slice(cursor, cursor + take), separator));
    cursor += take;
  }
  return lines.join("\n");
}

export function buildSubtitleCues(scenes, settings = {}) {
  const wordsPerCaption = Math.round(clamp(settings.wordsPerCaption, 1, 20, 8));
  const maxLines = Math.round(clamp(settings.maxLines, 1, 4, 2));
  const language = settings.language || "auto";
  const cues = [];

  for (const scene of scenes || []) {
    const start = Math.max(0, Number(scene.start) || 0);
    const end = Math.max(start, Number(scene.end) || start);
    const { tokens, separator } = tokenize(scene.text, language);
    if (!tokens.length || end <= start) continue;

    let groups = [];
    for (let index = 0; index < tokens.length; index += wordsPerCaption) {
      groups.push(tokens.slice(index, index + wordsPerCaption));
    }

    // Tránh chớp phụ đề quá nhanh khi timestamp nguồn chứa một câu rất dài.
    const maxReadableGroups = Math.max(1, Math.floor((end - start) / 0.45));
    if (groups.length > maxReadableGroups) {
      const merged = [];
      for (let index = 0; index < maxReadableGroups; index++) {
        const from = Math.floor(index * tokens.length / maxReadableGroups);
        const to = Math.floor((index + 1) * tokens.length / maxReadableGroups);
        merged.push(tokens.slice(from, to));
      }
      groups = merged;
    }

    let cursor = start;
    groups.forEach((group, index) => {
      const isLast = index === groups.length - 1;
      const cueEnd = isLast ? end : start + (end - start) * ((index + 1) / groups.length);
      cues.push({
        ...scene,
        start: cursor,
        end: cueEnd,
        text: wrapTokens(group, separator, maxLines, wordsPerCaption),
      });
      cursor = cueEnd;
    });
  }
  return cues;
}

