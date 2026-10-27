// Assertion cards: a dedicated form per assertion kind, plus a raw JSON mode.
import { h, icon } from './dom.js';
import { edit, store } from './state.js';
import { jsonEditor } from './jsonedit.js';
import { field, text, select, toggle, segmented, chips, iconButton, setOrDelete } from './forms.js';
import {
  ACTIONS, ACTION_INDEX, SOURCE_TYPES, SOURCE_TYPE_INDEX, IPTC, REDACT_REASONS, NAMESPACES,
  METADATA_FIELDS, METADATA_INDEX, SCHEMA_FIELDS, SCHEMA_INDEX, TRAINING_ENTRIES, TRAINING_USES,
  KINDS, kindOf,
} from './vocab.js';

const cardUi = new Map(); // `${label}#${n}` -> { collapsed, json }
const actionUi = new WeakMap(); // action object -> { more }

function uiKey(assertions, i) {
  const label = assertions[i].label;
  const n = assertions.slice(0, i).filter((a) => a.label === label).length;
  return `${label}#${n}`;
}

const sourceTypeOptions = [['', '— none —'], ...SOURCE_TYPES.map((g) => ({
  group: g.group, items: g.items.map(([id, label]) => [id.startsWith('http') ? id : IPTC + id, label]),
}))];

// --- Card shell -------------------------------------------------------------------

export function assertionList(rerender) {
  const list = store.draft.manifest.assertions ||= [];
  const container = h('div.assertion-list');
  let dragFrom = null;

  list.forEach((a, i) => {
    const card = assertionCard(a, i, list, rerender);
    card.addEventListener('dragstart', (e) => {
      dragFrom = i;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
    });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); card.draggable = false; });
    card.addEventListener('dragover', (e) => {
      if (dragFrom == null) return;
      e.preventDefault();
      const r = card.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      card.classList.toggle('drop-before', !after);
      card.classList.toggle('drop-after', after);
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      const after = card.classList.contains('drop-after');
      card.classList.remove('drop-before', 'drop-after');
      if (dragFrom == null) return;
      let to = after ? i + 1 : i;
      const from = dragFrom;
      dragFrom = null;
      if (from < to) to -= 1;
      if (from === to) return;
      edit((d) => {
        const arr = d.manifest.assertions;
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
      }, { structural: true });
    });
    container.append(card);
  });
  return container;
}

