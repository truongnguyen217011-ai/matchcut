import express from "express";
import multer from "multer";
import ffmpegPath from "ffmpeg-static";
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { pipeline } from "@huggingface/transformers";
import wavefile from "wavefile";
const root = path.dirname(fileURLToPath(import.meta.url)),
  jobsRoot = path.join(root, "jobs"),
  fontsRoot = path.join(root, "dist", "fonts"),
  exportRoot = process.env.MATCHCUT_EXPORT_DIR || "C:\\MatchCut\\Exports";
await mkdir(jobsRoot, { recursive: true });
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
  const events = scenes
    .map((scene) => {
      const content = assEscape(scene.text), placement = settings.textEffect === "slide-up" ? `{\\move(${subtitleX},${subtitleY + 180},${subtitleX},${subtitleY},0,350)\\fad(120,100)}` : `{\\pos(${subtitleX},${subtitleY})}`;
      let text = `${placement}${content}`;
      if (settings.textEffect === "fade") text = `{\\fad(250,180)}${text}`;
      if (settings.textEffect === "pop")
        text = `{\\fscx70\\fscy70\\t(0,250,\\fscx100\\fscy100)}${text}`;
      if (settings.textEffect === "karaoke") {
        const words = content.split(/\s+/),
          centis = Math.max(
            1,
            Math.round(
              ((Number(scene.end) - Number(scene.start)) * 100) /
                Math.max(1, words.length),
            ),
          );
        text = `${placement}${words.map((word) => `{\\k${centis}}${word}`).join(" ")}`;
      }
      if (settings.textEffect === "typewriter") {
        const characters = [...content], centis = Math.max(1, Math.round(((Number(scene.end) - Number(scene.start)) * 100) / Math.max(1, characters.length)));
        text = `${placement}${characters.map((character) => `{\\k${centis}}${character}`).join("")}`;
      }
      if (settings.textEffect === "zoom-in") text = `{\\fscx35\\fscy35\\t(0,320,\\fscx100\\fscy100)}${text}`;
      if (settings.textEffect === "bounce") text = `{\\fscx55\\fscy55\\t(0,180,\\fscx120\\fscy120)\\t(180,360,\\fscx100\\fscy100)}${text}`;
      if (settings.textEffect === "glow") text = `{\\blur3\\bord5\\3c${accent}}${text}`;
      if (settings.textEffect === "shake") text = `{\\frz-2\\t(0,100,\\frz2)\\t(100,200,\\frz-2)\\t(200,300,\\frz0)}${text}`;
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
    await mkdir(dir, { recursive: true });
    try {
      const voice = req.files?.voice?.[0],
        media = req.files?.media || [],
        scenes = JSON.parse(req.body.scenes || "[]"),
        settings = JSON.parse(req.body.settings || "{}");
      if (!voice || !scenes.length || (!media.length && !scenes.some((scene) => scene.mediaPath)))
        return res
          .status(400)
          .json({ error: "Thiếu voice, tư liệu hoặc timeline." });
      const segments = [];
      const [width, height] = settings.aspectRatio === "9:16" ? [1080, 1920] : settings.aspectRatio === "1:1" ? [1080, 1080] : [1920, 1080];
      let overlayImagePath = null;
      if (settings.overlayImageEnabled && settings.overlayImageFolder) {
        const overlayFiles = await findOverlayImages(settings.overlayImageFolder);
        if (!overlayFiles.length) throw new Error("Folder ảnh lớp phủ không có file PNG hoặc WebP.");
        const folderKey = path.resolve(settings.overlayImageFolder), previous = lastOverlaySelections.get(folderKey), choices = overlayFiles.length > 1 ? overlayFiles.filter((file) => file !== previous) : overlayFiles;
        overlayImagePath = choices[Math.floor(Math.random() * choices.length)];
        lastOverlaySelections.set(folderKey, overlayImagePath);
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
          await run([
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
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            out,
          ]);
        else
          await run([
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
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            out,
          ]);
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
      if (overlayImagePath) { overlayInputIndex = nextVideoInput++; inputArgs.push("-loop", "1", "-i", overlayImagePath); }
      if (watermark) { watermarkInputIndex = nextVideoInput++; inputArgs.push("-loop", "1", "-i", watermark.path); }
      if (settings.voiceWaveformEnabled) { voiceWaveformInputIndex = nextVideoInput++; inputArgs.push("-i", voice.path); }
      if (settings.waveformEnabled && music) { musicWaveformInputIndex = nextVideoInput++; inputArgs.push("-stream_loop", "-1", "-i", music.path); }
      let subtitleFilter = "";
      if (settings.subtitleEnabled !== false) {
        const assPath = path.join(dir, "captions.ass");
        await writeFile(assPath, createAss(scenes, settings), "utf8");
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
          filters.push(`[${current}][overlayimg]overlay=0:0:shortest=1[v${++layerNumber}]`); current = `v${layerNumber}`;
        }
        const waveWidth = Math.max(120, Math.round(width * Math.min(100, Math.max(20, Number(settings.waveformWidth) || 70)) / 100)),
          waveHeight = Math.max(40, Math.min(300, Number(settings.waveformHeight) || 120)),
          waveCenterX = width * Math.min(95, Math.max(5, Number(settings.waveformX) || 50)) / 100,
          waveX = Math.max(0, Math.min(width - waveWidth, Math.round(waveCenterX - waveWidth / 2)));
        const addWaveform = (inputIndex, color, yPercent, name) => {
          if (inputIndex === null) return;
          const safeColor = String(color || "#ffffff").replace("#", ""), centerY = height * Math.min(95, Math.max(5, Number(yPercent) || 80)) / 100, waveY = Math.max(0, Math.min(height - waveHeight, Math.round(centerY - waveHeight / 2)));
          filters.push(`[${inputIndex}:a]showwaves=s=${waveWidth}x${waveHeight}:mode=line:colors=0x${safeColor}:rate=30,format=rgba[${name}]`);
          filters.push(`[${current}][${name}]overlay=${waveX}:${waveY}:shortest=1[v${++layerNumber}]`); current = `v${layerNumber}`;
        };
        addWaveform(musicWaveformInputIndex, settings.waveformColor, settings.waveformY, "musicwave");
        addWaveform(voiceWaveformInputIndex, settings.voiceWaveformColor, settings.voiceWaveformY, "voicewave");
        if (watermarkInputIndex !== null) {
          const opacity = Math.min(100, Math.max(0, Number(settings.watermarkOpacity ?? 70))) / 100,
            speed = Math.min(45, Math.max(1, Number(settings.watermarkRotationSpeed) || 12)),
            rotation = settings.watermarkRotate ? `,rotate='${(speed * Math.PI / 180).toFixed(6)}*t':ow=rotw(iw):oh=roth(ih):c=none` : "";
          filters.push(`[${watermarkInputIndex}:v]scale=${Math.round(width * 0.12)}:-1,format=rgba,colorchannelmixer=aa=${opacity.toFixed(2)}${rotation}[wm]`);
          filters.push(`[${current}][wm]overlay=W-w-35:35:shortest=1[v${++layerNumber}]`); current = `v${layerNumber}`;
        }
        if (subtitleFilter) filters.push(`[${current}]${subtitleFilter}[vout]`);
        else filters.push(`[${current}]null[vout]`);
        encodeArgs.push("-filter_complex", filters.join(";"), "-map", "[vout]", "-map", "1:a:0");
      } else {
        if (subtitleFilter) encodeArgs.push("-vf", subtitleFilter);
        encodeArgs.push("-map", "0:v:0", "-map", "1:a:0");
      }
      encodeArgs.push("-c:v", subtitleFilter || hasVisualLayers ? "libx264" : "copy");
      if (subtitleFilter || hasVisualLayers) encodeArgs.push("-preset", "veryfast", "-crf", "20");
      encodeArgs.push("-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", output);
      await run(encodeArgs);
      const savedPath = await availableExportPath(voice.originalname);
      await copyFile(output, savedPath);
      res.json({
        ok: true,
        savedPath,
        fileName: path.basename(savedPath),
        overlayImage: overlayImagePath ? path.basename(overlayImagePath) : null,
        settings,
      });
    } catch (error) {
      res
        .status(500)
        .json({
          error:
            error instanceof Error
              ? error.message.split("\n").slice(-4).join(" ")
              : "Không thể render video.",
        });
    } finally {
      setTimeout(() => void rm(dir, { recursive: true, force: true }), 30000);
    }
  },
);
app.post("/api/transcribe", upload.single("voice"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Chưa có file voice." });
  const wavPath = `${req.file.path}.wav`;
  try {
    await run([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      req.file.path,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      wavPath,
    ]);
    const wav = new wavefile.WaveFile(await readFile(wavPath));
    wav.toBitDepth("32f");
    wav.toSampleRate(16000);
    let samples = wav.getSamples();
    if (Array.isArray(samples)) samples = samples[0];
    const transcriber = await getWhisper();
    const language = req.body.language;
    const options = {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    };
    if (language && language !== "auto") options.language = language;
    const output = await transcriber(samples, options);
    res.json({
      language: language || "auto",
      text: output.text || "",
      chunks: (output.chunks || [])
        .map((c) => ({
          text: c.text.trim(),
          start: Number(c.timestamp?.[0] || 0),
          end: Number(c.timestamp?.[1] || c.timestamp?.[0] || 0),
        }))
        .filter((c) => c.text && c.end > c.start),
    });
  } catch (error) {
    res
      .status(500)
      .json({
        error:
          error instanceof Error
            ? error.message
            : "Whisper không thể nhận dạng voice.",
      });
  } finally {
    void rm(req.file.path, { force: true });
    void rm(wavPath, { force: true });
  }
});
app.get("/api/health", (_req, res) => res.json({ ok: true, engine: "FFmpeg" }));
const port = Number(process.env.MATCHCUT_PORT) || 4173;
app.listen(port, () =>
  console.log(`MatchCut FFmpeg: http://localhost:${port}`),
);
