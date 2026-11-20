// UPipe audio player page. Receives items from the feed (via the background worker), resolves each to
// an audio stream on demand, and plays them from a persistent queue.
import { ext, send } from '../lib/browser.js';
import { h, $, fmtDur, fmtNum, fmtInt, timeAgo, copyText, linkify, sanitizeHtml, debounce, clamp, enc } from '../lib/util.js';
import { icon } from '../lib/icons.js';
import { SERVICES } from '../lib/config.js';
import { applyTheme } from '../lib/theme.js';
import * as store from '../lib/store.js';
import * as svc from '../lib/services/index.js';
import { attach } from '../lib/hls.js';
import { toast, downloadDialog, shareUrl, playlistPicker, confirmBox, promptBox } from '../lib/ui.js';
import { routeFor } from '../lib/urls.js';

const audio = new Audio();
audio.preload = 'auto';
let s, q = { items: [], index: -1 };
let details = null, token = 0, detach = () => {}, retried = false, failStreak = 0;
let shuffle = false, repeat = 'off';
const played = new Set();
const backStack = [];
let sleepTimer = null, sleepEnd = 0, sleepAtEnd = false;
let pendingSeconds = 0, lastT = 0, countedPlay = false;

const el = {};
const keyOf = store.keyOf;
const cur = () => q.items[q.index] || null;
const persist = debounce(() => store.saveQueue({ items: q.items, index: q.index }), 300);

