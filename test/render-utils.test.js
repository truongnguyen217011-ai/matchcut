import test from "node:test";
import assert from "node:assert/strict";
import { applyAssTextEffect } from "../ass-effects.js";
import { compactVisualScenes } from "../render-utils.js";

const settings = { textEffect: "typewriter", wordsPerCaption: 8, maxLines: 2, language: "en", subtitlePosition: "bottom" };

test("typewriter giữ nguyên mã xuống dòng ASS", () => {
  const result = applyAssTextEffect("The bird turns its\\Nsmall head toward you", "{\\pos(960,900)}", { start: 0, end: 2 }, settings, "&H0000FFFF");
  assert.match(result, /\\N/);
  assert.doesNotMatch(result, /\\\{\\k\d+\}N/);
});

test("timeline hình được rút gọn nhưng vẫn phủ toàn bộ timeline phụ đề", () => {
  const captions = Array.from({ length: 560 }, (_, index) => ({ start: index * 4, end: (index + 1) * 4, text: `cue ${index}`, mediaIndex: index }));
  const visuals = compactVisualScenes(captions, 96);
  assert.ok(visuals.length <= 96);
  assert.equal(visuals[0].start, 0);
  assert.equal(visuals.at(-1).end, captions.at(-1).end);
});