function assertionCard(a, i, list, rerender) {
  const key = uiKey(list, i);
  const ui = cardUi.get(key) || { collapsed: false, json: false };
  cardUi.set(key, ui);
  const kind = kindOf(a.label);
  const meta = KINDS[kind];
  const cawg = store.draft.signing?.cawg;
  const covered = cawg?.enabled && (cawg.referencedAssertions || []).includes(a.label);

  const grip = h('span.grip', { title: 'Drag to reorder' }, icon('grip'));
  const labelInput = h('input.label-input.mono', {
    value: a.label, spellcheck: 'false', 'aria-label': 'Assertion label',
    oninput: (e) => edit(() => { a.label = e.target.value.trim(); }, { key: `label${i}` }),
    onchange: () => { cardUi.delete(key); rerender(); },
  });

  const header = h('header.card-head',
    grip,
    h('span.kind-icon', { class: `k-${kind}` }, icon(meta.icon)),
    h('div.card-title', h('strong', meta.title), labelInput),
    h('div.card-tools',
      cawg?.enabled && h('button.cawg-chip', {
        type: 'button', class: covered ? 'on' : '',
        title: covered ? 'Covered by the CAWG identity signature. Click to exclude.' : 'Not covered by the CAWG identity signature. Click to include.',
        onclick: () => edit((d) => {
          const refs = d.signing.cawg.referencedAssertions ||= [];
          const at = refs.indexOf(a.label);
          if (at >= 0) refs.splice(at, 1); else refs.push(a.label);
        }, { structural: true }),
      }, icon('user'), covered ? 'Identity-signed' : 'Not identity-signed'),
      kind !== 'custom' && iconButton('code', ui.json ? 'Show form' : 'Edit as JSON', () => { ui.json = !ui.json; rerender(); }, { cls: ui.json ? 'active' : '' }),
      iconButton('copy', 'Duplicate', () => edit((d) => d.manifest.assertions.splice(i + 1, 0, structuredClone(a)), { structural: true })),
      iconButton('up', 'Move up', () => edit((d) => { const arr = d.manifest.assertions; [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; }, { structural: true }), { disabled: i === 0 }),
      iconButton('down', 'Move down', () => edit((d) => { const arr = d.manifest.assertions; [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; }, { structural: true }), { disabled: i === list.length - 1 }),
      iconButton('trash', 'Remove assertion', () => edit((d) => d.manifest.assertions.splice(i, 1), { structural: true }), { cls: 'danger' }),
      iconButton('chevron', ui.collapsed ? 'Expand' : 'Collapse', () => { ui.collapsed = !ui.collapsed; rerender(); }, { cls: ui.collapsed ? 'chev' : 'chev open' })));

  grip.addEventListener('mousedown', () => { card.draggable = true; });
  grip.addEventListener('mouseup', () => { card.draggable = false; });

  let body = null;
  if (!ui.collapsed) {
    a.data ??= {};
    if (ui.json || kind === 'custom') {
      body = h('div.card-body',
        kind === 'custom' && h('p.blurb', 'Custom assertions use a reverse-DNS label you control, e.g. ', h('code', 'com.yourorg.thing'), '. Any JSON object works as the payload.'),
        jsonEditor({
          value: a.data, label: `${a.label} data`,
          validate: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? null : 'Assertion data must be a JSON object.'),
          onChange: (v) => edit(() => { a.data = v; }, { key: `json${i}` }),
        }));
    } else {
      const forms = { actions: actionsForm, metadata: metadataForm, training: trainingForm, creativework: creativeWorkForm };
      body = h('div.card-body', h('p.blurb', meta.blurb), forms[kind](a, rerender));
    }
  } else {
    body = h('div.card-summary', summarize(a, kind));
  }

  const card = h('article.card.assertion', { class: `kind-${kind}` }, header, body);
  return card;
}

function summarize(a, kind) {
  const d = a.data || {};
  if (kind === 'actions') return (d.actions || []).map((x) => ACTION_INDEX[x.action]?.label || x.action).join(' → ') || 'No actions';
  if (kind === 'training') return Object.entries(d.entries || {}).map(([k, v]) => `${k.replace('cawg.', '')}: ${v.use}`).join(' · ');
  const keys = Object.keys(d).filter((k) => !k.startsWith('@'));
  return keys.length ? keys.join(', ') : 'Empty';
}

// --- Actions ------------------------------------------------------------------------

const actionsListId = 'dl-actions';
function actionDatalist() {
  return h('datalist', { id: actionsListId }, ACTIONS.map(([id, label]) => h('option', { value: id }, label)));
}

function actionsForm(a, rerender) {
  const actions = a.data.actions ||= [];
  const wrap = h('div.actions-form', actionDatalist());
  const timeline = h('ol.timeline');
  actions.forEach((act, j) => timeline.append(actionRow(actions, act, j, rerender)));
  if (!actions.length) timeline.append(h('li.empty-note', 'No actions yet. The first action should be c2pa.created or c2pa.opened.'));

  const adder = h('select.add-select', {
    'aria-label': 'Add action',
    onchange: (e) => {
      const v = e.target.value;
      if (!v) return;
      edit(() => {
        const act = { action: v };
        if (v === 'c2pa.created') act.digitalSourceType = IPTC + 'digitalCapture';
        if (v === 'c2pa.opened') act.parameters = { ingredientIds: ['parent'] };
        if (v === 'c2pa.placed') act.parameters = { ingredientIds: ['component1'] };
        actions.push(act);
      }, { structural: true });
    },
  }, h('option', { value: '' }, '＋ Add action…'), ACTIONS.map(([id, label]) => h('option', { value: id }, `${label}  (${id})`)));

  wrap.append(timeline, h('div.row-end', adder));
  return wrap;
}

function actionRow(actions, act, j, rerender) {
  const ui = actionUi.get(act) || { more: null };
  actionUi.set(act, ui);
  const info = ACTION_INDEX[act.action];
  const params = act.parameters || {};
  const hasMore = act.when || act.softwareAgent || params.ingredientIds?.length || act.reason ||
    Object.keys(params).some((k) => k !== 'ingredientIds');
  const showMore = ui.more ?? !!hasMore;

  const agent = typeof act.softwareAgent === 'string' ? { name: act.softwareAgent } : (act.softwareAgent || {});
  const setAgent = (k, v) => {
    const next = { ...agent, [k]: v };
    for (const key of Object.keys(next)) if (!next[key]) delete next[key];
    setOrDelete(act, 'softwareAgent', Object.keys(next).length ? next : null);
  };
  const sourceTypeHint = SOURCE_TYPE_INDEX[act.digitalSourceType]?.desc;

  const more = h('div.action-more', { hidden: !showMore },
    h('div.grid-2',
      field('When', h('div.with-btn',
        text(() => act.when, (v) => setOrDelete(act, 'when', v), { placeholder: '{{now}} or 2026-01-01T12:00:00Z', mono: true }),
        h('button.btn.ghost.small', { type: 'button', title: 'Use the signing time', onclick: () => edit(() => { act.when = '{{now}}'; }, { structural: true }) }, '{{now}}'))),
      field('Software agent', h('div.pair',
        text(() => agent.name, (v) => setAgent('name', v), { placeholder: 'Name', ariaLabel: 'Software agent name' }),
        text(() => agent.version, (v) => setAgent('version', v), { placeholder: 'Version', ariaLabel: 'Software agent version' })))),
    h('div.grid-2',
      field('Linked ingredient ids', chips(() => params.ingredientIds, (v) => {
        act.parameters ||= {};
        setOrDelete(act.parameters, 'ingredientIds', v);
        if (!Object.keys(act.parameters).length) delete act.parameters;
      }, { placeholder: 'parent, component1…', suggestions: [['parent', 'parentOf ingredient'], ['component1', 'componentOf ingredient']] }),
      { hint: 'Matches the id you give an ingredient file when signing.' }),
      act.action === 'c2pa.redacted'
        ? field('Reason', select([['', '— choose —'], ...REDACT_REASONS.map((r) => [r, r])], () => act.reason, (v) => setOrDelete(act, 'reason', v), { allowCustom: true }))
        : field('Other parameters (JSON)', jsonEditor({
          value: Object.fromEntries(Object.entries(params).filter(([k]) => k !== 'ingredientIds')),
          minRows: 2,
          validate: (v) => (v && typeof v === 'object' && !Array.isArray(v) ? null : 'Parameters must be an object.'),
          onChange: (v) => edit(() => {
            const ids = act.parameters?.ingredientIds;
            const next = { ...v };
            if (ids) next.ingredientIds = ids;
            setOrDelete(act, 'parameters', Object.keys(next).length ? next : null);
          }, { key: `params${j}` }),
        }))));

  const moreBtn = h('button.link-btn', {
    type: 'button',
    onclick: () => { ui.more = more.hidden; more.hidden = !more.hidden; moreBtn.textContent = more.hidden ? 'More fields' : 'Fewer fields'; },
  }, showMore ? 'Fewer fields' : 'More fields');

  return h('li.action',
    h('span.step', String(j + 1)),
    h('div.action-body',
      h('div.action-main',
        h('div.action-name',
          h('input.mono', {
            list: actionsListId, value: act.action || '', 'aria-label': 'Action', spellcheck: 'false',
            oninput: (e) => edit(() => { act.action = e.target.value.trim(); }, { key: `act${j}` }),
            onchange: () => rerender(),
          }),
          h('div.hint', info ? info.desc || info.label : 'Custom action label')),
        h('div.action-source',
          select(sourceTypeOptions, () => act.digitalSourceType, (v) => setOrDelete(act, 'digitalSourceType', v), { structural: true, ariaLabel: 'Digital source type', allowCustom: true }),
          h('div.hint', sourceTypeHint || 'Digital source type')),
        h('div.action-tools',
          iconButton('up', 'Move up', () => edit(() => { [actions[j - 1], actions[j]] = [actions[j], actions[j - 1]]; }, { structural: true }), { disabled: j === 0 }),
          iconButton('down', 'Move down', () => edit(() => { [actions[j + 1], actions[j]] = [actions[j], actions[j + 1]]; }, { structural: true }), { disabled: j === actions.length - 1 }),
          iconButton('trash', 'Remove action', () => edit(() => actions.splice(j, 1), { structural: true }), { cls: 'danger' }))),
      h('div.action-desc',
        text(() => act.description, (v) => setOrDelete(act, 'description', v), { placeholder: 'Description (optional)', ariaLabel: 'Action description' }),
        moreBtn),
      more));
}

// --- Key/value (CAWG metadata, CreativeWork) ------------------------------------------

function renameKey(obj, from, to) {
  const entries = Object.entries(obj).map(([k, v]) => [k === from ? to : k, v]);
  for (const k of Object.keys(obj)) delete obj[k];
  Object.assign(obj, Object.fromEntries(entries));
}

function valueControl(data, key, type) {
  const v = data[key];
  if (type === 'list') {
    return chips(() => (Array.isArray(v) ? v : v ? [String(v)] : []), (list) => { data[key] = list; }, { placeholder: 'Add and press Enter' });
  }
  if (type === 'bool' || typeof v === 'boolean') {
    return toggle(() => data[key], (b) => { data[key] = b; }, { label: v ? 'Yes' : 'No', structural: true });
  }
  if (type === 'json' || (v !== null && typeof v === 'object') || typeof v === 'number') {
    return jsonEditor({ value: v ?? null, minRows: 2, onChange: (p) => edit(() => { data[key] = p; }, { key: `kv-${key}` }) });
  }
  return text(() => v, (s) => { data[key] = s; }, { placeholder: type === 'date' ? '{{date}} or 2026-01-31' : '', ariaLabel: key });
}

function kvRows(data, { index, fields, keyPlaceholder, onKeys = () => {} }) {
  const keys = Object.keys(data).filter((k) => !k.startsWith('@'));
  const dlId = `dl-kv-${fields === METADATA_FIELDS ? 'meta' : 'schema'}`;
  const table = h('div.kv', h('datalist', { id: dlId }, fields.map(([k, l]) => h('option', { value: k }, l))));
  for (const k of keys) {
    const def = index[k];
    table.append(h('div.kv-row',
      h('div.kv-key',
        h('input.mono', {
          value: k, list: dlId, spellcheck: 'false', 'aria-label': 'Field name',
          onchange: (e) => {
            const nk = e.target.value.trim();
            if (!nk || nk === k || nk in data) { e.target.value = k; return; }
            edit(() => { renameKey(data, k, nk); onKeys(data); }, { structural: true });
          },
        }),
        h('div.hint', def?.label || 'Custom field')),
      h('div.kv-val', valueControl(data, k, def?.type)),
      iconButton('trash', `Remove ${k}`, () => edit(() => { delete data[k]; }, { structural: true }), { cls: 'danger' })));
  }
  if (!keys.length) table.append(h('div.empty-note', 'No fields yet.'));

  const available = fields.filter(([k]) => !(k in data));
  const adder = h('select.add-select', {
    'aria-label': 'Add field',
    onchange: (e) => {
      let k = e.target.value;
      if (!k) return;
      if (k === '__custom') {
        k = prompt(`Field name (${keyPlaceholder})`);
        if (!k || k in data) { e.target.value = ''; return; }
      }
      const type = index[k]?.type;
      edit(() => { data[k] = type === 'list' ? [] : type === 'bool' ? true : type === 'json' ? [] : ''; onKeys(data); }, { structural: true });
    },
  }, h('option', { value: '' }, '＋ Add field…'),
  available.map(([k, l]) => h('option', { value: k }, `${l}  (${k})`)),
  h('option', { value: '__custom' }, 'Custom field…'));
  return h('div', table, h('div.row-end', adder));
}

function prefixesInUse(data) {
  return new Set(Object.keys(data).filter((k) => !k.startsWith('@') && k.includes(':')).map((k) => k.split(':')[0]));
}

// Keep @context in step with the prefixes in use (runs inside an edit).
function declareKnownPrefixes(data) {
  const ctx = data['@context'];
  for (const p of prefixesInUse(data)) if (!(p in ctx) && NAMESPACES[p]) ctx[p] = NAMESPACES[p];
}

function metadataForm(a) {
  const data = a.data;
  if (typeof data['@context'] !== 'object' || data['@context'] === null || Array.isArray(data['@context'])) data['@context'] = {};
  const ctx = data['@context'];
  const used = prefixesInUse(data);

  const nsRows = [...new Set([...Object.keys(ctx), ...used])].map((p) => {
    const inUse = used.has(p);
    const uri = ctx[p];
    return h('div.ns-row', { class: !uri ? 'missing' : !inUse ? 'unused' : '' },
      h('code', p),
      uri ? h('span.ns-uri', typeof uri === 'string' ? uri : JSON.stringify(uri))
        : NAMESPACES[p] ? h('button.btn.ghost.small', { type: 'button', onclick: () => edit(() => { ctx[p] = NAMESPACES[p]; }, { structural: true }) }, `Declare ${NAMESPACES[p]}`)
        : h('input.mono', {
          placeholder: `Namespace URI for "${p}:"`, 'aria-label': `Namespace for ${p}`,
          onchange: (e) => e.target.value.trim() && edit(() => { ctx[p] = e.target.value.trim(); }, { structural: true }),
        }),
      !inUse && uri && h('span.tag', 'unused'),
      !uri && h('span.tag.warn', 'undeclared'),
      uri && iconButton('x', `Remove ${p} namespace`, () => edit(() => { delete ctx[p]; }, { structural: true })));
  });

  return h('div',
    kvRows(data, { index: METADATA_INDEX, fields: METADATA_FIELDS, keyPlaceholder: 'prefix:name', onKeys: declareKnownPrefixes }),
    h('details.ns', { open: nsRows.some((r) => r.classList.contains('missing')) || null },
      h('summary', `JSON-LD @context · ${Object.keys(ctx).length} namespace${Object.keys(ctx).length === 1 ? '' : 's'}`),
      h('p.hint', 'Known prefixes are declared automatically. Declare a URI for any custom prefix you use.'),
      nsRows));
}

function creativeWorkForm(a, rerender) {
  const data = a.data;
  data['@context'] ??= 'https://schema.org';
  data['@type'] ??= 'CreativeWork';
  const authors = Array.isArray(data.author) ? data.author : data.author ? [data.author] : [];
  const authorRows = h('div.authors', authors.map((au, j) => h('div.author-row',
    select([['Person', 'Person'], ['Organization', 'Organization']], () => au['@type'], (v) => { au['@type'] = v; }, { ariaLabel: 'Author type' }),
    text(() => au.name, (v) => { au.name = v; }, { placeholder: 'Name', ariaLabel: 'Author name' }),
    text(() => au.identifier || au.url, (v) => setOrDelete(au, au.url && !au.identifier ? 'url' : 'identifier', v), { placeholder: 'Identifier or URL', ariaLabel: 'Author identifier' }),
    iconButton('trash', 'Remove author', () => edit(() => { authors.splice(j, 1); data.author = authors; }, { structural: true }), { cls: 'danger' }))));
  const rest = Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'author'));
  const restProxy = new Proxy(rest, {
    set: (t, k, v) => { t[k] = v; data[k] = v; return true; },
    deleteProperty: (t, k) => { delete t[k]; delete data[k]; return true; },
  });
  return h('div',
    h('div.grid-2', field('@type', select([['CreativeWork', 'CreativeWork'], ['Photograph', 'Photograph'], ['ImageObject', 'ImageObject'], ['VideoObject', 'VideoObject'], ['AudioObject', 'AudioObject'], ['Article', 'Article']], () => data['@type'], (v) => { data['@type'] = v; }, { allowCustom: true }))),
    h('h4.sub', 'Authors'),
    authorRows,
    h('div.row-end', h('button.btn.ghost.small', { type: 'button', onclick: () => edit(() => { data.author = [...authors, { '@type': 'Person', name: '' }]; }, { structural: true }) }, '＋ Add author')),
    h('h4.sub', 'Properties'),
    kvRows(restProxy, { index: SCHEMA_INDEX, fields: SCHEMA_FIELDS.filter(([k]) => k !== 'author'), keyPlaceholder: 'schema.org property' }));
}