// ---- UI --------------------------------------------------------------------------------------
function build() {
  const root = $('#player');
  el.cover = h('img', { alt: '', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.style.opacity = 0; } });
  el.ph = h('div', { class: 'ph' }, icon('music'));
  el.loading = h('div', { class: 'loading hide' }, h('div', { class: 'spin' }));
  el.coverWrap = h('div', { class: 'cover-wrap' }, el.ph, el.cover, el.loading);
  el.src = h('div', { class: 'src' }, h('i'), h('span', 'UPipe'));
  el.title = h('h1', 'Nothing playing');
  el.by = h('div', { class: 'by' }, 'Pick something from the home or search page.');
  el.cur = h('span', '0:00'); el.dur = h('span', '0:00');
  el.seek = h('input', { type: 'range', min: 0, max: 1000, value: 0, step: 1, 'aria-label': 'Seek', oninput: () => { if (isFinite(audio.duration)) audio.currentTime = (el.seek.value / 1000) * audio.duration; } });
  el.playBtn = h('button', { class: 'icon-btn big', 'aria-label': 'Play', onclick: toggle }, icon('play'));
  el.shuf = h('button', { class: 'icon-btn', title: 'Shuffle', 'aria-label': 'Shuffle', onclick: () => { shuffle = !shuffle; paintModes(); toast(shuffle ? 'Shuffle on' : 'Shuffle off'); } }, icon('shuffle'));
  el.rep = h('button', { class: 'icon-btn', title: 'Repeat', 'aria-label': 'Repeat', onclick: () => { repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'; paintModes(); } }, icon('repeat'));
  el.fav = h('button', { class: 'icon-btn', title: 'Favorite', 'aria-label': 'Favorite', onclick: async () => { if (!cur()) return; await store.toggleFavorite(cur()); paintFav(); } }, icon('heartOutline'));
  el.speed = h('select', { 'aria-label': 'Speed', onchange: () => { audio.playbackRate = +el.speed.value; } }, [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2].map((v) => h('option', { value: v }, v + '×')));
  el.sleep = h('select', { 'aria-label': 'Sleep timer', onchange: () => setSleep(el.sleep.value) },
    h('option', { value: '' }, 'Sleep: off'), ...[15, 30, 45, 60].map((m) => h('option', { value: m }, `Sleep: ${m} min`)), h('option', { value: 'end' }, 'Sleep: end of track'));
  el.vol = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: s.volume, 'aria-label': 'Volume', oninput: () => { audio.volume = +el.vol.value; audio.muted = false; saveVol(); } });
  el.muteBtn = h('button', { class: 'icon-btn', title: 'Mute', 'aria-label': 'Mute', onclick: () => { audio.muted = !audio.muted; paintVol(); } }, icon('volume'));
  el.stats = h('div', { class: 'stats' });
  el.desc = h('div', { class: 'desc-t' });
  el.meta = h('div', { class: 'meta-panel hide' }, el.stats, el.desc);
  el.list = h('div', { class: 'list' });
  el.qcount = h('span', { class: 'muted' }, '');

  const np = h('section', { class: 'np' },
    h('div', { class: 'brandbar' }, h('div', { class: 'logo' }, icon('play')), h('b', 'UPipe'), h('span', { class: 'spacer' }),
      h('button', { class: 'icon-btn', title: 'Open UPipe', 'aria-label': 'Open UPipe', onclick: () => send({ type: 'app:open', hash: '#/' }) }, icon('home'))),
    el.coverWrap,
    h('div', { class: 'info' }, el.src, el.title, el.by),
    h('div', { class: 'seek' }, el.cur, el.seek, el.dur),
    h('div', { class: 'ctrls' }, el.shuf, h('button', { class: 'icon-btn', 'aria-label': 'Previous', title: 'Previous (P)', onclick: prev }, icon('prev')), el.playBtn,
      h('button', { class: 'icon-btn', 'aria-label': 'Next', title: 'Next (N)', onclick: () => next(true) }, icon('next')), el.rep),
    h('div', { class: 'sec-row' }, el.fav,
      h('button', { class: 'icon-btn', title: 'Download', 'aria-label': 'Download', onclick: () => cur() && downloadDialog(cur(), details) }, icon('download')),
      h('button', { class: 'icon-btn', title: 'Add to playlist', 'aria-label': 'Add to playlist', onclick: () => cur() && playlistPicker(cur()) }, icon('list')),
      h('button', { class: 'icon-btn', title: 'Open page in UPipe', 'aria-label': 'Open page in UPipe', onclick: () => cur() && send({ type: 'app:open', hash: routeFor({ service: cur().service, id: cur().id, type: 'stream' }) }) }, icon('open')),
      h('button', { class: 'icon-btn', title: 'Copy link', 'aria-label': 'Copy link', onclick: async () => { if (cur()) { await copyText(shareUrl(cur())); toast('Link copied'); } } }, icon('link'))),
    h('div', { class: 'sec-row' }, el.speed, el.sleep, h('div', { class: 'vol' }, el.muteBtn, el.vol)),
    el.meta,
    h('div', { class: 'hint' }, 'Space play/pause · ←/→ seek · ↑/↓ volume · N/P next/previous'));

  const queue = h('section', { class: 'queue' },
    h('div', { class: 'qhead' }, h('h2', 'Up next ', el.qcount),
      h('button', { class: 'btn sm', onclick: async () => { if (!q.items.length) return; const n = await promptBox('Save queue as playlist', 'Name', 'Queue ' + new Date().toLocaleDateString()); if (n) { await store.createPlaylist(n, q.items); toast('Playlist saved'); } } }, icon('add'), 'Save'),
      h('button', { class: 'btn sm danger', onclick: async () => { if (q.items.length > 1 && !(await confirmBox('Clear queue?', 'Playback will stop.', 'Clear'))) return; stopAll(); q = { items: [], index: -1 }; persist(); renderQueue(); renderNow(); } }, icon('trash'), 'Clear')),
    el.list);
  root.replaceChildren(h('div', { class: 'pl' }, np, queue));
  paintVol(); paintModes();
}

