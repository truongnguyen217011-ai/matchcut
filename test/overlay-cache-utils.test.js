import assert from "node:assert/strict";
import test from "node:test";
import { findAlphaBounds, overlayCacheKey } from "../overlay-cache-utils.js";

test("alpha bounds giữ mọi pixel nhìn thấy và bỏ viền trong suốt", () => {
  const rgba = Buffer.alloc(4 * 4 * 4);
  rgba[(1 * 4 + 2) * 4 + 3] = 1;
  rgba[(3 * 4 + 3) * 4 + 3] = 255;
  assert.deepEqual(findAlphaBounds(rgba, 4, 4), { left:2, top:1, width:2, height:3 });
});

test("overlay cache đổi khóa theo nội dung và kích thước", () => {
  const key = overlayCacheKey("hash-a", 1920, 1080);
  assert.equal(key, overlayCacheKey("hash-a", 1920, 1080));
  assert.notEqual(key, overlayCacheKey("hash-b", 1920, 1080));
  assert.notEqual(key, overlayCacheKey("hash-a", 1080, 1920));
});
