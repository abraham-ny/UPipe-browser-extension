import { h, $, fmtDur, fmtNum, fmtBytes, timeAgo, copyText, hostOf } from './util.js';
import { icon } from './icons.js';
import { send } from './browser.js';
import { SERVICES } from './config.js';
import * as store from './store.js';
import { routeFor, itemRoute } from './urls.js';
import { startDownload, showDownload } from './download.js';
import * as svc from './services/index.js';
import { pickAudio } from './services/index.js';

// ---- toast -----------------------------------------------------------------------------------
let toastHost;
export function toast(msg, kind = '') {
  if (!toastHost) { toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(toastHost); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  toastHost.append(t);
  setTimeout(() => t.remove(), kind === 'err' ? 5500 : 2600);
}

// ---- modal -----------------------------------------------------------------------------------
export function modal(title, body, { width } = {}) {
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: width ? { width } : null },
    h('div', { class: 'head' }, h('h2', { class: 'spacer' }, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close'))),
    body);
  const ov = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === ov) close(); } }, box);
  document.body.append(ov);
  document.addEventListener('keydown', onKey);
  return { close, box };
}
export function confirmBox(title, text, okLabel = 'Confirm') {
  return new Promise((res) => {
    const m = modal(title, h('div', h('p', { class: 'muted' }, text),
      h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '14px' } },
        h('button', { class: 'btn', onclick: () => { m.close(); res(false); } }, 'Cancel'),
        h('button', { class: 'btn primary', onclick: () => { m.close(); res(true); } }, okLabel))), { width: '420px' });
  });
}
export function promptBox(title, label, value = '') {
  return new Promise((res) => {
    const inp = h('input', { class: 'field', style: { width: '100%' }, value, placeholder: label });
    const go = () => { m.close(); res(inp.value.trim() || null); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const m = modal(title, h('div', inp, h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '14px' } },
      h('button', { class: 'btn', onclick: () => { m.close(); res(null); } }, 'Cancel'), h('button', { class: 'btn primary', onclick: go }, 'OK'))), { width: '420px' });
    setTimeout(() => inp.focus(), 30);
  });
}