function paintModes() {
  el.shuf.classList.toggle('on', shuffle);
  el.rep.classList.toggle('on', repeat !== 'off');
  el.rep.replaceChildren(icon(repeat === 'one' ? 'repeat1' : 'repeat'));
  el.rep.title = `Repeat: ${repeat}`;
}
function paintVol() { el.muteBtn.replaceChildren(icon(audio.muted || audio.volume === 0 ? 'mute' : 'volume')); }
const saveVol = debounce(() => store.setSettings({ volume: audio.volume }), 600);
async function paintFav() {
  const c = cur();
  const on = c && (await store.isFavorite(c));
  el.fav.replaceChildren(icon(on ? 'heart' : 'heartOutline'));
  el.fav.classList.toggle('on', !!on);
}
function paintPlay() {
  const playing = !audio.paused && !audio.ended;
  el.playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
  el.playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  el.coverWrap.classList.toggle('playing', playing);
  document.body.classList.toggle('paused', !playing);
  const c = cur();
  document.title = c ? `${playing ? '▶ ' : ''}${c.title}${c.uploader ? ' — ' + c.uploader : ''}` : 'UPipe Player';
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

function renderNow(partial) {
  const c = cur();
  const d = partial ? null : details;
  if (!c) {
    el.title.textContent = 'Nothing playing'; el.by.textContent = 'Pick something from the home or search page.'; el.cover.removeAttribute('src'); el.ph.classList.remove('hide');
    el.meta.classList.add('hide'); el.src.lastChild.textContent = 'UPipe'; applyTheme(s, s.service); paintPlay(); paintFav(); return;
  }
  const sv = SERVICES[c.service];
  applyTheme(s, c.service);
  el.src.lastChild.textContent = sv?.name || 'UPipe';
  el.title.textContent = d?.title || c.title;
  el.by.replaceChildren();
  const who = d?.uploader || c.uploader;
  if (who) {
    const uid = d?.uploaderId || c.uploaderId;
    el.by.append(uid ? h('a', { onclick: () => send({ type: 'app:open', hash: routeFor({ service: c.service, id: uid, type: 'channel' }) }) }, who) : who);
    if (c.album || d?.album) el.by.append(' · ' + (d?.album || c.album));
  }
  const thumb = d?.thumbnail || c.thumbnail;
  el.cover.style.opacity = 1;
  if (thumb) { el.cover.src = thumb; el.ph.classList.add('hide'); } else { el.cover.removeAttribute('src'); el.ph.classList.remove('hide'); }
  if (d) {
    el.meta.classList.remove('hide');
    const chip = (ic, t) => (t ? h('span', { class: 'chip', style: { cursor: 'default' } }, icon(ic), t) : null);
    el.stats.replaceChildren(chip('eye', d.views != null ? fmtNum(d.views) : ''), chip('thumb', d.likes != null ? fmtNum(d.likes) : ''), chip('history', d.uploaded ? timeAgo(d.uploaded) : ''),
      chip('music', d.audio_label || ''), chip('globe', d.license || ''),
      ...(d.tags || []).slice(0, 8).map((t) => h('a', { class: 'chip', onclick: () => send({ type: 'app:open', hash: `#/search?q=${enc(t)}&s=${c.service}` }) }, '#' + t)));
    el.desc.replaceChildren(d.descriptionIsHtml ? sanitizeHtml(d.description) : linkify(d.description || ''));
    el.desc.classList.toggle('hide', !d.description);
  } else { el.meta.classList.add('hide'); }
  if (!partial) paintFav();
  paintPlay();
}

function renderQueue() {
  el.qcount.textContent = q.items.length ? `· ${q.items.length}` : '';
  if (!q.items.length) { el.list.replaceChildren(h('div', { class: 'empty-q' }, 'The queue is empty.')); return; }
  let dragFrom = null;
  el.list.replaceChildren(...q.items.map((it, i) => {
    const row = h('div', { class: 'qitem' + (i === q.index ? ' cur' : ''), draggable: 'true', onclick: () => playIndex(i) },
      i === q.index ? h('span', { class: 'eq' }, h('i'), h('i'), h('i')) : h('span', { class: 'n' }, i + 1),
      h('img', { src: it.thumbnail || '', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 'title', style: { WebkitLineClamp: 1 } }, it.title), h('div', { class: 'sub' }, [it.uploader, SERVICES[it.service]?.name].filter(Boolean).join(' · '))),
      h('div', { class: 'sub' }, it.duration ? fmtDur(it.duration) : ''),
      h('button', { class: 'icon-btn', 'aria-label': 'Remove from queue', onclick: (e) => { e.stopPropagation(); removeAt(i); } }, icon('close')));
    row.addEventListener('dragstart', (e) => { dragFrom = i; row.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', () => row.classList.remove('drag'));
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('over'); });
    row.addEventListener('dragleave', () => row.classList.remove('over'));
    row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('over'); if (dragFrom != null && dragFrom !== i) moveItem(dragFrom, i); });
    return row;
  }));
  el.list.querySelector('.cur')?.scrollIntoView({ block: 'nearest' });
}

