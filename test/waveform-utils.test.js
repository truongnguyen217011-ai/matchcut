import test from "node:test";
import assert from "node:assert/strict";
import { buildWaveformSourceFilters } from "../waveform-utils.js";

test("sóng cầu vồng dùng p2p, tăng biên độ và mask bảy màu", () => {
  const filters = buildWaveformSourceFilters({ source: "1:a", name: "wave", width: 1248, height: 170, style: "rainbow", thickness: 4, opacity: 0.8 });
  assert.match(filters.join(";"), /mode=p2p/);
  assert.match(filters.join(";"), /scale=sqrt/);
  assert.match(filters.join(";"), /nb_colors=7/);
  assert.equal((filters[0].match(/dilation/g) || []).length, 3);
  assert.match(filters.at(-1), /aa=0\.80/);
});

test("sóng một màu vẫn dùng bộ mask nét dày", () => {
  const filters = buildWaveformSourceFilters({ source: "voice", name: "voicewave", width: 600, height: 100, style: "solid", color: "FFD700", thickness: 2 });
  assert.match(filters[1], /color=c=0xFFD700/);
  assert.doesNotMatch(filters.join(";"), /gradients=/);
});
