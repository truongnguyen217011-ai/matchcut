import test from "node:test";
import assert from "node:assert/strict";
import { mergeDialogueDrafts, restoreDialogueRevision, saveDialogueDraft } from "../dist/dialogue-drafts.js";

test("keeps drafts separate per profile", () => {
  let drafts = saveDialogueDraft({}, "k1", "Lời thoại K1", { now:"2026-09-12T01:00:00Z" });
  drafts = saveDialogueDraft(drafts, "k2", "Lời thoại K2", { now:"2026-09-12T01:01:00Z" });
  assert.equal(drafts.k1.text, "Lời thoại K1");
  assert.equal(drafts.k2.text, "Lời thoại K2");
});

test("snapshots the previous draft before Whisper replaces it", () => {
  let drafts = saveDialogueDraft({}, "k1", "Bản người dùng", { now:"2026-09-12T01:00:00Z" });
  drafts = saveDialogueDraft(drafts, "k1", "Bản Whisper", { snapshot:true, reason:"before-whisper", now:"2026-09-12T01:02:00Z" });
  assert.equal(drafts.k1.text, "Bản Whisper");
  assert.deepEqual(drafts.k1.revisions[0], { text:"Bản người dùng", savedAt:"2026-09-12T01:02:00Z", reason:"before-whisper" });
  const restored = restoreDialogueRevision(drafts, "k1", { now:"2026-09-12T01:03:00Z" });
  assert.equal(restored.text, "Bản người dùng");
  assert.equal(restored.drafts.k1.revisions[0].text, "Bản Whisper");
});

test("merges local and machine copies by the newest timestamp", () => {
  const local = saveDialogueDraft({}, "k1", "local mới", { now:"2026-09-12T02:00:00Z" });
  const remote = saveDialogueDraft({}, "k1", "server cũ", { now:"2026-09-12T01:00:00Z" });
  const remoteOnly = saveDialogueDraft(remote, "k2", "server K2", { now:"2026-09-12T01:30:00Z" });
  const merged = mergeDialogueDrafts(local, remoteOnly);
  assert.equal(merged.k1.text, "local mới");
  assert.equal(merged.k2.text, "server K2");
});
