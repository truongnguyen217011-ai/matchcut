import test from "node:test";
import assert from "node:assert/strict";
import { applyAssTextEffect } from "../ass-effects.js";
import { compactVisualScenes } from "../render-utils.js";

const settings = { textEffect: "typewriter", wordsPerCaption: 8, maxLines: 2, language: "en", subtitlePosition: "bottom" };

test("typewriter giữ nguyên mã xuống dòng ASS", () => {
  const result = applyAssTextEffect("The bird turns its\\Nsmall head toward you", "{\\pos(960,900)}", { start: 0, end: 2 }, settings, "&H0000FFFF");
  assert.match(result, /\\N/);
  assert.doesNotMatch(result, /\\\{\\ko\d+\}N/);
  assert.match(result, /\{\\2a&HFF&\}/);
  assert.match(result, /\{\\ko\d+\}T/);
  assert.doesNotMatch(result, /\{\\k\d+\}/);
});

test("karaoke hiện sẵn câu và đổi từ màu chữ sang màu nhấn", () => {
  const result = applyAssTextEffect("ONE TWO\\NTHREE", "{\\pos(960,900)}", { start: 0, end: 3 }, { ...settings, textEffect: "karaoke" }, "&H0000FF00", "&H00FFFFFF");
  assert.match(result, /\{\\1c&H0000FF00\\2c&H00FFFFFF\}/);
  assert.match(result, /\{\\k\d+\}ONE/);
  assert.doesNotMatch(result, /\\2a&HFF&/);
});

test("các hiệu ứng chữ còn lại sinh đúng lệnh ASS riêng", () => {
  const expected = {
    none: /ONE TWO/,
    fade: /\\fad\(250,180\)/,
    pop: /\\fscx70/,
    "zoom-in": /\\fscx35/,
    bounce: /\\fscx55/,
    glow: /\\blur3/,
    shake: /\\frz-2/,
  };
  for (const [textEffect, pattern] of Object.entries(expected)) {
    const result = applyAssTextEffect("ONE TWO", "{\\pos(960,900)}", { start: 0, end: 2 }, { ...settings, textEffect }, "&H0000FF00", "&H00FFFFFF");
    assert.match(result, pattern, `${textEffect} không sinh đúng lệnh`);
  }
});

test("timeline hình được rút gọn nhưng vẫn phủ toàn bộ timeline phụ đề", () => {
  const captions = Array.from({ length: 560 }, (_, index) => ({ start: index * 4, end: (index + 1) * 4, text: `cue ${index}`, mediaIndex: index }));
  const visuals = compactVisualScenes(captions, 96);
  assert.ok(visuals.length <= 96);
  assert.equal(visuals[0].start, 0);
  assert.equal(visuals.at(-1).end, captions.at(-1).end);
});
