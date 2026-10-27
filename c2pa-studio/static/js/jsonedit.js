// A lightweight JSON editor: a transparent textarea over a syntax-highlighted <pre>.
import { h } from './dom.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

export function highlightJson(text) {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    out += esc(text.slice(last, m.index));
    if (m[1]) {
      const str = esc(m[1]).replace(/\{\{\s*[\w]+\s*\}\}/g, (v) => `<span class="j-tv">${v}</span>`);
      out += m[2] ? `<span class="j-key">${str}</span>${esc(m[2])}` : `<span class="j-str">${str}</span>`;
    } else if (m[3]) out += `<span class="j-lit">${m[3]}</span>`;
    else out += `<span class="j-num">${m[4]}</span>`;
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last)) + '\n';
}

export function jsonView(value, { maxHeight } = {}) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return h('pre.code-view', { html: highlightJson(text), style: maxHeight ? { maxHeight } : null });
}

function parseError(text, err) {
  const m = /position (\d+)/.exec(err.message);
  let where = '';
  if (m) {
    const pos = +m[1];
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    const col = pos - before.lastIndexOf('\n');
    where = `Line ${line}, column ${col}: `;
  }
  return where + err.message.replace(/^JSON\.parse: /, '').replace(/ in JSON at position \d+.*$/, '');
}

/**
 * onChange(parsed) fires for every edit that leaves valid JSON.
 * validate(parsed) may return an error string to reject otherwise-valid JSON.
 */
export function jsonEditor({ value, onChange, validate, minRows = 8, label = 'JSON' }) {
  const pre = h('pre.code-hl', { 'aria-hidden': 'true' });
  const ta = h('textarea.code-input', { spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': label, rows: minRows });
  const status = h('div.code-status');
  const wrap = h('div.code-editor', h('div.code-stack', pre, ta), status);

  const paint = () => {
    pre.innerHTML = highlightJson(ta.value);
    ta.style.height = 'auto';
    ta.style.height = Math.max(ta.scrollHeight, minRows * 20) + 'px';
  };
  const check = () => {
    let parsed;
    try {
      parsed = JSON.parse(ta.value);
    } catch (e) {
      wrap.classList.add('invalid');
      status.textContent = parseError(ta.value, e);
      return;
    }
    const problem = validate?.(parsed);
    wrap.classList.toggle('invalid', !!problem);
    status.textContent = problem || '';
    if (!problem) onChange?.(parsed);
  };

  ta.addEventListener('input', () => { paint(); check(); });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '  ');
    }
  });

  wrap.setValue = (v) => {
    ta.value = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
    wrap.classList.remove('invalid');
    status.textContent = '';
    paint();
  };
  wrap.focusInput = () => ta.focus();
  wrap.setValue(value ?? '');
  requestAnimationFrame(paint);
  return wrap;
}
