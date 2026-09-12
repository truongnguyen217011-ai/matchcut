const MAX_REVISIONS = 10;

export function normalizeDialogueDrafts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([profileId, draft]) => {
    if (!draft || typeof draft !== "object") return [];
    const revisions = Array.isArray(draft.revisions) ? draft.revisions
      .filter((entry) => entry && typeof entry.text === "string")
      .slice(0, MAX_REVISIONS)
      .map((entry) => ({ text:entry.text, savedAt:entry.savedAt || null, reason:entry.reason || "autosave" })) : [];
    return [[profileId, { text:typeof draft.text === "string" ? draft.text : "", updatedAt:draft.updatedAt || null, revisions }]];
  }));
}

export function saveDialogueDraft(drafts, profileId, text, options = {}) {
  const result = normalizeDialogueDrafts(drafts);
  if (!profileId) return result;
  const previous = result[profileId] || { text:"", updatedAt:null, revisions:[] };
  let revisions = previous.revisions;
  if (options.snapshot && previous.text && previous.text !== text) {
    revisions = [{ text:previous.text, savedAt:options.now || new Date().toISOString(), reason:options.reason || "manual" }, ...revisions]
      .filter((entry, index, all) => index === all.findIndex((candidate) => candidate.text === entry.text))
      .slice(0, MAX_REVISIONS);
  }
  result[profileId] = { text:String(text ?? ""), updatedAt:options.now || new Date().toISOString(), revisions };
  return result;
}

export function restoreDialogueRevision(drafts, profileId, options = {}) {
  const result = normalizeDialogueDrafts(drafts), current = result[profileId];
  if (!current?.revisions.length) return { drafts:result, text:null };
  const [revision, ...remaining] = current.revisions;
  const revisions = current.text && current.text !== revision.text
    ? [{ text:current.text, savedAt:options.now || new Date().toISOString(), reason:"before-restore" }, ...remaining].slice(0, MAX_REVISIONS)
    : remaining;
  result[profileId] = { text:revision.text, updatedAt:options.now || new Date().toISOString(), revisions };
  return { drafts:result, text:revision.text, revision };
}

export function mergeDialogueDrafts(localDrafts, remoteDrafts) {
  const local = normalizeDialogueDrafts(localDrafts), remote = normalizeDialogueDrafts(remoteDrafts), merged = { ...local };
  for (const [profileId, remoteDraft] of Object.entries(remote)) {
    const localDraft = local[profileId];
    if (!localDraft || Date.parse(remoteDraft.updatedAt || 0) > Date.parse(localDraft.updatedAt || 0)) merged[profileId] = remoteDraft;
  }
  return merged;
}
