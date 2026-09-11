import test from "node:test";
import assert from "node:assert/strict";
import { parseSrt } from "../srt-utils.js";

test("đọc SRT CRLF, dấu phẩy và phụ đề nhiều dòng", () => {
  const chunks = parseSrt("\uFEFF1\r\n00:00:01,250 --> 00:00:03,500\r\nXin chào\r\nthế giới\r\n\r\n2\r\n00:00:04.000 --> 00:00:05.100\r\nDòng hai");
  assert.deepEqual(chunks, [
    { start: 1.25, end: 3.5, text: "Xin chào thế giới" },
    { start: 4, end: 5.1, text: "Dòng hai" },
  ]);
});

test("bỏ cue lỗi nhưng chặn file không có timestamp hợp lệ", () => {
  assert.throws(() => parseSrt("1\nkhông có timestamp\nNội dung"), /không có cue/);
});