// ---- context menu ----------------------------------------------------------------------------
export function ctxMenu(x, y, entries) {
  document.querySelectorAll('.ctx').forEach((n) => n.remove());
  const m = h('div', { class: 'ctx', role: 'menu' });
  for (const e of entries) {
    if (e === '-') { m.append(h('hr')); continue; }
    m.append(h('button', { role: 'menuitem', onclick: () => { m.remove(); e.run(); } }, e.icon ? icon(e.icon) : null, e.label));
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  const off = (ev) => { if (!m.contains(ev.target)) { m.remove(); cleanup(); } };
  const key = (ev) => { if (ev.key === 'Escape') { m.remove(); cleanup(); } };
  const cleanup = () => { removeEventListener('mousedown', off, true); removeEventListener('keydown', key, true); removeEventListener('blur', cleanup); };
  setTimeout(() => { addEventListener('mousedown', off, true); addEventListener('keydown', key, true); addEventListener('blur', () => { m.remove(); cleanup(); }); }, 0);
  m.querySelector('button')?.focus();
}

// ---- player bridge ---------------------------------------------------------------------------
const streams = (items) => items.filter((i) => i.type === 'stream' || i.type === 'resolve');
export async function playItems(items, index = 0, mode = 'play') {
  const list = streams(items);
  if (!list.length) return toast('Nothing playable here', 'err');
  const s = await store.getSettings();
  const slimmed = list.map(store.slim);
  const picked = items[index];
  const idx = Math.max(0, slimmed.findIndex((x) => picked && x.id === picked.id && x.service === picked.service));
  const res = await send({ type: 'player:open', payload: { items: s.queueFromFeed || mode !== 'play' ? slimmed : [slimmed[idx]], index: s.queueFromFeed || mode !== 'play' ? idx : 0, mode } });
  if (res && res.ok === false) toast('Could not open the player: ' + (res.error || ''), 'err');
  else if (mode === 'enqueue') toast('Added to queue');
  else if (mode === 'next') toast('Will play next');
}
export const playOne = (item) => playItems([item], 0, 'play');

// ---- download dialog -------------------------------------------------------------------------
export async function downloadDialog(item, details) {
  const s = await store.getSettings();
  const body = h('div', h('div', { class: 'spin' }));
  const m = modal('Download', body, { width: '600px' });
  try {
    const d = details || await svc.stream(item.service, item.id);
    const progress = h('div', { class: 'progress hide', style: { margin: '10px 0' } }, h('i'));
    const go = async (stream, kind) => {
      progress.classList.remove('hide');
      try {
        const rec = await startDownload({ item: { ...item, ...d, id: item.id }, stream, kind, settings: s, onProgress: (p) => { progress.firstChild.style.width = Math.round(p * 100) + '%'; } });
        toast(`Saved “${rec.name}”`);
        m.close();
      } catch (e) { toast('Download failed: ' + e.message, 'err'); progress.classList.add('hide'); }
    };
    const row = (st, kind, note) => h('button', { class: 'opt', onclick: () => go(st, kind) },
      icon(kind === 'audio' ? 'music' : 'play'),
      h('div', { class: 'grow' }, h('b', st.label || st.ext.toUpperCase()), h('small', [st.ext.toUpperCase(), st.size ? fmtBytes(st.size) : '', note].filter(Boolean).join(' · '))),
      icon('download'));
    const audio = (d.audio || []).filter((a) => a.url);
    const muxed = (d.video || []).filter((v) => v.url && !v.videoOnly);
    const vOnly = (d.video || []).filter((v) => v.url && v.videoOnly);
    body.replaceChildren(
      h('div', { class: 'row', style: { marginBottom: '12px' } }, h('img', { class: 'avatar', style: { borderRadius: '8px', width: '64px', height: '36px' }, src: d.thumbnail || item.thumbnail || '' }), h('div', h('b', d.title), h('div', { class: 'sub' }, d.uploader || ''))),
      progress,
      audio.length ? h('h3', { style: { margin: '14px 0 8px' } }, 'Audio') : null, ...audio.slice(0, 8).map((a) => row(a, 'audio', a.hls ? 'stitched locally' : '')),
      muxed.length ? h('h3', { style: { margin: '14px 0 8px' } }, 'Video (with sound)') : null, ...muxed.slice(0, 8).map((v) => row(v, 'video')),
      vOnly.length ? h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '14px' } }, `${vOnly.length} higher-quality video-only streams exist (e.g. ${vOnly[0].label}). Browsers cannot merge them with audio, so UPipe offers complete files only.`) : null,
      !audio.length && !muxed.length ? h('p', { class: 'muted' }, 'No downloadable streams were found.') : null,
      h('div', { class: 'row wrap', style: { marginTop: '14px' } },
        d.thumbnail ? h('button', { class: 'btn sm', onclick: () => saveThumb(d) }, icon('download'), 'Thumbnail') : null,
        d.subtitles?.length ? h('button', { class: 'btn sm', onclick: () => subtitleMenu(d, s) }, icon('download'), 'Subtitles') : null,
        h('button', { class: 'btn sm', onclick: () => saveMeta(d) }, icon('code'), 'Metadata JSON')));
  } catch (e) {
    body.replaceChildren(errorBox(e));
  }
}
async function saveThumb(d) {
  const { ext } = await import('./browser.js');
  const { safeName } = await import('./util.js');
  const s = await store.getSettings();
  const e = (d.thumbnail.split('?')[0].match(/\.(jpe?g|png|webp)$/i) || [, 'jpg'])[1];
  ext.downloads.download({ url: d.thumbnail, filename: `${safeName(s.downloadFolder)}/${safeName(d.title)}.${e}`, conflictAction: 'uniquify' }, () => void ext.runtime.lastError);
  toast('Saving thumbnail…');
}
async function subtitleMenu(d, s) {
  const { ext } = await import('./browser.js');
  const { safeName } = await import('./util.js');
  modal('Subtitles', h('div', ...d.subtitles.map((t) => h('button', { class: 'opt', onclick: () => {
    const e = /vtt/.test(t.mime || t.url) ? 'vtt' : 'srt';
    ext.downloads.download({ url: t.url, filename: `${safeName(s.downloadFolder)}/${safeName(d.title)}.${t.lang || 'sub'}.${e}`, conflictAction: 'uniquify' }, () => void ext.runtime.lastError);
    toast('Saving subtitle…');
  } }, h('div', { class: 'grow' }, h('b', t.label || t.lang), h('small', t.auto ? 'auto-generated' : '')), icon('download')))), { width: '420px' });
}
export async function saveMeta(d) {
  const { downloadText } = await import('./download.js');
  const { safeName } = await import('./util.js');
  const { audio, video, related, ...meta } = d;
  downloadText(`${safeName(d.title)}.upipe.json`, JSON.stringify({ ...meta, exportedBy: 'UPipe' }, null, 2));
}

