// YouTube via the open Piped and Invidious APIs (no key, no login). Instances are tried in turn.
import { getJSON, hostOf, HttpError, ContentError, contentErrorFrom } from '../http.js';
import { DEFAULT_PIPED, DEFAULT_INVIDIOUS } from '../config.js';
import { ext } from '../browser.js';
import { enc, parseTagList } from '../util.js';

const SERVICE = 'youtube';
const bad = new Map();      // base -> until timestamp (temporary blacklist)
const good = { piped: null, invidious: null };
const isBad = (b) => (bad.get(b) || 0) > Date.now();
const mark = (b) => bad.set(b, Date.now() + 5 * 60 * 1000);

async function liveList(kind) {
  const key = `inst_${kind}`;
  try {
    const r = await ext.storage.local.get(key);
    const c = r[key];
    if (c && Date.now() - c.at < 6 * 3600 * 1000 && c.list?.length) return c.list;
  } catch { /* ignore */ }
  let list = [];
  try {
    if (kind === 'piped') {
      const j = await getJSON('https://piped-instances.kavin.rocks/', { timeout: 6000 });
      list = j.filter((x) => x.api_url && (x.uptime_24h ?? 100) > 80).sort((a, b) => (b.uptime_30d || 0) - (a.uptime_30d || 0)).map((x) => x.api_url.replace(/\/$/, ''));
    } else {
      const j = await getJSON('https://api.invidious.io/instances.json?sort_by=type,health', { timeout: 6000 });
      list = j.filter(([, i]) => i.api && i.type === 'https').map(([, i]) => i.uri.replace(/\/$/, ''));
    }
  } catch { /* fall back to the seed list */ }
  if (list.length) { try { await ext.storage.local.set({ [key]: { at: Date.now(), list } }); } catch { /* ignore */ } }
  return list;
}

