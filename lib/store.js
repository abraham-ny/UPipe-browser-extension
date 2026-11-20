import { ext } from './browser.js';
import { DEFAULT_SETTINGS } from './config.js';

const L = ext.storage.local;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

export function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) out[k] = isObj(v) && isObj(base?.[k]) ? deepMerge(base[k], v) : v;
  return out;
}

// ---- settings --------------------------------------------------------------------------------
let cache = null;
const subs = new Set();

export async function getSettings() {
  if (cache) return cache;
  const r = await L.get('settings');
  cache = deepMerge(DEFAULT_SETTINGS, r.settings || {});
  return cache;
}
export async function setSettings(patch) {
  const next = deepMerge(await getSettings(), patch);
  cache = next;
  await L.set({ settings: next });
  subs.forEach((f) => f(next));
  return next;
}
export async function resetSettings() {
  cache = deepMerge(DEFAULT_SETTINGS, {});
  await L.set({ settings: cache });
  subs.forEach((f) => f(cache));
  return cache;
}
export const onSettings = (fn) => { subs.add(fn); return () => subs.delete(fn); };
ext.storage.onChanged.addListener((ch, area) => {
  if (area !== 'local' || !ch.settings) return;
  const next = deepMerge(DEFAULT_SETTINGS, ch.settings.newValue || {});
  if (cache && JSON.stringify(next) === JSON.stringify(cache)) return;
  cache = next;
  subs.forEach((f) => f(next));
});

// ---- generic helpers -------------------------------------------------------------------------
export async function get(key, def) { const r = await L.get(key); return r[key] ?? def; }
export const set = (key, val) => L.set({ [key]: val });

const KEEP = ['service', 'id', 'type', 'url', 'title', 'uploader', 'uploaderId', 'uploaderAvatar', 'thumbnail', 'duration', 'views', 'uploaded', 'album', 'count', 'live', 'verified', 'subscribers'];
export function slim(it) {
  const o = {};
  for (const k of KEEP) if (it[k] != null && it[k] !== '') o[k] = it[k];
  return o;
}
export const keyOf = (it) => `${it.service}:${it.id}`;
export const sameItem = (a, b) => a && b && keyOf(a) === keyOf(b);

// ---- history ---------------------------------------------------------------------------------
export const getHistory = () => get('history', []);
export async function addHistory(item) {
  if (!(await getSettings()).saveHistory) return;
  const list = (await getHistory()).filter((x) => !sameItem(x, item));
  list.unshift({ ...slim(item), at: Date.now() });
  await set('history', list.slice(0, 1000));
}
export const removeHistory = async (item) => set('history', (await getHistory()).filter((x) => !sameItem(x, item)));
export const clearHistory = () => set('history', []);

// ---- favorites -------------------------------------------------------------------------------
export const getFavorites = () => get('favorites', []);
export async function isFavorite(item) { return (await getFavorites()).some((x) => sameItem(x, item)); }
export async function toggleFavorite(item) {
  const list = await getFavorites();
  const i = list.findIndex((x) => sameItem(x, item));
  if (i >= 0) { list.splice(i, 1); await set('favorites', list); return false; }
  list.unshift({ ...slim(item), at: Date.now() });
  await set('favorites', list);
  return true;
}

// ---- local playlists -------------------------------------------------------------------------
export const getPlaylists = () => get('playlists', []);
export async function createPlaylist(name, items = []) {
  const list = await getPlaylists();
  const pl = { id: 'pl_' + Math.random().toString(36).slice(2, 9), name: name || 'New playlist', items: items.map(slim), created: Date.now() };
  list.push(pl);
  await set('playlists', list);
  return pl;
}
export async function updatePlaylist(id, fn) {
  const list = await getPlaylists();
  const pl = list.find((p) => p.id === id);
  if (!pl) return null;
  fn(pl);
  await set('playlists', list);
  return pl;
}
export async function addToPlaylist(id, items) {
  return updatePlaylist(id, (pl) => {
    for (const it of [].concat(items)) if (!pl.items.some((x) => sameItem(x, it))) pl.items.push(slim(it));
  });
}
export const deletePlaylist = async (id) => set('playlists', (await getPlaylists()).filter((p) => p.id !== id));

// ---- subscriptions (local only, no account) --------------------------------------------------
export const getSubs = () => get('subs', []);
export async function isSubscribed(ch) { return (await getSubs()).some((x) => sameItem(x, ch)); }
export async function toggleSub(ch) {
  const list = await getSubs();
  const i = list.findIndex((x) => sameItem(x, ch));
  if (i >= 0) { list.splice(i, 1); await set('subs', list); return false; }
  list.push({ service: ch.service, id: ch.id, type: 'channel', title: ch.title, thumbnail: ch.thumbnail, at: Date.now() });
  await set('subs', list);
  return true;
}

// ---- searches --------------------------------------------------------------------------------
export const getSearches = () => get('searches', []);
export async function addSearch(q) {
  if (!q || !(await getSettings()).saveSearches) return;
  const list = (await getSearches()).filter((x) => x !== q);
  list.unshift(q);
  await set('searches', list.slice(0, 40));
}
export const removeSearch = async (q) => set('searches', (await getSearches()).filter((x) => x !== q));
export const clearSearches = () => set('searches', []);

// ---- stats -----------------------------------------------------------------------------------
const today = () => new Date().toISOString().slice(0, 10);
export const getStats = () => get('stats', { plays: 0, seconds: 0, daily: {} });
export async function bumpStats({ plays = 0, seconds = 0 }) {
  const st = await getStats();
  st.plays += plays;
  st.seconds += seconds;
  const d = (st.daily[today()] ||= { plays: 0, seconds: 0 });
  d.plays += plays;
  d.seconds += seconds;
  const keys = Object.keys(st.daily).sort();
  while (keys.length > 60) delete st.daily[keys.shift()];
  await set('stats', st);
}

// ---- downloads index -------------------------------------------------------------------------
export const getDownloads = () => get('downloads', []);
export async function addDownload(rec) {
  const list = await getDownloads();
  list.unshift(rec);
  await set('downloads', list.slice(0, 200));
}
export const removeDownload = async (id) => set('downloads', (await getDownloads()).filter((d) => d.id !== id));
export const clearDownloads = () => set('downloads', []);

// ---- queue -----------------------------------------------------------------------------------
export const getQueue = () => get('queue', { items: [], index: -1 });
export const saveQueue = (q) => set('queue', q);

// ---- backup ----------------------------------------------------------------------------------
const BACKUP_KEYS = ['settings', 'history', 'favorites', 'playlists', 'subs', 'searches', 'stats', 'downloads'];
export async function exportAll() {
  const data = await L.get(BACKUP_KEYS);
  return { app: 'UPipe', version: 1, exported: new Date().toISOString(), data };
}
export async function importAll(obj) {
  if (!obj || obj.app !== 'UPipe' || !isObj(obj.data)) throw new Error('This is not a UPipe backup file.');
  const out = {};
  for (const k of BACKUP_KEYS) if (obj.data[k] !== undefined) out[k] = obj.data[k];
  await L.set(out);
  if (out.settings) { cache = deepMerge(DEFAULT_SETTINGS, out.settings); subs.forEach((f) => f(cache)); }
}
export async function wipeAll() {
  await L.clear();
  cache = deepMerge(DEFAULT_SETTINGS, {});
  subs.forEach((f) => f(cache));
}
