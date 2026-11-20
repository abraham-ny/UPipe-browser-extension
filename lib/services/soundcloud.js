// SoundCloud through its public web API. A client_id is read from the site's own scripts (same as the web player).
import { getJSON, getText, HttpError, ContentError } from '../http.js';
import { ext } from '../browser.js';
import { enc, parseTagList } from '../util.js';

const SERVICE = 'soundcloud';
const API = 'https://api-v2.soundcloud.com';
let clientId = null;
let pending = null;

async function discoverClientId() {
  const html = await getText('https://soundcloud.com/', { timeout: 12000 });
  const srcs = [...html.matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]).reverse();
  for (const src of srcs.slice(0, 8)) {
    try {
      const js = await getText(src, { timeout: 12000 });
      const m = js.match(/[,{(]client_id:"([a-zA-Z0-9]{20,})"/) || js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{20,})"/);
      if (m) return m[1];
    } catch { /* try next */ }
  }
  throw new Error('Could not obtain a SoundCloud client id');
}

async function cid(force) {
  if (!force && clientId) return clientId;
  if (!force) {
    try { const r = await ext.storage.local.get('sc_client'); if (r.sc_client?.id && Date.now() - r.sc_client.at < 24 * 3600 * 1000) return (clientId = r.sc_client.id); } catch { /* ignore */ }
  }
  pending ||= discoverClientId().finally(() => { pending = null; });
  clientId = await pending;
  try { await ext.storage.local.set({ sc_client: { id: clientId, at: Date.now() } }); } catch { /* ignore */ }
  return clientId;
}

async function api(path, params = {}, retried = false) {
  const id = await cid(retried);
  const q = new URLSearchParams({ ...params, client_id: id });
  const url = /^https?:/.test(path) ? `${path}${path.includes('?') ? '&' : '?'}client_id=${id}` : `${API}${path}?${q}`;
  try {
    return await getJSON(url, { timeout: 15000 });
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 403) && !retried) return api(path, params, true);
    if (e instanceof HttpError && e.status === 404) throw new ContentError('This item is no longer available on SoundCloud.');
    throw e;
  }
}

const art = (u) => (u ? u.replace('-large.', '-t300x300.') : '');
const art500 = (u) => (u ? u.replace('-large.', '-t500x500.') : '');

function track(t) {
  if (!t || !t.id) return null;
  return {
    service: SERVICE, type: 'stream', id: String(t.id), title: t.title, uploader: t.user?.username, uploaderId: String(t.user?.id || ''), uploaderAvatar: art(t.user?.avatar_url),
    verified: !!t.user?.verified, thumbnail: art(t.artwork_url || t.user?.avatar_url), duration: Math.round((t.full_duration || t.duration || 0) / 1000), views: t.playback_count ?? null,
    uploaded: t.display_date ? Date.parse(t.display_date) : t.created_at ? Date.parse(t.created_at) : null, url: t.permalink_url, _partial: !t.media,
  };
}
function user(u) {
  return { service: SERVICE, type: 'channel', id: String(u.id), title: u.username, thumbnail: art(u.avatar_url), subscribers: u.followers_count, verified: !!u.verified, count: u.track_count, description: u.description || u.city || '' };
}
function pl(p) {
  return { service: SERVICE, type: 'playlist', id: String(p.id), title: p.title, thumbnail: art(p.artwork_url || p.tracks?.find((t) => t.artwork_url)?.artwork_url || p.user?.avatar_url), uploader: p.user?.username, count: p.track_count, url: p.permalink_url };
}
const anyItem = (x) => (x.kind === 'track' ? track(x) : x.kind === 'user' ? user(x) : x.kind === 'playlist' || x.kind === 'system-playlist' ? pl(x) : null);

export const filters = [['all', 'All'], ['tracks', 'Tracks'], ['users', 'Artists'], ['playlists', 'Playlists'], ['albums', 'Albums']];

export async function trending(s) {
  const j = await api('/charts', { kind: 'trending', genre: 'soundcloud:genres:all-music', limit: 40 });
  const items = (j.collection || []).map((c) => track(c.track)).filter(Boolean);
  return { items, next: j.next_href || null };
}

export async function search(q, { filter = 'all', page = null } = {}) {
  const path = { all: '/search', tracks: '/search/tracks', users: '/search/users', playlists: '/search/playlists_without_albums', albums: '/search/albums' }[filter] || '/search';
  const j = page ? await api(page) : await api(path, { q, limit: 30, offset: 0 });
  return { items: (j.collection || []).map(anyItem).filter(Boolean), next: j.next_href || null };
}

export async function suggest(q) {
  const j = await api('/search/queries', { q, limit: 8 }).catch(() => ({ collection: [] }));
  return (j.collection || []).map((x) => x.output || x.query).filter(Boolean);
}

async function hydrate(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 30) {
    const j = await api('/tracks', { ids: ids.slice(i, i + 30).join(',') });
    out.push(...j);
  }
  return out;
}

export async function resolve(url) {
  const j = await api('/resolve', { url });
  if (j.kind === 'track') return track(j);
  if (j.kind === 'user') return user(j);
  if (j.kind === 'playlist') return pl(j);
  throw new ContentError('Unsupported SoundCloud link.');
}

