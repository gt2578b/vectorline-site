// Form controls bound to the draft through store.edit().
import { h, icon, mount } from './dom.js';
import { edit } from './state.js';

let seq = 0;
const uid = (p = 'f') => `${p}${++seq}`;

export function field(label, control, { hint, wide, inline } = {}) {
  const id = control.id || (control.id = uid('in'));
  return h('div.field', { class: [wide && 'wide', inline && 'inline'].filter(Boolean).join(' ') },
    h('label', { for: id }, label),
    control,
    hint && h('div.hint', hint));
}

export function text(get, set, { placeholder, mono, multiline, list, rows = 3, type = 'text', structural = false, ariaLabel } = {}) {
  const key = uid('t');
  const tag = multiline ? 'textarea' : 'input';
  return h(tag, {
    type: multiline ? null : type, rows: multiline ? rows : null, value: get() ?? '', placeholder, list,
    class: mono ? 'mono' : '', spellcheck: mono ? 'false' : null, 'aria-label': ariaLabel,
    oninput: (e) => edit(() => set(e.target.value), { key }),
    onchange: structural ? () => edit(() => {}, { key, structural: true }) : null,
  });
}

export function select(options, get, set, { structural = false, ariaLabel, allowCustom = false } = {}) {
  const current = get() ?? '';
  const opts = [];
  let found = false;
  for (const o of options) {
    if (o.group) {
      opts.push(h('optgroup', { label: o.group }, o.items.map(([v, l]) => {
        if (v === current) found = true;
        return h('option', { value: v, selected: v === current }, l);
      })));
    } else {
      const [v, l] = o;
      if (v === current) found = true;
      opts.push(h('option', { value: v, selected: v === current }, l));
    }
  }
  if (!found && current && allowCustom) opts.unshift(h('option', { value: current, selected: true }, current));
  return h('select', {
    'aria-label': ariaLabel,
    onchange: (e) => edit(() => set(e.target.value), { structural }),
  }, opts);
}

export function toggle(get, set, { label, structural = true } = {}) {
  const input = h('input', { type: 'checkbox', checked: !!get(), onchange: (e) => edit(() => set(e.target.checked), { structural }) });
  return h('label.switch', input, h('span.track', h('span.thumb')), label && h('span.switch-label', label));
}

export function segmented(options, get, set, { ariaLabel, allowNone = false } = {}) {
  const group = h('div.segmented', { role: 'radiogroup', 'aria-label': ariaLabel });
  const paint = () => {
    const cur = get();
    mount(group, ...options.map(([v, l]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(cur === v), class: cur === v ? 'on' : '',
      dataset: { value: v },
      onclick: () => {
        edit(() => set(allowNone && cur === v ? undefined : v), { structural: false });
        paint();
      },
    }, l)));
  };
  paint();
  return group;
}

/** Chip list editor for arrays of strings. */
export function chips(getList, setList, { placeholder = 'Add…', suggestions = [], labels = {}, onchange } = {}) {
  const wrap = h('div.chips');
  const listId = suggestions.length ? uid('dl') : null;
  const input = h('input.chip-input', { placeholder, list: listId, 'aria-label': placeholder });
  const commit = () => {
    const v = input.value.trim().replace(/,$/, '');
    if (!v) return;
    const list = getList() || [];
    if (!list.includes(v)) edit(() => setList([...list, v]), { structural: false });
    input.value = '';
    paint();
    onchange?.();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
    else if (e.key === 'Backspace' && !input.value) {
      const list = getList() || [];
      if (list.length) { edit(() => setList(list.slice(0, -1))); paint(); onchange?.(); }
    }
  });
  input.addEventListener('blur', commit);
  const paint = () => {
    const list = getList() || [];
    mount(wrap, 
      ...list.map((v, i) => h('span.chip', { title: v }, labels[v] || v,
        h('button', {
          type: 'button', 'aria-label': `Remove ${v}`,
          onclick: () => { edit(() => setList(list.filter((_, j) => j !== i))); paint(); onchange?.(); },
        }, '×'))),
      input,
      listId && h('datalist', { id: listId }, suggestions.map(([v, l]) => h('option', { value: v }, l))));
  };
  wrap.addEventListener('click', (e) => { if (e.target === wrap) input.focus(); });
  paint();
  return wrap;
}

export function iconButton(name, title, onclick, { disabled, cls = '' } = {}) {
  return h('button.btn.ghost.icon-only', { type: 'button', title, 'aria-label': title, onclick, disabled, class: cls }, icon(name));
}

export function button(label, onclick, { kind = 'secondary', iconName, disabled, title, type = 'button' } = {}) {
  return h('button.btn', { class: kind, onclick, disabled, title, type }, iconName && icon(iconName), h('span', label));
}

/** Set a key on obj, deleting it when the value is empty. */
export function setOrDelete(obj, key, value) {
  if (value === '' || value == null || (Array.isArray(value) && !value.length)) delete obj[key];
  else obj[key] = value;
}