function moveItem(from, to) {
  const curItem = cur();
  const [it] = q.items.splice(from, 1);
  q.items.splice(to, 0, it);
  q.index = q.items.indexOf(curItem);
  persist(); renderQueue();
}
function removeAt(i) {
  const wasCur = i === q.index;
  q.items.splice(i, 1);
  if (i < q.index) q.index--;
  if (wasCur) { if (q.items.length) { q.index = Math.min(i, q.items.length - 1); playIndex(q.index); } else { stopAll(); q.index = -1; renderNow(); } }
  persist(); renderQueue();
}

// ---- playback --------------------------------------------------------------------------------
function stopAll() { token++; detach(); detach = () => {}; audio.pause(); audio.removeAttribute('src'); audio.load(); details = null; flushSeconds(); }

async function playIndex(i, { autoplay = true, seekTo = 0 } = {}) {
  if (i < 0 || i >= q.items.length) return;
  const prevItem = cur();
  if (prevItem && i !== q.index) backStack.push(q.index);
  q.index = i;
  const item = cur();
  played.add(keyOf(item));
  persist(); renderQueue(); renderNow(true);
  await loadCurrent({ autoplay, retry: false, seekTo });
}

async function loadCurrent({ autoplay, retry, seekTo = 0 }) {
  const my = ++token;
  const item = cur();
  if (!item) return;
  detach(); detach = () => {};
  audio.pause();
  el.loading.classList.remove('hide');
  countedPlay = false; lastT = 0;
  try {
    const d = await svc.stream(item.service, item.id);
    if (my !== token) return;
    d.service = item.service; d.id = item.id;
    const a = svc.pickAudio(d.audio, s);
    if (!a) throw new Error('No audio stream available for this item.');
    details = { ...d, audio_label: a.label };
    // refresh queue entry with the richer metadata we just learned
    Object.assign(item, store.slim({ ...item, title: d.title || item.title, uploader: d.uploader || item.uploader, uploaderId: d.uploaderId || item.uploaderId, thumbnail: d.thumbnail || item.thumbnail, duration: d.duration || item.duration, album: d.album || item.album }));
    detach = await attach(audio, a.url, { hls: a.hls, startAt: seekTo, onError: (e) => toast(e.message, 'err') });
    audio.playbackRate = +el.speed.value || 1;
    renderNow(); renderQueue(); setMediaSession();
    if (autoplay) {
      try { await audio.play(); } catch (e) { if (e.name !== 'AbortError') toast('Press play to start (the browser blocked autoplay)'); }
    }
    persist();
    store.addHistory(item);
  } catch (e) {
    if (my !== token) return;
    failStreak++;
    toast(`${item.title}: ${e.message}`, 'err');
    el.loading.classList.add('hide');
    if (autoplay && failStreak < 4 && q.index < q.items.length - 1) setTimeout(() => { if (my === token) next(false); }, 1200);
  }
}

function toggle() {
  if (!cur()) return;
  if (!audio.src && !audio.currentSrc) return loadCurrent({ autoplay: true });
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
}
function pickNext() {
  if (!q.items.length) return -1;
  if (shuffle && q.items.length > 1) {
    const pool = q.items.map((_, i) => i).filter((i) => i !== q.index && !played.has(keyOf(q.items[i])));
    if (!pool.length) { if (repeat !== 'all') return -1; played.clear(); return pickNext(); }
    return pool[Math.floor(Math.random() * pool.length)];
  }
  if (q.index < q.items.length - 1) return q.index + 1;
  return repeat === 'all' ? 0 : -1;
}
async function next(manual) {
  failStreak = manual ? 0 : failStreak;
  let i = pickNext();
  if (i < 0 && !manual && s.autoplayNext && details?.related?.length) {
    const have = new Set(q.items.map(keyOf));
    const add = details.related.filter((r) => r.type === 'stream' && !have.has(keyOf(r))).slice(0, 10).map(store.slim);
    if (add.length) { q.items.push(...add); i = q.index + 1; renderQueue(); toast('Queue ended — added related tracks'); }
  }
  if (i < 0) { if (manual) toast('End of queue'); else { audio.pause(); audio.currentTime = 0; paintPlay(); } return; }
  playIndex(i);
}
function prev() {
  if (audio.currentTime > 4 || !q.items.length) { audio.currentTime = 0; return; }
  const b = backStack.pop();
  if (b != null && q.items[b]) { const keep = backStack.slice(); playIndex(b); backStack.length = 0; backStack.push(...keep); return; }
  if (q.index > 0) playIndex(q.index - 1); else audio.currentTime = 0;
}

