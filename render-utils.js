export function compactVisualScenes(captionScenes, maximumScenes = 96) {
  if (captionScenes.length <= maximumScenes) return captionScenes.map((scene) => ({ ...scene }));
  const groupSize = Math.ceil(captionScenes.length / maximumScenes), visualScenes = [];
  for (let index = 0; index < captionScenes.length; index += groupSize) {
    const group = captionScenes.slice(index, index + groupSize), first = group[0], last = group.at(-1);
    visualScenes.push({ ...first, start: first.start, end: last.end, text: "" });
  }
  return visualScenes;
}

