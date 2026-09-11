import express from "express";
import multer from "multer";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import { openAsBlob } from "node:fs";
import {
  copyFile,
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
import { buildSubtitleCues } from "./subtitle-utils.js";
import { parseSrt } from "./srt-utils.js";
import { applyAssTextEffect } from "./ass-effects.js";
import { compactVisualScenes } from "./render-utils.js";
const root = path.dirname(fileURLToPath(import.meta.url)),
  jobsRoot = path.join(root, "jobs"),
  persistentRoot = path.join(root, "data", "runtime-jobs"),
  projectStatePath = path.join(root, "data", "project-state.json"),
  fontsRoot = path.join(root, "dist", "fonts"),
  fasterWhisperPython = path.join(root, ".venv-whisper", "Scripts", "python.exe"),
  fasterWhisperScript = path.join(root, "scripts", "faster_whisper_transcribe.py"),
  exportRoot = process.env.MATCHCUT_EXPORT_DIR || "C:\\MatchCut\\Exports",
  port = Number(process.env.MATCHCUT_PORT) || 4173;
await mkdir(jobsRoot, { recursive: true });
await mkdir(persistentRoot, { recursive: true });
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
function probeMediaDuration(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-i", file], { windowsHide: true });
    let details = "";
    child.stderr.on("data", (chunk) => (details += chunk.toString()));
    child.on("error", reject);
    child.on("close", () => {
      const match = details.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) return reject(new Error("Không đọc được thời lượng voice."));
      resolve(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]));
    });
  });
}
let nvencUsable;
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
async function runVideoEncode(baseArgs, output, options = {}) {
  if (await hasNvenc()) {
    try {
      const preset = options.fast ? "p2" : "p4";
      await run([...baseArgs, "-c:v", "h264_nvenc", "-preset", preset, "-tune", "hq", "-rc", "vbr", "-cq", "23", "-b:v", "4M", "-maxrate", "8M", "-bufsize", "16M", output]);
      return "h264_nvenc";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/nvenc|cuda|no capable devices|error while opening encoder/i.test(message)) throw error;
      console.warn(`NVENC fallback: ${message}`);
      nvencUsable = false;
    }
  }
  await run([...baseArgs, "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", output]);
  return "libx264-fallback";
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
const assTime = (value) => {
  const n = Math.max(0, Number(value) || 0),
    hours = Math.floor(n / 3600),
    minutes = Math.floor((n % 3600) / 60),
    seconds = (n % 60).toFixed(2).padStart(5, "0");
  return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
};
const assColor = (hex) => {
  const value = String(hex || "#ffffff")
    .replace("#", "")
    .padEnd(6, "f");
  return `&H00${value.slice(4, 6)}${value.slice(2, 4)}${value.slice(0, 2).toUpperCase()}`;
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
    primary = assColor(settings.fontColor),
    accent = assColor(settings.accentColor),
    outline = assColor(settings.secondaryOutline || "#000000"),
    alpha = Math.round(255 * (1 - (Number(settings.subtitleBg) || 0) / 100)).toString(16).padStart(2, "0").toUpperCase(),
    bold = settings.fontBold === false ? 0 : -1,
    italic = settings.fontItalic ? -1 : 0,
    spacing = Math.max(0, Number(settings.letterSpacing) || 0),
    outlineSize = Math.max(0, Number(settings.outlineSize) || 2);
  const subtitleCues = buildSubtitleCues(scenes, settings);
  const events = subtitleCues
    .map((scene) => {
      const content = assEscape(scene.text), placement = settings.textEffect === "slide-up" ? `{\\move(${subtitleX},${subtitleY + 180},${subtitleX},${subtitleY},0,350)\\fad(120,100)}` : `{\\pos(${subtitleX},${subtitleY})}`;
      const text = applyAssTextEffect(content, placement, scene, settings, accent, primary);
      return `Dialogue: 0,${assTime(scene.start)},${assTime(scene.end)},Default,,0,0,0,,${text}`;
    })
    .join("\n");
  const end = assTime(Math.max(...scenes.map((scene) => Number(scene.end) || 0)));
  const title = settings.persistentTitle && settings.titleLine1 ? `\nDialogue: 1,0:00:00.00,${end},Title,,0,0,0,,${assEscape([settings.titleLine1, settings.titleLine2].filter(Boolean).join("\n"))}` : "";
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${font},${size},${primary},${accent},${outline},&H${alpha}000000,${bold},${italic},0,0,100,100,${spacing},0,3,${outlineSize},1,5,90,90,20,1\nStyle: Title,${font},62,${accent},${primary},${outline},&H50000000,-1,0,0,0,100,100,1,0,3,3,2,9,60,60,60,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}${title}\n`;
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
function sceneVideoFilter(scene, settings, width, height, duration, transition) {
  let vf = `trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
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
async function renderSinglePass({ dir, files, voice, media, scenes, captionScenes, settings, width, height, overlayImagePath, timeOffset = 0, outputName = "matchcut-output.mp4" }) {
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
  let inputIndex = 0;
  for (const entry of sourceMap.values()) {
    entry.inputIndex = inputIndex++;
    inputArgs.push(entry.type === "image" ? "-loop" : "-stream_loop", entry.type === "image" ? "1" : "-1", "-i", entry.source);
    if (entry.uses.length > 1) {
      entry.labels = entry.uses.map((_, branch) => `src${entry.inputIndex}_${branch}`);
      filters.push(`[${entry.inputIndex}:v]split=${entry.uses.length}${entry.labels.map((label) => `[${label}]`).join("")}`);
    } else entry.labels = [`${entry.inputIndex}:v`];
  }
  const totalDuration = Math.max(...scenes.map((scene) => Number(scene.end) || 0));
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
    filters.push(`[${entry.labels[branch]}]${sceneVideoFilter(scene, settings, width, height, duration, transition)}[scene${index}]`);
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
    filters.push(`[${overlayIndex}:v]scale=${width}:${height},format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[overlayimg]`);
    filters.push(`[${current}][overlayimg]overlay=0:0:eof_action=repeat:shortest=0[layer${++layer}]`); current = `layer${layer}`;
  }
  const waveWidth = Math.max(120, Math.round(width * Math.min(100, Math.max(20, Number(settings.waveformWidth) || 70)) / 100));
  const waveHeight = Math.max(40, Math.min(300, Number(settings.waveformHeight) || 120));
  const addWave = (source, color, opacityPercent, xPercent, yPercent, name) => {
    if (!source) return;
    const safeColor = String(color || "#ffffff").replace("#", "");
    const opacity = Math.min(100, Math.max(0, Number(opacityPercent ?? 100))) / 100;
    const centerX = width * Math.min(95, Math.max(5, Number(xPercent) || 50)) / 100, centerY = height * Math.min(95, Math.max(5, Number(yPercent) || 80)) / 100;
    const x = Math.max(0, Math.min(width - waveWidth, Math.round(centerX - waveWidth / 2))), y = Math.max(0, Math.min(height - waveHeight, Math.round(centerY - waveHeight / 2)));
    filters.push(`[${source}]showwaves=s=${waveWidth}x${waveHeight}:mode=line:colors=0x${safeColor}:rate=${settings.fastRender !== false ? 15 : 30},format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[${name}]`);
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
    const assPath = path.join(dir, "captions.ass");
    await writeFile(assPath, createAss(captionScenes || scenes, settings), "utf8");
    const escaped = assPath.replaceAll("\\", "/").replace(":", "\\:").replaceAll("'", "\\'");
    const escapedFonts = fontsRoot.replaceAll("\\", "/").replace(":", "\\:").replaceAll("'", "\\'");
    filters.push(`[${current}]subtitles=filename='${escaped}':fontsdir='${escapedFonts}',setsar=1[vout]`);
  } else filters.push(`[${current}]setsar=1[vout]`);

  const graphPath = path.join(dir, "single-pass.ffgraph");
  await writeFile(graphPath, filters.join(";\n"), "utf8");
  const output = path.join(dir, outputName);
  const encoder = await runVideoEncode([...inputArgs, "-filter_complex_script", graphPath, "-map", "[vout]", "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart"], output, { fast: settings.fastRender !== false });
  return { output, encoder };
}
async function renderChunkedSinglePass(options) {
  const { dir, scenes, captionScenes = scenes, onProgress } = options, chunkSize = 24, outputs = [], chunkCount = Math.ceil(scenes.length / chunkSize);
  let encoder = "h264_nvenc";
  for (let index = 0; index < scenes.length; index += chunkSize) {
    const chunkNumber = outputs.length + 1;
    await onProgress?.(`Render khối ${chunkNumber}/${chunkCount}`, 60 + Math.floor(((chunkNumber - 1) / chunkCount) * 30));
    const group = scenes.slice(index, index + chunkSize), offset = Number(group[0].start) || 0, end = Number(group.at(-1).end), duration = end - offset;
    const localScenes = group.map((scene) => ({ ...scene, start: Number(scene.start) - offset, end: Number(scene.end) - offset }));
    const localCaptions = captionScenes
      .filter((scene) => Number(scene.end) > offset && Number(scene.start) < end)
      .map((scene) => ({ ...scene, start: Math.max(0, Number(scene.start) - offset), end: Math.min(duration, Number(scene.end) - offset) }));
    const result = await renderSinglePass({ ...options, scenes: localScenes, captionScenes: localCaptions, timeOffset: offset, outputName: `fast-chunk-${String(outputs.length).padStart(3, "0")}.mp4` });
    outputs.push(result.output); encoder = result.encoder;
  }
  await onProgress?.("Ghép các khối MP4", 92);
  const concatFile = path.join(dir, "fast-chunks.txt");
  await writeFile(concatFile, outputs.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n"), "utf8");
  const output = path.join(dir, "matchcut-output.mp4");
  await run(["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", concatFile, "-c", "copy", "-movflags", "+faststart", output]);
  return { output, encoder, pipeline: `chunked-single-pass-${outputs.length}` };
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
      let overlayImagePath = null, renderEncoder = "copy";
      if (settings.overlayImageEnabled && settings.overlayImageFolder) {
        const overlayFiles = await findOverlayImages(settings.overlayImageFolder);
        if (!overlayFiles.length) throw new Error("Folder ảnh lớp phủ không có file PNG hoặc WebP.");
        const folderKey = path.resolve(settings.overlayImageFolder), previous = lastOverlaySelections.get(folderKey), choices = overlayFiles.length > 1 ? overlayFiles.filter((file) => file !== previous) : overlayFiles;
        overlayImagePath = choices[Math.floor(Math.random() * choices.length)];
        lastOverlaySelections.set(folderKey, overlayImagePath);
      }
      if (settings.singlePassRender !== false) {
        try {
          const progressJob = req.body.jobId ? persistentJobs.get(req.body.jobId) : null;
          const onProgress = progressJob ? async (stage, progress) => {
            progressJob.stage = stage; progressJob.progress = progress; progressJob.updatedAt = new Date().toISOString();
            await savePersistentJob(progressJob);
          } : null;
          const renderOptions = { dir, files: req.files, voice, media, scenes, captionScenes, settings, width, height, overlayImagePath, onProgress };
          const singlePass = settings.fastRender !== false && scenes.length > 24 ? await renderChunkedSinglePass(renderOptions) : await renderSinglePass(renderOptions);
          const savedPath = await availableExportPath(voice.originalname);
          await copyFile(singlePass.output, savedPath);
          return sendRenderResult({
            ok: true,
            savedPath,
            fileName: path.basename(savedPath),
            overlayImage: overlayImagePath ? path.basename(overlayImagePath) : null,
            renderEncoder: singlePass.encoder,
            renderPipeline: singlePass.pipeline || "single-pass",
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
          filters.push(`[${overlayInputIndex}:v]scale=${width}:${height},format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[overlayimg]`);
          filters.push(`[${current}][overlayimg]overlay=0:0:eof_action=repeat:shortest=0[v${++layerNumber}]`); current = `v${layerNumber}`;
        }
        const waveWidth = Math.max(120, Math.round(width * Math.min(100, Math.max(20, Number(settings.waveformWidth) || 70)) / 100)),
          waveHeight = Math.max(40, Math.min(300, Number(settings.waveformHeight) || 120));
        const addWaveform = (inputIndex, color, opacityPercent, xPercent, yPercent, name) => {
          if (inputIndex === null) return;
          const safeColor = String(color || "#ffffff").replace("#", ""), opacity = Math.min(100, Math.max(0, Number(opacityPercent ?? 100))) / 100, centerX = width * Math.min(95, Math.max(5, Number(xPercent) || 50)) / 100, centerY = height * Math.min(95, Math.max(5, Number(yPercent) || 80)) / 100, waveX = Math.max(0, Math.min(width - waveWidth, Math.round(centerX - waveWidth / 2))), waveY = Math.max(0, Math.min(height - waveHeight, Math.round(centerY - waveHeight / 2)));
          filters.push(`[${inputIndex}:a]showwaves=s=${waveWidth}x${waveHeight}:mode=line:colors=0x${safeColor}:rate=${settings.fastRender !== false ? 15 : 30},format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}[${name}]`);
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
      encodeArgs.push("-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart");
      if (subtitleFilter || hasVisualLayers) renderEncoder = await runVideoEncode(encodeArgs, output, { fast: settings.fastRender !== false });
      else {
        await run([...encodeArgs, "-c:v", "copy", output]);
        renderEncoder = "copy";
      }
      const savedPath = await availableExportPath(voice.originalname);
      await copyFile(output, savedPath);
      sendRenderResult({
        ok: true,
        savedPath,
        fileName: path.basename(savedPath),
        overlayImage: overlayImagePath ? path.basename(overlayImagePath) : null,
        renderEncoder,
        renderPipeline: "legacy-two-pass-fallback",
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
  createdAt: job.createdAt, updatedAt: job.updatedAt, completedAt: job.completedAt,
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
      addJobLog(job, "Bắt đầu tạo timestamp bằng Faster-Whisper."); await savePersistentJob(job);
      const form = new FormData();
      await appendJobFile(form, "voice", job.files.voice); form.append("language", job.settings.language || "auto");
      job.transcript = await localPost("/api/transcribe", form); job.transcript.source = "whisper";
      job.progress = 55; addJobLog(job, `Đã lưu ${job.transcript.chunks.length} timestamp; checkpoint này sẽ được dùng lại.`); await savePersistentJob(job);
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
    addJobLog(job, `Render nhanh ${scenes.length} cảnh hình và ${captionScenes.length} cue phụ đề bằng single-pass NVENC.`); await savePersistentJob(job);
    const renderHeartbeat = setInterval(() => {
      if (job.status !== "rendering") return;
      job.updatedAt = new Date().toISOString();
      void savePersistentJob(job).catch((error) => console.error(`Không lưu được heartbeat job ${job.id}:`, error));
    }, 10000);
    try { job.output = await localPost("/api/render", renderForm); }
    finally { clearInterval(renderHeartbeat); }
    job.status = "completed"; job.stage = "Hoàn tất"; job.progress = 100; job.completedAt = new Date().toISOString();
    addJobLog(job, `Đã xuất và kiểm tra hoàn tất: ${job.output.savedPath}`); await savePersistentJob(job);
  } catch (error) {
    job.status = "failed"; job.error = error instanceof Error ? error.message : String(error);
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
      await rename(file.path, destination); return { path: destination, originalName: file.originalname, size: file.size };
    };
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
    const now = new Date().toISOString(), settings = JSON.parse(req.body.settings || "{}");
    const job = { id, name: voice.originalname, profileName: settings.profileName || "Kênh mặc định", status: "queued", stage: "Chờ xử lý", progress: 0, error: null, logs: [], createdAt: now, updatedAt: now, completedAt: null, files, assets, settings, selectionMode: req.body.selectionMode || "shuffle", transcript: null, output: null };
    addJobLog(job, "Đã lưu project và file đầu vào vào ổ máy."); persistentJobs.set(id, job); await savePersistentJob(job);
    res.status(202).json(jobPublic(job)); void pumpPersistentJobs();
  } catch (error) { await rm(dir, { recursive: true, force: true }); res.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
});
app.get("/api/jobs", (_req, res) => res.json({ jobs: [...persistentJobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(jobPublic) }));
app.get("/api/jobs/:id", (req, res) => { const job = persistentJobs.get(req.params.id); return job ? res.json(jobPublic(job)) : res.status(404).json({ error: "Không tìm thấy job." }); });
app.post("/api/jobs/:id/retry", async (req, res) => {
  const job = persistentJobs.get(req.params.id); if (!job) return res.status(404).json({ error: "Không tìm thấy job." });
  job.status = "queued"; job.error = null; addJobLog(job, `Yêu cầu tiếp tục từ ${job.transcript ? "render" : "timestamp"}.`); await savePersistentJob(job); res.json(jobPublic(job)); void pumpPersistentJobs();
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
  res.json({ ok: true, engine: "FFmpeg", transcriptionEngine, renderEncoder: await hasNvenc() ? "h264_nvenc" : "libx264" });
});
await loadPersistentJobs();
app.listen(port, () => { console.log(`MatchCut FFmpeg: http://localhost:${port}`); void pumpPersistentJobs(); });
setInterval(() => void cleanupPersistentJobs(), 60 * 60 * 1000).unref();
