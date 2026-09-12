import express from "express";
import multer from "multer";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { createReadStream, openAsBlob } from "node:fs";
import {
  copyFile,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { pipeline } from "@huggingface/transformers";
import wavefile from "wavefile";
import sharp from "sharp";
import { buildSubtitleCues } from "./subtitle-utils.js";
import { parseSrt } from "./srt-utils.js";
import { applyAssTextEffect, expandTypewriterScene } from "./ass-effects.js";
import { assertExpectedFrameRate, buildBoundaryConcatArgs, buildConcatManifest, buildDecodeVerificationSegments, compactVisualScenes, mapWithConcurrency, parseMediaProbeDetails } from "./render-utils.js";
import { assColor, resolveCaptionBackground } from "./caption-backgrounds.js";
import { buildWaveformSourceFilters } from "./waveform-utils.js";
import { fileMetadataMatches } from "./media-cache-utils.js";
import { isValidCachedTranscript, transcriptCacheKey } from "./transcript-cache-utils.js";
import { boundaryCacheKey } from "./boundary-cache-utils.js";
import { findAlphaBounds, overlayCacheKey } from "./overlay-cache-utils.js";
const root = path.dirname(fileURLToPath(import.meta.url)),
  jobsRoot = path.join(root, "jobs"),
  persistentRoot = path.join(root, "data", "runtime-jobs"),
  profileAssetsRoot = path.join(root, "data", "profile-assets"),
  mediaDurationCachePath = path.join(root, "data", "media-duration-cache.json"),
  transcriptCacheRoot = path.join(root, "data", "transcript-cache"),
  boundaryCacheRoot = path.join(root, "data", "boundary-cache"),
  overlayCacheRoot = path.join(root, "data", "overlay-cache"),
  projectStatePath = path.join(root, "data", "project-state.json"),
  fontsRoot = path.join(root, "dist", "fonts"),
  fasterWhisperPython = path.join(root, ".venv-whisper", "Scripts", "python.exe"),
  fasterWhisperScript = path.join(root, "scripts", "faster_whisper_transcribe.py"),
  exportRoot = process.env.MATCHCUT_EXPORT_DIR || "C:\\MatchCut\\Exports",
  port = Number(process.env.MATCHCUT_PORT) || 4173;
await mkdir(jobsRoot, { recursive: true });
await mkdir(persistentRoot, { recursive: true });
await mkdir(profileAssetsRoot, { recursive: true });
await mkdir(transcriptCacheRoot, { recursive: true });
await mkdir(boundaryCacheRoot, { recursive: true });
await mkdir(overlayCacheRoot, { recursive: true });
await mkdir(exportRoot, { recursive: true });
const app = express(),
  upload = multer({
    dest: jobsRoot,
    limits: { fileSize: 1024 * 1024 * 1024, files: 108 },
  });
app.use(express.json({ limit: "2mb" }));
app.use(
  express.static(path.join(root, "dist"), {
    etag: false,
    lastModified: false,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    },
  }),
);
let whisperPromise;
const profileAssetFields = ["intro", "outro", "overlay", "watermark", "music"];
function safeProfileId(value) { const id = String(value || ""); if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Mã kênh không hợp lệ."); return id; }
async function readProfileAssetManifest(profileId) { try { return JSON.parse(await readFile(path.join(profileAssetsRoot, safeProfileId(profileId), "manifest.json"), "utf8")); } catch { return {}; } }
async function resolveProfileAssetFiles(profileId) {
  if (!profileId) return {};
  const id = safeProfileId(profileId), manifest = await readProfileAssetManifest(id), files = {};
  for (const field of profileAssetFields) {
    const item = manifest[field]; if (!item?.storedName) continue;
    const filePath = path.join(profileAssetsRoot, id, item.storedName);
    try { const info = await stat(filePath); files[field] = [{ path:filePath, originalname:item.originalName || item.storedName, size:info.size, profileAsset:true }]; } catch {}
  }
  return files;
}
async function applySavedProfileAssets(req) {
  const saved = await resolveProfileAssetFiles(req.body?.profileId);
  req.files ||= {};
  for (const field of profileAssetFields) if (!req.files[field]?.[0] && saved[field]?.[0]) req.files[field] = saved[field];
}
function getWhisper() {
  whisperPromise ??= pipeline(
    "automatic-speech-recognition",
    "onnx-community/whisper-tiny",
    { dtype: "q8" },
  );
  return whisperPromise;
}
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let error = "";
    child.stderr.on("data", (c) => {
      error += c.toString();
      if (error.length > 12000) error = error.slice(-12000);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(error || `FFmpeg exited ${code}`)),
    );
  });
}
function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let output = "", error = "";
    child.stdout.on("data", (chunk) => (output += chunk.toString()));
    child.stderr.on("data", (chunk) => (error += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error || `Folder picker exited ${code}`)));
  });
}
function probeMediaOutput(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-i", file], { windowsHide: true });
    let details = "";
    child.stderr.on("data", (chunk) => (details += chunk.toString()));
    child.on("error", reject);
    child.on("close", () => resolve(details));
  });
}
async function probeMediaDuration(file) {
  const match = (await probeMediaOutput(file)).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error("Không đọc được thời lượng media.");
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}
async function probeMediaDetails(file) { return parseMediaProbeDetails(await probeMediaOutput(file)); }
let persistentMediaDurations = {};
try {
  const saved = JSON.parse(await readFile(mediaDurationCachePath, "utf8"));
  if (saved?.version === 1 && saved.entries && typeof saved.entries === "object") persistentMediaDurations = saved.entries;
} catch {}
const mediaDurationCache = new Map();
let mediaDurationCacheDirty = false, mediaDurationSaveQueue = Promise.resolve();
function isPersistentMediaSource(file) {
  const relativeJobs = path.relative(jobsRoot, file), relativePersistent = path.relative(persistentRoot, file);
  return (relativeJobs.startsWith("..") || path.isAbsolute(relativeJobs)) && (relativePersistent.startsWith("..") || path.isAbsolute(relativePersistent));
}
async function savePersistentMediaDurations() {
  if (!mediaDurationCacheDirty) return;
  mediaDurationCacheDirty = false;
  const snapshot = JSON.stringify({ version:1, entries:persistentMediaDurations }, null, 2), temp = `${mediaDurationCachePath}.${crypto.randomUUID()}.tmp`;
  mediaDurationSaveQueue = mediaDurationSaveQueue.catch(() => {}).then(async () => {
    await writeFile(temp, snapshot, "utf8");
    await rename(temp, mediaDurationCachePath);
  });
  await mediaDurationSaveQueue;
}
async function cachedMediaDuration(file) {
  const key = path.resolve(file);
  if (!mediaDurationCache.has(key)) mediaDurationCache.set(key, (async () => {
    const info = await stat(key), saved = persistentMediaDurations[key];
    if (isPersistentMediaSource(key) && fileMetadataMatches(saved, info)) return Number(saved.duration);
    const duration = await probeMediaDuration(key);
    if (isPersistentMediaSource(key)) {
      persistentMediaDurations[key] = { duration, size:info.size, mtimeMs:info.mtimeMs };
      mediaDurationCacheDirty = true;
    }
    return duration;
  })().catch((error) => { mediaDurationCache.delete(key); throw error; }));
  return mediaDurationCache.get(key);
}
async function hydrateSourceDurations(entries, concurrency = 6) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (cursor < entries.length) {
      const entry = entries[cursor++];
      entry.sourceDuration = await cachedMediaDuration(entry.source);
    }
  });
  await Promise.all(workers);
  try {
    await savePersistentMediaDurations();
  } catch (error) {
    mediaDurationCacheDirty = true;
    console.warn(`Không lưu được cache thời lượng tư liệu: ${error instanceof Error ? error.message : error}`);
  }
}
function probeHasAudio(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-i", file], { windowsHide: true });
    let details = "";
    child.stderr.on("data", (chunk) => (details += chunk.toString()));
    child.on("error", reject);
    child.on("close", () => resolve(/Stream #.*Audio:/i.test(details)));
  });
}
let nvencUsable, cudaPipelineUsable, mediaFoundationAacUsable;
async function hasNvenc() {
  if (nvencUsable !== undefined) return nvencUsable;
  try {
    // Ada/Ampere drivers reject very small NVENC frames; test at 256px.
    await run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1", "-frames:v", "1", "-c:v", "h264_nvenc", "-f", "null", "NUL"]);
    nvencUsable = true;
  } catch {
    nvencUsable = false;
  }
  return nvencUsable;
}
async function hasCudaPipeline() {
  if (cudaPipelineUsable !== undefined) return cudaPipelineUsable;
  try {
    await run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:d=0.1", "-vf", "format=nv12,hwupload_cuda,scale_cuda=256:144:interp_algo=lanczos,hwdownload,format=nv12", "-frames:v", "1", "-f", "null", "NUL"]);
    cudaPipelineUsable = true;
  } catch {
    cudaPipelineUsable = false;
  }
  return cudaPipelineUsable;
}
async function preferredAacEncoder() {
  if (mediaFoundationAacUsable === undefined) {
    try {
      await run(["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=0.1", "-c:a", "aac_mf", "-f", "null", "NUL"]);
      mediaFoundationAacUsable = true;
    } catch {
      mediaFoundationAacUsable = false;
    }
  }
  return mediaFoundationAacUsable ? "aac_mf" : "aac";
}
const isCudaPipelineError = (error) => /cuda|cuvid|nvdec|device setup failed|hardware frames|unsupported device|function not implemented/i.test(error instanceof Error ? error.message : String(error));
async function runVideoEncode(baseArgs, output, options = {}) {
  if (await hasNvenc()) {
    try {
      const preset = options.fast ? "p2" : "p4";
      await run([...baseArgs, "-c:v", "h264_nvenc", "-preset", preset, "-tune", "hq", "-rc", "vbr", "-cq", "23", "-b:v", "4M", "-maxrate", "8M", "-bufsize", "16M", output]);
      return "h264_nvenc";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (options.strictGpu && isCudaPipelineError(error)) throw error;
      if (!/nvenc|cuda|no capable devices|error while opening encoder/i.test(message)) throw error;
      console.warn(`NVENC fallback: ${message}`);
      nvencUsable = false;
    }
  }
  await run([...baseArgs, "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", output]);
  return "libx264-fallback";
}
async function normalizeBoundaryVideo(source, output, width, height, fast) {
  const hasAudio = await probeHasAudio(source);
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", source];
  if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  args.push(
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`,
    "-map", "0:v:0", "-map", hasAudio ? "0:a:0" : "1:a:0", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart",
  );
  await runVideoEncode(args, output, { fast });
}
const verifiedBoundaryCache = new Set();
async function verifyBoundaryVideo(file) {
  const info = await stat(file);
  if (!info.size) throw new Error("Cache intro/outro rỗng.");
  await run(["-v", "error", "-i", file, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "NUL"]);
  return cachedMediaDuration(file);
}
async function normalizedBoundary({ source, fallbackOutput, width, height, fast, encoder }) {
  let temporary;
  try {
    const sourceHash = await hashFile(source), key = boundaryCacheKey(sourceHash, { width, height, fast, encoder });
    const cached = path.join(boundaryCacheRoot, `${key}.mp4`);
    try {
      const duration = verifiedBoundaryCache.has(key) ? await cachedMediaDuration(cached) : await verifyBoundaryVideo(cached);
      verifiedBoundaryCache.add(key);
      return { file:cached, duration, cacheHit:true };
    } catch {
      verifiedBoundaryCache.delete(key);
      mediaDurationCache.delete(path.resolve(cached));
      await rm(cached, { force:true });
    }
    temporary = path.join(boundaryCacheRoot, `${key}.${crypto.randomUUID()}.tmp.mp4`);
    await normalizeBoundaryVideo(source, temporary, width, height, fast);
    const duration = await verifyBoundaryVideo(temporary);
    try { await rename(temporary, cached); }
    catch {
      await rm(temporary, { force:true });
      const existingDuration = await verifyBoundaryVideo(cached);
      verifiedBoundaryCache.add(key);
      return { file:cached, duration:existingDuration, cacheHit:true };
    }
    mediaDurationCache.delete(path.resolve(temporary));
    mediaDurationCache.set(path.resolve(cached), Promise.resolve(duration));
    verifiedBoundaryCache.add(key);
    return { file:cached, duration, cacheHit:false };
  } catch (error) {
    if (temporary) await rm(temporary, { force:true }).catch(() => {});
    console.warn(`Cache intro/outro không khả dụng, dùng file theo job: ${error instanceof Error ? error.message : error}`);
    await normalizeBoundaryVideo(source, fallbackOutput, width, height, fast);
    return { file:fallbackOutput, duration:await cachedMediaDuration(fallbackOutput), cacheHit:false };
  }
}
async function attachIntroOutro({ dir, content, files, width, height, fast, onProgress }) {
  const intro = files?.intro?.[0], outro = files?.outro?.[0];
  const contentSegments = (Array.isArray(content) ? content : [{ file:content }]).filter((segment) => segment?.file);
  if (!intro && !outro && contentSegments.length === 1) return contentSegments[0].file;
  await onProgress?.("Ghép Intro và Outro", 96);
  // Intro and outro are independent, short encodes. Normalize both together
  // while the long content chunks stay untouched, then restore timeline order.
  const nvenc = await hasNvenc(), boundaryConcurrency = nvenc ? 2 : 1;
  const encoder = nvenc ? `h264_nvenc:${fast ? "p2" : "p4"}:cq23` : "libx264:veryfast:crf22";
  const boundaryPlans = [
    intro && { source:intro.path, fallbackOutput:path.join(dir, "normalized-intro.mp4") },
    outro && { source:outro.path, fallbackOutput:path.join(dir, "normalized-outro.mp4") },
  ].filter(Boolean);
  const boundaries = await mapWithConcurrency(boundaryPlans, boundaryConcurrency, (plan) => normalizedBoundary({ ...plan, width, height, fast, encoder }));
  const cacheHits = boundaries.filter((item) => item.cacheHit).length;
  if (cacheHits) await onProgress?.(`Ghép Intro và Outro (cache ${cacheHits}/${boundaries.length})`, 96);
  const segments = [];
  if (intro) segments.push(boundaries.shift());
  for (const segment of contentSegments) segments.push({ file:segment.file, duration:segment.duration || await cachedMediaDuration(segment.file) });
  if (outro) segments.push(boundaries.shift());
  const list = path.join(dir, "intro-content-outro.txt"), output = path.join(dir, "matchcut-with-intro-outro.mp4");
  await writeFile(list, buildConcatManifest(segments), "utf8");
  // MP4/AAC priming can overlap audio DTS at file boundaries. Keep the long
  // H.264 video stream untouched, but rebuild the much cheaper audio timeline.
  await run(buildBoundaryConcatArgs(list, output, await preferredAacEncoder()));
  return output;
}
async function availableExportPath(originalName) {
  const base =
    path
      .parse(originalName || "MatchCut")
      .name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .replace(/[. ]+$/, "")
      .trim() || "MatchCut";
  let candidate = path.join(exportRoot, `${base}.mp4`),
    index = 2;
  while (true) {
    try {
      await stat(candidate);
      candidate = path.join(exportRoot, `${base}-${index++}.mp4`);
    } catch {
      return candidate;
    }
  }
}
async function verifyCompleteMedia(file) {
  const decode = ({ start = 0, duration = null }) => {
    const args = ["-v", "error", "-xerror"];
    if (start > 0) args.push("-ss", start.toFixed(6));
    if (duration !== null) args.push("-t", duration.toFixed(6));
    args.push("-i", file, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "NUL");
    return run(args);
  };
  const details = await probeMediaDetails(file);
  assertExpectedFrameRate(details.frameRate);
  const segments = buildDecodeVerificationSegments(details.duration, 3);
  if (segments.length === 1) {
    await decode(segments[0]);
    return "single";
  }
  try {
    await mapWithConcurrency(segments, segments.length, decode);
    return `parallel-${segments.length}`;
  } catch {
    // A decoder process can fail from temporary host pressure. Rechecking the
    // whole file distinguishes that from deterministic media corruption.
    await decode({ start:0, duration:null });
    return "single-fallback";
  }
}
async function publishVerifiedOutput(source, destination) {
  const temporary = `${destination}.${crypto.randomUUID()}.partial.mp4`;
  let mode = "hardlink";
  try {
    try {
      // Jobs and exports normally share C:, so a hard link publishes even a
      // multi-gigabyte MP4 without copying its bytes. Job cleanup only removes
      // the other directory entry.
      await link(source, temporary);
    } catch {
      mode = "copy";
      await copyFile(source, temporary);
    }
    const verificationMode = await verifyCompleteMedia(temporary);
    await rename(temporary, destination);
    return { publishMode:mode, verificationMode };
  } finally {
    await rm(temporary, { force:true });
  }
}
const assTime = (value) => {
  const n = Math.max(0, Number(value) || 0),
    hours = Math.floor(n / 3600),
    minutes = Math.floor((n % 3600) / 60),
    seconds = (n % 60).toFixed(2).padStart(5, "0");
  return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
};
const assEscape = (text) =>
  String(text || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replace(/\r?\n/g, "\\N");
function createAss(scenes, settings) {
  const positionPresets = { "top-left": [18,15], top: [50,15], "top-right": [82,15], "middle-left": [18,50], middle: [50,50], "middle-right": [82,50], "bottom-left": [18,85], bottom: [50,85], "bottom-right": [82,85] },
    preset = positionPresets[settings.subtitlePosition] || positionPresets.bottom,
    xPercent = Math.min(95, Math.max(5, Number(settings.subtitleX ?? preset[0]))),
    yPercent = Math.min(95, Math.max(5, Number(settings.subtitleY ?? preset[1]))),
    subtitleX = Math.round(1920 * xPercent / 100),
    subtitleY = Math.round(1080 * yPercent / 100),
    font = String(settings.fontFamily || "Arial").replaceAll(",", ""),
    sizePercent = Math.min(220, Math.max(40, Number(settings.fontSizePercent) || 100)),
    size = Math.round(56 * sizePercent / 100),
    background = resolveCaptionBackground(settings),
    primary = assColor(background.primary),
    accent = assColor(background.secondary),
    outline = background.borderStyle === 3 ? assColor(background.background, background.opacity) : assColor(background.outline),
    back = background.borderStyle === 3 ? assColor("#000000", background.shadow ? Math.min(70, Math.max(35, background.opacity)) : 0) : assColor(background.background, background.opacity),
    bold = settings.fontBold === false ? 0 : -1,
    italic = settings.fontItalic ? -1 : 0,
    spacing = Math.max(0, Number(settings.letterSpacing) || 0),
    outlineSize = background.outlineSize;
  const subtitleCues = buildSubtitleCues(scenes, settings);
  const renderedCues = settings.textEffect === "typewriter" ? subtitleCues.flatMap(expandTypewriterScene) : subtitleCues;
  const events = renderedCues
    .map((scene) => {
      const content = assEscape(scene.text), placement = settings.textEffect === "slide-up" ? `{\\move(${subtitleX},${subtitleY + 180},${subtitleX},${subtitleY},0,350)\\fad(120,100)}` : `{\\pos(${subtitleX},${subtitleY})}`;
      const text = applyAssTextEffect(content, placement, scene, settings, accent, primary, background.prefix);
      return `Dialogue: 0,${assTime(scene.start)},${assTime(scene.end)},Default,,0,0,0,,${text}`;
    })
    .join("\n");
  const end = assTime(Math.max(...scenes.map((scene) => Number(scene.end) || 0)));
  const title = settings.persistentTitle && settings.titleLine1 ? `\nDialogue: 1,0:00:00.00,${end},Title,,0,0,0,,${assEscape([settings.titleLine1, settings.titleLine2].filter(Boolean).join("\n"))}` : "";
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${font},${size},${primary},${accent},${outline},${back},${bold},${italic},0,0,100,100,${spacing},0,${background.borderStyle},${outlineSize},${background.shadow},5,90,90,20,1\nStyle: Title,${font},62,${accent},${primary},${outline},&H50000000,-1,0,0,0,100,100,1,0,3,3,2,9,60,60,60,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}${title}\n`;
}
const allowedLocalMedia = new Set();
const mediaExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"]);
const lastOverlaySelections = new Map();
async function findOverlayImages(folder) {
  const results = [], pending = [path.resolve(folder)];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && [".png", ".webp"].includes(path.extname(entry.name).toLowerCase())) results.push(fullPath);
    }
  }
  return results;
}
const overlayPreparationCache = new Map();
async function prepareOverlayImage(source, width, height) {
  let memoryKey;
  try {
    const info = await stat(source);
    memoryKey = `${path.resolve(source)}:${info.size}:${info.mtimeMs}:${width}x${height}`;
    if (!overlayPreparationCache.has(memoryKey)) overlayPreparationCache.set(memoryKey, (async () => {
      const key = overlayCacheKey(await hashFile(source), width, height);
      const cachedImage = path.join(overlayCacheRoot, `${key}.png`), cachedMeta = path.join(overlayCacheRoot, `${key}.json`);
      try {
        const meta = JSON.parse(await readFile(cachedMeta, "utf8")), cachedInfo = await stat(cachedImage), imageInfo = await sharp(cachedImage).metadata();
        const validBounds = [meta?.x, meta?.y, meta?.width, meta?.height].every(Number.isInteger) && meta.x >= 0 && meta.y >= 0 && meta.width > 0 && meta.height > 0;
        if (meta?.version === 1 && meta.key === key && validBounds && cachedInfo.size > 0 && imageInfo.width === meta.width && imageInfo.height === meta.height) return { file:cachedImage, x:meta.x, y:meta.y, preScaled:true };
      } catch {}
      const { data, info:rawInfo } = await sharp(source).resize(width, height, { fit:"fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject:true });
      const bounds = findAlphaBounds(data, rawInfo.width, rawInfo.height, rawInfo.channels);
      const cropped = await sharp(data, { raw:rawInfo }).extract(bounds).png().toBuffer();
      const temporaryImage = `${cachedImage}.${crypto.randomUUID()}.tmp`, temporaryMeta = `${cachedMeta}.${crypto.randomUUID()}.tmp`;
      try {
        await writeFile(temporaryImage, cropped);
        await rm(cachedImage, { force:true });
        await rename(temporaryImage, cachedImage);
        await writeFile(temporaryMeta, JSON.stringify({ version:1, key, x:bounds.left, y:bounds.top, width:bounds.width, height:bounds.height }), "utf8");
        await rm(cachedMeta, { force:true });
        await rename(temporaryMeta, cachedMeta);
      } finally {
        await rm(temporaryImage, { force:true });
        await rm(temporaryMeta, { force:true });
      }
      return { file:cachedImage, x:bounds.left, y:bounds.top, preScaled:true };
    })());
    return await overlayPreparationCache.get(memoryKey);
  } catch (error) {
    if (memoryKey) overlayPreparationCache.delete(memoryKey);
    console.warn(`Không chuẩn bị được overlay crop, dùng ảnh gốc: ${error instanceof Error ? error.message : error}`);
    return { file:source, x:0, y:0, preScaled:false };
  }
}
function sceneVideoFilter(scene, settings, width, height, duration, transition, gpuMode = false, preScaled = false) {
  const scaler = gpuMode && scene.mediaType !== "image"
    ? `scale_cuda=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:interp_algo=lanczos,hwdownload,format=nv12,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`
    : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  let vf = preScaled ? `trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS` : `trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,${scaler},setsar=1,fps=30`;
  const darkness = Math.min(90, Math.max(0, Number(settings.backgroundDarkness) || 0));
  if (darkness > 0) vf += `,eq=brightness=${(-darkness / 100).toFixed(2)}`;
  if (transition === "fade") vf += `,fade=t=in:st=0:d=${Math.min(0.45, duration / 3).toFixed(2)}`;
  if (transition === "cinematic-fade") vf += `,eq=contrast=1.08:saturation=0.92,fade=t=in:st=0:d=${Math.min(0.7, duration / 3).toFixed(2)}:color=black`;
  if (transition === "zoom-in" && scene.mediaType === "image") vf += `,zoompan=z='min(zoom+0.0008,1.08)':d=1:s=${width}x${height}:fps=30`;
  if (transition === "zoom-out" && scene.mediaType === "image") vf += `,zoompan=z='if(eq(on,1),1.08,max(zoom-0.0008,1.0))':d=1:s=${width}x${height}:fps=30`;
  if (transition === "cross-zoom" && scene.mediaType === "image") vf += `,zoompan=z='if(lt(on,14),1.32-0.02*on,1.04)':d=1:s=${width}x${height}:fps=30,fade=t=in:st=0:d=${Math.min(0.2, duration / 4).toFixed(2)}`;
  if (transition === "slide-left") vf += `,scale=${width + 80}:${height + 45},crop=${width}:${height}:x='80*(1-min(t/${duration.toFixed(3)},1))':y=22`;
  if (transition === "slide-right") vf += `,scale=${width + 80}:${height + 45},crop=${width}:${height}:x='80*min(t/${duration.toFixed(3)},1)':y=22`;
  if (transition === "pan-up") vf += `,scale=${width}:${height + 80},crop=${width}:${height}:x=0:y='80*(1-min(t/${duration.toFixed(3)},1))'`;
  if (transition === "pan-down") vf += `,scale=${width}:${height + 80},crop=${width}:${height}:x=0:y='80*min(t/${duration.toFixed(3)},1)'`;
  if (transition === "diagonal-up") vf += `,scale=${width + 80}:${height + 80},crop=${width}:${height}:x='80*(1-min(t/${duration.toFixed(3)},1))':y='80*(1-min(t/${duration.toFixed(3)},1))'`;
  if (transition === "diagonal-down") vf += `,scale=${width + 80}:${height + 80},crop=${width}:${height}:x='80*min(t/${duration.toFixed(3)},1)':y='80*min(t/${duration.toFixed(3)},1)'`;
  if (transition === "rotate-in") vf += `,rotate='0.10*(1-min(t/0.55,1))':ow=iw:oh=ih:fillcolor=black`;
  if (transition === "shake-cut") vf += `,scale=${width + 80}:${height + 50},crop=${width}:${height}:x='40+18*sin(35*t)*max(0,1-t/0.5)':y='25+12*cos(31*t)*max(0,1-t/0.5)'`;
  if (transition === "flash") vf += `,fade=t=in:st=0:d=${Math.min(0.18, duration / 4).toFixed(2)}:color=white`;
  return `${vf},setsar=1,format=yuv420p`;
}
async function renderSinglePass({ dir, files, voice, media, scenes, captionScenes, settings, width, height, overlayImagePath, overlayImageX = 0, overlayImageY = 0, overlayImagePreScaled = false, timeOffset = 0, outputName = "matchcut-output.mp4", gpuMode }) {
  if (gpuMode === undefined) gpuMode = await hasCudaPipeline();
  if (scenes.length > 120) throw new Error(`Timeline ${scenes.length} cảnh vượt ngưỡng single-pass an toàn 120 cảnh.`);
  const randomTransitions = settings.fastRender !== false ? ["none", "fade", "zoom-in", "zoom-out", "flash"] : ["fade", "cinematic-fade", "zoom-in", "zoom-out", "cross-zoom", "slide-left", "slide-right", "pan-up", "pan-down", "diagonal-up", "diagonal-down", "rotate-in", "shake-cut", "flash"];
  const sourceMap = new Map(), resolvedScenes = [];
  for (let index = 0; index < scenes.length; index++) {
    const scene = scenes[index];
    const source = scene.mediaPath && allowedLocalMedia.has(path.resolve(scene.mediaPath)) ? path.resolve(scene.mediaPath) : media[scene.mediaIndex]?.path;
    if (!source) throw new Error(`Không tìm thấy tư liệu cho cảnh ${index + 1}`);
    if (!sourceMap.has(source)) sourceMap.set(source, { source, type: scene.mediaType, uses: [] });
    const entry = sourceMap.get(source);
    entry.uses.push(index);
    resolvedScenes.push({ ...scene, source });
  }
  if ([...sourceMap.keys()].join("").length > 24000) throw new Error("Danh sách đường dẫn quá dài cho single-pass.");

  const inputArgs = ["-y", "-hide_banner", "-loglevel", "error"], filters = [];
  const totalDuration = Math.max(...scenes.map((scene) => Number(scene.end) || 0));
  await hydrateSourceDurations([...sourceMap.values()].filter((entry) => entry.type !== "image"));
  let inputIndex = 0;
  for (const entry of sourceMap.values()) {
    entry.inputIndex = inputIndex++;
    entry.requiredDuration = Math.max(...entry.uses.map((sceneIndex) => Math.max(0.5, Number(resolvedScenes[sceneIndex].end) - Number(resolvedScenes[sceneIndex].start))));
    if (gpuMode && entry.type !== "image") inputArgs.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda");
    if (entry.type === "image") inputArgs.push("-loop", "1", "-t", entry.requiredDuration.toFixed(3), "-i", entry.source);
    else {
      const sourceDuration = Math.max(0.05, entry.sourceDuration);
      const loopCount = Math.max(0, Math.ceil(entry.requiredDuration / sourceDuration) - 1);
      inputArgs.push("-stream_loop", String(loopCount), "-i", entry.source);
    }
    const baseLabel = `base${entry.inputIndex}`;
    const baseScale = gpuMode && entry.type !== "image"
      ? `scale_cuda=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2:interp_algo=lanczos,hwdownload,format=nv12,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`
      : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
    filters.push(`[${entry.inputIndex}:v]${baseScale},setsar=1,fps=30,setpts=N/(30*TB),format=yuv420p[${baseLabel}]`);
    if (entry.uses.length > 1) {
      entry.labels = entry.uses.map((_, branch) => `src${entry.inputIndex}_${branch}`);
      filters.push(`[${baseLabel}]split=${entry.uses.length}${entry.labels.map((label) => `[${label}]`).join("")}`);
    } else entry.labels = [baseLabel];
  }
  const voiceIndex = inputIndex++;
  if (timeOffset > 0) inputArgs.push("-ss", timeOffset.toFixed(3));
  inputArgs.push("-t", totalDuration.toFixed(3), "-i", voice.path);
  const music = files?.music?.[0];
  let musicIndex = null;
  if (music) { musicIndex = inputIndex++; inputArgs.push("-stream_loop", "-1"); if (timeOffset > 0) inputArgs.push("-ss", timeOffset.toFixed(3)); inputArgs.push("-t", totalDuration.toFixed(3), "-i", music.path); }
  let overlayIndex = null;
  if (overlayImagePath) { overlayIndex = inputIndex++; inputArgs.push("-loop", "1", "-framerate", "1", "-i", overlayImagePath); }
  const watermark = files?.watermark?.[0];
  let watermarkIndex = null;
  if (watermark) { watermarkIndex = inputIndex++; inputArgs.push("-loop", "1", "-framerate", settings.watermarkRotate ? "30" : "1", "-i", watermark.path); }

  let previousTransition = "";
  const sourceBranches = new Map([...sourceMap.entries()].map(([key, entry]) => [key, 0]));
  resolvedScenes.forEach((scene, index) => {
    const entry = sourceMap.get(scene.source), branch = sourceBranches.get(scene.source);
    sourceBranches.set(scene.source, branch + 1);
    let transition = settings.transition || "none";
    if (transition === "random") {
      const choices = randomTransitions.filter((item) => item !== previousTransition);
      transition = choices[Math.floor(Math.random() * choices.length)];
    }
    previousTransition = transition;
    const duration = Math.max(0.5, Number(scene.end) - Number(scene.start));
    filters.push(`[${entry.labels[branch]}]${sceneVideoFilter(scene, settings, width, height, duration, transition, gpuMode, true)}[scene${index}]`);
  });
  filters.push(`${resolvedScenes.map((_, index) => `[scene${index}]`).join("")}concat=n=${resolvedScenes.length}:v=1:a=0[timeline]`);

  const voiceCopies = settings.voiceWaveformEnabled ? 2 : 1;
  if (voiceCopies > 1) filters.push(`[${voiceIndex}:a]asplit=2[voiceMixSource][voiceWaveSource]`);
  const voiceSource = voiceCopies > 1 ? "voiceMixSource" : `${voiceIndex}:a`;
  const voiceGain = Math.max(0, Number(settings.voiceVolume ?? 100)) / 100;
  const delayMs = Math.max(0, Number(settings.voiceDelay || 0)) * 1000;
  filters.push(`[${voiceSource}]volume=${voiceGain.toFixed(3)},adelay=${Math.round(delayMs)}|${Math.round(delayMs)}[voiceAudio]`);
  if (musicIndex !== null) {
    const musicCopies = settings.waveformEnabled ? 2 : 1;
    if (musicCopies > 1) filters.push(`[${musicIndex}:a]asplit=2[musicMixSource][musicWaveSource]`);
    const musicSource = musicCopies > 1 ? "musicMixSource" : `${musicIndex}:a`;
    filters.push(`[${musicSource}]volume=${(Math.max(0, Number(settings.musicVolume || 6)) / 100).toFixed(3)},atrim=duration=${totalDuration.toFixed(3)}[musicAudio]`);
    filters.push("[voiceAudio][musicAudio]amix=inputs=2:duration=first:dropout_transition=2[aout]");
  } else filters.push("[voiceAudio]anull[aout]");

  let current = "timeline", layer = 0;
  if (overlayIndex !== null) {
    const opacity = Math.min(100, Math.max(5, Number(settings.overlayImageOpacity ?? 70))) / 100;
    const scale = overlayImagePreScaled ? "" : `scale=${width}:${height},`;
    filters.push(`[${overlayIndex}:v]${scale}format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[overlayimg]`);
    filters.push(`[${current}][overlayimg]overlay=${overlayImageX}:${overlayImageY}:eof_action=repeat:shortest=0[layer${++layer}]`); current = `layer${layer}`;
  }
  const waveWidth = Math.max(120, Math.round(width * Math.min(100, Math.max(20, Number(settings.waveformWidth) || 70)) / 100));
  const waveHeight = Math.max(40, Math.min(300, Number(settings.waveformHeight) || 120));
  const addWave = (source, color, opacityPercent, xPercent, yPercent, name) => {
    if (!source) return;
    const safeColor = String(color || "#ffffff").replace("#", "");
    const opacity = Math.min(100, Math.max(0, Number(opacityPercent ?? 100))) / 100;
    const centerX = width * Math.min(95, Math.max(5, Number(xPercent) || 50)) / 100, centerY = height * Math.min(95, Math.max(5, Number(yPercent) || 80)) / 100;
    const x = Math.max(0, Math.min(width - waveWidth, Math.round(centerX - waveWidth / 2))), y = Math.max(0, Math.min(height - waveHeight, Math.round(centerY - waveHeight / 2)));
    filters.push(...buildWaveformSourceFilters({ source, name, width: waveWidth, height: waveHeight, rate: settings.fastRender !== false ? 15 : 30, color: safeColor, opacity, style: settings.waveformStyle || "solid", thickness: settings.waveformThickness || 2 }));
    filters.push(`[${current}][${name}]overlay=${x}:${y}:shortest=1[layer${++layer}]`); current = `layer${layer}`;
  };
  if (settings.waveformEnabled && musicIndex !== null) addWave("musicWaveSource", settings.waveformColor, settings.waveformOpacity, settings.waveformX, settings.waveformY, "musicwave");
  if (settings.voiceWaveformEnabled) addWave("voiceWaveSource", settings.voiceWaveformColor, settings.voiceWaveformOpacity, settings.voiceWaveformX, settings.voiceWaveformY, "voicewave");
  if (watermarkIndex !== null) {
    const opacity = Math.min(100, Math.max(0, Number(settings.watermarkOpacity ?? 70))) / 100, speed = Math.min(45, Math.max(1, Number(settings.watermarkRotationSpeed) || 12));
    const rotation = settings.watermarkRotate ? `,rotate='${(speed * Math.PI / 180).toFixed(6)}*t':ow=rotw(iw):oh=roth(ih):c=none` : "";
    filters.push(`[${watermarkIndex}:v]scale=${Math.round(width * 0.12)}:-1,format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}${rotation}[wm]`);
    filters.push(`[${current}][wm]overlay=W-w-35:35:eof_action=repeat:shortest=0[layer${++layer}]`); current = `layer${layer}`;
  }
  if (settings.subtitleEnabled !== false) {
    const artifactStem = path.parse(outputName).name.replace(/[^a-z0-9_-]/gi, "-");
    const assPath = path.join(dir, `${artifactStem}-captions.ass`);
    await writeFile(assPath, createAss(captionScenes || scenes, settings), "utf8");
    const escaped = assPath.replaceAll("\\", "/").replace(":", "\\:").replaceAll("'", "\\'");
    const escapedFonts = fontsRoot.replaceAll("\\", "/").replace(":", "\\:").replaceAll("'", "\\'");
    filters.push(`[${current}]subtitles=filename='${escaped}':fontsdir='${escapedFonts}',setsar=1[vout]`);
  } else filters.push(`[${current}]setsar=1[vout]`);

  const artifactStem = path.parse(outputName).name.replace(/[^a-z0-9_-]/gi, "-");
  const graphPath = path.join(dir, `${artifactStem}-single-pass.ffgraph`);
  await writeFile(graphPath, filters.join(";\n"), "utf8");
  const output = path.join(dir, outputName);
  try {
    const encoder = await runVideoEncode([...inputArgs, "-filter_complex_script", graphPath, "-map", "[vout]", "-map", "[aout]", "-t", totalDuration.toFixed(3), "-frames:v", String(Math.max(1, Math.ceil(totalDuration * 30))), "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart"], output, { fast: settings.fastRender !== false, strictGpu: gpuMode });
    return { output, encoder, acceleration: gpuMode ? "nvdec-scale_cuda-nvenc" : "cpu-filters-nvenc" };
  } catch (error) {
    if (!gpuMode || !isCudaPipelineError(error)) throw error;
    console.warn(`CUDA pipeline fallback: ${error instanceof Error ? error.message : error}`);
    await rm(output, { force: true });
    return renderSinglePass({ dir, files, voice, media, scenes, captionScenes, settings, width, height, overlayImagePath, overlayImageX, overlayImageY, overlayImagePreScaled, timeOffset, outputName, gpuMode: false });
  }
}
async function renderChunkedSinglePass(options) {
  const { scenes, captionScenes = scenes, onProgress } = options, chunkSize = 24, chunkCount = Math.ceil(scenes.length / chunkSize);
  const gpuMode = options.gpuMode ?? await hasCudaPipeline();
  // RTX 3060 has enough headroom for three isolated 24-scene graphs. A fourth
  // adds memory pressure, while three lets the common four-chunk job finish
  // its first three long chunks in one wave.
  const concurrency = gpuMode && options.settings.fastRender !== false ? 3 : 1;
  const plans = Array.from({ length: chunkCount }, (_, chunkIndex) => ({ chunkIndex, group: scenes.slice(chunkIndex * chunkSize, (chunkIndex + 1) * chunkSize) }));
  let finished = 0;
  const outputs = await mapWithConcurrency(plans, concurrency, async ({ chunkIndex, group }) => {
    const chunkNumber = chunkIndex + 1;
    await onProgress?.(`Render khối ${chunkNumber}/${chunkCount}${concurrency > 1 ? ` (song song ${concurrency} khối)` : ""}`, 60 + Math.floor((finished / chunkCount) * 30));
    const offset = Number(group[0].start) || 0, end = Number(group.at(-1).end), duration = end - offset;
    const localScenes = group.map((scene) => ({ ...scene, start: Number(scene.start) - offset, end: Number(scene.end) - offset }));
    const localCaptions = captionScenes
      .filter((scene) => Number(scene.end) > offset && Number(scene.start) < end)
      .map((scene) => ({ ...scene, start: Math.max(0, Number(scene.start) - offset), end: Math.min(duration, Number(scene.end) - offset) }));
    const result = await renderSinglePass({ ...options, gpuMode, scenes: localScenes, captionScenes: localCaptions, timeOffset: offset, outputName: `fast-chunk-${String(chunkIndex).padStart(3, "0")}.mp4` });
    finished += 1;
    await onProgress?.(`Đã render ${finished}/${chunkCount} khối`, 60 + Math.floor((finished / chunkCount) * 30));
    return { file:result.output, duration, encoder:result.encoder, acceleration:result.acceleration };
  });
  await onProgress?.("Chuẩn bị ghép các khối MP4", 92);
  return { output:outputs[0]?.file, segments:outputs, encoder:outputs.at(-1)?.encoder || "unknown", acceleration:outputs.at(-1)?.acceleration || "unknown", pipeline: `chunked-single-pass-${outputs.length}-parallel-${concurrency}` };
}
app.post("/api/pick-folder", async (_req, res) => {
  try {
    const script = "Add-Type -AssemblyName System.Windows.Forms; $owner=New-Object System.Windows.Forms.Form; $owner.TopMost=$true; $owner.ShowInTaskbar=$false; $owner.Opacity=0; $owner.Width=1; $owner.Height=1; $owner.StartPosition='CenterScreen'; $owner.Show(); $owner.Activate(); $dialog=New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description='Chọn thư mục tư liệu cho MatchCut'; $dialog.ShowNewFolderButton=$false; $result=$dialog.ShowDialog($owner); $owner.Close(); if($result -eq [System.Windows.Forms.DialogResult]::OK){[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Write-Output $dialog.SelectedPath}";
    const folder = await runCapture("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-STA", "-Command", script]);
    res.json({ ok: true, folder: folder || null });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Không mở được cửa sổ chọn folder." });
  }
});
app.post("/api/media-folders", async (req, res) => {
  try {
    const folders = Array.isArray(req.body?.folders) ? req.body.folders : [], files = [], acceptedFolders = [];
    for (const rawFolder of folders) {
      const folder = path.resolve(String(rawFolder || "").trim());
      const info = await stat(folder);
      if (!info.isDirectory()) throw new Error(`${folder} không phải thư mục.`);
      acceptedFolders.push(folder);
      const pending = [folder];
      while (pending.length) {
        const current = pending.pop();
        for (const entry of await readdir(current, { withFileTypes: true })) {
          const fullPath = path.join(current, entry.name), extension = path.extname(entry.name).toLowerCase();
          if (entry.isDirectory()) pending.push(fullPath);
          else if (entry.isFile() && mediaExtensions.has(extension)) {
            allowedLocalMedia.add(fullPath);
            files.push({ name: entry.name, localPath: fullPath, type: [".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"].includes(extension) ? "video" : "image" });
          }
        }
      }
    }
    res.json({ ok: true, folders: acceptedFolders, files });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Không thể quét thư mục." });
  }
});
app.post(
  "/api/render",
  upload.fields([
    { name: "voice", maxCount: 1 },
    { name: "media", maxCount: 100 },
    { name: "intro", maxCount: 1 },
    { name: "outro", maxCount: 1 },
    { name: "overlay", maxCount: 1 },
    { name: "watermark", maxCount: 1 },
    { name: "music", maxCount: 1 },
  ]),
  async (req, res) => {
    const dir = path.join(jobsRoot, crypto.randomUUID());
    let responseHeartbeat = null;
    const sendRenderResult = (payload) => {
      if (responseHeartbeat) {
        clearInterval(responseHeartbeat);
        responseHeartbeat = null;
      }
      if (res.headersSent) res.end(JSON.stringify(payload));
      else res.json(payload);
    };
    await mkdir(dir, { recursive: true });
    try {
      await applySavedProfileAssets(req);
      const voice = req.files?.voice?.[0],
        media = req.files?.media || [],
        scenes = JSON.parse(req.body.scenes || "[]"),
        captionScenes = JSON.parse(req.body.captionScenes || req.body.scenes || "[]"),
        settings = JSON.parse(req.body.settings || "{}");
      if (!voice || !scenes.length || (!media.length && !scenes.some((scene) => scene.mediaPath)))
        return res
          .status(400)
          .json({ error: "Thiếu voice, tư liệu hoặc timeline." });
      // Node/Undici times out if a long internal render sends no response headers
      // for five minutes. Persistent jobs acknowledge headers immediately while
      // keeping the JSON body open until FFmpeg really finishes.
      if (req.body.persistentJob === "1") {
        res.status(200);
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.flushHeaders();
        responseHeartbeat = setInterval(() => res.write(" "), 15000);
      }
      const segments = [];
      const [width, height] = settings.aspectRatio === "9:16" ? [1080, 1920] : settings.aspectRatio === "1:1" ? [1080, 1080] : [1920, 1080];
      let overlayImagePath = null, overlayImageOriginalPath = null, overlayImageX = 0, overlayImageY = 0, overlayImagePreScaled = false, renderEncoder = "copy";
      if (settings.overlayImageEnabled && settings.overlayImageFolder) {
        const overlayFiles = await findOverlayImages(settings.overlayImageFolder);
        if (!overlayFiles.length) throw new Error("Folder ảnh lớp phủ không có file PNG hoặc WebP.");
        const folderKey = path.resolve(settings.overlayImageFolder), previous = lastOverlaySelections.get(folderKey), choices = overlayFiles.length > 1 ? overlayFiles.filter((file) => file !== previous) : overlayFiles;
        overlayImageOriginalPath = choices[Math.floor(Math.random() * choices.length)];
        lastOverlaySelections.set(folderKey, overlayImageOriginalPath);
        const preparedOverlay = await prepareOverlayImage(overlayImageOriginalPath, width, height);
        overlayImagePath = preparedOverlay.file;
        overlayImageX = preparedOverlay.x;
        overlayImageY = preparedOverlay.y;
        overlayImagePreScaled = preparedOverlay.preScaled;
      }
      if (settings.singlePassRender !== false) {
        try {
          const progressJob = req.body.jobId ? persistentJobs.get(req.body.jobId) : null;
          const onProgress = progressJob ? async (stage, progress) => {
            progressJob.stage = stage; progressJob.progress = progress; progressJob.updatedAt = new Date().toISOString();
            await savePersistentJob(progressJob);
          } : null;
          const renderOptions = { dir, files: req.files, voice, media, scenes, captionScenes, settings, width, height, overlayImagePath, overlayImageX, overlayImageY, overlayImagePreScaled, onProgress };
          const singlePass = settings.fastRender !== false && scenes.length > 24 ? await renderChunkedSinglePass(renderOptions) : await renderSinglePass(renderOptions);
          singlePass.output = await attachIntroOutro({ dir, content: singlePass.segments || singlePass.output, files: req.files, width, height, fast: settings.fastRender !== false, onProgress });
          const savedPath = await availableExportPath(voice.originalname);
          await onProgress?.("Kiểm tra MP4 hoàn chỉnh", 98);
          const { publishMode, verificationMode } = await publishVerifiedOutput(singlePass.output, savedPath);
          return sendRenderResult({
            ok: true,
            savedPath,
            fileName: path.basename(savedPath),
            overlayImage: overlayImageOriginalPath ? path.basename(overlayImageOriginalPath) : null,
            renderEncoder: singlePass.encoder,
            acceleration: singlePass.acceleration,
            renderPipeline: singlePass.pipeline || "single-pass",
            publishMode,
            verificationMode,
            settings,
          });
        } catch (singlePassError) {
          console.warn(`Single-pass fallback: ${singlePassError instanceof Error ? singlePassError.message : singlePassError}`);
        }
      }
      const randomTransitions = ["fade", "cinematic-fade", "zoom-in", "zoom-out", "cross-zoom", "slide-left", "slide-right", "pan-up", "pan-down", "diagonal-up", "diagonal-down", "rotate-in", "shake-cut", "flash"];
      let previousTransition = "";
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i],
          source = scene.mediaPath && allowedLocalMedia.has(path.resolve(scene.mediaPath)) ? path.resolve(scene.mediaPath) : media[scene.mediaIndex]?.path;
        if (!source)
          throw new Error(`Không tìm thấy tư liệu cho cảnh ${i + 1}`);
        const out = path.join(dir, `scene-${String(i).padStart(4, "0")}.mp4`),
          duration = Math.max(0.5, Number(scene.end) - Number(scene.start)),
          common = ["-y", "-hide_banner", "-loglevel", "error"];
        let transition = settings.transition || "none";
        if (transition === "random") {
          const choices = randomTransitions.filter((item) => item !== previousTransition);
          transition = choices[Math.floor(Math.random() * choices.length)];
        }
        previousTransition = transition;
        let vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
        const backgroundDarkness = Math.min(90, Math.max(0, Number(settings.backgroundDarkness) || 0));
        if (backgroundDarkness > 0) vf += `,eq=brightness=${(-backgroundDarkness / 100).toFixed(2)}`;
        if (transition === "fade")
          vf += `,fade=t=in:st=0:d=${Math.min(0.45, duration / 3).toFixed(2)}`;
        if (transition === "cinematic-fade")
          vf += `,eq=contrast=1.08:saturation=0.92,fade=t=in:st=0:d=${Math.min(0.7, duration / 3).toFixed(2)}:color=black`;
        if (transition === "zoom-in" && scene.mediaType === "image")
          vf += `,zoompan=z='min(zoom+0.0008,1.08)':d=1:s=${width}x${height}:fps=30`;
        if (transition === "zoom-out" && scene.mediaType === "image")
          vf += `,zoompan=z='if(eq(on,1),1.08,max(zoom-0.0008,1.0))':d=1:s=${width}x${height}:fps=30`;
        if (transition === "cross-zoom" && scene.mediaType === "image")
          vf += `,zoompan=z='if(lt(on,14),1.32-0.02*on,1.04)':d=1:s=${width}x${height}:fps=30,fade=t=in:st=0:d=${Math.min(0.2, duration / 4).toFixed(2)}`;
        if (transition === "slide-left")
          vf += `,scale=${width + 80}:${height + 45},crop=${width}:${height}:x='80*(1-min(t/${duration.toFixed(3)},1))':y=22`;
        if (transition === "slide-right")
          vf += `,scale=${width + 80}:${height + 45},crop=${width}:${height}:x='80*min(t/${duration.toFixed(3)},1)':y=22`;
        if (transition === "pan-up")
          vf += `,scale=${width}:${height + 80},crop=${width}:${height}:x=0:y='80*(1-min(t/${duration.toFixed(3)},1))'`;
        if (transition === "pan-down")
          vf += `,scale=${width}:${height + 80},crop=${width}:${height}:x=0:y='80*min(t/${duration.toFixed(3)},1)'`;
        if (transition === "diagonal-up")
          vf += `,scale=${width + 80}:${height + 80},crop=${width}:${height}:x='80*(1-min(t/${duration.toFixed(3)},1))':y='80*(1-min(t/${duration.toFixed(3)},1))'`;
        if (transition === "diagonal-down")
          vf += `,scale=${width + 80}:${height + 80},crop=${width}:${height}:x='80*min(t/${duration.toFixed(3)},1)':y='80*min(t/${duration.toFixed(3)},1)'`;
        if (transition === "rotate-in")
          vf += `,rotate='0.10*(1-min(t/0.55,1))':ow=iw:oh=ih:fillcolor=black`;
        if (transition === "shake-cut")
          vf += `,scale=${width + 80}:${height + 50},crop=${width}:${height}:x='40+18*sin(35*t)*max(0,1-t/0.5)':y='25+12*cos(31*t)*max(0,1-t/0.5)'`;
        if (transition === "flash")
          vf += `,fade=t=in:st=0:d=${Math.min(0.18, duration / 4).toFixed(2)}:color=white`;
        vf += ",format=yuv420p";
        if (scene.mediaType === "image")
          renderEncoder = await runVideoEncode([
            ...common,
            "-loop",
            "1",
            "-i",
            source,
            "-t",
            String(duration),
            "-vf",
            vf,
            "-an",
          ], out, { fast: settings.fastRender !== false });
        else
          renderEncoder = await runVideoEncode([
            ...common,
            "-stream_loop",
            "-1",
            "-i",
            source,
            "-t",
            String(duration),
            "-vf",
            vf,
            "-an",
          ], out, { fast: settings.fastRender !== false });
        segments.push(out);
      }
      const concatFile = path.join(dir, "concat.txt");
      await writeFile(
        concatFile,
        segments.map((f) => `file '${f.replaceAll("'", "'\\''")}'`).join("\n"),
      );
      const joined = path.join(dir, "joined.mp4");
      await run([
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        concatFile,
        "-c",
        "copy",
        joined,
      ]);
      let audioSource = voice.path;
      const music = req.files?.music?.[0], voiceGain = Math.max(0, Number(settings.voiceVolume ?? 100)) / 100, delayMs = Math.max(0, Number(settings.voiceDelay || 0)) * 1000;
      if (music || voiceGain !== 1 || delayMs) {
        audioSource = path.join(dir, "mixed-audio.m4a");
        const audioArgs = ["-y", "-hide_banner", "-loglevel", "error", "-i", voice.path];
        if (music) audioArgs.push("-stream_loop", "-1", "-i", music.path);
        const voiceFilter = `[0:a]volume=${voiceGain.toFixed(3)},adelay=${Math.round(delayMs)}|${Math.round(delayMs)}[voice]`;
        const filter = music ? `${voiceFilter};[1:a]volume=${(Math.max(0, Number(settings.musicVolume || 6)) / 100).toFixed(3)}[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=2[aout]` : `${voiceFilter};[voice]anull[aout]`;
        await run([...audioArgs, "-filter_complex", filter, "-map", "[aout]", "-t", String(Math.max(...scenes.map((scene) => Number(scene.end) || 0))), "-c:a", "aac", "-b:a", "192k", audioSource]);
      }
      const output = path.join(dir, "matchcut-output.mp4"), watermark = req.files?.watermark?.[0],
        inputArgs = [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          joined,
          "-i",
          audioSource,
        ];
      let nextVideoInput = 2, overlayInputIndex = null, watermarkInputIndex = null, voiceWaveformInputIndex = null, musicWaveformInputIndex = null;
      if (overlayImagePath) { overlayInputIndex = nextVideoInput++; inputArgs.push("-loop", "1", "-framerate", "1", "-i", overlayImagePath); }
      if (watermark) { watermarkInputIndex = nextVideoInput++; inputArgs.push("-loop", "1", "-framerate", settings.watermarkRotate ? "30" : "1", "-i", watermark.path); }
      if (settings.voiceWaveformEnabled) { voiceWaveformInputIndex = nextVideoInput++; inputArgs.push("-i", voice.path); }
      if (settings.waveformEnabled && music) { musicWaveformInputIndex = nextVideoInput++; inputArgs.push("-stream_loop", "-1", "-i", music.path); }
      let subtitleFilter = "";
      if (settings.subtitleEnabled !== false) {
        const assPath = path.join(dir, "captions.ass");
        await writeFile(assPath, createAss(captionScenes, settings), "utf8");
        const escaped = assPath
          .replaceAll("\\", "/")
          .replace(":", "\\:")
          .replaceAll("'", "\\'");
        const escapedFonts = fontsRoot.replaceAll("\\", "/").replace(":", "\\:").replaceAll("'", "\\'");
        subtitleFilter = `subtitles=filename='${escaped}':fontsdir='${escapedFonts}'`;
      }
      const encodeArgs = [...inputArgs];
      const hasVisualLayers = overlayInputIndex !== null || watermarkInputIndex !== null || voiceWaveformInputIndex !== null || musicWaveformInputIndex !== null;
      if (hasVisualLayers) {
        const filters = ["[0:v]null[vbase]"]; let current = "vbase", layerNumber = 0;
        if (overlayInputIndex !== null) {
          const opacity = Math.min(100, Math.max(5, Number(settings.overlayImageOpacity ?? 70))) / 100;
          const scale = overlayImagePreScaled ? "" : `scale=${width}:${height},`;
          filters.push(`[${overlayInputIndex}:v]${scale}format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[overlayimg]`);
          filters.push(`[${current}][overlayimg]overlay=${overlayImageX}:${overlayImageY}:eof_action=repeat:shortest=0[v${++layerNumber}]`); current = `v${layerNumber}`;
        }
        const waveWidth = Math.max(120, Math.round(width * Math.min(100, Math.max(20, Number(settings.waveformWidth) || 70)) / 100)),
          waveHeight = Math.max(40, Math.min(300, Number(settings.waveformHeight) || 120));
        const addWaveform = (inputIndex, color, opacityPercent, xPercent, yPercent, name) => {
          if (inputIndex === null) return;
          const safeColor = String(color || "#ffffff").replace("#", ""), opacity = Math.min(100, Math.max(0, Number(opacityPercent ?? 100))) / 100, centerX = width * Math.min(95, Math.max(5, Number(xPercent) || 50)) / 100, centerY = height * Math.min(95, Math.max(5, Number(yPercent) || 80)) / 100, waveX = Math.max(0, Math.min(width - waveWidth, Math.round(centerX - waveWidth / 2))), waveY = Math.max(0, Math.min(height - waveHeight, Math.round(centerY - waveHeight / 2)));
          filters.push(...buildWaveformSourceFilters({ source: `${inputIndex}:a`, name, width: waveWidth, height: waveHeight, rate: settings.fastRender !== false ? 15 : 30, color: safeColor, opacity, style: settings.waveformStyle || "solid", thickness: settings.waveformThickness || 2 }));
          filters.push(`[${current}][${name}]overlay=${waveX}:${waveY}:shortest=1[v${++layerNumber}]`); current = `v${layerNumber}`;
        };
        addWaveform(musicWaveformInputIndex, settings.waveformColor, settings.waveformOpacity, settings.waveformX, settings.waveformY, "musicwave");
        addWaveform(voiceWaveformInputIndex, settings.voiceWaveformColor, settings.voiceWaveformOpacity, settings.voiceWaveformX, settings.voiceWaveformY, "voicewave");
        if (watermarkInputIndex !== null) {
          const opacity = Math.min(100, Math.max(0, Number(settings.watermarkOpacity ?? 70))) / 100,
            speed = Math.min(45, Math.max(1, Number(settings.watermarkRotationSpeed) || 12)),
            rotation = settings.watermarkRotate ? `,rotate='${(speed * Math.PI / 180).toFixed(6)}*t':ow=rotw(iw):oh=roth(ih):c=none` : "";
          filters.push(`[${watermarkInputIndex}:v]scale=${Math.round(width * 0.12)}:-1,format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}${rotation}[wm]`);
          filters.push(`[${current}][wm]overlay=W-w-35:35:eof_action=repeat:shortest=0[v${++layerNumber}]`); current = `v${layerNumber}`;
        }
        if (subtitleFilter) filters.push(`[${current}]${subtitleFilter},setsar=1[vout]`);
        else filters.push(`[${current}]setsar=1[vout]`);
        encodeArgs.push("-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "1:a:0");
      } else {
        if (subtitleFilter) encodeArgs.push("-vf", subtitleFilter);
        encodeArgs.push("-map", "0:v:0", "-map", "1:a:0");
      }
      encodeArgs.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart");
      if (subtitleFilter || hasVisualLayers || req.files?.intro?.[0] || req.files?.outro?.[0]) renderEncoder = await runVideoEncode(encodeArgs, output, { fast: settings.fastRender !== false });
      else {
        await run([...encodeArgs, "-c:v", "copy", output]);
        renderEncoder = "copy";
      }
      const finalOutput = await attachIntroOutro({ dir, content: output, files: req.files, width, height, fast: settings.fastRender !== false });
      const savedPath = await availableExportPath(voice.originalname);
      const { publishMode, verificationMode } = await publishVerifiedOutput(finalOutput, savedPath);
      sendRenderResult({
        ok: true,
        savedPath,
        fileName: path.basename(savedPath),
        overlayImage: overlayImageOriginalPath ? path.basename(overlayImageOriginalPath) : null,
        renderEncoder,
        renderPipeline: "legacy-two-pass-fallback",
        publishMode,
        verificationMode,
        settings,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message.split("\n").slice(-4).join(" ") : "Không thể render video.";
      if (res.headersSent) res.end(JSON.stringify({ ok: false, error: errorMessage }));
      else res.status(500).json({ error: errorMessage });
    } finally {
      if (responseHeartbeat) clearInterval(responseHeartbeat);
      setTimeout(() => void rm(dir, { recursive: true, force: true }), 30000);
    }
  },
);
let transcriptionQueue = Promise.resolve();
function enqueueTranscription(task) {
  const result = transcriptionQueue.then(task, task);
  transcriptionQueue = result.catch(() => undefined);
  return result;
}
async function transcribeWithFasterWhisper(audioPath, language) {
  await stat(fasterWhisperPython);
  const output = await runCapture(fasterWhisperPython, [
    fasterWhisperScript,
    audioPath,
    "--language",
    language || "auto",
    "--device",
    process.env.MATCHCUT_WHISPER_DEVICE || "auto",
  ]);
  const result = JSON.parse(output);
  if (!result.chunks?.length) throw new Error("Faster-Whisper không tạo được timestamp.");
  return result;
}
async function transcribeWithLegacyWhisper(audioPath, language, chunkDir, segmentSeconds) {
  await mkdir(chunkDir, { recursive: true });
  await run(["-y", "-hide_banner", "-loglevel", "error", "-i", audioPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "segment", "-segment_time", String(segmentSeconds), "-reset_timestamps", "1", path.join(chunkDir, "part-%04d.wav")]);
  const chunkFiles = (await readdir(chunkDir)).filter((name) => name.endsWith(".wav")).sort();
  if (!chunkFiles.length) throw new Error("FFmpeg không tách được voice thành các đoạn xử lý.");
  const transcriber = await getWhisper(), allChunks = [], texts = [];
  for (let index = 0; index < chunkFiles.length; index++) {
    const wav = new wavefile.WaveFile(await readFile(path.join(chunkDir, chunkFiles[index])));
    wav.toBitDepth("32f"); wav.toSampleRate(16000);
    let samples = wav.getSamples(); if (Array.isArray(samples)) samples = samples[0];
    const options = { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 };
    if (language && language !== "auto") options.language = language;
    const output = await transcriber(samples, options), offset = index * segmentSeconds;
    if (output.text?.trim()) texts.push(output.text.trim());
    for (const chunk of output.chunks || []) {
      const start = offset + Number(chunk.timestamp?.[0] || 0), end = offset + Number(chunk.timestamp?.[1] ?? chunk.timestamp?.[0] ?? 0);
      if (chunk.text?.trim() && end > start) allChunks.push({ text: chunk.text.trim(), start, end });
    }
  }
  return { engine: "whisper-js-fallback", device: "cpu", model: "tiny", language: language || "auto", text: texts.join(" "), chunks: allChunks, audioParts: chunkFiles.length };
}
app.post("/api/transcribe", upload.single("voice"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Chưa có file voice." });
  const chunkDir = `${req.file.path}-chunks`, segmentSeconds = 300;
  try {
    const result = await enqueueTranscription(async () => {
      const language = req.body.language || "auto";
      try {
        return await transcribeWithFasterWhisper(req.file.path, language);
      } catch (fasterError) {
        console.warn(`Faster-Whisper fallback: ${fasterError instanceof Error ? fasterError.message : fasterError}`);
        return transcribeWithLegacyWhisper(req.file.path, language, chunkDir, segmentSeconds);
      }
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Whisper không thể nhận dạng voice." });
  } finally {
    void rm(req.file.path, { force: true });
    void rm(chunkDir, { recursive: true, force: true });
  }
});

const persistentJobs = new Map(), persistentSaveQueues = new Map();
let persistentWorkerRunning = false;
const jobPublic = (job) => ({
  id: job.id, name: job.name, profileName: job.profileName, status: job.status,
  stage: job.stage, progress: job.progress, error: job.error, logs: job.logs,
  createdAt: job.createdAt, startedAt: job.startedAt || job.createdAt, updatedAt: job.updatedAt,
  completedAt: job.completedAt, failedAt: job.failedAt,
  output: job.output, transcriptCount: job.transcript?.chunks?.length || 0,
  language: job.transcript?.language || job.settings?.language || "auto",
});
function addJobLog(job, message) {
  job.logs ||= [];
  job.logs.push({ at: new Date().toISOString(), message });
  job.logs = job.logs.slice(-100);
  job.updatedAt = new Date().toISOString();
}
async function savePersistentJob(job) {
  const snapshot = JSON.stringify(job, null, 2), previous = persistentSaveQueues.get(job.id) || Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    const file = path.join(persistentRoot, job.id, "job.json"), temporary = `${file}.${crypto.randomUUID()}.tmp`;
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await writeFile(temporary, snapshot, "utf8");
      try { await rename(temporary, file); }
      catch { await rm(file, { force: true }); await rename(temporary, file); }
    } finally { await rm(temporary, { force: true }); }
  });
  persistentSaveQueues.set(job.id, operation);
  operation.finally(() => { if (persistentSaveQueues.get(job.id) === operation) persistentSaveQueues.delete(job.id); }).catch(() => undefined);
  return operation;
}
async function loadPersistentJobs() {
  for (const entry of await readdir(persistentRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const job = JSON.parse(await readFile(path.join(persistentRoot, entry.name, "job.json"), "utf8"));
      if (["queued", "transcribing", "rendering"].includes(job.status)) {
        job.status = "queued";
        addJobLog(job, `Backend khởi động lại — tự tiếp tục từ công đoạn ${job.transcript ? "render" : "timestamp"}.`);
        await savePersistentJob(job);
      }
      for (const asset of job.assets || []) {
        if (asset?.localPath) allowedLocalMedia.add(path.resolve(asset.localPath));
      }
      persistentJobs.set(job.id, job);
    } catch (error) { console.warn(`Không đọc được job ${entry.name}: ${error}`); }
  }
}
function chooseJobAssets(assets, count, mode) {
  const candidates = assets.map((_, index) => index), result = [], bag = [];
  if (!candidates.length) return result;
  if (mode === "sequential") return Array.from({ length: count }, (_, index) => candidates[index % candidates.length]);
  while (result.length < count) {
    if (mode === "random") result.push(candidates[Math.floor(Math.random() * candidates.length)]);
    else {
      if (!bag.length) {
        bag.push(...candidates);
        for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
        if (result.length && bag.length > 1 && bag[0] === result.at(-1)) [bag[0], bag[1]] = [bag[1], bag[0]];
      }
      result.push(bag.shift());
    }
  }
  return result;
}
async function appendJobFile(form, field, record) {
  if (!record?.path) return;
  form.append(field, await openAsBlob(record.path), record.originalName || path.basename(record.path));
}
const whisperCacheSignature = `faster-whisper:${process.env.MATCHCUT_WHISPER_MODEL || "small"}:beam1:vad350:condition0:v1`;
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256"), input = createReadStream(file);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}
async function transcriptCacheContext(file, language) {
  const audioHash = await hashFile(file), key = transcriptCacheKey(audioHash, language, whisperCacheSignature);
  return { key, file:path.join(transcriptCacheRoot, `${key}.json`) };
}
async function readCachedTranscript(context) {
  try {
    const saved = JSON.parse(await readFile(context.file, "utf8"));
    return saved?.version === 1 && saved?.key === context.key && isValidCachedTranscript(saved.transcript) ? saved.transcript : null;
  } catch { return null; }
}
async function writeCachedTranscript(context, transcript) {
  if (transcript?.engine !== "faster-whisper" || !isValidCachedTranscript(transcript)) return;
  const temporary = `${context.file}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ version:1, key:context.key, transcript }, null, 2), "utf8");
    try { await rename(temporary, context.file); }
    catch { await rm(context.file, { force:true }); await rename(temporary, context.file); }
  } finally { await rm(temporary, { force:true }); }
}
async function localPost(endpoint, form) {
  const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw new Error(result.error || `${endpoint} thất bại`);
  return result;
}
async function processPersistentJob(job) {
  try {
    job.error = null;
    if (!job.transcript?.chunks?.length && job.files.subtitle?.path) {
      job.status = "transcribing"; job.stage = "Đọc phụ đề SRT"; job.progress = 20;
      addJobLog(job, `Đang đọc SRT cùng tên: ${job.files.subtitle.originalName}`); await savePersistentJob(job);
      try {
        const chunks = parseSrt(await readFile(job.files.subtitle.path, "utf8"));
        job.transcript = { chunks, language: job.settings.language || "auto", source: "srt" };
        job.progress = 55; addJobLog(job, `Đã dùng trực tiếp ${chunks.length} timestamp từ SRT; bỏ qua Whisper.`); await savePersistentJob(job);
      } catch (error) {
        addJobLog(job, `SRT không hợp lệ (${error instanceof Error ? error.message : error}); tự chuyển sang Faster-Whisper.`);
        job.transcript = null; await savePersistentJob(job);
      }
    }
    if (!job.transcript?.chunks?.length) {
      job.status = "transcribing"; job.stage = "Tạo timestamp"; job.progress = 10;
      const requestedLanguage = job.settings.language || "auto", cacheContext = await transcriptCacheContext(job.files.voice.path, requestedLanguage);
      job.transcript = await readCachedTranscript(cacheContext);
      if (job.transcript) {
        job.transcript = structuredClone(job.transcript); job.transcript.source = "whisper-cache";
        addJobLog(job, `Dùng cache Faster-Whisper ${job.transcript.chunks.length} timestamp; bỏ qua nhận dạng lại.`);
      } else {
        addJobLog(job, "Bắt đầu tạo timestamp bằng Faster-Whisper."); await savePersistentJob(job);
        const form = new FormData();
        await appendJobFile(form, "voice", job.files.voice); form.append("language", requestedLanguage);
        job.transcript = await localPost("/api/transcribe", form); job.transcript.source = "whisper";
        try { await writeCachedTranscript(cacheContext, job.transcript); }
        catch (error) { console.warn(`Không lưu được cache Faster-Whisper: ${error instanceof Error ? error.message : error}`); }
        addJobLog(job, `Đã lưu ${job.transcript.chunks.length} timestamp; checkpoint này sẽ được dùng lại.`);
      }
      job.progress = 55; await savePersistentJob(job);
    } else addJobLog(job, `Dùng lại checkpoint ${job.transcript.chunks.length} timestamp đã lưu.`);

    job.status = "rendering"; job.stage = "Render MP4"; job.progress = 60; job.settings.fastRender = job.settings.fastRender !== false; await savePersistentJob(job);
    const picked = chooseJobAssets(job.assets, job.transcript.chunks.length, job.selectionMode);
    const renderForm = new FormData(); await appendJobFile(renderForm, "voice", job.files.voice);
    const uploadedAssets = job.assets.filter((asset) => asset.uploadedPath).sort((a, b) => a.uploadIndex - b.uploadIndex);
    for (const asset of uploadedAssets) renderForm.append("media", await openAsBlob(asset.uploadedPath), asset.name);
    for (const field of ["intro", "outro", "overlay", "watermark", "music"]) await appendJobFile(renderForm, field, job.files[field]);
    // Whisper's reported duration can stop at the last spoken word and omit
    // trailing silence. The rendered timeline must cover the physical voice
    // file, otherwise `-shortest` truncates the exported video.
    const probedVoiceDuration = await probeMediaDuration(job.files.voice.path);
    const voiceDuration = Math.max(Number(job.transcript.audioDuration) || 0, probedVoiceDuration);
    const captionScenes = job.transcript.chunks.map((chunk, index) => {
      const asset = job.assets[picked[index]];
      // Render scenes must be contiguous. Summing only spoken chunk lengths
      // removes every pause between phrases and shortens long videos.
      const start = index === 0 ? 0 : Number(chunk.start);
      const nextStart = Number(job.transcript.chunks[index + 1]?.start);
      const end = Number.isFinite(nextStart) ? nextStart : voiceDuration;
      return { start, end: Math.max(start + 0.05, end), text: chunk.text, mediaIndex: asset.uploadedPath ? asset.uploadIndex : null, mediaPath: asset.localPath || null, mediaType: asset.type };
    });
    const scenes = job.settings.fastRender ? compactVisualScenes(captionScenes, 96) : captionScenes;
    renderForm.append("scenes", JSON.stringify(scenes)); renderForm.append("captionScenes", JSON.stringify(captionScenes)); renderForm.append("settings", JSON.stringify(job.settings)); renderForm.append("persistentJob", "1"); renderForm.append("jobId", job.id);
    addJobLog(job, `Render nhanh ${scenes.length} cảnh hình và ${captionScenes.length} cue phụ đề bằng NVDEC/CUDA → filter giữ nguyên hiệu ứng → NVENC.`); await savePersistentJob(job);
    const renderHeartbeat = setInterval(() => {
      if (job.status !== "rendering") return;
      job.updatedAt = new Date().toISOString();
      void savePersistentJob(job).catch((error) => console.error(`Không lưu được heartbeat job ${job.id}:`, error));
    }, 10000);
    try { job.output = await localPost("/api/render", renderForm); }
    finally { clearInterval(renderHeartbeat); }
    job.status = "completed"; job.stage = "Hoàn tất"; job.progress = 100; job.completedAt = new Date().toISOString();
    addJobLog(job, `Đã xuất bằng ${job.output.acceleration || job.output.renderEncoder} và kiểm tra hoàn tất: ${job.output.savedPath}`); await savePersistentJob(job);
  } catch (error) {
    job.status = "failed"; job.error = error instanceof Error ? error.message : String(error); job.failedAt = new Date().toISOString();
    addJobLog(job, `Lỗi tại ${job.stage}: ${job.error}`); await savePersistentJob(job);
  }
}
async function pumpPersistentJobs() {
  if (persistentWorkerRunning) return;
  persistentWorkerRunning = true;
  try {
    while (true) {
      const next = [...persistentJobs.values()].find((job) => job.status === "queued");
      if (!next) break;
      await processPersistentJob(next);
    }
  } finally { persistentWorkerRunning = false; }
}
const jobUpload = upload.fields([{ name: "voice", maxCount: 1 }, { name: "subtitle", maxCount: 1 }, { name: "media", maxCount: 100 }, { name: "intro", maxCount: 1 }, { name: "outro", maxCount: 1 }, { name: "overlay", maxCount: 1 }, { name: "watermark", maxCount: 1 }, { name: "music", maxCount: 1 }]);
app.post("/api/jobs", jobUpload, async (req, res) => {
  const voice = req.files?.voice?.[0];
  if (!voice) return res.status(400).json({ error: "Chưa có file voice." });
  const id = crypto.randomUUID(), dir = path.join(persistentRoot, id), inputs = path.join(dir, "inputs");
  try {
    await mkdir(inputs, { recursive: true });
    const moveRecord = async (file, field) => {
      if (!file) return null;
      const destination = path.join(inputs, `${field}-${crypto.randomUUID()}${path.extname(file.originalname)}`);
      if (file.profileAsset) await copyFile(file.path, destination); else await rename(file.path, destination);
      return { path: destination, originalName: file.originalname, size: file.size };
    };
    await applySavedProfileAssets(req);
    const files = { voice: await moveRecord(voice, "voice"), subtitle: await moveRecord(req.files?.subtitle?.[0], "subtitle") };
    for (const field of ["intro", "outro", "overlay", "watermark", "music"]) files[field] = await moveRecord(req.files?.[field]?.[0], field);
    const assetSpecs = JSON.parse(req.body.assets || "[]"), uploaded = req.files?.media || [];
    const assets = [];
    for (const spec of assetSpecs) {
      if (spec.uploadIndex !== null && spec.uploadIndex !== undefined) {
        const record = await moveRecord(uploaded[spec.uploadIndex], `media-${spec.uploadIndex}`);
        if (!record) throw new Error(`Thiếu file tư liệu ${spec.name}`);
        assets.push({ ...spec, uploadedPath: record.path });
      } else assets.push(spec);
    }
    if (!assets.length) throw new Error("Chưa có kho tư liệu.");
    const now = new Date().toISOString(), requestedStart = Date.parse(req.body.startedAt), startedAt = Number.isFinite(requestedStart) && requestedStart <= Date.now() + 5000 ? new Date(requestedStart).toISOString() : now, settings = JSON.parse(req.body.settings || "{}");
    const job = { id, name: voice.originalname, profileName: settings.profileName || "Kênh mặc định", status: "queued", stage: "Chờ xử lý", progress: 0, error: null, logs: [], createdAt: now, startedAt, updatedAt: now, completedAt: null, failedAt: null, files, assets, settings, selectionMode: req.body.selectionMode || "shuffle", transcript: null, output: null };
    addJobLog(job, "Đã lưu project và file đầu vào vào ổ máy."); persistentJobs.set(id, job); await savePersistentJob(job);
    res.status(202).json(jobPublic(job)); void pumpPersistentJobs();
  } catch (error) { await rm(dir, { recursive: true, force: true }); res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.get("/api/jobs", (_req, res) => res.json({ jobs: [...persistentJobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(jobPublic) }));
app.delete("/api/jobs", async (_req, res) => {
  const activeJobs = [...persistentJobs.values()].filter((job) => ["queued", "transcribing", "rendering"].includes(job.status));
  if (activeJobs.length || persistentWorkerRunning) {
    return res.status(409).json({ error: "Không thể xóa hàng đợi khi backend còn job đang xử lý.", activeJobs: activeJobs.map(jobPublic) });
  }
  try {
    await Promise.allSettled([...persistentSaveQueues.values()]);
    const entries = await readdir(persistentRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) await rm(path.join(persistentRoot, entry.name), { recursive: true, force: true });
    }
    const deleted = persistentJobs.size;
    persistentJobs.clear();
    res.json({ ok: true, deleted, outputsPreserved: true, exportRoot });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Không thể xóa lịch sử hàng đợi." });
  }
});
app.get("/api/jobs/:id", (req, res) => { const job = persistentJobs.get(req.params.id); return job ? res.json(jobPublic(job)) : res.status(404).json({ error: "Không tìm thấy job." }); });
app.delete("/api/jobs/:id", async (req, res) => {
  const job = persistentJobs.get(req.params.id); if (!job) return res.status(404).json({ error:"Không tìm thấy job." });
  if (["queued", "transcribing", "rendering"].includes(job.status)) return res.status(409).json({ error:"Không thể xóa job đang xử lý." });
  await Promise.allSettled([persistentSaveQueues.get(job.id)]); persistentJobs.delete(job.id); persistentSaveQueues.delete(job.id);
  await rm(path.join(persistentRoot, job.id), { recursive:true, force:true }); res.json({ ok:true, deleted:job.id, outputPreserved:true });
});
app.post("/api/jobs/:id/retry", async (req, res) => {
  const job = persistentJobs.get(req.params.id); if (!job) return res.status(404).json({ error: "Không tìm thấy job." });
  const requestedStart = Date.parse(req.body?.startedAt), now = new Date().toISOString();
  job.status = "queued"; job.error = null; job.startedAt = Number.isFinite(requestedStart) && requestedStart <= Date.now() + 5000 ? new Date(requestedStart).toISOString() : now; job.completedAt = null; job.failedAt = null;
  addJobLog(job, `Yêu cầu tiếp tục từ ${job.transcript ? "render" : "timestamp"}.`); await savePersistentJob(job); res.json(jobPublic(job)); void pumpPersistentJobs();
});
const profileAssetUpload = upload.fields(profileAssetFields.map((name) => ({ name, maxCount: 1 })));
app.post("/api/profile-assets/:profileId", profileAssetUpload, async (req, res) => {
  try {
    const id = safeProfileId(req.params.profileId), dir = path.join(profileAssetsRoot, id);
    await mkdir(dir, { recursive: true });
    const manifest = await readProfileAssetManifest(id);
    for (const field of profileAssetFields) {
      const file = req.files?.[field]?.[0]; if (!file) continue;
      for (const entry of await readdir(dir, { withFileTypes:true })) if (entry.isFile() && entry.name.startsWith(`${field}-`)) await rm(path.join(dir, entry.name), { force:true });
      const storedName = `${field}-${crypto.randomUUID()}${path.extname(file.originalname)}`;
      await rename(file.path, path.join(dir, storedName));
      manifest[field] = { storedName, originalName:file.originalname, size:file.size, updatedAt:new Date().toISOString() };
    }
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    res.json({ ok:true, assets:Object.fromEntries(profileAssetFields.filter((field) => manifest[field]).map((field) => [field, { originalName:manifest[field].originalName, size:manifest[field].size }])) });
  } catch (error) { res.status(400).json({ error:error instanceof Error ? error.message : String(error) }); }
});
app.get("/api/project-state", async (_req, res) => { try { res.json(JSON.parse(await readFile(projectStatePath, "utf8"))); } catch { res.json({}); } });
app.put("/api/project-state", async (req, res) => { await mkdir(path.dirname(projectStatePath), { recursive: true }); await writeFile(projectStatePath, JSON.stringify(req.body, null, 2), "utf8"); res.json({ ok: true }); });
async function cleanupPersistentJobs() {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, job] of persistentJobs) if (job.status === "completed" && Date.parse(job.completedAt) < cutoff) { await rm(path.join(persistentRoot, id), { recursive: true, force: true }); persistentJobs.delete(id); }
}
app.get("/api/health", async (_req, res) => {
  let transcriptionEngine = "whisper-js-fallback";
  try { await stat(fasterWhisperPython); transcriptionEngine = "faster-whisper"; } catch {}
  res.json({ ok: true, engine: "FFmpeg", transcriptionEngine, renderEncoder: await hasNvenc() ? "h264_nvenc" : "libx264", gpuPipeline: await hasCudaPipeline() ? "NVDEC + scale_cuda + NVENC" : "CPU fallback" });
});
await loadPersistentJobs();
app.listen(port, () => { console.log(`MatchCut FFmpeg: http://localhost:${port}`); void pumpPersistentJobs(); });
setInterval(() => void cleanupPersistentJobs(), 60 * 60 * 1000).unref();
