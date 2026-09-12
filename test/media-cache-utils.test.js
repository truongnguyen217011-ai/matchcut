import test from "node:test";
import assert from "node:assert/strict";
import { fileMetadataMatches } from "../media-cache-utils.js";

test("cache thời lượng chỉ khớp khi size và mtime của nguồn không đổi", () => {
  const info = { size:1234, mtimeMs:5678.25 };
  assert.equal(fileMetadataMatches({ duration:9.5, ...info }, info), true);
  assert.equal(fileMetadataMatches({ duration:9.5, size:1235, mtimeMs:info.mtimeMs }, info), false);
  assert.equal(fileMetadataMatches({ duration:9.5, size:info.size, mtimeMs:info.mtimeMs + 2 }, info), false);
  assert.equal(fileMetadataMatches({ duration:0, ...info }, info), false);
});
