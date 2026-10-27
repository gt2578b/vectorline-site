// Renders a manifest store + validation results returned by the reader.
import { h, icon, download } from './dom.js';
import { jsonView } from './jsonedit.js';
import { ACTION_INDEX, SOURCE_TYPE_INDEX, CAWG_ROLES } from './vocab.js';

const EXPECTED = {
  'signingCredential.untrusted': 'The claim signer chains to a root that isn\'t in the trust list used for this check. Expected for test certificates on public validators; it does not mean the manifest was tampered with.',
  'cawg.x509.credential.untrusted': 'The CAWG identity certificate isn\'t on a CAWG trust list. Expected for test certificates; this SDK has no setting for custom CAWG trust anchors, so even the local check reports it.',
  'signingCredential.ocsp.skipped': 'Revocation (OCSP) wasn\'t checked. Test certificates have no OCSP responder.',
  'timeStamp.untrusted': 'The timestamp authority isn\'t on the timestamp trust list used for this check.',
};
const UNTRUSTED = new Set(['signingCredential.untrusted', 'cawg.x509.credential.untrusted', 'timeStamp.untrusted']);
const ROLE_LABELS = Object.fromEntries(CAWG_ROLES);

export function verdict(report) {
  const vr = report.store?.validation_results?.activeManifest || {};
  const failures = vr.failure || [];
  const hard = failures.filter((f) => !UNTRUSTED.has(f.code));
  if (hard.length) return { cls: 'bad', title: 'Invalid', detail: `${hard.length} validation failure${hard.length > 1 ? 's' : ''}` };
  const codes = new Set(failures.map((f) => f.code));
  if (codes.has('signingCredential.untrusted')) return { cls: 'warn', title: 'Valid, untrusted signer', detail: 'Signatures and hashes check out; the claim signer isn\'t on the trust list used.' };
  if (codes.has('cawg.x509.credential.untrusted')) return { cls: 'ok', title: 'Valid, claim signer trusted', detail: 'The CAWG identity credential isn\'t on a CAWG trust list, which is expected for test identities.' };
  if (failures.length) return { cls: 'warn', title: 'Valid, untrusted timestamp', detail: 'Signatures and hashes check out; the timestamp authority isn\'t on the trust list used.' };
  return { cls: 'ok', title: 'Valid and trusted', detail: 'Signatures, hashes and certificate trust all check out.' };
}