// ---- queue commands from the rest of the extension -------------------------------------------
function handle(p) {
  if (!p) return;
  const items = (p.items || []).map(store.slim);
  if (p.mode === 'play' && items.length) {
    q = { items, index: -1 }; played.clear(); backStack.length = 0; playIndex(clamp(p.index || 0, 0, items.length - 1));
  } else if (p.mode === 'enqueue' && items.length) {
    const wasEmpty = !q.items.length;
    const have = new Set(q.items.map(keyOf));
    q.items.push(...items.filter((i) => !have.has(keyOf(i))));
    persist(); renderQueue();
    if (wasEmpty) playIndex(0);
  } else if (p.mode === 'next' && items.length) {
    const wasEmpty = !q.items.length;
    q.items = q.items.filter((x) => !items.some((i) => keyOf(i) === keyOf(x) && keyOf(x) !== keyOf(cur() || {})));
    const at = q.items.findIndex((x) => keyOf(x) === keyOf(cur() || {}));
    q.items.splice(at + 1, 0, ...items);
    persist(); renderQueue();
    if (wasEmpty) playIndex(0);
  }
}

// ---- media session, stats, sleep -------------------------------------------------------------
function setMediaSession() {
  if (!('mediaSession' in navigator) || !details) return;
  const art = details.thumbnail ? [{ src: details.thumbnail, sizes: '512x512' }] : [];
  navigator.mediaSession.metadata = new MediaMetadata({ title: details.title, artist: details.uploader || '', album: details.album || SERVICES[details.service]?.name || 'UPipe', artwork: art });
}
function initMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const set = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch { /* unsupported */ } };
  set('play', () => audio.play()); set('pause', () => audio.pause()); set('previoustrack', prev); set('nexttrack', () => next(true));
  set('seekbackward', () => { audio.currentTime = Math.max(0, audio.currentTime - 10); }); set('seekforward', () => { audio.currentTime += 10; });
  set('seekto', (d) => { audio.currentTime = d.seekTime; });
}
function flushSeconds() { if (pendingSeconds >= 1) { store.bumpStats({ seconds: Math.round(pendingSeconds) }); pendingSeconds = 0; } }
setInterval(flushSeconds, 15000);
addEventListener('pagehide', flushSeconds);

function setSleep(v) {
  clearTimeout(sleepTimer); sleepTimer = null; sleepAtEnd = false; sleepEnd = 0;
  if (!v) return toast('Sleep timer off');
  if (v === 'end') { sleepAtEnd = true; return toast('Will stop after this track'); }
  sleepEnd = Date.now() + v * 60000;
  sleepTimer = setTimeout(fadeOut, v * 60000);
  toast(`Sleeping in ${v} minutes`);
}
function fadeOut() {
  const v0 = audio.volume; let step = 0;
  const t = setInterval(() => { step++; audio.volume = Math.max(0, v0 * (1 - step / 20)); if (step >= 20) { clearInterval(t); audio.pause(); audio.volume = v0; el.sleep.value = ''; } }, 100);
}

