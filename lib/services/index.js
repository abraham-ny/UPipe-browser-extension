// Service registry: one uniform interface, five backends.
import * as youtube from './youtube.js';
import * as soundcloud from './soundcloud.js';
import * as bandcamp from './bandcamp.js';
import * as peertube from './peertube.js';
import * as ccc from './ccc.js';
import { SERVICES } from '../config.js';
import { getSettings } from '../store.js';
import { ContentError } from '../http.js';

const IMPL = { youtube, soundcloud, bandcamp, peertube, ccc };

export function impl(id) {
  const m = IMPL[id];
  if (!m) throw new Error(`Unknown service: ${id}`);
  return m;
}
export const filtersFor = (id) => impl(id).filters || [['all', 'All']];

export async function trending(id, signal) {
  return impl(id).trending(await getSettings(), signal);
}
export async function search(id, q, opts) {
  return impl(id).search(q, opts || {}, await getSettings());
}
export async function suggest(id, q) {
  const f = impl(id).suggest;
  return f ? f(q, await getSettings()).catch(() => []) : [];
}
export async function stream(id, itemId) {
  return impl(id).stream(itemId, await getSettings());
}
export async function comments(id, itemId, page) {
  return impl(id).comments(itemId, page, await getSettings());
}
export async function replies(id, itemId, token) {
  const m = impl(id);
  return m.replies ? m.replies(itemId, token, await getSettings()) : { items: [], next: null };
}
export async function channel(id, itemId, page) {
  return impl(id).channel(itemId, page, await getSettings());
}
export async function playlist(id, itemId, page) {
  const m = impl(id);
  return (m.playlist || m.channel)(itemId, page, await getSettings());
}
export async function resolve(id, url) {
  const m = impl(id);
  if (!m.resolve) throw new ContentError('This link type is not supported.');
  return m.resolve(url, await getSettings());
}
export const serviceInfo = (id) => SERVICES[id];

/** Pick the audio stream that best matches the user's quality/format settings. */
export function pickAudio(streams, s) {
  const list = (streams || []).filter((a) => a.url);
  if (!list.length) return null;
  const fmt = s.audioFormat || 'any';
  const pool = fmt !== 'any' && list.some((a) => a.ext === fmt) ? list.filter((a) => a.ext === fmt) : list;
  const sorted = [...pool].sort((a, b) => (a.hls ? 1 : 0) - (b.hls ? 1 : 0) || (b.bitrate || 0) - (a.bitrate || 0));
  const direct = sorted.filter((a) => !a.hls);
  const use = direct.length ? direct : sorted;
  if (s.audioQuality === 'low') return use[use.length - 1];
  if (s.audioQuality === 'medium') return use[Math.floor((use.length - 1) / 2)];
  return use[0];
}
