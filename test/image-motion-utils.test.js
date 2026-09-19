import test from "node:test";
import assert from "node:assert/strict";
import { buildImageMotionFilter } from "../image-motion-utils.js";

test("keyframe chỉ luân phiên zoom nhẹ vào và zoom nhẹ ra từ tâm pixel chẵn", () => {
  const filters = Array.from({ length:4 }, (_, index) => buildImageMotionFilter({ index, strength:4, duration:5, width:1920, height:1080 }));
  assert.equal(new Set(filters).size, 2);
  assert.match(filters[0], /1\+0\.0400/);
  assert.match(filters[1], /1\.0400-0\.0400/);
  for (const filter of filters) {
    assert.match(filter, /x='floor\(\(iw-iw\/zoom\)\/4\)\*2'/);
    assert.match(filter, /y='floor\(\(ih-ih\/zoom\)\/4\)\*2'/);
  }
});