// ---- audio element events --------------------------------------------------------------------
function wire() {
  audio.addEventListener('timeupdate', () => {
    const t = audio.currentTime, d = audio.duration;
    el.cur.textContent = fmtDur(t) || '0:00';
    if (isFinite(d) && d > 0) { el.dur.textContent = fmtDur(d); el.seek.value = (t / d) * 1000; el.seek.style.setProperty('--p', (t / d) * 100 + '%'); if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) { try { navigator.mediaSession.setPositionState({ duration: d, position: t, playbackRate: audio.playbackRate }); } catch { /* ignore */ } } }
    const dt = t - lastT;
    if (dt > 0 && dt < 2 && !audio.paused) pendingSeconds += dt;
    lastT = t;
    if (!countedPlay && t > 8) { countedPlay = true; failStreak = 0; store.bumpStats({ plays: 1 }); }
  });
  audio.addEventListener('loadedmetadata', () => { if (isFinite(audio.duration)) el.dur.textContent = fmtDur(audio.duration); });
  audio.addEventListener('play', paintPlay); audio.addEventListener('pause', paintPlay);
  audio.addEventListener('playing', () => { el.loading.classList.add('hide'); paintPlay(); });
  audio.addEventListener('waiting', () => el.loading.classList.remove('hide'));
  audio.addEventListener('canplay', () => el.loading.classList.add('hide'));
  audio.addEventListener('volumechange', () => { el.vol.value = audio.volume; paintVol(); });
  audio.addEventListener('ended', () => {
    if (sleepAtEnd) { sleepAtEnd = false; el.sleep.value = ''; paintPlay(); toast('Sleep timer: stopped'); return; }
    if (repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
    next(false);
  });
  audio.addEventListener('error', () => {
    if (!cur() || !audio.src) return;
    if (!retried) { retried = true; toast('Stream expired — refreshing…'); loadCurrent({ autoplay: true, retry: true, seekTo: audio.currentTime || 0 }).finally(() => setTimeout(() => { retried = false; }, 4000)); return; }
    toast('This stream cannot be played.', 'err');
    el.loading.classList.add('hide');
    if (q.index < q.items.length - 1) setTimeout(() => next(false), 1200);
  });

  addEventListener('keydown', (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && e.target.type !== 'range') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
    else if (k === 'ArrowRight') { e.preventDefault(); audio.currentTime += 5; }
    else if (k === 'ArrowLeft') { e.preventDefault(); audio.currentTime -= 5; }
    else if (k === 'ArrowUp') { e.preventDefault(); audio.volume = clamp(audio.volume + 0.05, 0, 1); saveVol(); }
    else if (k === 'ArrowDown') { e.preventDefault(); audio.volume = clamp(audio.volume - 0.05, 0, 1); saveVol(); }
    else if (k === 'n' || k === 'N') next(true);
    else if (k === 'p' || k === 'P') prev();
    else if (k === 'm' || k === 'M') { audio.muted = !audio.muted; paintVol(); }
    else if (k === 's' || k === 'S') el.shuf.click();
    else if (k === 'r' || k === 'R') el.rep.click();
  });
  ext.runtime.onMessage.addListener((msg) => { if (msg?.type === 'player:command') handle(msg.payload); });
  ext.storage.onChanged.addListener((ch, area) => {
    if (area === 'local' && ch.queue && JSON.stringify(ch.queue.newValue) !== JSON.stringify({ items: q.items, index: q.index })) {
      // another page enqueued while we were closed/asleep: merge any new items
      const nv = ch.queue.newValue;
      if (nv?.items && nv.items.length > q.items.length) { const have = new Set(q.items.map(keyOf)); q.items.push(...nv.items.filter((i) => !have.has(keyOf(i)))); renderQueue(); }
    }
  });
}

// ---- boot ------------------------------------------------------------------------------------
(async function boot() {
  s = await store.getSettings();
  applyTheme(s, s.service);
  store.onSettings((n) => { s = n; applyTheme(s, cur()?.service || s.service); });
  audio.volume = s.volume;
  build(); wire(); initMediaSession();
  el.speed.value = String(s.defaultSpeed || 1);
  if (![...el.speed.options].some((o) => +o.value === +el.speed.value)) el.speed.append(h('option', { value: s.defaultSpeed, selected: true }, s.defaultSpeed + '×'));
  audio.playbackRate = +el.speed.value;
  q = await store.getQueue();
  if (!Array.isArray(q.items)) q = { items: [], index: -1 };
  renderQueue(); renderNow(true);
  const hello = await send({ type: 'player:hello' });
  if (hello?.pending) handle(hello.pending);
  else if (q.items.length && q.index >= 0) { renderNow(true); loadCurrent({ autoplay: false }); }
})();
