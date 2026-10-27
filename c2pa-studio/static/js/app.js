import { h, icon, mount, toast, download, slugify } from './dom.js';
import { api } from './api.js';
import { store, subscribe, load, markSaved, isDirty, undo, redo } from './state.js';
import { editorHeader, headerStatus, headerTools, editorTabs, editorBody, inspector } from './editor.js';
import { openSignDialog } from './sign.js';
import { verifyView, certsView } from './views.js';
import { BLANK_PROFILE, AUTO_LABELS } from './vocab.js';

const app = document.getElementById('app');
let route = { view: 'profiles', id: null };
let search = '';
const regions = {};

// --- Data ------------------------------------------------------------------------------

async function refresh() {
  [store.profiles, store.certs] = await Promise.all([api.profiles(), api.certs()]);
}

function parseRoute() {
  const [, view = 'profiles', id = null] = location.hash.split('/');
  return { view, id: id && decodeURIComponent(id) };
}

function go(hash) {
  if (location.hash !== hash) location.hash = hash;
  else onRoute();
}

function confirmDiscard() {
  return !isDirty() || confirm('You have unsaved changes to this profile. Discard them?');
}

// --- Profile actions ---------------------------------------------------------------------

const actions = {
  async save() {
    const d = store.draft;
    let id = store.currentId;
    if (!id) {
      const base = slugify(d.name);
      id = base;
      for (let n = 2; store.profiles.some((p) => p.id === id); n++) id = `${base}-${n}`;
    }
    try {
      const saved = await api.saveProfile(id, { ...d, id });
      store.draft.id = saved.id;
      await refresh();
      markSaved(id);
      toast('Profile saved', 'ok');
      if (route.id !== id) {
        history.replaceState(null, '', `#/profiles/${id}`);
        route = parseRoute();
      }
      renderSidebar();
    } catch (e) {
      toast(e.message, 'error', 6000);
    }
  },
  duplicate() {
    if (!confirmDiscard()) return;
    const copy = structuredClone(store.draft);
    copy.name = `${copy.name} (copy)`;
    delete copy.id;
    load(copy, null);
    history.replaceState(null, '', '#/profiles/new');
    route = parseRoute();
    renderSidebar();
  },
  exportJson() {
    download(`${store.currentId || slugify(store.draft.name)}.json`, JSON.stringify(store.draft, null, 2) + '\n');
  },
  async remove() {
    if (!store.currentId || !confirm(`Delete “${store.draft.name}”? This removes profiles/${store.currentId}.json.`)) return;
    await api.deleteProfile(store.currentId);
    store.savedJson = JSON.stringify(store.draft); // nothing left to save
    await refresh();
    toast('Profile deleted');
    go(store.profiles[0] ? `#/profiles/${store.profiles[0].id}` : '#/profiles/new');
  },
};

function newProfile(profile = BLANK_PROFILE()) {
  if (!confirmDiscard()) return;
  load(profile, null);
  history.replaceState(null, '', '#/profiles/new');
  route = parseRoute();
  render();
}

function importProfile() {
  const input = h('input', { type: 'file', accept: '.json,application/json' });
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (data.manifest) newProfile({ ...BLANK_PROFILE(), ...data, id: undefined });
      else if (Array.isArray(data.assertions)) newProfile({ ...BLANK_PROFILE(), name: data.title || 'Imported manifest', manifest: data });
      else throw new Error('Expected a profile (with "manifest") or a manifest definition (with "assertions").');
    } catch (e) {
      toast(`Import failed: ${e.message}`, 'error', 6000);
    }
  };
  input.click();
}

