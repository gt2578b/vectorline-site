// Verify and Certificates pages.
import { h, icon, mount, toast } from './dom.js';
import { api } from './api.js';
import { store } from './state.js';
import { renderReport } from './report.js';
import { dropZone } from './sign.js';
import { chainView } from './editor.js';
import { field } from './forms.js';

// --- Verify ------------------------------------------------------------------------------

const verifyState = { file: null, trust: 'local', report: null, busy: false };

export function verifyView({ onCreateProfile }) {
  const root = h('div.page');
  const paint = () => {
    mount(root, 
      h('header.page-head', h('div', h('h1', 'Verify'), h('p.lede', 'Read and validate the Content Credentials in any supported file — your signed outputs, or files from elsewhere.'))),
      h('div.verify-grid',
        h('div.verify-input',
          verifyState.file
            ? h('div.file-preview', h('span.file-icon', icon('file')), h('div', h('strong', verifyState.file.name), h('div.hint', verifyState.file.type || '')),
              h('button.btn.ghost.small', { type: 'button', onclick: () => { Object.assign(verifyState, { file: null, report: null }); paint(); } }, 'Choose another'))
            : dropZone({ onFile: (f) => { verifyState.file = f; run(); }, label: 'Drop a file to verify' }),
          h('div.field',
            h('label', 'Trust anchors'),
            h('div.segmented',
              [['local', 'Local test roots'], ['public', 'None (like a public validator)']].map(([v, l]) => h('button', {
                type: 'button', class: verifyState.trust === v ? 'on' : '',
                onclick: () => { verifyState.trust = v; if (verifyState.file) run(); else paint(); },
              }, l))),
            h('div.hint', verifyState.trust === 'local'
              ? 'Certificates from your local test CAs count as trusted, so you can see that everything else validates.'
              : 'No extra anchors: your test signer shows as untrusted, the way contentcredentials.org/verify will see it.')),
          h('aside.note', icon('external'), h('div',
            h('strong', 'Checking online. '), 'Upload the signed file to ',
            h('a', { href: 'https://contentcredentials.org/verify', target: '_blank', rel: 'noopener' }, 'contentcredentials.org/verify'),
            '. Expect the manifest to display with an "unrecognized signer" notice, since test roots aren\'t on the C2PA trust list. Tools that accept custom trust anchors (such as c2patool with a settings file) can use the root PEM from the Certificates page.'))),
        h('div.verify-output',
          verifyState.busy ? h('div.placeholder', h('span.spinner.big'), 'Reading manifest…')
            : verifyState.report ? renderReport(verifyState.report, { onCreateProfile, filename: verifyState.file?.name })
              : h('div.placeholder', icon('shield'), h('strong', 'No file yet'), h('span.hint', 'The validation report appears here.')))));
  };
  const run = async () => {
    verifyState.busy = true;
    paint();
    const form = new FormData();
    form.append('file', verifyState.file, verifyState.file.name);
    form.append('trust', verifyState.trust);
    try {
      verifyState.report = await api.verify(form);
    } catch (e) {
      toast(e.message, 'error', 8000);
      verifyState.report = null;
    } finally {
      verifyState.busy = false;
      paint();
    }
  };
  paint();
  return root;
}

// --- Certificates ----------------------------------------------------------------------------

export function certsView({ reload }) {
  const used = (id) => store.profiles.filter((p) => p.signing?.certSet === id || (p.signing?.cawg?.enabled && p.signing.cawg.certSet === id)).map((p) => p.name);
  const form = { name: '', org: '', commonName: '', purpose: 'c2pa', alg: 'es256', days: 365 };
  const input = (k, attrs = {}) => h('input', { value: form[k], oninput: (e) => { form[k] = e.target.value; }, ...attrs });

  const create = async (e) => {
    e.preventDefault();
    try {
      const info = await api.createCerts(form);
      toast(`Created ${info.name}`, 'ok');
      reload();
    } catch (err) {
      toast(err.message, 'error', 6000);
    }
  };

  const card = (c) => {
    const users = used(c.id);
    const files = [['root_ca.pem', 'Root CA'], ['signer_chain.pem', 'Signing chain'], ['signer.key', 'Private key'], ['bundle.zip', 'Everything (.zip)']];
    return h('article.card.cert-card',
      h('header.card-head.static',
        h('span.kind-icon', { class: c.purpose === 'cawg' ? 'k-metadata' : 'k-manifest' }, icon(c.purpose === 'cawg' ? 'user' : 'key')),
        h('div.card-title', h('strong', c.name), h('span.hint', h('code', c.id), ` · created ${c.created.slice(0, 10)}`)),
        h('div.card-tools', h('span.tag', c.purpose === 'cawg' ? 'CAWG identity' : 'C2PA claim signing'), h('span.tag.muted', c.alg.toUpperCase()))),
      h('div.card-body',
        chainView(c),
        h('dl.facts.compact',
          h('dt', 'Signer subject'), h('dd', h('code', c.chain[0].subject)),
          h('dt', 'SHA-256'), h('dd', h('code.wrap', c.chain[0].sha256)),
          h('dt', 'Used by'), h('dd', users.length ? users.join(', ') : 'No profiles')),
        h('div.row-split',
          h('div.dl-links', files.map(([f, l]) => h('a.btn.ghost.small', { href: `/api/certs/${c.id}/${f}`, download: '' }, icon('download'), h('span', l)))),
          h('button.btn.ghost.small.danger', {
            type: 'button',
            onclick: async () => {
              if (!confirm(`Delete ${c.name}?${users.length ? `\nUsed by: ${users.join(', ')}` : ''}\nThe keys can't be recovered.`)) return;
              await api.deleteCerts(c.id);
              reload();
            },
          }, icon('trash'), h('span', 'Delete')))));
  };

  return h('div.page',
    h('header.page-head', h('div', h('h1', 'Certificates'), h('p.lede', 'Test PKI for signing. Each set is a root CA, an intermediate CA and an end-entity certificate built to the C2PA certificate profile: ECDSA or Ed25519 keys, critical digitalSignature key usage, and emailProtection + documentSigning extended key usage.'))),
    h('div.cert-grid', store.certs.map(card)),
    h('form.card.new-cert', { onsubmit: create },
      h('header.card-head.static', h('span.kind-icon.k-custom', icon('plus')), h('div.card-title', h('strong', 'New certificate set'), h('span.hint', 'Make one per persona or organization you want to demo'))),
      h('div.card-body',
        h('div.grid-3',
          field('Set name', input('name', { required: true, placeholder: 'Example Wire Newsroom' })),
          field('Organization (O)', input('org', { placeholder: 'Example Wire' })),
          field('Common name (CN)', input('commonName', { placeholder: 'Example Wire Photo Desk' }))),
        h('div.grid-3',
          field('Purpose', h('select', { onchange: (e) => { form.purpose = e.target.value; } },
            h('option', { value: 'c2pa' }, 'C2PA claim signing'), h('option', { value: 'cawg' }, 'CAWG identity (person or org)'))),
          field('Algorithm', h('select', { onchange: (e) => { form.alg = e.target.value; } },
            [['es256', 'ES256 (P-256)'], ['es384', 'ES384 (P-384)'], ['es512', 'ES512 (P-521)'], ['ed25519', 'Ed25519']].map(([v, l]) => h('option', { value: v }, l)))),
          field('Valid for (days)', input('days', { type: 'number', min: 1, max: 3650 }))),
        h('div.row-end', h('button.btn.primary', { type: 'submit' }, icon('key'), h('span', 'Generate'))))));
}
