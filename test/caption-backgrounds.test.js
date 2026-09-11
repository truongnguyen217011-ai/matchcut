import test from "node:test";
import assert from "node:assert/strict";
import { assColor, resolveCaptionBackground } from "../caption-backgrounds.js";
import { applyAssTextEffect, expandTypewriterScene } from "../ass-effects.js";

test("màu nền ASS giữ đúng màu và phần trăm độ đậm", () => {
  assert.equal(assColor("#112233", 50), "&H80332211");
  assert.equal(assColor("#ffffff", 0), "&HFFFFFFFF");
  assert.equal(assColor("#ffffff", 100), "&H00FFFFFF");
});

test("toàn bộ preset nền chữ trả về cấu hình ASS hợp lệ", () => {
  const styles = ["solid", "none", "soft-dark", "glass", "highlight", "white-card", "neon", "cinema", "shadow", "outline-card"];
  for (const captionBackgroundStyle of styles) {
    const result = resolveCaptionBackground({ captionBackgroundStyle, subtitleBg: 45, fontColor: "#ffffff", accentColor: "#2af0a8", captionBackgroundColor: "#6b294e", outlineSize: 2 });
    assert.equal(result.style, captionBackgroundStyle);
    assert.ok([1, 3].includes(result.borderStyle));
    assert.ok(result.opacity >= 0 && result.opacity <= 100);
  }
});

test("preset dạng thẻ luôn giữ padding hộp libass khác không", () => {
  for (const captionBackgroundStyle of ["highlight", "white-card"]) {
    const result = resolveCaptionBackground({ captionBackgroundStyle, outlineSize: 0 });
    assert.equal(result.borderStyle, 3);
    assert.ok(result.outlineSize >= 1);
  }
});

test("typewriter tạo frame tích lũy để chữ và nền lớn dần cùng nhau", () => {
  const frames = expandTypewriterScene({ start: 0, end: 3, text: "ABC" });
  assert.deepEqual(frames.map((frame) => frame.text), ["A", "AB", "ABC"]);
  assert.deepEqual(frames.map((frame) => [frame.start, frame.end]), [[0, 1], [1, 2], [2, 3]]);
  const result = applyAssTextEffect(frames[1].text, "{\\pos(960,900)}", frames[1], { textEffect: "typewriter" }, "&H0000FF00", "&H00FFFFFF", "{\\blur2}");
  assert.equal(result, "{\\pos(960,900)}{\\blur2}AB");
});

test("typewriter giữ xuống dòng ASS nhưng không tạo frame riêng cho mã xuống dòng", () => {
  const frames = expandTypewriterScene({ start: 0, end: 4, text: "AB\\NCD" });
  assert.deepEqual(frames.map((frame) => frame.text), ["A", "AB", "AB\\NC", "AB\\NCD"]);
  assert.equal(frames.at(-1).end, 4);
});
