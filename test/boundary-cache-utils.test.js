import assert from "node:assert/strict";
import test from "node:test";
import { boundaryCacheKey } from "../boundary-cache-utils.js";

const settings = { width:1920, height:1080, fast:true, encoder:"h264_nvenc:p2:cq23" };

test("boundary cache key is stable for identical inputs", () => {
  assert.equal(boundaryCacheKey("source-a", settings), boundaryCacheKey("source-a", { ...settings }));
});

test("boundary cache key changes with source or normalization settings", () => {
  const key = boundaryCacheKey("source-a", settings);
  assert.notEqual(key, boundaryCacheKey("source-b", settings));
  assert.notEqual(key, boundaryCacheKey("source-a", { ...settings, width:1280 }));
  assert.notEqual(key, boundaryCacheKey("source-a", { ...settings, fast:false }));
  assert.notEqual(key, boundaryCacheKey("source-a", { ...settings, encoder:"libx264:veryfast:crf22" }));
});
