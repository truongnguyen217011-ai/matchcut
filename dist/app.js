const $ = (s) => document.querySelector(s);
const audio = $("#audio"),
  voice = $("#voiceInput"),
  mediaInput = $("#mediaInput"),
  script = $("#script"),
  match = $("#matchBtn"),
  timeline = $("#timeline"),
  canvas = $("#canvas"),
  caption = $("#caption");
let assets = [],
  scenes = [],
  whisperChunks = [],
  timelineWindowStart = 0;
const fmt = (n) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;
function effectSettings() {
  return {
    fontFamily: $("#fontFamily").value,
    fontSize: Number($("#fontSize").value),
    textEffect: $("#textEffect").value,
    transition: $("#transition").value,
    fontColor: $("#fontColor").value,
    accentColor: $("#accentColor").value,
    subtitlePosition: $("#subtitlePosition").value,
    subtitleEnabled: $("#subtitleEnabled").checked,
    profileName: $("#profileName").value,
    aspectRatio: $("#aspectRatio").value,
    language: $("#language").value,
    poolMode: $("#poolMode").checked,
    fontBold: $("#fontBold").checked,
    fontItalic: $("#fontItalic").checked,
    outlineSize: Number($("#outlineSize").value),
    subtitleBg: Number($("#subtitleBg").value),
    wordsPerCaption: Number($("#wordsPerCaption").value),
    maxLines: Number($("#maxLines").value),
    letterSpacing: Number($("#letterSpacing").value),
    secondaryOutline: $("#secondaryOutline").value,
    chromaKey: $("#chromaKey").checked,
    watermarkOpacity: Number($("#watermarkOpacity").value),
    voiceVolume: Number($("#voiceVolume").value),
    voiceDelay: Number($("#voiceDelay").value),
    musicVolume: Number($("#musicVolume").value),
    waveformEnabled: $("#waveformEnabled").checked,
    waveformPosition: $("#waveformPosition").value,
    persistentTitle: $("#persistentTitle").checked,
    titleLine1: $("#titleLine1").value,
    titleLine2: $("#titleLine2").value,
    titleEffect: $("#titleEffect").value,
    titlePosition: $("#titlePosition").value,
  };
}
function applyCaptionStyle() {
  const s = effectSettings();
  caption.className = `caption fx-${s.textEffect} pos-${s.subtitlePosition}`;
  caption.style.fontFamily = s.fontFamily;
  caption.style.fontSize = `${Math.max(12, Math.round(s.fontSize / 3))}px`;
  caption.style.color = s.fontColor;
  caption.style.setProperty("--accent", s.accentColor);
  caption.style.display = s.subtitleEnabled && scenes.length ? "block" : "none";
}
document.querySelectorAll(".effect-grid input,.effect-grid select").forEach((control) =>
  control.addEventListener("input", applyCaptionStyle),
);
function ready() {
  const missing = [];
  if (!audio.src) missing.push("voice");
  if (!script.value.trim()) missing.push("lời thoại");
  if (!assets.length) missing.push("ảnh/video");
  const status = $("#matchStatus");
  status.textContent = missing.length
    ? `Còn thiếu: ${missing.join(", ")}.`
    : "Đã đủ dữ liệu — có thể bắt đầu ghép.";
  status.classList.toggle("ready", !missing.length);
  return !missing.length;
}
voice.onchange = () => {
  const f = voice.files[0];
  if (!f) return;
  audio.src = URL.createObjectURL(f);
  $("#voiceLabel").textContent = f.name;
  $("#outputName").textContent = `${f.name.replace(/\.[^.]+$/, "")}.mp4`;
  $("#voiceDrop").style.borderStyle = "solid";
  $("#whisperBtn").disabled = false;
  whisperChunks = [];
  ready();
};
script.oninput = () => {
  ready();
};
mediaInput.onchange = () => {
  for (const f of mediaInput.files) {
    assets.push({
      name: f.name,
      type: f.type.startsWith("video/") ? "video" : "image",
      url: URL.createObjectURL(f),
      file: f,
    });
  }
  $("#mediaCount").textContent = `${assets.length} file`;
  $("#mediaStrip").innerHTML = assets
    .map(
      (a) =>
        `<div class="thumb">${a.type === "image" ? `<img src="${a.url}">` : `<video src="${a.url}" muted>`}</div>`,
    )
    .join("");
  ready();
};
match.onclick = async () => {
  if (!ready()) {
    const status = $("#matchStatus");
    status.animate(
      [
        { transform: "translateX(-4px)" },
        { transform: "translateX(4px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 220 },
    );
    return;
  }
  match.disabled = true;
  match.textContent = "Đang chia lời và ghép cảnh…";
  try {
    const parts = script.value
        .split(/(?<=[.!?])\s+|\n+/)
        .map((x) => x.trim())
        .filter(Boolean),
      total = Number.isFinite(audio.duration)
        ? audio.duration
        : Math.max(12, parts.length * 5);
    if (whisperChunks.length) {
      scenes = whisperChunks.map((chunk, i) => ({
        id: i + 1,
        start: chunk.start,
        end: chunk.end,
        text: chunk.text,
        media: assets[i % assets.length],
      }));
    } else {
      const weights = parts.map((x) => Math.max(4, x.split(/\s+/).length)),
        sum = weights.reduce((a, b) => a + b, 0);
      let t = 0;
      scenes = parts.map((text, i) => {
        const len =
            i === parts.length - 1 ? total - t : (total * weights[i]) / sum,
          s = {
            id: i + 1,
            start: t,
            end: t + len,
            text,
            media: assets[i % assets.length],
          };
        t += len;
        return s;
      });
    }
    if (!scenes.length) throw new Error("Không tách được cảnh từ lời thoại");
    audio.pause();
    audio.currentTime = 0;
    renderTimeline();
    showScene(scenes[0]);
    $("#sceneCount").textContent =
      `${scenes.length} cảnh${whisperChunks.length ? " · Whisper" : ""}`;
    $("#totalTime").textContent = fmt(total);
    $("#playBtn").disabled = false;
    $("#exportBtn").disabled = false;
    $("#planBtn").disabled = false;
    try {
      await audio.play();
      const video = canvas.querySelector("video");
      if (video) void video.play();
      $("#playBtn").textContent = "Ⅱ";
      $("#matchStatus").textContent =
        `Đã ghép ${scenes.length} cảnh — preview đang phát.`;
    } catch {
      $("#playBtn").textContent = "▶";
      $("#matchStatus").textContent =
        `Đã ghép ${scenes.length} cảnh. Bấm nút ▶ để xem preview.`;
    }
    $("#matchStatus").className = "match-status ready";
  } catch (error) {
    $("#matchStatus").textContent = `Không thể ghép: ${error.message}`;
  } finally {
    match.disabled = false;
    match.innerHTML = "<span>✓</span> Ghép lại timeline";
  }
};
function renderTimeline(focusId = 1) {
  const focus = Math.max(0, focusId - 1);
  timelineWindowStart = Math.max(
    0,
    Math.min(Math.max(0, scenes.length - 40), focus - 8),
  );
  const visible = scenes.slice(timelineWindowStart, timelineWindowStart + 40);
  timeline.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const s of visible) {
    const button = document.createElement("button");
    button.className = "scene";
    button.dataset.id = s.id;
    const number = document.createElement("span");
    number.textContent = s.id;
    let media;
    if (s.media.type === "image") {
      media = document.createElement("img");
      media.src = s.media.url;
      media.loading = "lazy";
    } else {
      media = document.createElement("div");
      media.className = "video-chip";
      media.textContent = "VIDEO";
    }
    const copy = document.createElement("div"),
      time = document.createElement("strong"),
      text = document.createElement("p");
    time.textContent = `${fmt(s.start)}–${fmt(s.end)}`;
    text.textContent = s.text || "(Đoạn không có lời)";
    copy.append(time, text);
    button.append(number, media, copy);
    button.onclick = () => {
      audio.currentTime = s.start;
      showScene(s);
    };
    fragment.append(button);
  }
  timeline.append(fragment);
  const note = document.createElement("div");
  note.className = "window-note";
  note.textContent = `Đang hiển thị cảnh ${timelineWindowStart + 1}–${Math.min(scenes.length, timelineWindowStart + 40)} / ${scenes.length}`;
  timeline.append(note);
}
function showScene(s) {
  if (!s || !s.media) return;
  const current = canvas.querySelector("[data-preview-id]");
  if (current?.dataset.previewId !== String(s.id)) {
    canvas.querySelectorAll("img,video,.empty").forEach((x) => x.remove());
    const el = document.createElement(
      s.media.type === "image" ? "img" : "video",
    );
    el.src = s.media.url;
    el.dataset.previewId = s.id;
    if (el.tagName === "VIDEO") {
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      if (!audio.paused) void el.play();
    }
    canvas.prepend(el);
  }
  caption.textContent = s.text || "";
  applyCaptionStyle();
  if (!timeline.querySelector(`.scene[data-id="${s.id}"]`))
    renderTimeline(s.id);
  timeline
    .querySelectorAll(".scene")
    .forEach((x) => x.classList.toggle("active", +x.dataset.id === s.id));
}
audio.ontimeupdate = () => {
  const s =
    scenes.find(
      (x) => audio.currentTime >= x.start && audio.currentTime < x.end,
    ) || scenes.at(-1);
  if (
    s &&
    !timeline
      .querySelector(`.scene[data-id="${s.id}"]`)
      ?.classList.contains("active")
  )
    showScene(s);
  $("#currentTime").textContent = fmt(audio.currentTime);
  $("#progress").style.width =
    `${audio.duration ? (audio.currentTime / audio.duration) * 100 : 0}%`;
};
audio.onplaying = () => {
  $("#playBtn").textContent = "Ⅱ";
};
audio.onpause = () => {
  $("#playBtn").textContent = "▶";
};
audio.onended = () => {
  $("#playBtn").textContent = "▶";
};
audio.onerror = () => {
  $("#matchStatus").textContent =
    "Không đọc được file voice. Hãy đổi sang MP3, WAV hoặc M4A chuẩn.";
};
$("#playBtn").onclick = async () => {
  const video = canvas.querySelector("video");
  if (audio.paused) {
    await audio.play();
    if (video) void video.play();
    $("#playBtn").textContent = "Ⅱ";
  } else {
    audio.pause();
    if (video) video.pause();
    $("#playBtn").textContent = "▶";
  }
};
$("#whisperBtn").onclick = async () => {
  const button = $("#whisperBtn"),
    status = $("#whisperStatus");
  button.disabled = true;
  status.className = "whisper-status show";
  status.textContent =
    "Whisper đang nhận dạng voice. Lần đầu sẽ tải model khoảng 75 MB và có thể mất vài phút…";
  const form = new FormData();
  form.append("voice", voice.files[0]);
  try {
    const response = await fetch("/api/transcribe", {
        method: "POST",
        body: form,
      }),
      data = await response.json();
    if (!response.ok) throw new Error(data.error || "Không thể nhận dạng");
    whisperChunks = data.chunks || [];
    script.value = data.text || whisperChunks.map((x) => x.text).join(" ");
    status.textContent = `Đã tạo ${whisperChunks.length} đoạn có timestamp chính xác. Timeline sẽ ưu tiên các mốc Whisper.`;
    ready();
  } catch (error) {
    status.textContent = `Lỗi Whisper: ${error.message}`;
  } finally {
    button.disabled = false;
  }
};
$("#planBtn").onclick = () => {
  const data = {
      app: "MatchCut",
      version: 1,
      voice: voice.files[0]?.name,
      duration: audio.duration,
      scenes: scenes.map((s) => ({
        id: s.id,
        start: +s.start.toFixed(3),
        end: +s.end.toFixed(3),
        text: s.text,
        media: s.media.name,
      })),
    },
    url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "matchcut-project.json";
  a.click();
  URL.revokeObjectURL(url);
};
async function renderVideo() {
  const button = $("#exportBtn"),
    status = $("#renderStatus");
  button.disabled = true;
  status.className = "render-status show";
  status.textContent = `FFmpeg đang render. Video sẽ được lưu tại C:\\MatchCut\\Exports với tên “${voice.files[0]?.name.replace(/\.[^.]+$/, "")}.mp4”…`;
  const form = new FormData();
  form.append("voice", voice.files[0]);
  assets.forEach((a) => form.append("media", a.file));
  for (const [field, id] of [["intro","#introInput"],["outro","#outroInput"],["overlay","#overlayInput"],["watermark","#watermarkInput"],["music","#musicInput"]]) {
    const file = $(id).files[0];
    if (file) form.append(field, file);
  }
  form.append(
    "scenes",
    JSON.stringify(
      scenes.map((s) => ({
        start: s.start,
        end: s.end,
        mediaIndex: assets.indexOf(s.media),
        mediaType: s.media.type,
        text: s.text,
      })),
    ),
  );
  form.append("settings", JSON.stringify(effectSettings()));
  try {
    const response = await fetch("/api/render", { method: "POST", body: form }),
      data = await response.json();
    if (!response.ok) throw new Error(data.error || "Render thất bại");
    status.textContent = `Đã lưu video: ${data.savedPath}`;
    status.className = "render-status show success";
  } catch (error) {
    status.textContent = `Lỗi render: ${error.message}`;
  } finally {
    button.disabled = false;
  }
}
$("#exportBtn").onclick = renderVideo;
