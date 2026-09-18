import test from "node:test";
import assert from "node:assert/strict";
import { buildVideoEffectFilter } from "../video-effects.js";

test("không thêm filter khi chọn không hiệu ứng", () => {
  assert.equal(buildVideoEffectFilter("none", 50), "");
});

test("mọi preset video tạo filter FFmpeg hợp lệ về cấu trúc", () => {
  for (const effect of ["cinematic", "warm", "cool", "vivid", "vintage", "black-white", "dramatic", "soft"])
    assert.match(buildVideoEffectFilter(effect, 60), /^(eq|colorbalance)=/);
});

test("cường độ được giới hạn từ 0 đến 100", () => {
  assert.equal(buildVideoEffectFilter("vivid", -10), buildVideoEffectFilter("vivid", 0));
  assert.equal(buildVideoEffectFilter("vivid", 200), buildVideoEffectFilter("vivid", 100));
});
