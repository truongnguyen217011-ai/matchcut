import test from "node:test";
import assert from "node:assert/strict";
import { isValidCachedTranscript, transcriptCacheKey } from "../transcript-cache-utils.js";

test("khóa transcript đổi theo voice, ngôn ngữ và cấu hình model", () => {
  const base = transcriptCacheKey("voice-a", "en", "small-v1");
  assert.equal(base, transcriptCacheKey("voice-a", "en", "small-v1"));
  assert.notEqual(base, transcriptCacheKey("voice-b", "en", "small-v1"));
  assert.notEqual(base, transcriptCacheKey("voice-a", "es", "small-v1"));
  assert.notEqual(base, transcriptCacheKey("voice-a", "en", "medium-v1"));
});

test("chỉ nhận transcript có cue hợp lệ", () => {
  assert.equal(isValidCachedTranscript({ chunks:[{ text:"Hello", start:0, end:1.2 }] }), true);
  assert.equal(isValidCachedTranscript({ chunks:[] }), false);
  assert.equal(isValidCachedTranscript({ chunks:[{ text:"", start:0, end:1 }] }), false);
  assert.equal(isValidCachedTranscript({ chunks:[{ text:"Bad", start:2, end:1 }] }), false);
});
