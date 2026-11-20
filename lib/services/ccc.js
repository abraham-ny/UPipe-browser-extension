// media.ccc.de: recordings of talks from the Chaos Computer Club and friends. Public JSON API, no key.
import { getJSON, ContentError, HttpError } from '../http.js';
import { enc } from '../util.js';

const SERVICE = 'ccc';
const API = 'https://api.media.ccc.de/public';

function evItem(e) {
  return {
    service: SERVICE, type: 'stream', id: e.guid || e.slug, title: e.title, uploader: (e.persons || []).join(', ') || e.conference_title || 'media.ccc.de', uploaderId: (e.conference_url || '').split('/').pop(),
    thumbnail: e.thumb_url || e.poster_url || '', duration: e.length || 0, views: e.view_count ?? null, uploaded: e.release_date ? Date.parse(e.release_date) : e.date ? Date.parse(e.date) : null,
    description: e.subtitle || '', url: e.frontend_link || `https://media.ccc.de/v/${e.slug}`,
  };
}

export const filters = [['all', 'Talks']];

export async function trending() {
  const [recent, popular] = await Promise.all([
    getJSON(`${API}/events/recent`).catch(() => ({ events: [] })),
    getJSON(`${API}/events/popular`).catch(() => ({ events: [] })),
  ]);
  const seen = new Set();
  const items = [...(popular.events || []).slice(0, 12), ...(recent.events || [])].filter((e) => !seen.has(e.guid) && seen.add(e.guid)).map(evItem);
  return { items, next: null };
}

export async function search(q) {
  const j = await getJSON(`${API}/events/search?q=${enc(q)}`);
  return { items: (j.events || []).map(evItem), next: null };
}
export async function suggest() { return []; }

export async function stream(id) {
  let e;
  try { e = await getJSON(`${API}/events/${enc(id)}`, { timeout: 15000 }); } catch (err) {
    if (err instanceof HttpError && err.status === 404) throw new ContentError('Talk not found.');
    throw err;
  }
  const recs = (e.recordings || []).filter((r) => r.recording_url);
  const audio = recs.filter((r) => /^audio/.test(r.mime_type || '')).map((r) => ({
    url: r.recording_url, mime: r.mime_type, ext: /opus/.test(r.mime_type) ? 'opus' : /ogg/.test(r.mime_type) ? 'ogg' : 'mp3', label: `${r.mime_type.replace('audio/', '').toUpperCase()}${r.language ? ' · ' + r.language : ''}`,
    size: (r.size || 0) * 1024 * 1024, bitrate: 128000, lang: r.language,
  }));
  const video = recs.filter((r) => /^video/.test(r.mime_type || '') && !/slides/i.test(r.folder || '')).map((r) => ({
    url: r.recording_url, mime: r.mime_type, ext: /webm/.test(r.mime_type) ? 'webm' : 'mp4', height: r.height || 0, width: r.width || 0, label: `${r.height ? r.height + 'p' : r.folder || 'video'}${r.high_quality ? ' HD' : ''} · ${r.language || ''}`.trim(),
    size: (r.size || 0) * 1024 * 1024, videoOnly: false, lang: r.language,
  })).sort((a, b) => (b.height || 0) - (a.height || 0));
  const related = [];
  for (const r of (e.related || []).sort((a, b) => b.weight - a.weight).slice(0, 8)) {
    try { related.push(evItem(await getJSON(`${API}/events/${r.event_guid}`))); } catch { /* skip */ }
  }
  return {
    service: SERVICE, type: 'stream', id, title: e.title, description: [e.subtitle, e.description].filter(Boolean).join('\n\n'), descriptionIsHtml: false, uploader: (e.persons || []).join(', ') || e.conference_title,
    uploaderId: (e.conference_url || '').split('/').pop(), thumbnail: e.poster_url || e.thumb_url, duration: e.length, views: e.view_count, likes: null, uploaded: e.release_date ? Date.parse(e.release_date) : Date.parse(e.date),
    tags: e.tags || [], category: e.conference_title, license: 'CC BY 4.0 (unless stated otherwise)', language: e.original_language, live: false, chapters: [], subtitles: [], audio, video, related, url: e.frontend_link,
  };
}

export async function comments() { return { disabled: true, items: [], next: null }; }

export async function channel(id) {
  const c = await getJSON(`${API}/conferences/${enc(id)}`);
  return {
    info: { service: SERVICE, type: 'channel', id, title: c.title, thumbnail: c.logo_url, description: [c.description, c.link && `Website: ${c.link}`].filter(Boolean).join('\n\n'), count: (c.events || []).length },
    items: (c.events || []).sort((a, b) => (b.view_count || 0) - (a.view_count || 0)).map(evItem), next: null,
  };
}
export async function playlist(id) { return channel(id); }