async function transcodingUrl(t, auth) {
  const j = await api(`${t.url}${t.url.includes('?') ? '&' : '?'}${auth ? 'track_authorization=' + enc(auth) : ''}`);
  return j.url;
}

export async function stream(id, s) {
  let t;
  try { t = await api(`/tracks/${id}`); } catch (e) {
    if (/^https?:/.test(id)) { t = await api('/resolve', { url: id }); } else throw e;
  }
  if (t.kind !== 'track') throw new ContentError('Not a track.');
  const auth = t.track_authorization;
  const tcs = (t.media?.transcodings || []).filter((x) => !/encrypted/.test(x.format.protocol));
  const audio = [];
  for (const tc of tcs) {
    const mime = (tc.format.mime_type || '').split(';')[0];
    const isOpus = /opus/.test(mime) || /opus/.test(tc.preset || '');
    const proto = tc.format.protocol;
    const q = /_hq/.test(tc.preset || '') || tc.quality === 'hq';
    try {
      const url = await transcodingUrl(tc, auth);
      audio.push({
        url, mime: proto === 'hls' && isOpus ? 'audio/ogg; codecs=opus' : mime, hls: proto === 'hls', ext: isOpus ? 'opus' : /mp4|aac/.test(mime) ? 'm4a' : 'mp3',
        bitrate: /abr_sd|_64/.test(tc.preset || '') ? 64000 : q ? 256000 : /mp3/.test(tc.preset || '') ? 128000 : 160000,
        label: `${isOpus ? 'Opus' : /aac|mp4/.test(mime) ? 'AAC' : 'MP3'} ${q ? 'HQ' : 'standard'} · ${proto === 'hls' ? 'HLS' : 'direct'}`,
        size: 0,
      });
    } catch { /* skip unavailable transcoding */ }
  }
  // Prefer progressive (directly playable & downloadable) first, then bitrate
  audio.sort((a, b) => (a.hls - b.hls) || (b.bitrate - a.bitrate));
  if (!audio.length) throw new ContentError(t.policy === 'SNIP' ? 'Only a 30 s preview is available (Go+ track).' : 'No playable stream found for this track.');

  let related = [];
  try {
    const r = await api(`/tracks/${id}/related`, { limit: 20 });
    related = (r.collection || []).map(track).filter(Boolean);
  } catch { /* optional */ }

  return {
    ...track(t), _partial: false, description: t.description || '', descriptionIsHtml: false,
    thumbnail: art500(t.artwork_url || t.user?.avatar_url), likes: t.likes_count ?? t.favoritings_count ?? null, reposts: t.reposts_count, comments_count: t.comment_count,
    tags: parseTagList(t.tag_list), genre: t.genre, category: t.genre, license: t.license, subscribers: t.user?.followers_count ?? null,
    downloads: t.download_count, label: t.label_name, downloadable: !!t.downloadable, purchaseUrl: t.purchase_url, isrc: t.publisher_metadata?.isrc, album: t.publisher_metadata?.album_title,
    artist: t.publisher_metadata?.artist, explicit: !!t.publisher_metadata?.explicit, waveform: t.waveform_url, audio, video: [], related, chapters: [], subtitles: [],
  };
}

export async function comments(id, page) {
  const j = page ? await api(page) : await api(`/tracks/${id}/comments`, { limit: 30, threaded: 0, sort: 'newest' });
  return {
    disabled: false, next: j.next_href || null,
    items: (j.collection || []).map((c) => ({
      id: String(c.id), author: c.user?.username, avatar: art(c.user?.avatar_url), html: c.body, text: true, time: c.created_at ? c.created_at.slice(0, 10) : '',
      likes: null, at: c.timestamp ? Math.round(c.timestamp / 1000) : null, authorId: String(c.user?.id || ''),
    })),
  };
}

export async function channel(id, page) {
  if (page) {
    const j = await api(page);
    return { info: null, items: (j.collection || []).map(track).filter(Boolean), next: j.next_href || null };
  }
  const [u, tr] = await Promise.all([api(`/users/${id}`), api(`/users/${id}/tracks`, { limit: 30 })]);
  return { info: { ...user(u), thumbnail: art500(u.avatar_url), banner: u.visuals?.visuals?.[0]?.visual_url, description: u.description || '' }, items: (tr.collection || []).map(track).filter(Boolean), next: tr.next_href || null };
}

export async function playlist(id) {
  const p = await api(`/playlists/${id}`);
  const full = (p.tracks || []).filter((t) => t.title);
  const stubs = (p.tracks || []).filter((t) => !t.title).map((t) => t.id);
  const extra = stubs.length ? await hydrate(stubs) : [];
  const byId = new Map([...full, ...extra].map((t) => [t.id, t]));
  const items = (p.tracks || []).map((t) => track(byId.get(t.id))).filter(Boolean);
  return { info: { ...pl(p), description: p.description || '', thumbnail: art500(p.artwork_url) || items[0]?.thumbnail }, items, next: null };
}
