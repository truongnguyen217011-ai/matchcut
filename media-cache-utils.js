export function fileMetadataMatches(entry, info) {
  return Boolean(
    entry
    && Number.isFinite(Number(entry.duration))
    && Number(entry.duration) > 0
    && Number(entry.size) === Number(info?.size)
    && Math.abs(Number(entry.mtimeMs) - Number(info?.mtimeMs)) < 1,
  );
}
