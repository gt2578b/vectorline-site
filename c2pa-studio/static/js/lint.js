// Spec-oriented checks for a profile, shown in the inspector before signing.
import { ACTION_INDEX, NAMESPACES, TRAINING_USES, kindOf } from './vocab.js';

const TEMPLATE_VARS = ['filename', 'basename', 'format', 'now', 'date', 'year', 'uuid'];

export function lint(profile, certs = []) {
  const out = [];
  const add = (level, msg, where) => out.push({ level, msg, where });
  const m = profile?.manifest;
  if (!m || typeof m !== 'object') return [{ level: 'error', msg: 'The profile has no manifest object.' }];
  const assertions = Array.isArray(m.assertions) ? m.assertions : [];
  if (!Array.isArray(m.assertions)) add('error', 'manifest.assertions must be an array.');

  // Labels
  const seen = new Map();
  assertions.forEach((a, i) => {
    const where = `Assertion ${i + 1}`;
    if (!a.label) { add('error', 'Assertion has no label.', where); return; }
    seen.set(a.label, (seen.get(a.label) || 0) + 1);
    if (!/^[A-Za-z0-9_.\-]+$/.test(a.label)) add('error', `Label "${a.label}" has characters that aren't allowed in a JUMBF label.`, where);
    if (/\.v1$/.test(a.label)) add('info', `"${a.label}": version 1 is implied, so the SDK stores it as "${a.label.replace(/\.v1$/, '')}".`, where);
    if (a.label === 'c2pa.actions') add('info', 'c2pa.actions (v1) is legacy; prefer c2pa.actions.v2.', where);
    if (a.label === 'stds.schema-org.CreativeWork') add('info', 'CreativeWork is deprecated in C2PA 2.x. cawg.metadata or a CAWG identity assertion is the current way to state authorship.', where);
    if (a.label === 'c2pa.training-mining') add('warn', 'c2pa.training-mining moved to CAWG; use cawg.training-mining.', where);
    if (/^stds\.(exif|iptc)/.test(a.label)) add('info', `${a.label} is deprecated; put this metadata in cawg.metadata instead.`, where);
    if (/^(c2pa|cawg)\./.test(a.label) && kindOf(a.label) === 'custom') add('warn', `"${a.label}" uses a reserved prefix but isn't a label this editor knows. Custom labels should be reverse-DNS (com.example.…).`, where);
    else if (kindOf(a.label) === 'custom' && !/^[a-z0-9-]+\.[a-z0-9-]+\./i.test(a.label)) add('info', `Custom label "${a.label}" should use reverse-DNS form, e.g. com.example.${a.label}.`, where);
    if (a.data == null || typeof a.data !== 'object') add('error', `"${a.label}" needs a data object.`, where);
  });
  for (const [label, n] of seen) {
    if (n > 1 && kindOf(label) !== 'custom') add('warn', `"${label}" appears ${n} times. The SDK keeps both as ${label} and ${label}__1, which validators may treat as an error for this assertion type.`);
  }

  // Actions
  const actionAssertions = assertions.filter((a) => kindOf(a.label) === 'actions');
  if (!actionAssertions.length) add('warn', 'No actions assertion. C2PA 2.x claims must start with a c2pa.created or c2pa.opened action.');
  if (actionAssertions.length > 1) add('warn', 'More than one actions assertion; keep all actions in a single c2pa.actions.v2.');
  const allActions = actionAssertions.flatMap((a) => a.data?.actions || []);
  if (actionAssertions.length) {
    const first = allActions[0]?.action;
    if (!first) add('error', 'The actions list is empty.');
    else if (first !== 'c2pa.created' && first !== 'c2pa.opened') add('warn', `The first action is ${first}; C2PA requires c2pa.created or c2pa.opened first.`);
    const starts = allActions.filter((x) => x.action === 'c2pa.created' || x.action === 'c2pa.opened');
    if (starts.length > 1) add('warn', 'Only one c2pa.created or c2pa.opened action is allowed.');
  }
  const ingredientIds = new Set();
  allActions.forEach((x, j) => {
    const where = `Action ${j + 1} (${x.action || '?'})`;
    if (!x.action) add('error', 'Action has no name.', where);
    else if (!ACTION_INDEX[x.action] && x.action.startsWith('c2pa.')) add('warn', `"${x.action}" isn't a standard C2PA action.`, where);
    if (x.action === 'c2pa.created' && !x.digitalSourceType) add('warn', 'c2pa.created should say what kind of content was created (digitalSourceType).', where);
    const ids = x.parameters?.ingredientIds || [];
    ids.forEach((id) => ingredientIds.add(id));
    if (x.action === 'c2pa.opened' && !ids.length) add('warn', 'c2pa.opened must reference its parentOf ingredient. Add an ingredient id and attach that file when signing.', where);
    if (x.action === 'c2pa.placed' && !ids.length) add('info', 'c2pa.placed usually references the componentOf ingredient that was placed.', where);
    if (x.action === 'c2pa.redacted' && !x.reason) add('warn', 'c2pa.redacted needs a reason.', where);
    if (x.when && !/\{\{/.test(x.when) && Number.isNaN(Date.parse(x.when))) add('warn', `"when" isn't a valid date-time: ${x.when}`, where);
  });
  if (ingredientIds.size) add('info', `When signing, attach ingredient files with ids: ${[...ingredientIds].join(', ')}.`);

  // CAWG metadata
  for (const a of assertions.filter((x) => x.label === 'cawg.metadata')) {
    const ctx = a.data?.['@context'];
    if (!ctx || typeof ctx !== 'object') { add('error', 'cawg.metadata needs a JSON-LD @context object.'); continue; }
    for (const k of Object.keys(a.data)) {
      if (k.startsWith('@')) continue;
      const prefix = k.includes(':') ? k.split(':')[0] : null;
      if (!prefix) add('warn', `cawg.metadata field "${k}" has no namespace prefix.`);
      else if (!(prefix in ctx)) add('error', `Prefix "${prefix}:" isn't declared in @context${NAMESPACES[prefix] ? ` (use ${NAMESPACES[prefix]})` : ''}.`);
      const v = a.data[k];
      if (v === '' || (Array.isArray(v) && !v.length)) add('info', `cawg.metadata "${k}" is empty.`);
    }
  }

  // Training and mining
  const uses = new Set(TRAINING_USES.map(([v]) => v));
  for (const a of assertions.filter((x) => kindOf(x.label) === 'training')) {
    for (const [k, v] of Object.entries(a.data?.entries || {})) {
      if (!uses.has(v?.use)) add('error', `${k}: "use" must be allowed, notAllowed or constrained.`);
      if (v?.use === 'constrained' && !v.constraint_info) add('info', `${k} is constrained but has no constraint_info.`);
    }
  }

  // Template variables
  const json = JSON.stringify(m);
  for (const [, name] of json.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    if (!TEMPLATE_VARS.includes(name)) add('warn', `Unknown template variable {{${name}}}; it will be left as-is.`);
  }

  // Signing
  const sig = profile.signing || {};
  const byId = Object.fromEntries(certs.map((c) => [c.id, c]));
  if (!sig.certSet) add('error', 'Choose a certificate set for the claim signer.', 'Signing');
  else if (certs.length && !byId[sig.certSet]) add('error', `Certificate set "${sig.certSet}" doesn't exist. Pick or create one on the Signing tab.`, 'Signing');
  const cawg = sig.cawg || {};
  if (cawg.enabled) {
    if (!cawg.certSet) add('error', 'Choose a certificate set for the CAWG identity.', 'Signing');
    else if (certs.length && !byId[cawg.certSet]) add('error', `CAWG certificate set "${cawg.certSet}" doesn't exist.`, 'Signing');
    else if (cawg.certSet === sig.certSet) add('info', 'The CAWG identity uses the same certificate as the claim signer. Real deployments separate the named actor from the claim generator.', 'Signing');
    if (!cawg.roles?.length) add('info', 'The CAWG identity has no role (e.g. cawg.creator).', 'Signing');
    const labels = new Set(assertions.map((a) => a.label));
    for (const r of cawg.referencedAssertions || []) {
      if (!labels.has(r)) add('error', `The CAWG identity references "${r}", which isn't in this manifest.`, 'Signing');
    }
    if (!(cawg.referencedAssertions || []).length) add('info', 'The CAWG identity only covers the hard binding. Reference assertions (e.g. cawg.metadata) to make the identity vouch for them.', 'Signing');
  }
  if (sig.tsaUrl && !/^https?:\/\//.test(sig.tsaUrl)) add('error', 'The timestamp authority URL must start with http:// or https://.', 'Signing');
  if (!sig.tsaUrl) add('info', 'No timestamp authority: the signature only validates while the signing certificate is valid.', 'Signing');

  const order = { error: 0, warn: 1, info: 2 };
  return out.sort((x, y) => order[x.level] - order[y.level]);
}
