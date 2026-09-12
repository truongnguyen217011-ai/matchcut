import { openAsBlob } from "node:fs";
import path from "node:path";

const [voicePath, ...folders] = process.argv.slice(2);
if (!voicePath || !folders.length) throw new Error("Dùng: node scripts/benchmark_job.mjs <voice> <folder...>");
const origin = process.env.MATCHCUT_URL || "http://localhost:4173";
const folderResponse = await fetch(`${origin}/api/media-folders`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ folders }),
});
const folderData = await folderResponse.json();
if (!folderResponse.ok || !folderData.files?.length) throw new Error(folderData.error || "Không quét được footage.");
const state = await (await fetch(`${origin}/api/project-state`)).json();
const profileId = state.activeProfile;
const settings = { ...(state.profiles?.[profileId] || {}), fastRender: true };
const selectionMode = process.env.MATCHCUT_BENCHMARK_SELECTION || settings.mediaSelectionMode || "shuffle";
const startedAt = new Date().toISOString();
const form = new FormData();
form.append("voice", await openAsBlob(voicePath), path.basename(voicePath));
form.append("assets", JSON.stringify(folderData.files.map((file) => ({ ...file, uploadIndex: null }))));
form.append("settings", JSON.stringify(settings));
form.append("selectionMode", selectionMode);
form.append("profileId", profileId || "");
form.append("startedAt", startedAt);
const response = await fetch(`${origin}/api/jobs`, { method: "POST", body: form });
const job = await response.json();
if (!response.ok) throw new Error(job.error || "Không tạo được benchmark job.");
console.log(JSON.stringify({ id: job.id, footage: folderData.files.length, profileId, selectionMode, startedAt }));