function shortUrl(url = '') {
  return url.replace(/^self#jumbf=\/c2pa\/[^/]+\//, '').replace(/^self#jumbf=/, '');
}

function dl(pairs) {
  return h('dl.facts', pairs.filter(([, v]) => v != null && v !== '').map(([k, v]) => [h('dt', k), h('dd', v)]));
}

function codesTable(title, items, cls) {
  if (!items?.length) return null;
  return h('details.codes', { class: cls, open: cls !== 'success' || null },
    h('summary', h('span.dot'), `${title} · ${items.length}`),
    h('ul', items.map((c) => h('li',
      h('code', c.code),
      h('span.expl', c.explanation || ''),
      c.url && h('span.where', shortUrl(c.url)),
      EXPECTED[c.code] && h('div.expected', icon('info'), EXPECTED[c.code])))));
}

function actionsView(actions) {
  return h('ol.timeline.readonly', actions.map((a, i) => {
    const st = a.digitalSourceType && SOURCE_TYPE_INDEX[a.digitalSourceType];
    const agent = typeof a.softwareAgent === 'string' ? a.softwareAgent : a.softwareAgent && [a.softwareAgent.name, a.softwareAgent.version].filter(Boolean).join(' ');
    return h('li.action',
      h('span.step', String(i + 1)),
      h('div.action-body',
        h('div', h('strong', ACTION_INDEX[a.action]?.label || a.action), ' ', h('code.muted', a.action)),
        st && h('div.tag-line', h('span.tag.src', st.label)),
        a.description && h('div', a.description),
        h('div.hint', [agent && `by ${agent}`, a.when, a.parameters?.ingredients?.length && `${a.parameters.ingredients.length} linked ingredient(s)`].filter(Boolean).join(' · '))));
  }));
}

function identityView(a) {
  const p = a.data?.signer_payload || {};
  const s = a.data?.signature_info || {};
  return h('div.identity',
    h('div.identity-head', h('span.avatar', icon('user')),
      h('div', h('strong', s.common_name || 'Unknown identity'), h('div.hint', s.issuer || ''))),
    h('div.tag-line', (p.role || []).map((r) => h('span.tag', ROLE_LABELS[r] || r)), h('span.tag.muted', p.sig_type || '')),
    h('div.hint', 'Vouches for: ', (p.referenced_assertions || []).map((r) => h('code', shortUrl(r.url).replace('c2pa.assertions/', ''))).flatMap((x, i) => (i ? [', ', x] : [x]))));
}

export function renderReport(report, { onCreateProfile, filename } = {}) {
  if (!report.found) {
    return h('div.report', h('div.banner.none', icon('info'), h('div', h('strong', 'No Content Credentials'), h('div', report.error || 'This file has no C2PA manifest.'))));
  }
  const store = report.store;
  const active = store.manifests?.[store.active_manifest] || {};
  const v = verdict(report);
  const vr = store.validation_results || {};
  const assertions = active.assertions || [];
  const actions = assertions.filter((a) => /^c2pa\.actions/.test(a.label)).flatMap((a) => a.data?.actions || []);
  const identities = assertions.filter((a) => a.label.startsWith('cawg.identity'));
  const others = assertions.filter((a) => !/^c2pa\.actions/.test(a.label) && !a.label.startsWith('cawg.identity'));
  const sig = active.signature_info || {};
  const gen = (active.claim_generator_info || []).map((g) => [g.name, g.version].filter(Boolean).join(' ')).join(', ') || active.claim_generator;

  return h('div.report',
    h('div.banner', { class: v.cls }, icon(v.cls === 'ok' ? 'shield' : v.cls === 'warn' ? 'alert' : 'x'),
      h('div', h('strong', v.title), h('div', v.detail)),
      h('span.state', report.validation_state || '')),

    h('section.r-sec',
      h('h3', 'Claim'),
      dl([['Title', active.title], ['Format', active.format], ['Generator', gen],
        ['Signed by', [sig.common_name, sig.issuer].filter(Boolean).join(' · ')],
        ['Algorithm', sig.alg?.toUpperCase()], ['Signed at', sig.time || 'No trusted timestamp'],
        ['Manifests in store', String(Object.keys(store.manifests || {}).length)],
        ['Label', h('code', store.active_manifest)]])),

    actions.length ? h('section.r-sec', h('h3', 'Actions'), actionsView(actions)) : null,

    identities.length ? h('section.r-sec', h('h3', 'CAWG identity'), identities.map(identityView)) : null,

    (active.ingredients || []).length ? h('section.r-sec', h('h3', 'Ingredients'),
      h('ul.ingredients', active.ingredients.map((ing) => h('li',
        h('strong', ing.title || 'Untitled'), ' ', h('span.tag', ing.relationship || ''), ' ', h('span.hint', ing.format || ''),
        ing.active_manifest ? h('span.tag.ok', 'has its own manifest') : h('span.tag.muted', 'no manifest'))))) : null,

    h('section.r-sec', h('h3', 'Validation'),
      codesTable('Failures', vr.activeManifest?.failure, 'failure'),
      codesTable('Informational', vr.activeManifest?.informational, 'informational'),
      codesTable('Passed checks', vr.activeManifest?.success, 'success'),
      (vr.ingredientDeltas || []).length ? h('details.codes.informational', h('summary', h('span.dot'), `Ingredient deltas · ${vr.ingredientDeltas.length}`), jsonView(vr.ingredientDeltas, { maxHeight: '240px' })) : null),

    h('section.r-sec', h('h3', 'Assertions'),
      others.map((a) => h('details.assertion-view', h('summary', h('code', a.label)), jsonView(a.data, { maxHeight: '320px' })))),

    h('section.r-sec.r-actions',
      h('details.raw', h('summary', 'Full manifest store JSON'), jsonView(store, { maxHeight: '480px' })),
      h('div.row-end',
        h('button.btn.secondary', { type: 'button', onclick: () => download(`${(filename || 'manifest').replace(/\.[^.]+$/, '')}-manifest-store.json`, JSON.stringify(store, null, 2)) }, icon('download'), h('span', 'Manifest JSON')),
        onCreateProfile && h('button.btn.secondary', { type: 'button', onclick: () => onCreateProfile(active) }, icon('plus'), h('span', 'New profile from this manifest')))));
}
