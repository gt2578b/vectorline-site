// The profile editor: header, tabs (Assertions / Signing / Details / JSON) and inspector.
import { h, icon } from './dom.js';
import { store, edit, replaceDraft, setUi, undo, redo, isDirty } from './state.js';
import { field, text, select, toggle, chips, button, iconButton, setOrDelete } from './forms.js';
import { assertionList } from './assertions.js';
import { jsonEditor, jsonView } from './jsonedit.js';
import { lint } from './lint.js';
import { ASSERTION_TEMPLATES, KINDS, kindOf, CAWG_ROLES, TSA_PRESETS, PROFILE_COLORS } from './vocab.js';

const TABS = [['assertions', 'Assertions'], ['signing', 'Signing'], ['details', 'Details'], ['json', 'JSON']];
const EKU_NAMES = { '1.3.6.1.5.5.7.3.4': 'emailProtection', '1.3.6.1.5.5.7.3.36': 'documentSigning', '1.3.6.1.4.1.62558.2.1': 'c2pa claimSigning' };

export function editorHeader(actions) {
  const d = store.draft;
  return h('header.editor-head',
    h('span.swatch', { style: { background: d.color || '#636A76' } }),
    h('div.title-block',
      h('input.title-input', {
        value: d.name || '', 'aria-label': 'Profile name', placeholder: 'Profile name',
        oninput: (e) => edit((x) => { x.name = e.target.value; }, { key: 'name' }),
      }),
      headerStatus()),
    headerTools(actions));
}

export function headerStatus() {
  return h('div.subtitle',
    store.currentId ? h('code', `profiles/${store.currentId}.json`) : h('span.tag.warn', 'New — not saved yet'),
    isDirty() && store.currentId && h('span.tag.warn', 'Unsaved changes'));
}

export function headerTools(actions) {
  return h('div.head-tools',
    iconButton('undo', 'Undo (Ctrl+Z)', undo, { disabled: !store.history.length }),
    iconButton('redo', 'Redo (Ctrl+Shift+Z)', redo, { disabled: !store.future.length }),
    h('span.sep'),
    iconButton('copy', 'Duplicate profile', actions.duplicate),
    iconButton('download', 'Export profile JSON', actions.exportJson),
    iconButton('trash', 'Delete profile', actions.remove, { disabled: !store.currentId, cls: 'danger' }),
    button('Save', actions.save, { kind: 'primary', iconName: 'save', disabled: !isDirty(), title: 'Save (Ctrl+S)' }));
}

export function editorTabs() {
  const counts = { assertions: store.draft.manifest?.assertions?.length || 0 };
  return h('nav.tabs', { role: 'tablist' }, TABS.map(([id, label]) => h('button.tab', {
    type: 'button', role: 'tab', 'aria-selected': String(store.ui.tab === id), class: store.ui.tab === id ? 'on' : '',
    onclick: () => setUi({ tab: id }),
  }, label, counts[id] != null && h('span.count', String(counts[id])))));
}

export function editorBody(rerender) {
  switch (store.ui.tab) {
    case 'signing': return signingTab();
    case 'details': return detailsTab();
    case 'json': return jsonTab();
    default: return assertionsTab(rerender);
  }
}

// --- Assertions tab ------------------------------------------------------------------

function assertionsTab(rerender) {
  const m = store.draft.manifest;
  m.claim_generator_info ||= [{ name: 'Vectorline C2PA Studio', version: '0.1.0' }];
  const gen = m.claim_generator_info[0];
  const present = new Set((m.assertions || []).map((a) => kindOf(a.label)));

  return h('div.tab-body',
    h('section.card.manifest-card',
      h('header.card-head.static', h('span.kind-icon.k-manifest', icon('file')), h('div.card-title', h('strong', 'Manifest'), h('span.hint', 'Claim-level fields'))),
      h('div.card-body.grid-3',
        field('Title', text(() => m.title, (v) => setOrDelete(m, 'title', v), { placeholder: '{{filename}}' }), { hint: 'Defaults to the file name. Template variables work here.' }),
        field('Claim generator', text(() => gen.name, (v) => { gen.name = v; })),
        field('Generator version', text(() => gen.version, (v) => setOrDelete(gen, 'version', v), { placeholder: '1.0.0' })))),
    assertionList(rerender),
    h('div.add-bar',
      h('span.add-label', 'Add assertion'),
      Object.entries(KINDS).map(([kind, meta]) => h('button.add-kind', {
        type: 'button', class: `k-${kind}`,
        disabled: kind !== 'custom' && present.has(kind) ? true : null,
        title: kind !== 'custom' && present.has(kind) ? 'Already in this profile' : meta.blurb,
        onclick: () => edit((d) => d.manifest.assertions.push(ASSERTION_TEMPLATES[kind]()), { structural: true }),
      }, icon(meta.icon), meta.title))));
}

