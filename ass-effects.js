export function applyAssTextEffect(content, placement, scene, settings, accent, primary = "&H00FFFFFF") {
  let text = `${placement}${content}`;
  if (settings.textEffect === "fade") text = `{\\fad(250,180)}${text}`;
  if (settings.textEffect === "pop") text = `{\\fscx70\\fscy70\\t(0,250,\\fscx100\\fscy100)}${text}`;
  if (settings.textEffect === "karaoke") {
    const words = content.split(/(\\N|\s+)/).filter(Boolean);
    const spokenWords = words.filter((word) => word !== "\\N" && !/^\s+$/.test(word));
    const centis = Math.max(1, Math.round(((Number(scene.end) - Number(scene.start)) * 100) / Math.max(1, spokenWords.length)));
    text = `${placement}{\\1c${accent}\\2c${primary}}${words.map((word) => word === "\\N" || /^\s+$/.test(word) ? word : `{\\k${centis}}${word}`).join("")}`;
  }
  if (settings.textEffect === "typewriter") {
    const tokens = content.split(/(\\N)/);
    const visibleCount = tokens.reduce((count, token) => count + (token === "\\N" ? 0 : [...token].length), 0);
    const centis = Math.max(1, Math.round(((Number(scene.end) - Number(scene.start)) * 100) / Math.max(1, visibleCount)));
    text = `${placement}{\\2a&HFF&}${tokens.map((token) => token === "\\N" ? token : [...token].map((character) => `{\\ko${centis}}${character}`).join("")).join("")}`;
  }
  if (settings.textEffect === "zoom-in") text = `{\\fscx35\\fscy35\\t(0,320,\\fscx100\\fscy100)}${text}`;
  if (settings.textEffect === "bounce") text = `{\\fscx55\\fscy55\\t(0,180,\\fscx120\\fscy120)\\t(180,360,\\fscx100\\fscy100)}${text}`;
  if (settings.textEffect === "glow") text = `{\\blur3\\bord5\\3c${accent}}${text}`;
  if (settings.textEffect === "shake") text = `{\\frz-2\\t(0,100,\\frz2)\\t(100,200,\\frz-2)\\t(200,300,\\frz0)}${text}`;
  return text;
}
