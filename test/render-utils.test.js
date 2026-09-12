import test from "node:test";
import assert from "node:assert/strict";
import { applyAssTextEffect } from "../ass-effects.js";
import { buildBoundaryConcatArgs, buildConcatManifest, buildDecodeVerificationSegments, compactVisualScenes, mapWithConcurrency } from "../render-utils.js";

const settings = { textEffect: "typewriter", wordsPerCaption: 8, maxLines: 2, language: "en", subtitlePosition: "bottom" };

test("typewriter giữ nguyên mã xuống dòng ASS", () => {
  const result = applyAssTextEffect("The bird turns its\\Nsmall head toward you", "{\\pos(960,900)}", { start: 0, end: 2 }, settings, "&H0000FFFF");
  assert.match(result, /\\N/);
  assert.doesNotMatch(result, /\\ko\d+/);
  assert.doesNotMatch(result, /\\2a&HFF&/);
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

test("nối biên giữ nguyên video và cho phép chọn AAC tăng tốc", () => {
  const args = buildBoundaryConcatArgs("segments.txt", "joined.mp4", "aac_mf");
  assert.deepEqual(args.slice(args.indexOf("-c:v"), args.indexOf("-c:v") + 2), ["-c:v", "copy"]);
  assert.deepEqual(args.slice(args.indexOf("-c:a"), args.indexOf("-c:a") + 2), ["-c:a", "aac_mf"]);
  assert.ok(args.includes("aresample=async=1:first_pts=0"));
});

test("manifest concat chèn khoảng bảo vệ một frame giữa các đoạn", () => {
  const manifest = buildConcatManifest([{ file:"one.mp4", duration:1.03 }, { file:"two.mp4", duration:2.07 }]);
  assert.equal(manifest, "file 'one.mp4'\nduration 1.066666667\nfile 'two.mp4'");
});

test("map giới hạn số tác vụ chạy song song và giữ đúng thứ tự kết quả", async () => {
  let active = 0, peak = 0;
  const result = await mapWithConcurrency([30, 5, 15, 1], 2, async (delay, index) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, delay));
    active -= 1;
    return index;
  });
  assert.deepEqual(result, [0, 1, 2, 3]);
  assert.equal(peak, 2);
});

test("map chờ tác vụ đang chạy dừng trước khi trả lỗi", async () => {
  const events = [];
  await assert.rejects(
    mapWithConcurrency(["fail", "active", "never"], 2, async (item) => {
      if (item === "fail") {
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push("failed");
        throw new Error("chunk failed");
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push(item);
    }),
    /chunk failed/,
  );
  assert.deepEqual(events, ["failed", "active"]);
});

test("kiểm tra video dài chia đoạn liên tục và để đoạn cuối chạy tới EOF", () => {
  const segments = buildDecodeVerificationSegments(2477.19, 3);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].start, 0);
  assert.equal(segments[0].start + segments[0].duration, segments[1].start);
  assert.equal(segments[1].start + segments[1].duration, segments[2].start);
  assert.equal(segments[2].duration, null);
  assert.equal(buildDecodeVerificationSegments(120, 3).length, 1);
});