// --- Signing tab -------------------------------------------------------------------------

function certOptions(purpose) {
  const sorted = [...store.certs].sort((a, b) => (a.purpose === purpose ? -1 : 1) - (b.purpose === purpose ? -1 : 1));
  return [['', '— choose —'], ...sorted.map((c) => [c.id, `${c.name}  ·  ${c.purpose.toUpperCase()} · ${c.alg.toUpperCase()}`])];
}

export function chainView(cert) {
  if (!cert) return h('div.empty-note', 'No certificate set selected.');
  const cn = (dn) => (/CN=([^,]+)/.exec(dn) || [])[1] || dn;
  const [ee, inter] = cert.chain;
  const node = (role, c, extra) => h('div.chain-node',
    h('span.chain-role', role), h('strong', cn(c.subject)),
    h('span.hint', `valid to ${c.not_after.slice(0, 10)}`), extra);
  return h('div.chain',
    node('Root CA', cert.root, h('span.tag.muted', 'not in public trust lists')),
    h('span.chain-arrow', '→'),
    node('Intermediate', inter),
    h('span.chain-arrow', '→'),
    node(cert.purpose === 'cawg' ? 'Identity' : 'Claim signer', ee,
      h('span.tag-line', (ee.eku || []).map((o) => h('span.tag', EKU_NAMES[o] || o)))));
}