async function candidates(kind, s) {
  const custom = kind === 'piped' ? s.pipedInstance : s.invidiousInstance;
  const seed = kind === 'piped' ? DEFAULT_PIPED : DEFAULT_INVIDIOUS;
  const out = [];
  const add = (u) => { u = (u || '').replace(/\/+$/, ''); if (/^https?:\/\//.test(u) && !out.includes(u)) out.push(u); };
  add(custom);
  if (s.instanceOnly && custom) return out;
  add(good[kind]);
  const live = await liveList(kind);
  // seed first (known-good ordering), then a shuffled slice of the live list
  seed.slice(0, 3).forEach(add);
  [...live].sort(() => Math.random() - 0.5).slice(0, 6).forEach(add);
  seed.forEach(add);
  const healthy = out.filter((b) => !isBad(b) || b === custom);
  // If every instance was recently marked bad, try them all again rather than giving up.
  return (healthy.length ? healthy : out).slice(0, 7);
}

async function viaBackend(kind, s, fn) {
  let lastErr;
  for (const base of await candidates(kind, s)) {
    try {
      const r = await fn(base);
      good[kind] = base;
      return r;
    } catch (e) {
      const ce = contentErrorFrom(e);
      if (ce) throw ce;
      if (e instanceof HttpError && e.status === 404) { lastErr = e; continue; }
      lastErr = e;
      mark(base);
    }
  }
  throw lastErr || new Error('No instance available');
}

/** Try backends in the configured order. */
async function run(s, ops) {
  const order = s.ytBackend === 'piped' ? ['piped'] : s.ytBackend === 'invidious' ? ['invidious'] : ['piped', 'invidious'];
  let lastErr;
  for (const kind of order) {
    if (!ops[kind]) continue;
    try { return await viaBackend(kind, s, (b) => ops[kind](b)); } catch (e) {
      if (e instanceof ContentError) throw e;
      lastErr = e;
    }
  }
  throw lastErr || new Error('YouTube backends are unreachable');
}

// ---- normalizers -----------------------------------------------------------------------------
const pId = (u) => { try { return new URL(u, 'https://x').searchParams.get('v') || u.split('/').pop(); } catch { return u; } };
const chanId = (u) => (u || '').split('/').pop();

function pItem(x, base) {
  const t = x.type || 'stream';
  const common = { service: SERVICE, title: x.title || x.name || '', thumbnail: x.thumbnail || '' };
  if (t === 'channel') return { ...common, type: 'channel', id: chanId(x.url), subscribers: x.subscribers, verified: x.verified, description: x.description, count: x.videos };
  if (t === 'playlist') return { ...common, type: 'playlist', id: new URL(x.url, 'https://x').searchParams.get('list') || chanId(x.url), uploader: x.uploaderName, count: x.videos };
  if (!x.url) return null;
  return {
    ...common, type: 'stream', id: pId(x.url), uploader: x.uploaderName, uploaderId: chanId(x.uploaderUrl),
    uploaderAvatar: x.uploaderAvatar, duration: x.duration > 0 ? x.duration : 0, live: x.duration === -1, views: x.views >= 0 ? x.views : null,
    uploaded: x.uploaded > 0 ? x.uploaded : null, verified: x.uploaderVerified, short: !!x.isShort, description: x.shortDescription,
  };
}
const pList = (arr, base) => (arr || []).map((x) => pItem(x, base)).filter((x) => x && x.id);

const iThumb = (arr, q = 'medium') => {
  const a = arr || [];
  return (a.find((t) => t.quality === q) || a[0] || {}).url || '';
};
function iItem(x, base) {
  const t = x.type || 'video';
  const abs = (u) => (u && u.startsWith('/') ? base + u : u || '');
  if (t === 'channel') return { service: SERVICE, type: 'channel', id: x.authorId, title: x.author, thumbnail: abs(iThumb(x.authorThumbnails, '')) || abs((x.authorThumbnails || []).slice(-1)[0]?.url), subscribers: x.subCount, verified: x.authorVerified, description: x.description, count: x.videoCount };
  if (t === 'playlist') return { service: SERVICE, type: 'playlist', id: x.playlistId, title: x.title, thumbnail: abs(x.playlistThumbnail || iThumb(x.videos?.[0]?.videoThumbnails)), uploader: x.author, count: x.videoCount };
  const id = x.videoId;
  if (!id) return null;
  return {
    service: SERVICE, type: 'stream', id, title: x.title, uploader: x.author, uploaderId: x.authorId, duration: x.lengthSeconds || 0, live: !!x.liveNow,
    views: x.viewCount ?? null, uploaded: x.published ? x.published * 1000 : null, verified: x.authorVerified, description: x.description,
    thumbnail: abs(iThumb(x.videoThumbnails)) || `${base}/vi/${id}/mqdefault.jpg`,
  };
}

const PIPED_FILTER = { all: 'all', videos: 'videos', channels: 'channels', playlists: 'playlists', music: 'music_songs' };
const INV_TYPE = { all: 'all', videos: 'video', channels: 'channel', playlists: 'playlist', music: 'video' };

export const filters = [['all', 'All'], ['videos', 'Videos'], ['channels', 'Channels'], ['playlists', 'Playlists'], ['music', 'Music']];

export async function trending(s) {
  const region = s.region || 'US';
  return run(s, {
    piped: async (b) => ({ items: pList(await getJSON(`${b}/trending?region=${region}`), b), next: null }),
    invidious: async (b) => ({ items: (await getJSON(`${b}/api/v1/trending?region=${region}`)).map((x) => iItem(x, b)).filter(Boolean), next: null }),
  });
}

export async function search(q, { filter = 'all', page = null } = {}, s) {
  return run(s, {
    piped: async (b) => {
      const f = PIPED_FILTER[filter] || 'all';
      const url = page ? `${b}/nextpage/search?nextpage=${enc(page)}&q=${enc(q)}&filter=${f}` : `${b}/search?q=${enc(q)}&filter=${f}`;
      const j = await getJSON(url);
      return { items: pList(j.items, b), next: j.nextpage || null, corrected: j.corrected ? j.suggestion : null };
    },
    invidious: async (b) => {
      const p = page ? Number(page) : 1;
      const j = await getJSON(`${b}/api/v1/search?q=${enc(q)}&page=${p}&type=${INV_TYPE[filter] || 'all'}`);
      const items = j.map((x) => iItem(x, b)).filter(Boolean);
      return { items, next: items.length ? String(p + 1) : null };
    },
  });
}

export async function suggest(q, s) {
  const j = await getJSON(`https://suggestqueries-clients6.youtube.com/complete/search?client=firefox&ds=yt&q=${enc(q)}`, { timeout: 4000 }).catch(() => null);
  if (Array.isArray(j?.[1])) return j[1];
  return run(s, {
    piped: async (b) => (await getJSON(`${b}/suggestions?query=${enc(q)}`, { timeout: 5000 })) || [],
    invidious: async (b) => (await getJSON(`${b}/api/v1/search/suggestions?q=${enc(q)}`, { timeout: 5000 })).suggestions || [],
  }).catch(() => []);
}

function pStreams(j) {
  const audio = (j.audioStreams || []).filter((a) => a.url && !/hls|dash/i.test(a.format || '')).map((a) => ({
    url: a.url, mime: (a.mimeType || '').split(';')[0] || 'audio/mp4', codec: a.codec, bitrate: a.bitrate, size: a.contentLength > 0 ? a.contentLength : 0,
    label: `${a.quality || Math.round((a.bitrate || 0) / 1000) + ' kbps'} · ${/opus|webm/i.test(a.mimeType + a.format) ? 'Opus' : 'AAC'}`,
    ext: /webm|opus/i.test(a.mimeType + a.format) ? 'opus' : 'm4a', lang: a.audioTrackLocale, trackName: a.audioTrackName, trackType: a.audioTrackType,
  }));
  const video = (j.videoStreams || []).filter((v) => v.url).map((v) => ({
    url: v.url, mime: (v.mimeType || '').split(';')[0] || 'video/mp4', codec: v.codec, bitrate: v.bitrate, size: v.contentLength > 0 ? v.contentLength : 0,
    height: v.height, width: v.width, fps: v.fps, videoOnly: !!v.videoOnly, label: v.quality || `${v.height}p`,
    ext: /webm/i.test(v.mimeType || '') ? 'webm' : 'mp4',
  }));
  return { audio, video };
}

export async function stream(id, s) {
  const base = await run(s, {
    piped: async (b) => {
      const j = await getJSON(`${b}/streams/${id}`, { timeout: 15000 });
      if (j.error) throw new ContentError(j.message || j.error);
      const { audio, video } = pStreams(j);
      const related = pList((j.relatedStreams || []).filter((r) => r.type !== 'playlist' && r.type !== 'channel'), b);
      return {
        service: SERVICE, type: 'stream', id, title: j.title, description: j.description || '', descriptionIsHtml: true,
        uploader: j.uploader, uploaderId: chanId(j.uploaderUrl), uploaderAvatar: j.uploaderAvatar, verified: j.uploaderVerified,
        subscribers: j.uploaderSubscriberCount >= 0 ? j.uploaderSubscriberCount : null,
        thumbnail: j.thumbnailUrl, duration: j.duration, views: j.views >= 0 ? j.views : null,
        likes: j.likes >= 0 ? j.likes : null, dislikes: j.dislikes >= 0 ? j.dislikes : null,
        uploaded: j.uploadDate ? Date.parse(j.uploadDate) : null, tags: j.tags || [], category: j.category, license: j.license, visibility: j.visibility,
        live: !!j.livestream, hls: j.hls || null, chapters: (j.chapters || []).map((c) => ({ title: c.title, start: c.start, image: c.image })),
        subtitles: (j.subtitles || []).map((t) => ({ label: t.name || t.code, lang: t.code, url: t.url, auto: !!t.autoGenerated, mime: t.mimeType })),
        audio, video, related, backend: hostOf(b),
        url: `https://www.youtube.com/watch?v=${id}`,
      };
    },
    invidious: async (b) => {
      const j = await getJSON(`${b}/api/v1/videos/${id}?local=true`, { timeout: 15000 });
      if (j.error) throw new ContentError(j.error);
      const abs = (u) => (u && u.startsWith('/') ? b + u : u);
      const audio = (j.adaptiveFormats || []).filter((f) => /^audio/.test(f.type || '')).map((f) => ({
        url: abs(f.url), mime: (f.type || '').split(';')[0], codec: f.encoding, bitrate: f.bitrate ? +f.bitrate : 0, size: f.clen ? +f.clen : 0,
        label: `${f.audioQuality || ''} · ${/opus|webm/.test(f.type) ? 'Opus' : 'AAC'}`.replace(/^AUDIO_QUALITY_/, '').trim(), ext: /webm/.test(f.type) ? 'opus' : 'm4a',
      })).sort((a, b2) => (b2.bitrate || 0) - (a.bitrate || 0));
      const video = [
        ...(j.formatStreams || []).map((f) => ({ url: abs(f.url), mime: (f.type || '').split(';')[0], height: parseInt(f.qualityLabel) || 0, label: f.qualityLabel || f.quality, videoOnly: false, ext: f.container || 'mp4' })),
        ...(j.adaptiveFormats || []).filter((f) => /^video/.test(f.type || '')).map((f) => ({ url: abs(f.url), mime: (f.type || '').split(';')[0], height: parseInt(f.qualityLabel) || 0, fps: f.fps, label: f.qualityLabel, videoOnly: true, size: f.clen ? +f.clen : 0, ext: f.container || 'mp4' })),
      ];
      return {
        service: SERVICE, type: 'stream', id, title: j.title, description: j.descriptionHtml || j.description || '', descriptionIsHtml: !!j.descriptionHtml,
        uploader: j.author, uploaderId: j.authorId, uploaderAvatar: abs((j.authorThumbnails || []).slice(-1)[0]?.url), verified: j.authorVerified,
        subscribers: j.subCountText || null, thumbnail: abs(iThumb(j.videoThumbnails, 'maxres') || iThumb(j.videoThumbnails)), duration: j.lengthSeconds,
        views: j.viewCount ?? null, likes: j.likeCount ?? null, dislikes: j.dislikeCount ?? null, uploaded: j.published ? j.published * 1000 : null,
        tags: j.keywords || [], category: j.genre, license: j.license, live: !!j.liveNow, hls: j.hlsUrl || null, chapters: [],
        subtitles: (j.captions || []).map((c) => ({ label: c.label, lang: c.language_code, url: abs(c.url) })),
        audio, video, related: (j.recommendedVideos || []).map((x) => iItem({ ...x, type: 'video' }, b)).filter(Boolean), backend: hostOf(b),
        url: `https://www.youtube.com/watch?v=${id}`,
      };
    },
  });
  // Like/dislike counts: Piped/Invidious no longer return them reliably, the community Return-YouTube-Dislike API does.
  if (s.dislikes !== false) {
    try {
      const r = await getJSON(`https://returnyoutubedislikeapi.com/votes?videoId=${id}`, { timeout: 5000 });
      if (r && typeof r.likes === 'number') {
        if (base.likes == null) base.likes = r.likes;
        if (base.dislikes == null) base.dislikes = r.dislikes;
        base.rating = r.rating;
        if (base.views == null && r.viewCount) base.views = r.viewCount;
      }
    } catch { /* optional */ }
  }
  return base;
}

export async function comments(id, page, s) {
  return run(s, {
    piped: async (b) => {
      const j = await getJSON(page ? `${b}/nextpage/comments/${id}?nextpage=${enc(page)}` : `${b}/comments/${id}`, { timeout: 15000 });
      return {
        disabled: !!j.disabled, next: j.nextpage || null,
        items: (j.comments || []).map((c) => ({
          id: c.commentId, author: c.author, avatar: c.thumbnail, html: c.commentText, time: c.commentedTime, likes: c.likeCount, replies: c.replyCount,
          replyToken: c.repliesPage, hearted: c.hearted, pinned: c.pinned, verified: c.verified, owner: c.channelOwner, authorId: chanId(c.commentorUrl),
        })),
      };
    },
    invidious: async (b) => {
      const j = await getJSON(`${b}/api/v1/comments/${id}${page ? '?continuation=' + enc(page) : ''}`, { timeout: 15000 });
      return {
        disabled: false, next: j.continuation || null,
        items: (j.comments || []).map((c) => ({
          id: c.commentId, author: c.author, avatar: (c.authorThumbnails || []).slice(-1)[0]?.url, html: c.contentHtml || c.content, time: c.publishedText, likes: c.likeCount,
          replies: c.replies?.replyCount || 0, replyToken: c.replies?.continuation, hearted: !!c.creatorHeart, pinned: !!c.isPinned, owner: c.authorIsChannelOwner, authorId: c.authorId,
        })),
      };
    },
  });
}

export async function replies(id, token, s) {
  return run(s, {
    piped: async (b) => {
      const j = await getJSON(`${b}/nextpage/comments/${id}?nextpage=${enc(token)}`, { timeout: 15000 });
      return { next: j.nextpage || null, items: (j.comments || []).map((c) => ({ id: c.commentId, author: c.author, avatar: c.thumbnail, html: c.commentText, time: c.commentedTime, likes: c.likeCount, hearted: c.hearted, owner: c.channelOwner })) };
    },
    invidious: async (b) => {
      const j = await getJSON(`${b}/api/v1/comments/${id}?continuation=${enc(token)}`, { timeout: 15000 });
      return { next: j.continuation || null, items: (j.comments || []).map((c) => ({ id: c.commentId, author: c.author, avatar: (c.authorThumbnails || []).slice(-1)[0]?.url, html: c.contentHtml || c.content, time: c.publishedText, likes: c.likeCount })) };
    },
  });
}

export async function channel(id, page, s) {
  return run(s, {
    piped: async (b) => {
      let cid = id;
      if (id.startsWith('@')) {
        const r = await getJSON(`${b}/c/${enc(id)}`).catch(() => null);
        if (r?.id) { cid = r.id; if (!page) return finish(r, b); }
      }
      if (page) {
        const j = await getJSON(`${b}/nextpage/channel/${cid}?nextpage=${enc(page)}`);
        return { info: null, items: pList(j.relatedStreams, b), next: j.nextpage || null };
      }
      return finish(await getJSON(`${b}/channel/${cid}`, { timeout: 15000 }), b);
      function finish(j, base) {
        return {
          info: { service: SERVICE, type: 'channel', id: j.id, title: j.name, thumbnail: j.avatarUrl, banner: j.bannerUrl, description: j.description, subscribers: j.subscriberCount >= 0 ? j.subscriberCount : null, verified: j.verified },
          items: pList(j.relatedStreams, base), next: j.nextpage || null,
          tabs: j.tabs || [],
        };
      }
    },
    invidious: async (b) => {
      if (page) {
        const j = await getJSON(`${b}/api/v1/channels/${id}/videos?continuation=${enc(page)}`);
        return { info: null, items: (j.videos || []).map((x) => iItem(x, b)).filter(Boolean), next: j.continuation || null };
      }
      const [ch, vids] = await Promise.all([getJSON(`${b}/api/v1/channels/${id}`), getJSON(`${b}/api/v1/channels/${id}/videos`).catch(() => ({ videos: [] }))]);
      const abs = (u) => (u && u.startsWith('/') ? b + u : u);
      return {
        info: { service: SERVICE, type: 'channel', id: ch.authorId, title: ch.author, thumbnail: abs((ch.authorThumbnails || []).slice(-1)[0]?.url), banner: abs((ch.authorBanners || [])[0]?.url), description: ch.description, subscribers: ch.subCount, verified: ch.authorVerified },
        items: (vids.videos || []).map((x) => iItem(x, b)).filter(Boolean), next: vids.continuation || null,
      };
    },
  });
}

export async function playlist(id, page, s) {
  return run(s, {
    piped: async (b) => {
      if (page) {
        const j = await getJSON(`${b}/nextpage/playlists/${id}?nextpage=${enc(page)}`);
        return { info: null, items: pList(j.relatedStreams, b), next: j.nextpage || null };
      }
      const j = await getJSON(`${b}/playlists/${id}`, { timeout: 15000 });
      return {
        info: { service: SERVICE, type: 'playlist', id, title: j.name, thumbnail: j.thumbnailUrl, uploader: j.uploader, uploaderId: chanId(j.uploaderUrl), count: j.videos, banner: j.bannerUrl },
        items: pList(j.relatedStreams, b), next: j.nextpage || null,
      };
    },
    invidious: async (b) => {
      const p = page ? Number(page) : 1;
      const j = await getJSON(`${b}/api/v1/playlists/${id}?page=${p}`, { timeout: 15000 });
      const items = (j.videos || []).map((x) => iItem({ ...x, type: 'video' }, b)).filter(Boolean);
      return {
        info: p === 1 ? { service: SERVICE, type: 'playlist', id, title: j.title, thumbnail: items[0]?.thumbnail, uploader: j.author, uploaderId: j.authorId, count: j.videoCount, description: j.description } : null,
        items, next: items.length >= 100 ? String(p + 1) : null,
      };
    },
  });
}

export const parseTags = parseTagList;
