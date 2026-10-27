// App state with an undo/redo history for the profile being edited.

const listeners = new Set();
const HISTORY_LIMIT = 200;
const COALESCE_MS = 900;

export const store = {
  meta: null,
  profiles: [],
  certs: [],
  currentId: null,   // id of the saved profile being edited (null for a new one)
  draft: null,       // working copy of the profile
  savedJson: null,   // JSON of the profile as last saved, for the dirty check
  history: [],
  future: [],
  lastEdit: { key: null, at: 0 },
  ui: { tab: 'assertions', inspector: 'preview', resolved: true },
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(change) {
  for (const fn of listeners) fn(change);
}

const snapshot = () => JSON.stringify(store.draft);

export function isDirty() {
  return store.draft != null && snapshot() !== store.savedJson;
}

export function load(profile, id = profile?.id ?? null) {
  store.draft = structuredClone(profile);
  store.currentId = id;
  store.savedJson = id ? snapshot() : null;
  store.history = [];
  store.future = [];
  store.lastEdit = { key: null, at: 0 };
  emit({ structural: true, loaded: true });
}

export function markSaved(id) {
  store.currentId = id;
  store.savedJson = snapshot();
  emit({ structural: false, saved: true });
}

/**
 * Apply a change to the draft.
 * key: edits sharing a key within COALESCE_MS become one undo step (typing).
 * structural: whether the editor needs a full re-render.
 */
export function edit(mutate, { key = null, structural = false } = {}) {
  const now = Date.now();
  const coalesce = key && store.lastEdit.key === key && now - store.lastEdit.at < COALESCE_MS;
  if (!coalesce) {
    store.history.push(snapshot());
    if (store.history.length > HISTORY_LIMIT) store.history.shift();
  }
  store.future = [];
  store.lastEdit = { key, at: now };
  mutate(store.draft);
  emit({ structural });
}

/** Replace the whole draft (e.g. from the JSON editor) as one undo step. */
export function replaceDraft(next, { key = 'json' } = {}) {
  edit((d) => {
    for (const k of Object.keys(d)) delete d[k];
    Object.assign(d, next);
  }, { key, structural: false });
  emit({ structural: true, fromJson: true });
}

export function undo() {
  if (!store.history.length) return;
  store.future.push(snapshot());
  store.draft = JSON.parse(store.history.pop());
  store.lastEdit = { key: null, at: 0 };
  emit({ structural: true });
}

export function redo() {
  if (!store.future.length) return;
  store.history.push(snapshot());
  store.draft = JSON.parse(store.future.pop());
  store.lastEdit = { key: null, at: 0 };
  emit({ structural: true });
}

export function setUi(patch) {
  Object.assign(store.ui, patch);
  emit({ structural: true, ui: true });
}
