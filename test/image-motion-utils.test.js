import test from "node:test";
import assert from "node:assert/strict";
import { buildImageMotionFilter } from "../image-motion-utils.js";

test("mỗi ảnh chỉ có một hướng zoom nhẹ và được oversample để chuyển động mịn", () => {
  const filters = Array.from({ length:4 }, (_, index) => buildImageMotionFilter({ index, strength:4, duration:5, width:1920, height:1080 }));
  assert.equal(new Set(filters).size, 2);
  assert.match(filters[0], /1\+0\.0400/);
  assert.match(filters[1], /1\.0400-0\.0400/);
  for (const filter of filters) {
    assert.match(filter, /^scale=3840:2160:flags=lanczos/);
    assert.match(filter, /x='\(iw-iw\/zoom\)\/2'/);
    assert.match(filter, /y='\(ih-ih\/zoom\)\/2'/);
  }
});
