import { parseUrl, routeFor } from './urls.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const enc = encodeURIComponent;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u); } };

/** Tiny DOM builder: h('div', {class:'x', onclick}, child, [children], 'text') */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'disabled', 'selected', 'indeterminate'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendKids(el, kids);
  return el;
}
export function appendKids(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}

const nf = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const ni = new Intl.NumberFormat();
export const fmtNum = (n) => (n == null || Number.isNaN(+n) ? '' : nf.format(+n));
export const fmtInt = (n) => (n == null || Number.isNaN(+n) ? '' : ni.format(+n));

export function fmtDur(sec) {
  if (!sec || sec < 0) return '';
  sec = Math.round(sec);
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = sec % 60;
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}
export function fmtBytes(n) {
  if (!n || n < 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}
export function fmtHours(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function timeAgo(ms) {
  if (!ms) return '';
  const d = (ms - Date.now()) / 1000;
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, s] of units) if (Math.abs(d) >= s) return rtf.format(Math.round(d / s), u);
  return rtf.format(Math.round(d), 'second');
}
export const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

export function debounce(fn, ms = 250) {
  let t;
  const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  f.cancel = () => clearTimeout(t);
  return f;
}

export function safeName(s, max = 120) {
  return String(s || 'untitled').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, max) || 'untitled';
}

const memo = new Map();
/** Cache promises for ttl ms (de-duplicates concurrent calls too). */
export function cached(key, ttl, fn) {
  const c = memo.get(key);
  if (c && Date.now() - c.t < ttl) return c.p;
  const p = Promise.resolve().then(fn);
  memo.set(key, { t: Date.now(), p });
  p.catch(() => { if (memo.get(key)?.p === p) memo.delete(key); });
  return p;
}

export function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(qs));
  return { path: path.replace(/\/+$/, ''), params };
}
export const hashFor = (path, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  const s = q.toString();
  return `#/${path}${s ? '?' + s : ''}`;
};

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: 0 } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand?.('copy');
    ta.remove();
    return !!ok;
  }
}

/** SoundCloud tag_list: `foo "multi word" bar` */
export function parseTagList(str) {
  if (!str) return [];
  return [...str.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => m[1] || m[2]).filter(Boolean);
}

// ---- links in descriptions & comments ------------------------------------------------------
function anchorFor(href, label) {
  const a = document.createElement('a');
  let abs = href;
  try { abs = new URL(href, 'https://www.youtube.com').href; } catch { /* keep */ }
  let u = null;
  try { u = new URL(abs); } catch { /* ignore */ }
  const ref = parseUrl(abs);
  if (ref) {
    a.href = routeFor(ref);
    a.dataset.internal = '1';
  } else if (u && u.pathname === '/results' && u.searchParams.get('search_query')) {
    a.href = `#/search?q=${enc(u.searchParams.get('search_query'))}`;
    a.dataset.internal = '1';
  } else if (u && /^(https?:|mailto:)$/.test(u.protocol)) {
    a.href = abs;
    a.target = '_blank';
    a.rel = 'noopener noreferrer nofollow';
  } else {
    return document.createTextNode(label);
  }
  a.textContent = label;
  return a;
}

const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'FORM', 'INPUT', 'BUTTON', 'SVG', 'IMG']);
const KEEP = new Set(['B', 'I', 'EM', 'STRONG', 'BR', 'P', 'UL', 'OL', 'LI', 'CODE', 'PRE', 'BLOCKQUOTE', 'SPAN', 'U', 'S', 'DIV']);
/** Whitelist sanitizer: returns a DocumentFragment, never injects raw HTML. */
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}`, 'text/html');
  const frag = document.createDocumentFragment();
  (function walk(src, dst) {
    for (const n of src.childNodes) {
      if (n.nodeType === 3) { dst.append(document.createTextNode(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toUpperCase();
      if (DROP.has(tag)) continue;
      if (tag === 'A') {
        const label = n.textContent || n.getAttribute('href') || '';
        dst.append(anchorFor(n.getAttribute('href') || '', label));
        continue;
      }
      if (/^H[1-6]$/.test(tag)) { const s = document.createElement('strong'); walk(n, s); dst.append(s, document.createElement('br')); continue; }
      if (!KEEP.has(tag)) { walk(n, dst); continue; }
      const out = document.createElement(tag.toLowerCase());
      walk(n, out);
      dst.append(out);
    }
  })(doc.body, frag);
  return frag;
}

/** Plain text -> fragment with clickable links and line breaks. */
export function linkify(text) {
  const frag = document.createDocumentFragment();
  const re = /https?:\/\/[^\s<>"')\]]+/g;
  String(text || '').split('\n').forEach((line, i) => {
    if (i) frag.append(document.createElement('br'));
    let last = 0;
    for (const m of line.matchAll(re)) {
      if (m.index > last) frag.append(line.slice(last, m.index));
      frag.append(anchorFor(m[0], m[0]));
      last = m.index + m[0].length;
    }
    if (last < line.length) frag.append(line.slice(last));
  });
  return frag;
}

/** Make an absolute URL from the various shapes APIs hand back. */
export function absUrl(u, base = '') {
  if (!u) return '';
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/')) return base.replace(/\/+$/, '') + u;
  return u;
}
