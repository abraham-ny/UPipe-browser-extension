import { h, fmtNum, fmtInt, fmtDur, fmtDate, timeAgo, fmtBytes, copyText, sanitizeHtml, linkify, enc } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { SERVICES } from '../../lib/config.js';
import * as store from '../../lib/store.js';
import * as svc from '../../lib/services/index.js';
import { routeFor } from '../../lib/urls.js';
import { attach } from '../../lib/hls.js';
import { getText } from '../../lib/http.js';
import { toast, errorBox, playItems, playOne, downloadDialog, playlistPicker, saveMeta, shareUrl, sideItem, skeletonGrid } from '../../lib/ui.js';

const toSeconds = (t) => {
  if (!t) return 0;
  if (/^\d+$/.test(t)) return +t;
  const m = /(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/.exec(t) || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
};

function srtToVtt(txt) {
  if (/^WEBVTT/.test(txt)) return txt;
  return 'WEBVTT\n\n' + txt.replace(/\r/g, '').replace(/(\d+:\d+:\d+),(\d+)/g, '$1.$2');
}

/** Build the inline video player (muxed stream, or a video-only + audio pair kept in sync). */
function buildVideo(d, s, startAt) {
  const video = h('video', { controls: true, playsinline: true, preload: 'metadata', poster: d.thumbnail || '', 'aria-label': d.title });
  const audioEl = new Audio();
  audioEl.preload = 'auto';
  const stage = h('div', { class: 'stage' }, video);
  const muxed = (d.video || []).filter((v) => !v.videoOnly && v.url).sort((a, b) => (b.height || 0) - (a.height || 0));
  const only = (d.video || []).filter((v) => v.videoOnly && v.url && /mp4|avc|h264/i.test((v.mime || '') + (v.codec || '') + (v.ext || ''))).sort((a, b) => (b.height || 0) - (a.height || 0));
  const bestAudio = svc.pickAudio((d.audio || []).filter((a) => a.ext === 'm4a'), { audioQuality: 'high' }) || svc.pickAudio(d.audio, { audioQuality: 'high' });
  const options = [];
  if (d.live && d.hls) options.push({ label: 'Live (auto)', hls: d.hls });
  else if (d.hls && !muxed.length && !only.length) options.push({ label: 'Auto (HLS)', hls: d.hls });
  muxed.forEach((v) => options.push({ label: `${v.label}${/webm/.test(v.ext) ? '' : ''}`, v }));
  if (bestAudio) { const seen = new Set(muxed.map((m) => m.height)); only.filter((v) => !seen.has(v.height)).forEach((v) => { seen.add(v.height); options.push({ label: `${v.label} · HD`, v, split: bestAudio }); }); }
  if (!options.length) return null;
  options.sort((a, b) => (b.v?.height || 9999) - (a.v?.height || 9999));
  const pref = options.find((o) => !o.split && (o.v?.height || 0) <= 720 && o.v) || options.find((o) => !o.hls) || options[0];

  let off = () => {};
  let sync = null;
  const volBox = h('label', { class: 'row hide', style: { fontSize: '12px' } }, icon('volume'), h('input', { type: 'range', min: 0, max: 1, step: 0.02, value: s.volume ?? 0.9, 'aria-label': 'Volume', oninput: (e) => { audioEl.volume = +e.target.value; } }));
  const select = h('select', { class: 'field', style: { minWidth: 0 }, 'aria-label': 'Quality', onchange: () => load(options[select.selectedIndex], true) }, options.map((o, i) => h('option', { selected: o === pref }, o.label)));

  function stopSync() {
    if (!sync) return;
    sync.forEach(([ev, fn, t]) => (t || video).removeEventListener(ev, fn));
    sync = null;
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
  }
  function startSync() {
    const d1 = () => { if (Math.abs(audioEl.currentTime - video.currentTime) > 0.25) audioEl.currentTime = video.currentTime; };
    const play = () => { d1(); audioEl.play().catch(() => {}); };
    sync = [['play', play], ['playing', play], ['pause', () => audioEl.pause()], ['seeking', d1], ['seeked', d1], ['timeupdate', d1],
      ['waiting', () => audioEl.pause()], ['ratechange', () => { audioEl.playbackRate = video.playbackRate; }]];
    sync.forEach(([ev, fn]) => video.addEventListener(ev, fn));
  }
  async function load(o, keep) {
    const at = keep ? video.currentTime : startAt;
    const wasPlaying = keep && !video.paused;
    off();
    stopSync();
    volBox.classList.toggle('hide', !o.split);
    video.muted = false;
    try {
      if (o.hls) off = await attach(video, o.hls, { hls: true, startAt: at, onError: (e) => toast(e.message, 'err') });
      else { off = await attach(video, o.v.url, { startAt: at }); }
      if (o.split) {
        audioEl.src = o.split.url;
        audioEl.volume = +volBox.querySelector('input').value;
        video.muted = true;
        startSync();
      }
      if (wasPlaying) video.play().catch(() => {});
    } catch (e) { toast(e.message, 'err'); }
  }
  video.addEventListener('error', () => toast('This video stream could not be played. Try another quality, or open the audio player.', 'err'));
  video.addEventListener('ratechange', () => { audioEl.playbackRate = video.playbackRate; });
  video.playbackRate = s.defaultSpeed || 1;
  load(pref, false);
  return { stage, video, select, volBox, dispose: () => { off(); stopSync(); video.pause(); video.removeAttribute('src'); video.load(); } };
}

function statChip(ic, text) { return text ? h('span', { class: 'chip', style: { cursor: 'default' } }, icon(ic), text) : null; }

function commentView(c, d, s, depth = 0) {
  const body = h('div', { class: 'body' });
  if (c.md || c.text) body.append(linkify(c.html));
  else body.append(sanitizeHtml(c.html));
  const el = h('div', { class: 'comment' },
    c.avatar ? h('img', { class: 'avatar', src: c.avatar, loading: 'lazy', referrerpolicy: 'no-referrer', alt: '' }) : h('div', { class: 'avatar' }),
    h('div',
      h('div', { class: 'by' }, c.authorId && d.service !== 'soundcloud' ? h('a', { href: routeFor({ service: d.service, id: c.authorId, type: 'channel' }) }, c.author) : c.author,
        c.owner ? h('span', { class: 'badge-s owner' }, 'creator') : null, c.pinned ? h('span', { class: 'badge-s' }, 'pinned') : null, c.hearted ? h('span', { class: 'badge-s' }, '♥ by creator') : null,
        h('small', c.time || '')),
      c.at != null ? h('div', { class: 'sub' }, `at ${fmtDur(c.at)}`) : null,
      body,
      h('div', { class: 'row sub' }, c.likes != null ? h('span', `👍 ${fmtNum(c.likes)}`) : null,
        c.replies > 0 && c.replyToken && depth === 0 ? h('button', { class: 'btn sm ghost', onclick: (e) => loadReplies(e.currentTarget) }, `${c.replies} ${c.replies === 1 ? 'reply' : 'replies'}`) : null),
      h('div', { class: 'replies hide' })));
  async function loadReplies(btn) {
    const box = el.querySelector('.replies');
    if (!box.classList.contains('hide')) { box.classList.add('hide'); return; }
    box.classList.remove('hide');
    if (box.childElementCount) return;
    box.append(h('div', { class: 'spin' }));
    try {
      const r = await svc.replies(d.service, d.id, c.replyToken);
      box.replaceChildren(...r.items.map((x) => commentView(x, d, s, 1)));
    } catch (e) { box.replaceChildren(errorBox(e)); }
  }
  return el;
}

function commentsSection(d, s) {
  const list = h('div');
  const foot = h('div', { class: 'more-row' });
  const sec = h('section', { style: { marginTop: '26px' } }, h('h2', { style: { marginBottom: '8px' } }, 'Comments', d.comments_count != null ? h('span', { class: 'muted', style: { fontWeight: 400 } }, ` · ${fmtInt(d.comments_count)}`) : null), list, foot);
  let next = null, started = false, busy = false;
  const load = async (page) => {
    if (busy) return;
    busy = true;
    foot.replaceChildren(h('div', { class: 'spin' }));
    try {
      const r = await svc.comments(d.service, d.id, page);
      if (r.disabled) { sec.replaceChildren(h('h2', 'Comments'), h('p', { class: 'muted' }, 'Comments are turned off or not available for this item.')); return; }
      if (!r.items.length && !page) { foot.replaceChildren(h('p', { class: 'muted' }, 'No comments yet.')); busy = false; return; }
      r.items.forEach((c) => list.append(commentView(c, d, s)));
      next = r.next;
      foot.replaceChildren(next ? h('button', { class: 'btn', onclick: () => load(next) }, 'Load more comments') : '');
    } catch (e) { foot.replaceChildren(errorBox(e, () => load(page))); }
    busy = false;
  };
  if (['bandcamp', 'ccc'].includes(d.service)) return null;
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting) && !started) { started = true; load(null); io.disconnect(); } }, { rootMargin: '300px' });
  io.observe(foot);
  foot.replaceChildren(h('button', { class: 'btn', onclick: () => { if (!started) { started = true; load(null); } } }, 'Load comments'));
  sec.dispose = () => io.disconnect();
  return sec;
}