// ---- add to playlist ------------------------------------------------------------------------
export async function playlistPicker(items) {
  const list = [].concat(items);
  const pls = await store.getPlaylists();
  const m = modal('Add to playlist', h('div',
    h('button', { class: 'opt', onclick: async () => {
      m.close();
      const name = await promptBox('New playlist', 'Playlist name');
      if (!name) return;
      await store.createPlaylist(name, list);
      toast(`Created “${name}”`);
    } }, icon('add'), h('div', { class: 'grow' }, h('b', 'New playlist…'))),
    ...pls.map((p) => h('button', { class: 'opt', onclick: async () => { await store.addToPlaylist(p.id, list); m.close(); toast(`Added to “${p.name}”`); } },
      icon('list'), h('div', { class: 'grow' }, h('b', p.name), h('small', `${p.items.length} items`))))), { width: '420px' });
}

// ---- item menu -------------------------------------------------------------------------------
export function itemMenu(ev, item, onChange) {
  ev.preventDefault();
  ev.stopPropagation();
  const r = ev.currentTarget?.getBoundingClientRect?.();
  const x = ev.clientX || (r ? r.left : 100), y = ev.clientY || (r ? r.bottom : 100);
  const entries = [];
  if (item.type === 'stream') {
    entries.push({ label: 'Play audio', icon: 'play', run: () => playOne(item) },
      { label: 'Play next', icon: 'queueNext', run: () => playItems([item], 0, 'next') },
      { label: 'Add to queue', icon: 'queueAdd', run: () => playItems([item], 0, 'enqueue') },
      { label: 'Download…', icon: 'download', run: () => downloadDialog(item) },
      '-',
      { label: 'Favorite', icon: 'heart', run: async () => { const on = await store.toggleFavorite(item); toast(on ? 'Added to favorites' : 'Removed from favorites'); onChange?.(); } },
      { label: 'Add to playlist…', icon: 'list', run: () => playlistPicker(item) });
  }
  if (item.type === 'channel') entries.push({ label: 'Subscribe / unsubscribe', icon: 'heart', run: async () => { const on = await store.toggleSub(item); toast(on ? 'Subscribed (locally)' : 'Unsubscribed'); onChange?.(); } });
  entries.push('-', { label: 'Copy link', icon: 'link', run: async () => { await copyText(shareUrl(item)); toast('Link copied'); } },
    { label: 'Open original site', icon: 'open', run: () => window.open(shareUrl(item), '_blank', 'noopener') });
  ctxMenu(x, y, entries);
}

/** Canonical link of the item on its original site. */
export function shareUrl(item) {
  if (item.url && /^https?:/.test(item.url)) return item.url;
  const id = item.id;
  switch (item.service) {
    case 'youtube': return item.type === 'channel' ? `https://www.youtube.com/channel/${id}` : item.type === 'playlist' ? `https://www.youtube.com/playlist?list=${id}` : `https://www.youtube.com/watch?v=${id}`;
    case 'soundcloud': return item.url || `https://api.soundcloud.com/tracks/${id}`;
    case 'bandcamp': return id;
    case 'ccc': return `https://media.ccc.de/v/${id}`;
    case 'peertube': { const [u, host] = id.split('@'); return item.type === 'channel' ? `https://${host}/c/${u}` : item.type === 'playlist' ? `https://${host}/w/p/${u}` : `https://${host}/w/${u}`; }
    default: return id;
  }
}

// ---- cards -----------------------------------------------------------------------------------
const img = (src, alt = '') => h('img', { src: src || '', alt, loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.style.visibility = 'hidden'; } });