function signingTab() {
  const d = store.draft;
  d.signing ||= {};
  const sig = d.signing;
  sig.cawg ||= { enabled: false, roles: [], referencedAssertions: [] };
  const cawg = sig.cawg;
  const byId = Object.fromEntries(store.certs.map((c) => [c.id, c]));
  const labels = [...new Set((d.manifest.assertions || []).map((a) => a.label))];
  const refs = cawg.referencedAssertions ||= [];
  const tsaKnown = TSA_PRESETS.some(([v]) => v === (sig.tsaUrl || ''));

  return h('div.tab-body',
    h('section.card',
      h('header.card-head.static', h('span.kind-icon.k-manifest', icon('key')), h('div.card-title', h('strong', 'Claim signer'), h('span.hint', 'Signs the C2PA claim (the manifest as a whole)'))),
      h('div.card-body',
        h('div.grid-2',
          field('Certificate set', select(certOptions('c2pa'), () => sig.certSet, (v) => { sig.certSet = v; }, { structural: true, allowCustom: true }),
            { hint: h('span', 'Make more on the ', h('a', { href: '#/certs' }, 'Certificates'), ' page.') }),
          field('Timestamp authority', h('div.pair',
            select([...TSA_PRESETS, ['__custom', 'Custom URL…']], () => (tsaKnown ? sig.tsaUrl || '' : '__custom'), (v) => { sig.tsaUrl = v === '__custom' ? 'https://' : v; }, { structural: true }),
            !tsaKnown && text(() => sig.tsaUrl, (v) => { sig.tsaUrl = v; }, { mono: true, placeholder: 'https://…' })),
          { hint: 'An RFC 3161 timestamp keeps the signature valid after the certificate expires. Needs network access when signing.' })),
        chainView(byId[sig.certSet]))),

    h('section.card', { class: cawg.enabled ? '' : 'muted-card' },
      h('header.card-head.static', h('span.kind-icon.k-metadata', icon('user')),
        h('div.card-title', h('strong', 'CAWG identity assertion'), h('span.hint', 'A named actor signs a subset of the assertions with their own X.509 credential')),
        h('div.card-tools', toggle(() => cawg.enabled, (v) => { cawg.enabled = v; }, { label: cawg.enabled ? 'On' : 'Off' }))),
      cawg.enabled && h('div.card-body',
        h('div.grid-2',
          field('Identity certificate set', select(certOptions('cawg'), () => cawg.certSet, (v) => { cawg.certSet = v; }, { structural: true, allowCustom: true })),
          field('Roles', h('div',
            h('div.role-picks', CAWG_ROLES.map(([r, l]) => {
              const on = (cawg.roles || []).includes(r);
              return h('button.pick', {
                type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on),
                onclick: () => edit(() => {
                  cawg.roles ||= [];
                  if (on) cawg.roles = cawg.roles.filter((x) => x !== r); else cawg.roles.push(r);
                }, { structural: true }),
              }, l);
            })),
            chips(() => (cawg.roles || []).filter((r) => !CAWG_ROLES.some(([x]) => x === r)), (v) => {
              cawg.roles = [...(cawg.roles || []).filter((r) => CAWG_ROLES.some(([x]) => x === r)), ...v];
            }, { placeholder: 'Custom role…' })))),
        field('Assertions the identity vouches for', h('div.checklist',
          h('label.check.locked', h('input', { type: 'checkbox', checked: true, disabled: true }), h('code', 'c2pa.hash.*'), h('span.hint', 'hard binding, always included')),
          labels.map((l) => h('label.check',
            h('input', { type: 'checkbox', checked: refs.includes(l), onchange: (e) => edit(() => {
              const at = refs.indexOf(l);
              if (e.target.checked && at < 0) refs.push(l);
              if (!e.target.checked && at >= 0) refs.splice(at, 1);
            }, { structural: true }) }),
            h('code', l))),
          refs.filter((r) => !labels.includes(r)).map((r) => h('label.check.missing',
            h('input', { type: 'checkbox', checked: true, onchange: () => edit(() => refs.splice(refs.indexOf(r), 1), { structural: true }) }),
            h('code', r), h('span.tag.warn', 'not in manifest'))))),
        chainView(byId[cawg.certSet]))),

    h('aside.note', icon('info'), h('div',
      h('strong', 'About trust. '),
      'These certificates come from a local test CA. Online validators such as contentcredentials.org/verify will show the manifest but flag the signer as unrecognized, because the root isn\'t on the C2PA trust list. The Verify page can check against your local test roots to confirm everything else is sound.')));
}

// --- Details tab -------------------------------------------------------------------------

function detailsTab() {
  const d = store.draft;
  return h('div.tab-body',
    h('section.card', h('div.card-body',
      field('Description', text(() => d.description, (v) => { d.description = v; }, { multiline: true, rows: 4, placeholder: 'What workflow does this profile represent? What should a validator show?' }), { wide: true }),
      h('div.grid-2',
        field('Colour', h('div.swatches', PROFILE_COLORS.map((c) => h('button.swatch-pick', {
          type: 'button', style: { background: c }, class: d.color === c ? 'on' : '', 'aria-label': `Colour ${c}`,
          onclick: () => edit(() => { d.color = c; }, { structural: true }),
        })))),
        field('Tags', chips(() => d.tags, (v) => { d.tags = v; }, { placeholder: 'Add a tag' }))))),
    h('section.card',
      h('header.card-head.static', h('span.kind-icon.k-custom', icon('code')), h('div.card-title', h('strong', 'Template variables'), h('span.hint', 'Filled in at signing time, in any string in the manifest'))),
      h('div.card-body', h('table.vars', h('tbody',
        [['filename', 'Asset file name', 'harbor.jpg'], ['basename', 'File name without extension', 'harbor'], ['format', 'Media type', 'image/jpeg'],
          ['now', 'Signing time (UTC, ISO 8601)', '2026-10-27T18:04:11Z'], ['date', 'Signing date', '2026-10-27'], ['year', 'Signing year', '2026'], ['uuid', 'A random UUID', '1b4e…']]
          .map(([k, desc, ex]) => h('tr',
            h('td', h('button.var-copy', { type: 'button', title: 'Copy', onclick: (e) => { navigator.clipboard?.writeText(`{{${k}}}`); e.currentTarget.classList.add('copied'); } }, `{{${k}}}`)),
            h('td', desc), h('td.hint', ex))))))));
}