export async function render({ params, settings: s, setOverride }) {
  const service = SERVICES[params.s] ? params.s : s.service;
  const id = params.id;
  setOverride?.(service);
  const root = h('div', { class: 'watch' });
  const main = h('div', { style: { minWidth: 0 } });
  const side = h('aside', h('div', { class: 'side-list' }, h('div', { class: 'skel', style: { height: '90px' } }), h('div', { class: 'skel', style: { height: '90px' } }), h('div', { class: 'skel', style: { height: '90px' } })));
  root.append(main, side);
  main.append(h('div', { class: 'skel', style: { aspectRatio: '16/9', borderRadius: '14px' } }), h('div', { class: 'skel', style: { height: '28px', width: '70%', marginTop: '16px' } }));
  const view = { el: root, title: '', cleanup: [] };
  view.dispose = () => view.cleanup.forEach((f) => { try { f(); } catch { /* ignore */ } });

  const load = async () => {
    let d;
    try { d = await svc.stream(service, id); } catch (e) {
      main.replaceChildren(errorBox(e, () => { main.replaceChildren(h('div', { class: 'spin' })); load(); }));
      side.replaceChildren();
      return;
    }
    d.service = service; d.id = id; d.type = 'stream';
    view.title = d.title;
    document.title = d.title + ' · UPipe';
    store.addHistory(d);
    main.replaceChildren();
    side.replaceChildren();

    // ---- stage
    const isVideoSvc = SERVICES[service].kind === 'video' && ((d.video || []).length || d.hls);
    const startAt = toSeconds(params.t);
    let vp = null;
    if (isVideoSvc) {
      vp = buildVideo(d, s, startAt);
      if (vp) { main.append(vp.stage); view.cleanup.push(vp.dispose); }
    }
    if (!vp) {
      main.append(h('div', { class: 'stage audio-hero' },
        h('img', { class: 'cover', src: d.thumbnail || '', alt: '', referrerpolicy: 'no-referrer' }),
        h('div', h('div', { class: 'tag muted', style: { textTransform: 'uppercase', letterSpacing: '.1em', fontSize: '11px', fontWeight: 700 } }, d.album ? `From ${d.album}` : SERVICES[service].name),
          h('h1', { style: { fontSize: '30px', margin: '6px 0 6px' } }, d.title),
          h('div', { class: 'sub', style: { fontSize: '15px' } }, d.uploaderId ? h('a', { href: routeFor({ service, id: d.uploaderId, type: 'channel' }) }, d.uploader) : d.uploader),
          h('div', { class: 'row wrap', style: { marginTop: '16px' } }, h('button', { class: 'btn primary', onclick: () => playOne(d) }, icon('play'), 'Play in audio player'),
            d.albumTracks?.length > 1 ? h('button', { class: 'btn', onclick: () => playItems(d.albumTracks, 0) }, icon('list'), 'Play whole album') : null))));
    } else {
      main.append(h('h1', d.title));
    }

    // ---- actions
    const favBtn = h('button', { class: 'btn' }, icon('heartOutline'), 'Favorite');
    const setFav = async () => { const on = await store.isFavorite(d); favBtn.replaceChildren(icon(on ? 'heart' : 'heartOutline'), on ? 'Favorited' : 'Favorite'); favBtn.classList.toggle('primary', on); };
    favBtn.onclick = async () => { await store.toggleFavorite(d); setFav(); };
    setFav();
    const actions = h('div', { class: 'actions-row', style: { marginTop: vp ? '0' : '18px' } },
      vp ? vp.select : null, vp ? vp.volBox : null, vp ? h('span', { class: 'spacer' }) : null,
      vp ? h('button', { class: 'btn primary', onclick: () => { vp.video.pause(); playOne(d); } }, icon('music'), 'Listen (audio player)') : null,
      h('button', { class: 'btn', onclick: () => playItems([d], 0, 'next') }, icon('queueNext'), 'Play next'),
      h('button', { class: 'btn', onclick: () => playItems([d], 0, 'enqueue') }, icon('queueAdd'), 'Queue'),
      h('button', { class: 'btn', onclick: () => downloadDialog(d, d) }, icon('download'), 'Download'),
      favBtn,
      h('button', { class: 'btn', onclick: () => playlistPicker(d) }, icon('list'), 'Playlist'),
      h('button', { class: 'icon-btn', title: 'Copy link', 'aria-label': 'Copy link', onclick: async () => { await copyText(shareUrl(d)); toast('Link copied'); } }, icon('link')),
      h('a', { class: 'icon-btn', title: 'Open original', 'aria-label': 'Open original site', href: shareUrl(d), target: '_blank', rel: 'noopener noreferrer' }, icon('open')));
    if (vp) actions.style.marginTop = '10px';
    main.append(actions);

    // ---- channel row
    if (d.uploader && vp) {
      const sub = h('button', { class: 'btn' }, 'Subscribe');
      const chan = { service, id: d.uploaderId, title: d.uploader, thumbnail: d.uploaderAvatar };
      const paintSub = async () => { const on = d.uploaderId && (await store.isSubscribed(chan)); sub.textContent = on ? 'Subscribed' : 'Subscribe'; sub.classList.toggle('primary', !!on); };
      sub.onclick = async () => { await store.toggleSub(chan); paintSub(); };
      if (d.uploaderId) paintSub();
      main.append(h('div', { class: 'chan-row' },
        d.uploaderAvatar ? h('img', { class: 'avatar', src: d.uploaderAvatar, alt: '', referrerpolicy: 'no-referrer' }) : null,
        h('div', { class: 'grow', style: { flex: 1, minWidth: 0 } }, h('a', { href: d.uploaderId ? routeFor({ service, id: d.uploaderId, type: 'channel' }) : '#', style: { fontWeight: 650, color: 'var(--text)' } }, d.uploader),
          d.verified ? icon('verified', 'verified') : null, d.subscribers != null ? h('div', { class: 'sub' }, typeof d.subscribers === 'number' ? `${fmtNum(d.subscribers)} subscribers` : d.subscribers) : null),
        d.uploaderId ? sub : null));
    }

    // ---- stat chips
    main.append(h('div', { class: 'row wrap', style: { marginTop: '12px' } },
      statChip('eye', d.views != null ? `${fmtInt(d.views)} ${['soundcloud', 'bandcamp'].includes(service) ? 'plays' : 'views'}` : ''),
      statChip('thumb', d.likes != null ? `${fmtInt(d.likes)} likes` : ''),
      s.dislikes && d.dislikes != null ? statChip('thumb', `${fmtInt(d.dislikes)} dislikes`) : null,
      d.reposts != null ? statChip('refresh', `${fmtInt(d.reposts)} reposts`) : null,
      d.comments_count != null ? statChip('comment', `${fmtInt(d.comments_count)} comments`) : null,
      statChip('history', d.uploaded ? `${fmtDate(d.uploaded)} (${timeAgo(d.uploaded)})` : ''),
      statChip('timer', d.duration ? fmtDur(d.duration) : d.live ? 'Live' : '')));

    // ---- metadata grid
    const kv = [['Category', d.category], ['Genre', d.genre], ['License', d.license], ['Language', d.language], ['Album', d.album], ['Artist', d.artist], ['Label', d.label], ['Price', d.price], ['ISRC', d.isrc],
      ['Downloads', d.downloads != null ? fmtInt(d.downloads) : ''], ['Explicit', d.explicit ? 'Yes' : ''], ['Visibility', d.visibility && d.visibility !== 'public' ? d.visibility : ''], ['Source', d.backend]].filter(([, v]) => v);
    if (kv.length) main.append(h('div', { class: 'kv' }, kv.map(([k, v]) => h('div', h('span', k), h('b', String(v))))));

    // ---- tags
    if (d.tags?.length) main.append(h('div', { class: 'tags' }, d.tags.slice(0, 30).map((t) => h('a', { class: 'chip', href: `#/search?q=${enc(t)}&s=${service}` }, '#' + t))));

    // ---- description
    if (d.description || d.credits) {
      const dBox = h('div', { class: 'desc clamp' });
      dBox.append(d.descriptionIsHtml ? sanitizeHtml(d.description) : linkify(d.description));
      if (d.credits) dBox.append(h('br'), h('br'), h('b', 'Credits'), h('br'), linkify(d.credits));
      const tog = h('button', { class: 'btn sm ghost', style: { marginTop: '6px' }, onclick: () => { const c = dBox.classList.toggle('clamp'); tog.textContent = c ? 'Show more' : 'Show less'; } }, 'Show more');
      main.append(dBox, (d.description || '').length > 220 ? tog : (dBox.classList.remove('clamp'), ''));
    }

    // ---- chapters & subtitles
    if (d.chapters?.length && vp) {
      main.append(h('h3', { style: { margin: '18px 0 4px' } }, 'Chapters'), h('div', { class: 'chapters' }, d.chapters.map((c) => h('button', { onclick: () => { vp.video.currentTime = c.start; vp.video.play(); vp.video.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, h('time', fmtDur(c.start) || '0:00'), c.title))));
    }
    if (d.subtitles?.length && vp) {
      const sel = h('select', { class: 'field', 'aria-label': 'Subtitles', onchange: async () => {
        vp.video.querySelectorAll('track').forEach((t) => t.remove());
        if (!sel.value) return;
        const t = d.subtitles[+sel.value];
        try {
          const vtt = srtToVtt(await getText(t.url, { timeout: 12000 }));
          const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
          const tr = h('track', { kind: 'subtitles', label: t.label, srclang: t.lang || 'en', src: url, default: true });
          vp.video.append(tr);
          tr.track.mode = 'showing';
        } catch (e) { toast('Could not load subtitles: ' + e.message, 'err'); }
      } }, h('option', { value: '' }, 'Subtitles: off'), d.subtitles.map((t, i) => h('option', { value: i }, `${t.label || t.lang}${t.auto ? ' (auto)' : ''}`)));
      actions.insertBefore(sel, actions.firstChild?.nextSibling || null);
    }

    // ---- comments
    if (s.comments) { const c = commentsSection(d, s); if (c) { main.append(c); view.cleanup.push(() => c.dispose?.()); } }

    // ---- related / album tracks
    const rel = (d.albumTracks?.length > 1 ? d.albumTracks : d.related) || [];
    if (rel.length) {
      side.append(h('h3', { style: { marginBottom: '12px' } }, d.albumTracks?.length > 1 ? 'Album tracks' : 'Related'),
        h('div', { class: 'side-list' }, rel.slice(0, 30).map((it, i) => (d.albumTracks?.length > 1 ? sideItem(it) : sideItem(it)))));
    }
  };
  load();
  return view;
}