export function metaLine(it) {
  const bits = [];
  if (it.type === 'stream') {
    if (it.views != null) bits.push(`${fmtNum(it.views)} ${it.service === 'soundcloud' || it.service === 'bandcamp' ? 'plays' : 'views'}`);
    if (it.uploaded) bits.push(timeAgo(it.uploaded));
  } else if (it.type === 'channel') {
    if (it.subscribers != null && typeof it.subscribers === 'number') bits.push(`${fmtNum(it.subscribers)} ${it.service === 'peertube' ? 'followers' : 'subscribers'}`);
    else if (typeof it.subscribers === 'string') bits.push(it.subscribers);
  } else if (it.count != null) bits.push(`${it.count} ${it.service === 'youtube' || it.service === 'peertube' ? 'videos' : 'tracks'}`);
  return bits.join(' · ');
}

export function card(it, ctx = {}) {
  const { items, index, onChange } = ctx;
  const sv = SERVICES[it.service];
  const verified = it.verified ? h('span', { title: 'Verified' }, icon('verified', 'verified')) : null;
  const href = itemRoute(it);
  if (it.type === 'channel') {
    return h('a', { class: 'card channel', href, style: { animationDelay: Math.min(index || 0, 20) * 15 + 'ms' } },
      h('div', { class: 'thumb round' }, img(it.thumbnail, it.title)),
      h('div', { class: 'meta' }, h('div', { class: 'txt' }, h('div', { class: 'title' }, it.title, verified), h('div', { class: 'sub' }, metaLine(it)), it.description ? h('div', { class: 'sub' }, it.description.slice(0, 80)) : null)));
  }
  const isPl = it.type === 'playlist';
  const thumbBox = h('div', { class: `thumb${sv?.kind === 'audio' || it.service === 'bandcamp' ? ' sq' : ''}` },
    img(it.thumbnail, it.title),
    it.live ? h('span', { class: 'badge live' }, 'LIVE') : null,
    isPl ? h('span', { class: 'badge type' }, 'Playlist') : null,
    it.duration ? h('span', { class: 'badge' }, fmtDur(it.duration)) : null,
    !isPl ? h('div', { class: 'play-overlay' }, h('button', { 'aria-label': 'Play audio', title: 'Play audio', onclick: (e) => { e.preventDefault(); e.stopPropagation(); items ? playItems(items, index) : playOne(it); } }, icon('play'))) : null);
  const more = h('button', { class: 'icon-btn more', 'aria-label': 'More actions', onclick: (e) => itemMenu(e, it, onChange) }, icon('more'));
  thumbBox.append(more);
  const a = h('a', { class: 'card', href, oncontextmenu: (e) => itemMenu(e, it, onChange), style: { animationDelay: Math.min(index || 0, 20) * 15 + 'ms' } },
    thumbBox,
    h('div', { class: 'meta' },
      it.uploaderAvatar && !isPl ? img(it.uploaderAvatar) : null,
      h('div', { class: 'txt' }, h('div', { class: 'title', title: it.title }, it.title),
        it.uploader ? h('div', { class: 'sub' }, it.uploaderId && !isPl ? h('a', { href: routeFor({ service: it.service, id: it.uploaderId, type: 'channel' }), onclick: (e) => e.stopPropagation() }, it.uploader) : it.uploader, it.uploaderId && !isPl && it.verified ? verified : null) : null,
        h('div', { class: 'sub' }, metaLine(it)))));
  const av = a.querySelector('.meta > img');
  if (av) av.className = 'avatar';
  return a;
}

