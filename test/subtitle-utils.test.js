import test from "node:test";
import assert from "node:assert/strict";
import { buildSubtitleCues } from "../subtitle-utils.js";

test("chia câu dài theo số từ/cụm và phân bổ timestamp liên tục", () => {
  const cues = buildSubtitleCues([
    { start: 10, end: 18, text: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen" },
  ], { wordsPerCaption: 8, maxLines: 2, language: "en" });
  assert.equal(cues.length, 2);
  assert.deepEqual(cues.map(({ start, end }) => [start, end]), [[10, 14], [14, 18]]);
  assert.equal(cues[0].text, "one two three four\nfive six seven eight");
  assert.equal(cues[1].text, "nine ten eleven twelve\nthirteen fourteen fifteen sixteen");
});

test("không vượt quá số dòng đã chọn", () => {
  const [cue] = buildSubtitleCues([
    { start: 0, end: 4, text: "một hai ba bốn năm sáu bảy tám" },
  ], { wordsPerCaption: 8, maxLines: 1, language: "vi" });
  assert.equal(cue.text.includes("\n"), false);
});

test("chia được ngôn ngữ không dùng khoảng trắng", () => {
  const cues = buildSubtitleCues([
    { start: 0, end: 6, text: "これは字幕の表示を確認する文章です" },
  ], { wordsPerCaption: 3, maxLines: 2, language: "ja" });
  assert.ok(cues.length >= 2);
  assert.equal(cues.at(-1).end, 6);
  assert.ok(cues.every((cue) => cue.text.split("\n").length <= 2));
});

test("bỏ cảnh rỗng và không tạo cue có thời lượng âm", () => {
  const cues = buildSubtitleCues([
    { start: 2, end: 1, text: "không hợp lệ" },
    { start: 2, end: 3, text: "" },
  ], {});
  assert.deepEqual(cues, []);
});
