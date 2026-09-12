import crypto from "node:crypto";

export function transcriptCacheKey(audioHash, language, signature) {
  return crypto.createHash("sha256").update(JSON.stringify({ audioHash, language:language || "auto", signature })).digest("hex");
}

export function isValidCachedTranscript(value) {
  return Boolean(
    value
    && Array.isArray(value.chunks)
    && value.chunks.length
    && value.chunks.every((chunk) => String(chunk?.text || "").trim() && Number.isFinite(Number(chunk.start)) && Number.isFinite(Number(chunk.end)) && Number(chunk.end) > Number(chunk.start)),
  );
}