export function listRow(it, ctx = {}) {
  const { items, index, current, onChange, number } = ctx;
  return h('div', { class: 'list-row' + (current ? ' current' : ''), onclick: () => { if (it.type === 'stream') items ? playItems(items, index) : playOne(it); else location.hash = itemRoute(it); }, oncontextmenu: (e) => itemMenu(e, it, onChange) },
    h('div', { class: 'idx' }, number ?? (index != null ? index + 1 : '')),
    h('img', { class: 't', src: it.thumbnail || '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
    h('div', { style: { minWidth: 0 } }, h('div', { class: 'title', style: { WebkitLineClamp: 1 } }, it.title), h('div', { class: 'sub' }, [it.uploader, metaLine(it)].filter(Boolean).join(' · '))),
    h('div', { class: 'dur' }, it.duration ? fmtDur(it.duration) : ''),
    h('button', { class: 'icon-btn', 'aria-label': 'More actions', onclick: (e) => itemMenu(e, it, onChange) }, icon('more')));
}

export function sideItem(it, ctx = {}) {
  return h('a', { class: 'side-item', href: itemRoute(it), oncontextmenu: (e) => itemMenu(e, it) },
    h('div', { class: 'thumb' + (SERVICES[it.service]?.kind === 'audio' ? ' sq' : '') }, img(it.thumbnail), it.duration ? h('span', { class: 'badge' }, fmtDur(it.duration)) : null),
    h('div', { class: 'txt' }, h('div', { class: 'title' }, it.title), h('div', { class: 'sub' }, it.uploader || ''), h('div', { class: 'sub' }, metaLine(it))));
}

// ---- states ----------------------------------------------------------------------------------
export function skeletonGrid(n = 12) {
  return h('div', { class: 'grid' }, Array.from({ length: n }, () => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
    h('div', { class: 'skel', style: { aspectRatio: '16/9', borderRadius: '14px' } }), h('div', { class: 'skel', style: { height: '14px', width: '90%' } }), h('div', { class: 'skel', style: { height: '12px', width: '55%' } }))));
}
export function errorBox(err, retry) {
  const msg = err?.message || String(err);
  const tip = /Failed to fetch|NetworkError|Timed out|HTTP 5|HTTP 4(03|29)|No instance|unreachable/i.test(msg)
    ? 'The public servers UPipe relies on may be busy or blocked on your network. Try again, or choose another instance in Settings → Services.' : '';
  return h('div', { class: 'errbox' }, icon('info'), h('div', { class: 'grow' }, h('b', 'Something went wrong'), h('div', { class: 'muted' }, msg), tip ? h('div', { class: 'muted', style: { marginTop: '4px' } }, tip) : null,
    retry ? h('div', { class: 'row' }, h('button', { class: 'btn sm primary', onclick: retry }, icon('refresh'), 'Try again'), h('a', { class: 'btn sm', href: '#/settings/services' }, 'Instance settings')) : null));
}
export function emptyBox(text, sub, ic = 'music') {
  return h('div', { class: 'empty' }, icon(ic), h('div', { style: { fontWeight: 650, color: 'var(--text)' } }, text), sub ? h('div', sub) : null);
}

/** Paged grid with a "Load more" button and infinite scroll. */
export function pagedGrid({ first, more, size, render }) {
  const wrap = h('div');
  const grid = h('div', { class: 'grid' + (size === 'small' ? ' small' : size === 'large' ? ' large' : '') });
  const foot = h('div', { class: 'more-row' });
  const all = [];
  let next = null, busy = false, done = false;
  const draw = (items) => { const start = all.length; all.push(...items); items.forEach((it, i) => grid.append((render || card)(it, { items: all, index: start + i }))); };
  const loadMore = async () => {
    if (busy || done || !next) return;
    busy = true;
    foot.replaceChildren(h('div', { class: 'spin' }));
    try {
      const r = await more(next);
      draw(r.items);
      next = r.next;
    } catch (e) { foot.replaceChildren(errorBox(e, () => { busy = false; loadMore(); })); busy = false; return; }
    busy = false;
    if (!next) { done = true; foot.replaceChildren(); } else foot.replaceChildren(h('button', { class: 'btn', onclick: loadMore }, 'Load more'));
  };
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && foot.querySelector('button')) loadMore(); }, { rootMargin: '600px' });
  io.observe(foot);
  wrap.append(grid, foot);
  wrap.start = async () => {
    grid.replaceChildren();
    all.length = 0;
    foot.replaceChildren();
    wrap.insertBefore(skeletonGrid(12), grid);
    grid.classList.add('hide');
    try {
      const r = await first();
      wrap.querySelector(':scope > .grid:not(.hide)')?.remove();
      grid.classList.remove('hide');
      if (!r.items.length) { wrap.replaceChildren(emptyBox('Nothing found', 'Try different words, or switch service in the sidebar.', 'search')); return r; }
      draw(r.items);
      next = r.next;
      if (next) foot.replaceChildren(h('button', { class: 'btn', onclick: loadMore }, 'Load more'));
      return r;
    } catch (e) {
      wrap.replaceChildren(errorBox(e, () => { wrap.replaceChildren(grid, foot); wrap.start(); }));
      return null;
    }
  };
  wrap.dispose = () => io.disconnect();
  return wrap;
}

export { fmtBytes, hostOf, pickAudio };
