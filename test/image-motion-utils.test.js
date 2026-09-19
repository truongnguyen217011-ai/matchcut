import test from "node:test";
import assert from "node:assert/strict";
import { buildImageMotionFilter } from "../image-motion-utils.js";

test("keyframe luân phiên sáu chuyển động khác nhau", () => {
  const filters = Array.from({ length:6 }, (_, index) => buildImageMotionFilter({ index, strength:8, duration:5, width:1920, height:1080 }));
  assert.equal(new Set(filters).size, 6);
  assert.match(filters[0], /1\+0\.0800/);
  assert.match(filters[1], /1\.0800-0\.0800/);
  assert.match(filters[2], /\*min\(on\/150,1\)/);
  assert.match(filters[3], /1-min\(on\/150,1\)/);
});
