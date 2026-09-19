import test from "node:test";
import assert from "node:assert/strict";
import { buildImageMotionFilter } from "../image-motion-utils.js";

test("keyframe chỉ luân phiên zoom vào và zoom ra từ tâm", () => {
  const filters = Array.from({ length:4 }, (_, index) => buildImageMotionFilter({ index, strength:8, duration:5, width:1920, height:1080 }));
  assert.equal(new Set(filters).size, 2);
  assert.match(filters[0], /1\+0\.0800/);
  assert.match(filters[1], /1\.0800-0\.0800/);
  for (const filter of filters) {
    assert.match(filter, /x='\(iw-iw\/zoom\)\/2'/);
    assert.match(filter, /y='\(ih-ih\/zoom\)\/2'/);
  }
});
