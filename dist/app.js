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
  timelineWindowStart = 0,
  activeVoiceFile = null;
const fmt = (n) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;
function effectSettings() {
  return {
    fontFamily: $("#fontFamily").value,
    fontSizePercent: Number($("#fontSizePercent").value),
    textEffect: $("#textEffect").value,
    transition: $("#transition").value,
    fontColor: $("#fontColor").value,
    accentColor: $("#accentColor").value,
    subtitlePosition: $("#subtitlePosition").value,
    subtitleX: Number($("#subtitleX").value),
    subtitleY: Number($("#subtitleY").value),
    subtitleEnabled: $("#subtitleEnabled").checked,
    profileName: $("#profileName").value,
    aspectRatio: $("#aspectRatio").value,
    language: $("#language").value,
    poolMode: $("#poolMode").checked,
    fontBold: $("#fontBold").checked,
    fontItalic: $("#fontItalic").checked,
    outlineSize: Number($("#outlineSize").value),
    subtitleBg: Number($("#subtitleBg").value),
    backgroundDarkness: Number($("#backgroundDarkness").value),
    wordsPerCaption: Number($("#wordsPerCaption").value),
    maxLines: Number($("#maxLines").value),
    letterSpacing: Number($("#letterSpacing").value),
    secondaryOutline: $("#secondaryOutline").value,
    chromaKey: $("#chromaKey").checked,
    watermarkOpacity: Number($("#watermarkOpacity").value),
    watermarkRotate: $("#watermarkRotate").checked,
    watermarkRotationSpeed: Number($("#watermarkRotationSpeed").value),
    overlayImageEnabled: $("#overlayImageEnabled").checked,
    overlayImageFolder: $("#overlayImageFolder").value,
    overlayImageOpacity: Number($("#overlayImageOpacity").value),
    voiceVolume: Number($("#voiceVolume").value),
    voiceDelay: Number($("#voiceDelay").value),
    musicVolume: Number($("#musicVolume").value),
    waveformEnabled: $("#waveformEnabled").checked,
    waveformColor: $("#waveformColor").value,
    waveformY: Number($("#waveformY").value),
    voiceWaveformEnabled: $("#voiceWaveformEnabled").checked,
    voiceWaveformColor: $("#voiceWaveformColor").value,
    voiceWaveformY: Number($("#voiceWaveformY").value),
    waveformX: Number($("#waveformX").value),
    voiceWaveformX: Number($("#voiceWaveformX").value),
    waveformWidth: Number($("#waveformWidth").value),
    waveformHeight: Number($("#waveformHeight").value),
    persistentTitle: $("#persistentTitle").checked,
    titleLine1: $("#titleLine1").value,
    titleLine2: $("#titleLine2").value,
    titleEffect: $("#titleEffect").value,
    titlePosition: $("#titlePosition").value,
    mediaSelectionMode: $("#mediaSelectionMode").value,
    folderPaths: $("#folderPaths").value,
    autoRenderOnMatch: $("#autoRenderOnMatch").checked,
  };
}
function applyCaptionStyle() {
  const s = effectSettings();
  caption.className = `caption fx-${s.textEffect} pos-${s.subtitlePosition}`;
  caption.style.fontFamily = s.fontFamily;
  caption.style.fontSize = `${Math.max(12, Math.round(19 * s.fontSizePercent / 100))}px`;
  caption.style.color = s.fontColor;
  caption.style.setProperty("--accent", s.accentColor);
  caption.style.left = `${s.subtitleX}%`; caption.style.right = "auto"; caption.style.top = `${s.subtitleY}%`; caption.style.bottom = "auto"; caption.style.width = "84%"; caption.style.transform = "translate(-50%,-50%)";
  caption.style.display = s.subtitleEnabled && scenes.length ? "block" : "none";
  $("#backgroundDarknessValue").textContent = `${s.backgroundDarkness}%`;
  $("#watermarkRotationSpeedValue").textContent = `${s.watermarkRotationSpeed}°/giây`;
  $("#overlayImageOpacityValue").textContent = `${s.overlayImageOpacity}%`;
  updateWaveformPreview(s);
  canvas.querySelectorAll(":scope > img,:scope > video").forEach((media) => media.style.filter = `brightness(${100 - s.backgroundDarkness}%)`);
  $("#positionStage").style.setProperty("--preview-darkness", String(s.backgroundDarkness / 100));
  updatePositionPreview(s);
  updateEffectInspector(s);
}
const TEXT_EFFECT_INFO = {
  none: ["Không hiệu ứng", "Phụ đề xuất hiện ngay, rõ ràng và nhẹ máy."],
  fade: ["Mờ dần hiện lên", "Chữ tăng dần độ rõ, phù hợp video kể chuyện nhẹ nhàng."],
  pop: ["Nảy Pop", "Chữ bật nhanh từ nhỏ đến đủ cỡ, tạo cảm giác năng động."],
  karaoke: ["Karaoke tô từng từ", "Từng từ đổi sang màu nhấn theo nhịp lời thoại."],
  typewriter: ["Gõ máy từng chữ", "Các ký tự lần lượt xuất hiện như đang được đánh máy."],
  "slide-up": ["Trượt từ dưới lên", "Cụm chữ đi từ dưới lên rồi dừng ở vị trí phụ đề."],
  "zoom-in": ["Phóng lớn vào", "Chữ phóng từ tâm ra kích thước chuẩn."],
  bounce: ["Nảy đàn hồi", "Chữ phóng quá cỡ rồi thu lại tạo nhịp nảy."],
  glow: ["Phát sáng", "Viền chữ phát sáng bằng màu nhấn đã chọn."],
  shake: ["Rung nhấn mạnh", "Chữ rung ngắn khi xuất hiện để nhấn câu quan trọng."],
};
const TRANSITION_INFO = {
  random: ["Random thông minh", "Mỗi cảnh tự chọn một hiệu ứng khác và tránh lặp kiểu vừa dùng."],
  none: ["Cắt thẳng", "Đổi cảnh tức thì, nhanh và dứt khoát."],
  fade: ["Mờ dần", "Cảnh mới hiện dần từ nền tối."],
  "cinematic-fade": ["Fade điện ảnh", "Mở cảnh chậm từ màu đen với độ tương phản điện ảnh."],
  "zoom-in": ["Zoom tiến", "Ảnh tiến chậm vào chủ thể theo phong cách Ken Burns."],
  "zoom-out": ["Zoom lùi", "Ảnh lùi chậm để dần hé lộ toàn bộ khung cảnh."],
  "cross-zoom": ["Cross Zoom mạnh", "Khung hình lao nhanh vào tâm rồi ổn định, phù hợp điểm chuyển cao trào."],
  "slide-left": ["Trượt sang trái", "Khung hình dịch chuyển từ phải sang trái."],
  "slide-right": ["Trượt sang phải", "Khung hình dịch chuyển từ trái sang phải."],
  "pan-up": ["Quét từ dưới lên", "Máy quay ảo di chuyển dọc lên trên."],
  "pan-down": ["Quét từ trên xuống", "Máy quay ảo di chuyển dọc xuống dưới."],
  "diagonal-up": ["Quét chéo lên", "Máy quay ảo lướt chéo từ góc dưới lên góc trên."],
  "diagonal-down": ["Quét chéo xuống", "Máy quay ảo lướt chéo từ góc trên xuống góc dưới."],
  "rotate-in": ["Xoay điện ảnh", "Cảnh nghiêng nhẹ rồi xoay về thẳng, tạo cảm giác có chiều sâu."],
  "shake-cut": ["Rung máy chuyển cảnh", "Khung hình rung nhanh rồi ổn định, hợp video mạnh và kịch tính."],
  flash: ["Chớp sáng", "Một chớp trắng ngắn mở cảnh, hợp đoạn cao trào."],
};
function updateEffectInspector(s = effectSettings()) {
  const textInfo = TEXT_EFFECT_INFO[s.textEffect] || TEXT_EFFECT_INFO.none;
  const transitionInfo = TRANSITION_INFO[s.transition] || TRANSITION_INFO.none;
  const textPreview = $("#textEffectPreview"), transitionPreview = $("#transitionPreview");
  $("#fontSizeValue").textContent = `${s.fontSizePercent}%`;
  $("#textEffectName").textContent = textInfo[0]; $("#textEffectDescription").textContent = textInfo[1];
  $("#transitionName").textContent = transitionInfo[0]; $("#transitionDescription").textContent = transitionInfo[1];
  textPreview.style.fontFamily = s.fontFamily; textPreview.style.fontSize = `${Math.max(13, 20 * s.fontSizePercent / 100)}px`; textPreview.style.color = s.fontColor; textPreview.style.setProperty("--accent", s.accentColor);
  textPreview.className = ""; transitionPreview.className = "transition-demo";
  void textPreview.offsetWidth;
  const randomPreviews = ["fade","cross-zoom","slide-left","diagonal-up","rotate-in","flash"];
  const previewTransition = s.transition === "random" ? randomPreviews[Math.floor(Date.now() / 1800) % randomPreviews.length] : s.transition;
  textPreview.className = `fx-${s.textEffect}`; transitionPreview.classList.add(`tr-${previewTransition}`);
}
document.querySelectorAll(".effect-grid input,.effect-grid select").forEach((control) =>
  control.addEventListener("input", applyCaptionStyle),
);
$("#watermarkRotationSpeed").addEventListener("input", applyCaptionStyle);
$("#overlayImageOpacity").addEventListener("input", applyCaptionStyle);
function updateWaveformPreview(s = effectSettings()) {
  $("#waveformYValue").textContent = `${s.waveformY}%`; $("#voiceWaveformYValue").textContent = `${s.voiceWaveformY}%`; $("#waveformXValue").textContent = `${s.waveformX}%`; $("#voiceWaveformXValue").textContent = `${s.voiceWaveformX}%`; $("#waveformWidthValue").textContent = `${s.waveformWidth}%`; $("#waveformHeightValue").textContent = `${s.waveformHeight}px`;
  for (const [element,enabled,color,x,y] of [[$("#musicWavePreview"),s.waveformEnabled,s.waveformColor,s.waveformX,s.waveformY],[$("#voiceWavePreview"),s.voiceWaveformEnabled,s.voiceWaveformColor,s.voiceWaveformX,s.voiceWaveformY]]) { element.style.display = enabled ? "block" : "none"; element.style.setProperty("--wave-color",color); element.style.left = `${x}%`; element.style.top = `${y}%`; element.style.width = `${s.waveformWidth}%`; element.style.height = `${Math.max(8,s.waveformHeight / 8)}px`; }
}
document.querySelectorAll("#waveformEnabled,#waveformColor,#waveformY,#voiceWaveformEnabled,#voiceWaveformColor,#voiceWaveformY,#waveformX,#voiceWaveformX,#waveformWidth,#waveformHeight").forEach((control) => control.addEventListener("input", applyCaptionStyle));
const waveformPreview = $("#waveformPreview"); let draggedWave = null;
function moveWave(event) { if (!draggedWave) return; const rect = waveformPreview.getBoundingClientRect(), x = Math.round(Math.max(5,Math.min(95,(event.clientX-rect.left)/rect.width*100))), y = Math.round(Math.max(5,Math.min(95,(event.clientY-rect.top)/rect.height*100))), prefix = draggedWave === "music" ? "waveform" : "voiceWaveform"; $("#"+prefix+"X").value=x; $("#"+prefix+"Y").value=y; applyCaptionStyle(); }
waveformPreview.addEventListener("pointerdown", (event) => { draggedWave = event.target.dataset.wave || ($("#waveformEnabled").checked ? "music" : "voice"); waveformPreview.setPointerCapture(event.pointerId); moveWave(event); });
waveformPreview.addEventListener("pointermove", (event) => { if (waveformPreview.hasPointerCapture(event.pointerId)) moveWave(event); }); waveformPreview.addEventListener("pointerup", () => { draggedWave=null; });
const POSITION_PRESETS = {"top-left":[18,15],top:[50,15],"top-right":[82,15],"middle-left":[18,50],middle:[50,50],"middle-right":[82,50],"bottom-left":[18,85],bottom:[50,85],"bottom-right":[82,85]};
function updatePositionPreview(s = effectSettings()) {
  $("#subtitleXValue").textContent = `${s.subtitleX}%`; $("#subtitleYValue").textContent = `${s.subtitleY}%`;
  const marker = $("#positionMarker"); marker.style.left = `${s.subtitleX}%`; marker.style.top = `${s.subtitleY}%`; marker.style.fontFamily = s.fontFamily; marker.style.color = s.fontColor; marker.style.borderColor = s.accentColor;
}
$("#subtitlePosition").addEventListener("change", (event) => { const point = POSITION_PRESETS[event.target.value]; if (point) { $("#subtitleX").value = point[0]; $("#subtitleY").value = point[1]; } applyCaptionStyle(); });
for (const id of ["subtitleX","subtitleY"]) $("#" + id).addEventListener("input", () => { $("#subtitlePosition").value = "custom"; applyCaptionStyle(); });
$("#accentSwatches").querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { $("#accentColor").value = button.dataset.color; applyCaptionStyle(); }));
const positionStage = $("#positionStage");
function moveSubtitle(event) { const rect = positionStage.getBoundingClientRect(); $("#subtitleX").value = Math.round(Math.max(5, Math.min(95, (event.clientX - rect.left) / rect.width * 100))); $("#subtitleY").value = Math.round(Math.max(5, Math.min(95, (event.clientY - rect.top) / rect.height * 100))); $("#subtitlePosition").value = "custom"; applyCaptionStyle(); }
positionStage.addEventListener("pointerdown", (event) => { positionStage.setPointerCapture(event.pointerId); moveSubtitle(event); });
positionStage.addEventListener("pointermove", (event) => { if (positionStage.hasPointerCapture(event.pointerId)) moveSubtitle(event); });
const PROFILE_KEY = "matchcut.channelProfiles.v2";
const PROFILE_FIELDS = ["fontFamily","fontSizePercent","textEffect","transition","fontColor","accentColor","subtitlePosition","subtitleX","subtitleY","subtitleEnabled","profileName","aspectRatio","language","poolMode","fontBold","fontItalic","outlineSize","subtitleBg","backgroundDarkness","wordsPerCaption","maxLines","letterSpacing","secondaryOutline","chromaKey","watermarkOpacity","watermarkRotate","watermarkRotationSpeed","overlayImageEnabled","overlayImageFolder","overlayImageOpacity","voiceVolume","voiceDelay","musicVolume","waveformEnabled","waveformColor","waveformY","voiceWaveformEnabled","voiceWaveformColor","voiceWaveformY","waveformX","voiceWaveformX","waveformWidth","waveformHeight","persistentTitle","titleLine1","titleLine2","titleEffect","titlePosition","mediaSelectionMode","folderPaths","autoRenderOnMatch"];
let profiles = {};
try { profiles = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"); } catch { profiles = {}; }
if (!Object.keys(profiles).length) profiles.default = { ...effectSettings(), profileName: "Kênh mặc định" };
let activeProfile = localStorage.getItem(`${PROFILE_KEY}.active`) || Object.keys(profiles)[0];
function persistProfiles() { localStorage.setItem(PROFILE_KEY, JSON.stringify(profiles)); localStorage.setItem(`${PROFILE_KEY}.active`, activeProfile); }
function renderProfileSelect() { const select = $("#profileSelect"); select.innerHTML = Object.entries(profiles).map(([id,p]) => `<option value="${id}">${p.profileName || "Chưa đặt tên"}</option>`).join(""); select.value = activeProfile; }
function loadProfile(id) { const profile = profiles[id]; if (!profile) return; activeProfile = id; if (profile.fontSizePercent === undefined && profile.fontSize !== undefined) profile.fontSizePercent = Math.round(Number(profile.fontSize) / 56 * 100); if (profile.transition === "zoom") profile.transition = "zoom-in"; if (profile.transition === "slide") profile.transition = "slide-left"; if (profile.subtitleX === undefined || profile.subtitleY === undefined) { const point = POSITION_PRESETS[profile.subtitlePosition] || POSITION_PRESETS.bottom; profile.subtitleX = point[0]; profile.subtitleY = point[1]; } for (const key of PROFILE_FIELDS) { const control = $(`#${key}`); if (!control || profile[key] === undefined) continue; if (control.type === "checkbox") control.checked = Boolean(profile[key]); else control.value = profile[key]; } persistProfiles(); renderProfileSelect(); applyCaptionStyle(); $("#profileStatus").textContent = `Đã nạp “${profile.profileName}”.`; }
function snapshotProfile() { const settings = effectSettings(); return Object.fromEntries(PROFILE_FIELDS.map((key) => [key, settings[key]])); }
$("#profileSelect").onchange = (event) => loadProfile(event.target.value);
$("#renameProfile").onclick = () => {
  const current = profiles[activeProfile]?.profileName || $("#profileName").value || "Kênh";
  const next = window.prompt("Nhập tên mới cho cấu hình kênh:", current)?.trim();
  if (!next || next === current) return;
  profiles[activeProfile] = { ...profiles[activeProfile], profileName: next };
  $("#profileName").value = next;
  persistProfiles(); renderProfileSelect();
  $("#profileStatus").textContent = `Đã đổi tên “${current}” thành “${next}”.`;
};
$("#saveProfile").onclick = () => { const name = $("#profileName").value.trim() || "Kênh chưa đặt tên"; profiles[activeProfile] = { ...snapshotProfile(), profileName: name }; persistProfiles(); renderProfileSelect(); $("#profileStatus").textContent = `Đã lưu cấu hình “${name}” trên máy.`; };
$("#newProfile").onclick = () => { activeProfile = `channel-${Date.now()}`; profiles[activeProfile] = { ...snapshotProfile(), profileName: `Kênh ${Object.keys(profiles).length + 1}` }; loadProfile(activeProfile); $("#profileName").focus(); $("#profileName").select(); };
$("#cloneProfile").onclick = () => { const source = profiles[activeProfile] || snapshotProfile(); activeProfile = `channel-${Date.now()}`; profiles[activeProfile] = { ...source, profileName: `${source.profileName || "Kênh"} - Bản sao` }; loadProfile(activeProfile); };
$("#deleteProfile").onclick = () => { if (Object.keys(profiles).length === 1) { $("#profileStatus").textContent = "Phải giữ lại ít nhất một cấu hình kênh."; return; } const oldName = profiles[activeProfile]?.profileName; delete profiles[activeProfile]; activeProfile = Object.keys(profiles)[0]; persistProfiles(); renderProfileSelect(); loadProfile(activeProfile); $("#profileStatus").textContent = `Đã xóa “${oldName}”.`; };
renderProfileSelect();
loadProfile(activeProfile);
function mediaPlan(count) {
  if (!assets.length) return [];
  const mode = $("#mediaSelectionMode").value;
  const candidates = assets.map((_, index) => index);
  if (mode !== "sequential") for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  if (mode === "sequential") return Array.from({ length: count }, (_, index) => candidates[index % candidates.length]);
  if (mode === "random") return Array.from({ length: count }, () => candidates[Math.floor(Math.random() * candidates.length)]);
  const result = [], bag = [];
  while (result.length < count) {
    if (!bag.length) {
      bag.push(...candidates);
      for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      if (result.length && bag.length > 1 && bag[0] === result.at(-1)) [bag[0], bag[1]] = [bag[1], bag[0]];
    }
    result.push(bag.shift());
  }
  return result;
}
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
function setActiveVoice(f) {
  if (!f) return;
  activeVoiceFile = f;
  audio.src = URL.createObjectURL(f);
  $("#voiceLabel").textContent = f.name;
  $("#outputName").textContent = `${f.name.replace(/\.[^.]+$/, "")}.mp4`;
  $("#voiceDrop").style.borderStyle = "solid";
  $("#whisperBtn").disabled = false;
  whisperChunks = [];
  ready();
  updateBatchButtons();
}
voice.onchange = () => {
  const incoming = [...voice.files];
  for (const file of incoming) {
    if (!batchFiles.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) batchFiles.push({ file, selected: true, status: "Chờ chạy" });
  }
  setActiveVoice(incoming[0]);
  renderBatchList();
  if (incoming.length) batchLog(`Đã thêm ${incoming.length} voice từ bước 01.`);
};
script.oninput = () => {
  ready();
};
function addMediaFiles(files) {
  for (const f of files) {
    if (assets.some((asset) => asset.file && asset.name === f.name && asset.file.size === f.size && asset.file.lastModified === f.lastModified)) continue;
    assets.push({
      name: f.name,
      type: f.type.startsWith("video/") ? "video" : "image",
      url: null,
      file: f,
    });
  }
  $("#mediaCount").textContent = `${assets.length} file`;
  const previewAssets = assets.filter((asset) => asset.file).slice(0, 24);
  for (const asset of previewAssets) asset.url ||= URL.createObjectURL(asset.file);
  $("#mediaStrip").innerHTML = previewAssets
    .map(
      (a) =>
        `<div class="thumb">${a.type === "image" ? `<img src="${a.url}">` : `<video src="${a.url}" muted>`}</div>`,
    )
    .join("") + `<div class="media-summary">${assets.length > 24 ? `Đang ẩn ${assets.length - 24} thumbnail để tiết kiệm bộ nhớ` : "Kho tư liệu đã sẵn sàng"}</div>`;
  ready();
  updateBatchButtons();
}
mediaInput.onchange = () => addMediaFiles(mediaInput.files);
async function scanFolders() {
  const folders = $("#folderPaths").value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (!folders.length) { $("#folderList").textContent = "Hãy chọn folder hoặc dán ít nhất một đường dẫn."; return; }
  $("#folderList").textContent = "Đang quét trực tiếp trên ổ đĩa…";
  try {
    const response = await fetch("/api/media-folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folders }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không thể quét folder");
    assets = assets.filter((asset) => asset.file);
    for (const item of result.files) assets.push({ ...item, file: null, url: null });
    $("#mediaCount").textContent = `${assets.length} file`;
    $("#folderList").innerHTML = result.folders.map((folder) => `<div><strong>▣ ${folder}</strong></div>`).join("") + `<span>${result.files.length.toLocaleString("vi-VN")} file được lập chỉ mục, không tải vào trình duyệt.</span>`;
    $("#mediaStrip").innerHTML = `<div class="media-summary">Kho cục bộ sẵn sàng: ${result.files.length.toLocaleString("vi-VN")} file · FFmpeg sẽ đọc trực tiếp khi render</div>`;
    ready(); updateBatchButtons();
  } catch (error) { $("#folderList").textContent = `Lỗi: ${error.message}`; }
}
$("#addFolders").onclick = scanFolders;
$("#pickFolder").onclick = async () => {
  const button = $("#pickFolder"); button.disabled = true; button.textContent = "Hộp thoại đang mở phía trước…"; $("#folderList").textContent = "Chọn một folder trong cửa sổ Windows vừa mở, hoặc bấm Cancel để quay lại.";
  try {
    const response = await fetch("/api/pick-folder", { method: "POST" }), result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không mở được cửa sổ chọn folder");
    if (result.folder) {
      const paths = $("#folderPaths"), current = paths.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      if (!current.includes(result.folder)) current.push(result.folder);
      paths.value = current.join("\n");
      await scanFolders();
    }
  } catch (error) { $("#folderList").textContent = `Lỗi: ${error.message}`; }
  finally { button.disabled = false; button.textContent = "▣ Chọn folder từ máy"; }
};
$("#pickOverlayImageFolder").onclick = async () => {
  const button = $("#pickOverlayImageFolder"), status = $("#overlayImageStatus"); button.disabled = true; button.textContent = "Đang mở…"; status.textContent = "Hãy chọn folder chứa ảnh PNG/WebP trong cửa sổ Windows.";
  try {
    const response = await fetch("/api/pick-folder", { method: "POST" }), result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không mở được cửa sổ chọn folder");
    if (result.folder) { $("#overlayImageFolder").value = result.folder; $("#overlayImageEnabled").checked = true; status.textContent = `Đã chọn: ${result.folder}. Mỗi video sẽ lấy ngẫu nhiên một ảnh lớp phủ.`; }
  } catch (error) { status.textContent = `Lỗi: ${error.message}`; }
  finally { button.disabled = false; button.textContent = "Chọn folder"; }
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
    const chosenMedia = mediaPlan(whisperChunks.length || parts.length);
    if (whisperChunks.length) {
      scenes = whisperChunks.map((chunk, i) => ({
        id: i + 1,
        start: chunk.start,
        end: chunk.end,
        text: chunk.text,
        media: assets[chosenMedia[i]],
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
            media: assets[chosenMedia[i]],
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
    if ($("#autoRenderOnMatch").checked) {
      $("#matchStatus").textContent = `Đã ghép ${scenes.length} cảnh. FFmpeg đang tự render và lưu MP4…`;
      await renderVideo();
      if ($("#renderStatus").classList.contains("success")) $("#matchStatus").textContent = `Hoàn tất ${scenes.length} cảnh và đã tự lưu MP4.`;
    }
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
    if (s.media.type === "image" && s.media.file) {
      media = document.createElement("img");
      media.src = s.media.url;
      media.loading = "lazy";
    } else {
      media = document.createElement("div");
      media.className = "video-chip";
      media.textContent = s.media.file ? "VIDEO" : "LOCAL";
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
  if (!s.media.file) {
    canvas.querySelectorAll("img,video,.empty").forEach((x) => x.remove());
    const local = document.createElement("div"); local.className = "empty"; local.dataset.previewId = s.id; local.innerHTML = `<b>▣</b><strong>File cục bộ</strong><span>${s.media.name}</span>`; canvas.prepend(local);
    caption.textContent = s.text || ""; applyCaptionStyle(); return;
  }
  s.media.url ||= URL.createObjectURL(s.media.file);
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
  form.append("voice", activeVoiceFile);
  form.append("language", $("#language").value);
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
      voice: activeVoiceFile?.name,
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
  status.textContent = `FFmpeg đang render. Video sẽ được lưu tại C:\\MatchCut\\Exports với tên “${activeVoiceFile?.name.replace(/\.[^.]+$/, "")}.mp4”…`;
  const form = new FormData();
  form.append("voice", activeVoiceFile);
  const compact = appendUsedMedia(form, scenes);
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
        mediaIndex: compact.indexByAsset.get(s.media),
        mediaPath: s.media.localPath || null,
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

function appendUsedMedia(form, sceneList) {
  const indexByAsset = new Map();
  for (const scene of sceneList) {
    if (scene.media.file && !indexByAsset.has(scene.media)) {
      indexByAsset.set(scene.media, indexByAsset.size);
      form.append("media", scene.media.file);
    }
  }
  return { indexByAsset };
}

let batchFiles = [], batchRunning = false, batchStopRequested = false;
const batchLog = (message) => { const box = $("#batchLog"); box.textContent += `\n[${new Date().toLocaleTimeString("vi-VN")}] ${message}`; box.scrollTop = box.scrollHeight; };
function renderBatchList() {
  const list = $("#batchList");
  list.innerHTML = batchFiles.length ? batchFiles.map((item,index) => `<label class="batch-row ${item.file === activeVoiceFile ? "active" : ""}"><input type="checkbox" data-batch-index="${index}" ${item.selected ? "checked" : ""}><button type="button" class="batch-open" data-open-index="${index}">${item.file.name}</button><em>${item.status}</em></label>`).join("") : '<div class="batch-empty">Thêm voice ở bước 01 phía trên để tạo hàng đợi.</div>';
  list.querySelectorAll("input").forEach((input) => input.onchange = () => { batchFiles[Number(input.dataset.batchIndex)].selected = input.checked; updateBatchButtons(); });
  list.querySelectorAll(".batch-open").forEach((button) => button.onclick = () => { setActiveVoice(batchFiles[Number(button.dataset.openIndex)].file); renderBatchList(); batchLog(`Đã đưa ${activeVoiceFile.name} lên trình biên tập.`); window.scrollTo({ top: 0, behavior: "smooth" }); });
  updateBatchButtons();
}
function updateBatchButtons() { const count = batchFiles.filter((item) => item.selected).length; $("#batchCounter").textContent = `${batchFiles.filter((item) => item.status === "Hoàn tất").length}/${count}`; $("#runSingle").disabled = batchRunning || !count || !assets.length; $("#runBatch").disabled = batchRunning || !count || !assets.length; $("#stopBatch").disabled = !batchRunning; }
$("#selectAllBatch").onclick = () => { batchFiles.forEach((item) => item.selected = true); renderBatchList(); };
$("#unselectAllBatch").onclick = () => { batchFiles.forEach((item) => item.selected = false); renderBatchList(); };
$("#clearBatch").onclick = () => { if (batchRunning) return; batchFiles = []; renderBatchList(); batchLog("Đã làm trống hàng đợi."); };
$("#stopBatch").onclick = () => { batchStopRequested = true; batchLog("Đã yêu cầu dừng. File hiện tại sẽ hoàn tất rồi hàng đợi dừng lại."); };
async function processBatchItem(item) {
  item.status = "Tạo timestamp"; renderBatchList(); batchLog(`Đang nhận dạng: ${item.file.name}`);
  const transcribeForm = new FormData(); transcribeForm.append("voice", item.file); transcribeForm.append("language", $("#language").value);
  const transcribeResponse = await fetch("/api/transcribe", { method: "POST", body: transcribeForm });
  const transcript = await transcribeResponse.json(); if (!transcribeResponse.ok) throw new Error(transcript.error || "Whisper thất bại");
  const chunks = transcript.chunks || []; if (!chunks.length) throw new Error("Không tạo được timestamp từ voice");
  item.status = "Đang render"; renderBatchList(); batchLog(`Đang render ${chunks.length} cảnh: ${item.file.name}`);
  const chosenMedia = mediaPlan(chunks.length);
  const renderForm = new FormData(); renderForm.append("voice", item.file);
  for (const [field,id] of [["intro","#introInput"],["outro","#outroInput"],["overlay","#overlayInput"],["watermark","#watermarkInput"],["music","#musicInput"]]) { const file = $(id).files[0]; if (file) renderForm.append(field,file); }
  const batchScenes = chunks.map((chunk,index) => ({ start:chunk.start, end:chunk.end, text:chunk.text, media:assets[chosenMedia[index]] }));
  const compact = appendUsedMedia(renderForm, batchScenes);
  renderForm.append("scenes", JSON.stringify(batchScenes.map((scene) => ({ start:scene.start, end:scene.end, text:scene.text, mediaIndex:compact.indexByAsset.get(scene.media), mediaPath:scene.media.localPath || null, mediaType:scene.media.type }))));
  renderForm.append("settings", JSON.stringify(effectSettings()));
  const renderResponse = await fetch("/api/render", { method:"POST", body:renderForm }); const result = await renderResponse.json(); if (!renderResponse.ok) throw new Error(result.error || "Render thất bại");
  item.status = "Hoàn tất"; renderBatchList(); batchLog(`✓ Xong: ${result.fileName}${result.overlayImage ? ` · Lớp phủ: ${result.overlayImage}` : ""} → ${result.savedPath}`);
}
async function runBatch(items) { if (batchRunning) return; if (!assets.length) { batchLog("Thiếu kho tư liệu. Hãy thêm ảnh/video trước khi chạy."); return; } batchRunning = true; batchStopRequested = false; updateBatchButtons(); for (const item of items) { if (batchStopRequested) break; try { await processBatchItem(item); } catch (error) { item.status = "Lỗi"; renderBatchList(); batchLog(`✕ ${item.file.name}: ${error.message}`); } } batchRunning = false; updateBatchButtons(); batchLog(batchStopRequested ? "Đã dừng hàng đợi." : "Đã xử lý xong hàng đợi."); }
$("#runSingle").onclick = () => { const item = batchFiles.find((entry) => entry.selected); if (item) void runBatch([item]); };
$("#runBatch").onclick = () => void runBatch(batchFiles.filter((item) => item.selected));
renderBatchList();
