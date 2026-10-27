// The "Sign an asset" dialog.
import { h, icon, mount, modal, toast } from './dom.js';
import { api } from './api.js';
import { store } from './state.js';
import { lint } from './lint.js';
import { renderReport, verdict } from './report.js';

const fmtSize = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const isImage = (f) => /^image\/(jpeg|png|webp|gif|avif)/.test(f?.type || '');

export function dropZone({ onFile, label = 'Drop a file here', accept, compact = false }) {
  const input = h('input', { type: 'file', accept, hidden: true, onchange: () => input.files[0] && onFile(input.files[0]) });
  const zone = h('div.dropzone', { class: compact ? 'compact' : '', tabindex: '0', role: 'button', 'aria-label': label,
    onclick: () => input.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
    ondragover: (e) => { e.preventDefault(); zone.classList.add('over'); },
    ondragleave: () => zone.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); zone.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) onFile(f); },
  }, icon('upload'), h('strong', label), h('span.hint', 'or click to browse'), input);
  return zone;
}

function filePreview(file, { onRemove } = {}) {
  const url = isImage(file) ? URL.createObjectURL(file) : null;
  return h('div.file-preview',
    url ? h('img', { src: url, alt: '' }) : h('span.file-icon', icon('file')),
    h('div', h('strong', file.name), h('div.hint', `${file.type || 'unknown type'} · ${fmtSize(file.size)}`)),
    onRemove && h('button.btn.ghost.icon-only', { type: 'button', title: 'Remove', onclick: onRemove }, icon('x')));
}

export function openSignDialog() {
  const profile = structuredClone(store.draft);
  const expected = [];
  for (const a of profile.manifest.assertions || []) {
    if (!/^c2pa\.actions/.test(a.label)) continue;
    for (const x of a.data?.actions || []) {
      for (const id of x.parameters?.ingredientIds || []) {
        if (!expected.some((e) => e.id === id)) expected.push({ id, parent: x.action === 'c2pa.opened' });
      }
    }
  }
  const state = { asset: null, ingredients: [], busy: false, result: null };
  const left = h('div.sign-left');
  const right = h('div.sign-right');
  const errors = lint(profile, store.certs).filter((i) => i.level === 'error');

  const addIngredient = (file) => {
    const used = new Set(state.ingredients.map((i) => i.label));
    const next = expected.find((e) => !used.has(e.id));
    state.ingredients.push({ file, label: next?.id || `ingredient${state.ingredients.length + 1}`, relationship: next?.parent ? 'parentOf' : 'componentOf' });
    paintLeft();
  };

  function paintLeft() {
    const sig = profile.signing || {};
    const cawg = sig.cawg || {};
    const certName = (id) => store.certs.find((c) => c.id === id)?.name || id || '—';
    mount(left, 
      h('h3.step-title', h('span.num', '1'), 'Asset'),
      state.asset ? filePreview(state.asset, { onRemove: () => { state.asset = null; paintLeft(); } })
        : h('div', dropZone({ onFile: (f) => { state.asset = f; paintLeft(); }, label: 'Drop the file to sign' }),
          h('div.row-center', h('button.btn.ghost.small', {
            type: 'button',
            onclick: async () => { state.asset = await api.sample(); paintLeft(); },
          }, icon('image'), h('span', 'Use a generated sample image')))),

      h('h3.step-title', h('span.num', '2'), 'Ingredients', h('span.hint', ' optional')),
      expected.length ? h('p.hint', 'This profile links actions to ingredient ids: ', expected.map((e) => h('code', e.id)).flatMap((x, i) => (i ? [', ', x] : [x])), '. Attach a file for each.') : null,
      h('div.ing-list', state.ingredients.map((ing, i) => h('div.ing-row',
        filePreview(ing.file),
        h('div.ing-fields',
          h('select', { 'aria-label': 'Relationship', onchange: (e) => { ing.relationship = e.target.value; } },
            ['parentOf', 'componentOf', 'inputTo'].map((r) => h('option', { value: r, selected: ing.relationship === r }, r))),
          h('input.mono', { value: ing.label, 'aria-label': 'Ingredient id', placeholder: 'id', oninput: (e) => { ing.label = e.target.value.trim(); } })),
        h('button.btn.ghost.icon-only', { type: 'button', title: 'Remove ingredient', onclick: () => { state.ingredients.splice(i, 1); paintLeft(); } }, icon('x'))))),
      dropZone({ onFile: addIngredient, label: 'Add an ingredient file', compact: true }),

      h('h3.step-title', h('span.num', '3'), 'Sign'),
      h('dl.facts.compact',
        h('dt', 'Profile'), h('dd', profile.name),
        h('dt', 'Claim signer'), h('dd', certName(sig.certSet)),
        h('dt', 'CAWG identity'), h('dd', cawg.enabled ? `${certName(cawg.certSet)} · ${(cawg.roles || []).join(', ') || 'no role'}` : 'Off'),
        h('dt', 'Timestamp'), h('dd', sig.tsaUrl || 'None')),
      errors.length ? h('div.inline-warn', icon('alert'), h('div', h('strong', `${errors.length} check${errors.length > 1 ? 's' : ''} failing. `), errors[0].msg)) : null,
      h('button.btn.primary.big.wide', {
        type: 'button', disabled: !state.asset || state.busy, onclick: doSign,
      }, state.busy ? h('span.spinner') : icon('pen'), h('span', state.busy ? 'Signing…' : 'Sign')));
  }

  function paintRight() {
    if (!state.result) {
      mount(right, h('div.placeholder', icon('shield'), h('strong', 'Signed output appears here'), h('span.hint', 'You\'ll get the signed file, its manifest, and a validation report.')));
      return;
    }
    const r = state.result;
    const v = verdict(r.report);
    const preview = h('div.signed-preview');
    if (isImage(state.asset)) {
      api.blob(r.download).then((b) => preview.append(h('img', { src: URL.createObjectURL(b), alt: 'Signed asset' })));
    }
    mount(right, 
      h('div.result-head',
        preview,
        h('div',
          h('div.verdict', { class: v.cls }, v.title),
          h('strong', r.filename), h('div.hint', fmtSize(r.size)),
          h('div.result-actions',
            h('a.btn.primary', { href: r.download, download: r.filename }, icon('download'), h('span', 'Download signed file')),
            h('a.btn.secondary', { href: r.manifest, download: 'manifest-store.json' }, icon('code'), h('span', 'Manifest JSON')),
            h('a.btn.ghost', { href: 'https://contentcredentials.org/verify', target: '_blank', rel: 'noopener' }, icon('external'), h('span', 'Open an online validator'))))),
      renderReport(r.report, { filename: r.filename }));
  }

  async function doSign() {
    if (errors.length && !confirm('Some checks are failing. Sign anyway?')) return;
    state.busy = true;
    paintLeft();
    const form = new FormData();
    form.append('profile', JSON.stringify(profile));
    form.append('asset', state.asset, state.asset.name);
    form.append('ingredients', JSON.stringify(state.ingredients.map(({ label, relationship }) => ({ label, relationship }))));
    for (const ing of state.ingredients) form.append('ingredient', ing.file, ing.file.name);
    try {
      state.result = await api.sign(form);
      toast('Signed', 'ok');
    } catch (e) {
      toast(e.message, 'error', 8000);
    } finally {
      state.busy = false;
      paintLeft();
      paintRight();
    }
  }

  paintLeft();
  paintRight();
  modal(`Sign with “${profile.name}”`, h('div.sign-grid', left, right), { wide: true });
}
