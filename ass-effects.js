export function applyAssTextEffect(content, placement, scene, settings, accent, primary = "&H00FFFFFF", backgroundPrefix = "") {
  let text = `${placement}${backgroundPrefix}${content}`;
  if (settings.textEffect === "fade") text = `{\\fad(250,180)}${text}`;
  if (settings.textEffect === "pop") text = `{\\fscx70\\fscy70\\t(0,250,\\fscx100\\fscy100)}${text}`;
  if (settings.textEffect === "karaoke") {
    const words = content.split(/(\\N|\s+)/).filter(Boolean);
    const spokenWords = words.filter((word) => word !== "\\N" && !/^\s+$/.test(word));
    const centis = Math.max(1, Math.round(((Number(scene.end) - Number(scene.start)) * 100) / Math.max(1, spokenWords.length)));
    text = `${placement}${backgroundPrefix}{\\1c${accent}\\2c${primary}}${words.map((word) => word === "\\N" || /^\s+$/.test(word) ? word : `{\\k${centis}}${word}`).join("")}`;
  }
  if (settings.textEffect === "typewriter") {
    text = `${placement}${backgroundPrefix}${content}`;
  }
  if (settings.textEffect === "zoom-in") text = `{\\fscx35\\fscy35\\t(0,320,\\fscx100\\fscy100)}${text}`;
  if (settings.textEffect === "bounce") text = `{\\fscx55\\fscy55\\t(0,180,\\fscx120\\fscy120)\\t(180,360,\\fscx100\\fscy100)}${text}`;
  if (settings.textEffect === "glow") text = `{\\blur3\\bord5\\3c${accent}}${text}`;
  if (settings.textEffect === "shake") text = `{\\frz-2\\t(0,100,\\frz2)\\t(100,200,\\frz-2)\\t(200,300,\\frz0)}${text}`;
  return text;
}

export function expandTypewriterScene(scene) {
  const content = String(scene.text || ""), units = content.match(/\\N|[\s\S]/gu) || [];
  const timedUnits = units.filter((unit) => unit !== "\\N");
  if (!timedUnits.length) return [];
  const start = Number(scene.start) || 0, end = Math.max(start + 0.01, Number(scene.end) || start), step = (end - start) / timedUnits.length;
  const frames = []; let built = "", timedIndex = 0;
  for (const unit of units) {
    built += unit;
    if (unit === "\\N") continue;
    const frameStart = start + timedIndex * step; timedIndex += 1;
    if (/^\s$/u.test(unit)) continue;
    frames.push({ ...scene, start: frameStart, text: built });
  }
  for (let index = 0; index < frames.length; index += 1) frames[index].end = index + 1 < frames.length ? frames[index + 1].start : end;
  return frames;
}