// --- JSON tab ----------------------------------------------------------------------------

function jsonTab() {
  return h('div.tab-body',
    h('p.blurb', 'The whole profile as JSON. Valid edits apply immediately and can be undone; the forms on the other tabs reflect them.'),
    jsonEditor({
      value: store.draft, minRows: 24, label: 'Profile JSON',
      validate: (v) => (!v || typeof v !== 'object' || Array.isArray(v) ? 'A profile must be a JSON object.'
        : !v.manifest || typeof v.manifest !== 'object' ? 'A profile needs a "manifest" object.' : null),
      onChange: (v) => replaceDraft(v),
    }));
}

// --- Inspector -----------------------------------------------------------------------------

const EXAMPLE_VARS = { filename: 'example.jpg', basename: 'example', format: 'image/jpeg', date: new Date().toISOString().slice(0, 10), year: String(new Date().getFullYear()) };

function resolve(value) {
  const vars = { ...EXAMPLE_VARS, now: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), uuid: '00000000-0000-4000-8000-000000000000' };
  return JSON.parse(JSON.stringify(value), (k, v) => (typeof v === 'string' ? v.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, n) => vars[n] ?? m) : v));
}

export function inspector({ onSign }) {
  const issues = lint(store.draft, store.certs);
  const counts = { error: 0, warn: 0, info: 0 };
  issues.forEach((i) => counts[i.level]++);
  const tab = store.ui.inspector;

  let body;
  if (tab === 'checks') {
    body = issues.length ? h('ul.issues', issues.map((i) => h('li', { class: i.level },
      icon(i.level === 'error' ? 'x' : i.level === 'warn' ? 'alert' : 'info'),
      h('div', i.where && h('span.where', i.where), h('span', i.msg)))))
      : h('div.all-good', icon('check'), 'No issues found.');
  } else {
    const m = store.draft.manifest || {};
    const shown = store.ui.resolved ? resolve(m) : m;
    const preview = { ...shown, format: store.ui.resolved ? 'image/jpeg' : '(from file)' };
    body = h('div',
      h('div.preview-tools',
        h('div.segmented.small',
          h('button', { type: 'button', class: store.ui.resolved ? 'on' : '', onclick: () => setUi({ resolved: true }) }, 'Resolved'),
          h('button', { type: 'button', class: store.ui.resolved ? '' : 'on', onclick: () => setUi({ resolved: false }) }, 'Template')),
        h('span.hint', store.ui.resolved ? 'As if signing example.jpg now' : 'Raw, with {{variables}}')),
      jsonView(preview),
      h('p.hint.added', 'Added by the SDK when signing: ', h('code', 'c2pa.hash.data'), ', ', h('code', 'c2pa.thumbnail.claim'),
        store.draft.signing?.cawg?.enabled ? [', ', h('code', 'cawg.identity')] : null, ', plus one ', h('code', 'c2pa.ingredient.v3'), ' per ingredient file.'));
  }

  return h('aside.inspector',
    h('nav.tabs.small',
      h('button.tab', { type: 'button', class: tab === 'preview' ? 'on' : '', onclick: () => setUi({ inspector: 'preview' }) }, 'Manifest preview'),
      h('button.tab', { type: 'button', class: tab === 'checks' ? 'on' : '', onclick: () => setUi({ inspector: 'checks' }) }, 'Checks',
        counts.error ? h('span.count.error', String(counts.error)) : null,
        counts.warn ? h('span.count.warn', String(counts.warn)) : null,
        !counts.error && !counts.warn ? h('span.count.ok', '✓') : null)),
    h('div.inspector-body', body),
    h('div.inspector-foot',
      h('button.btn.primary.big', { type: 'button', onclick: onSign }, icon('pen'), h('span', 'Sign an asset with this profile'))));
}