// --- Training & data mining ----------------------------------------------------------

function trainingForm(a, rerender) {
  const entries = a.data.entries ||= {};
  const known = new Set(TRAINING_ENTRIES.map(([k]) => k));
  const row = (k, title, desc) => {
    const entry = entries[k];
    const ci = h('div.constraint', { hidden: entry?.use !== 'constrained' },
      text(() => entries[k]?.constraint_info, (v) => entries[k] && setOrDelete(entries[k], 'constraint_info', v), { placeholder: 'Describe the constraint, or link to licence terms', ariaLabel: `${title} constraint` }));
    const seg = segmented(TRAINING_USES, () => entries[k]?.use, (v) => {
      if (!v) delete entries[k];
      else entries[k] = { ...(entries[k] || {}), use: v };
      ci.hidden = v !== 'constrained';
    }, { ariaLabel: title, allowNone: true });
    return h('div.tm-row',
      h('div.tm-label', h('strong', title), h('code', k), desc && h('div.hint', desc)),
      h('div.tm-ctl', seg, ci),
      !known.has(k) && iconButton('trash', `Remove ${k}`, () => edit(() => { delete entries[k]; }, { structural: true }), { cls: 'danger' }));
  };
  return h('div',
    h('div.tm', TRAINING_ENTRIES.map(([k, t, d]) => row(k, t, d)),
      Object.keys(entries).filter((k) => !known.has(k)).map((k) => row(k, k, ''))),
    h('div.row-split',
      h('span.hint', 'Click the selected option again to leave an entry out.'),
      h('button.btn.ghost.small', {
        type: 'button',
        onclick: () => {
          const k = prompt('Entry name (e.g. com.example.ai_finetuning)');
          if (k && !(k in entries)) edit(() => { entries[k] = { use: 'notAllowed' }; }, { structural: true });
        },
      }, '＋ Custom entry')));
}