function profileFromManifest(active) {
  let components = 0;
  const assertions = (active.assertions || [])
    .filter((a) => !AUTO_LABELS.test(a.label))
    .map((a) => {
      const copy = structuredClone(a);
      delete copy.instance;
      for (const act of copy.data?.actions || []) {
        if (act.parameters) {
          // Hashed links can't be reused; turn them into ids to match with ingredient files at signing.
          const links = act.parameters.ingredients || (act.parameters.ingredient ? [act.parameters.ingredient] : []);
          if (links.length) act.parameters.ingredientIds = links.map(() => (act.action === 'c2pa.opened' ? 'parent' : `component${++components}`));
          delete act.parameters.ingredients;
          delete act.parameters.ingredient;
          if (!Object.keys(act.parameters).length) delete act.parameters;
        }
      }
      return copy;
    });
  const identity = (active.assertions || []).find((a) => a.label.startsWith('cawg.identity'))?.data?.signer_payload;
  const p = BLANK_PROFILE();
  p.name = `From ${active.title || 'manifest'}`;
  p.description = `Imported from a signed manifest (${active.label || 'unknown label'}).`;
  p.manifest = { claim_generator_info: p.manifest.claim_generator_info, title: '{{filename}}', assertions };
  if (identity) {
    p.signing.cawg.enabled = true;
    p.signing.cawg.roles = identity.role || [];
    p.signing.cawg.referencedAssertions = (identity.referenced_assertions || [])
      .map((r) => r.url.replace(/^.*c2pa\.assertions\//, ''))
      .filter((l) => !AUTO_LABELS.test(l) && assertions.some((a) => a.label === l));
  }
  newProfile(p);
}

// --- Rendering ------------------------------------------------------------------------------

function renderSidebar() {
  const q = search.toLowerCase();
  const list = store.profiles.filter((p) => !q || [p.name, p.description, ...(p.tags || [])].join(' ').toLowerCase().includes(q));
  const nav = [['profiles', 'Profiles', 'layers'], ['verify', 'Verify', 'shield'], ['certs', 'Certificates', 'key']];
  mount(regions.sidebar,
    h('div.brand', h('span.brand-mark', 'V'), h('div', h('strong', 'C2PA Studio'), h('span', 'Vectorline'))),
    h('nav.main-nav', nav.map(([v, l, i]) => h('a', { href: v === 'profiles' ? `#/profiles/${store.currentId || store.profiles[0]?.id || 'new'}` : `#/${v}`, class: route.view === v ? 'on' : '' }, icon(i), l))),
    route.view === 'profiles' && h('div.profile-panel',
      h('div.search', icon('search'), h('input', {
        type: 'search', placeholder: 'Filter profiles', value: search, 'aria-label': 'Filter profiles',
        oninput: (e) => { search = e.target.value; renderSidebarList(); },
      })),
      regions.list = h('ul.profile-list'),
      h('div.side-actions',
        h('button.btn.side', { type: 'button', onclick: () => newProfile() }, icon('plus'), 'New profile'),
        h('button.btn.side.ghost', { type: 'button', onclick: importProfile }, icon('upload'), 'Import'))),
    h('div.side-foot', store.meta && `c2pa-rs ${store.meta.sdk_version}`));
  if (route.view === 'profiles') renderSidebarList(list);
}

function renderSidebarList(list) {
  const q = search.toLowerCase();
  list ||= store.profiles.filter((p) => !q || [p.name, p.description, ...(p.tags || [])].join(' ').toLowerCase().includes(q));
  const items = list.map((p) => {
    const current = p.id === store.currentId;
    const name = current ? store.draft.name : p.name;
    return h('li', h('a', { href: `#/profiles/${p.id}`, class: current ? 'on' : '' },
      h('span.dot', { style: { background: (current ? store.draft.color : p.color) || '#636A76' } }),
      h('span.p-text', h('span.p-name', name || p.id, current && isDirty() && h('span.unsaved', { title: 'Unsaved changes' }, '•')),
        h('span.p-tags', (p.tags || []).slice(0, 3).join(' · ') || ' '))));
  });
  if (!store.currentId && store.draft && route.view === 'profiles') {
    items.unshift(h('li', h('a.on', h('span.dot', { style: { background: store.draft.color } }),
      h('span.p-text', h('span.p-name', store.draft.name, h('span.unsaved', '•')), h('span.p-tags', 'unsaved')))));
  }
  if (!items.length) items.push(h('li.empty-note', 'No matches'));
  regions.list.replaceChildren(...items);
}

function renderEditor() {
  const rerender = () => renderEditorMain();
  regions.head = editorHeader(actions);
  regions.tabs = editorTabs();
  regions.body = h('div.editor-scroll');
  regions.inspector = h('div.inspector-wrap');
  mount(regions.main, h('div.editor', h('div.editor-main', regions.head, regions.tabs, regions.body), regions.inspector));
  renderEditorMain(rerender);
  renderInspector();
}

function renderEditorMain(rerender = () => renderEditorMain()) {
  const scroll = regions.body.scrollTop;
  mount(regions.body, editorBody(rerender));
  regions.body.scrollTop = scroll;
  const tabs = editorTabs();
  regions.tabs.replaceWith(tabs);
  regions.tabs = tabs;
}

function renderInspector() {
  mount(regions.inspector, inspector({ onSign: openSignDialog }));
}

function renderHeaderState() {
  regions.head.querySelector('.subtitle').replaceWith(headerStatus());
  regions.head.querySelector('.head-tools').replaceWith(headerTools(actions));
  regions.head.querySelector('.swatch').style.background = store.draft.color || '#636A76';
  const title = regions.head.querySelector('.title-input');
  if (document.activeElement !== title) title.value = store.draft.name || '';
}

function render() {
  renderSidebar();
  if (route.view === 'verify') mount(regions.main, verifyView({ onCreateProfile: profileFromManifest }));
  else if (route.view === 'certs') mount(regions.main, certsView({ reload: async () => { await refresh(); render(); } }));
  else if (store.draft) renderEditor();
}

let pending = null;
subscribe((change) => {
  if (route.view !== 'profiles' || !store.draft || !regions.head?.isConnected) return;
  if (change.structural && !(change.fromJson && store.ui.tab === 'json')) {
    if (change.loaded || change.ui) renderEditor();
    else { renderEditorMain(); renderHeaderState(); }
  }
  // Light-weight refresh for typing: header state, inspector and sidebar, once per frame.
  cancelAnimationFrame(pending);
  pending = requestAnimationFrame(() => {
    renderHeaderState();
    renderInspector();
    renderSidebarList();
  });
});

function onRoute() {
  const next = parseRoute();
  if (next.view === 'profiles' && next.id !== store.currentId && !(next.id === 'new' && !store.currentId && store.draft)) {
    if (!confirmDiscard()) {
      history.replaceState(null, '', `#/profiles/${store.currentId || 'new'}`);
      return;
    }
    const p = store.profiles.find((x) => x.id === next.id) || store.profiles[0];
    if (next.id === 'new' || !p) load(BLANK_PROFILE(), null);
    else load(p, p.id);
    if (p && next.id !== p.id && next.id !== 'new') history.replaceState(null, '', `#/profiles/${p.id}`);
  }
  route = parseRoute();
  render();
}

// --- Keyboard ------------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod || route.view !== 'profiles' || !store.draft || document.querySelector('.overlay')) return;
  const inField = e.target.closest?.('input, textarea, select');
  if (e.key.toLowerCase() === 's') { e.preventDefault(); if (isDirty()) actions.save(); }
  else if (e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (e.key.toLowerCase() === 'y' && !inField) { e.preventDefault(); redo(); }
});

window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
window.addEventListener('hashchange', onRoute);

// --- Boot ------------------------------------------------------------------------------------

(async function boot() {
  regions.sidebar = h('aside.sidebar');
  regions.main = h('main.main');
  mount(app, regions.sidebar, regions.main, h('div#toasts', { 'aria-live': 'polite' }));
  try {
    [store.meta] = await Promise.all([api.meta(), refresh()]);
  } catch (e) {
    mount(regions.main, h('div.page', h('h1', 'Can\'t reach the C2PA Studio server'), h('p', e.message)));
    return;
  }
  if (!location.hash) history.replaceState(null, '', `#/profiles/${store.profiles[0]?.id || 'new'}`);
  onRoute();
})();
