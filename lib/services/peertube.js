// PeerTube: any instance exposes the same REST API. Search uses the public SepiaSearch index.
// Item ids look like "uuid@instance.host" so a link from any instance can be opened.
import { getJSON, ContentError, HttpError } from '../http.js';
import { enc } from '../util.js';

const SERVICE = 'peertube';
const hostOnly = (s) => (s.peertubeInstance || 'https://framatube.org').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const split = (id) => { const i = id.lastIndexOf('@'); return i < 0 ? [id, ''] : [id.slice(0, i), id.slice(i + 1)]; };
const base = (h) => `https://${h}`;
const PAGE = 24;

function vItem(v, host) {
  const h = v.account?.host || host;
  const origin = v.thumbnailPath ? host : h;
  const abs = (p) => (p ? (p.startsWith('http') ? p : base(origin) + p) : '');
  const srcHost = v.account?.host || host;
  return {
    service: SERVICE, type: 'stream', id: `${v.uuid}@${host}`, title: v.name, uploader: v.channel?.displayName || v.account?.displayName, uploaderId: v.channel?.name ? `${v.channel.name}@${srcHost}` : '',
    uploaderAvatar: abs(v.channel?.avatars?.[0]?.path || v.channel?.avatar?.path), thumbnail: v.thumbnailUrl || abs(v.thumbnailPath), duration: v.duration || 0,
    views: v.views ?? null, uploaded: v.publishedAt ? Date.parse(v.publishedAt) : null, live: !!v.isLive, description: v.description || '', url: v.url || `${base(host)}/w/${v.uuid}`,
  };
}
// Videos from SepiaSearch belong to many instances; point each at its own instance.
function sepiaItem(v) {
  const host = v.account?.host || (v.url ? new URL(v.url).host : '');
  const o = { ...vItem({ ...v, thumbnailPath: null }, host), id: `${v.uuid}@${host}` };
  o.thumbnail = v.thumbnailUrl || (v.thumbnailPath ? base(host) + v.thumbnailPath : '');
  return o;
}
function cItem(c, host) {
  const h = c.host || host;
  const av = c.avatars?.slice(-1)[0]?.path || c.avatar?.path;
  return { service: SERVICE, type: 'channel', id: `${c.name}@${h}`, title: c.displayName, thumbnail: av ? base(h) + av : '', subscribers: c.followersCount, description: c.description || '', count: c.videosCount };
}
function pItem(p, host) {
  const h = p.ownerAccount?.host || host;
  return { service: SERVICE, type: 'playlist', id: `${p.uuid}@${h}`, title: p.displayName, thumbnail: p.thumbnailPath ? base(h) + p.thumbnailPath : '', uploader: p.ownerAccount?.displayName, count: p.videosLength, description: p.description || '' };
}

export const filters = [['all', 'Videos'], ['channels', 'Channels'], ['playlists', 'Playlists']];

export async function trending(s) {
  const h = hostOnly(s);
  const j = await getJSON(`${base(h)}/api/v1/videos?sort=-trending&count=${PAGE * 2}&start=0&nsfw=false`);
  return { items: (j.data || []).map((v) => vItem(v, h)), next: j.total > PAGE * 2 ? 'p:' + PAGE * 2 : null };
}

export async function search(q, { filter = 'all', page = null } = {}, s) {
  const start = page ? Number(page) : 0;
  const type = filter === 'channels' ? 'video-channels' : filter === 'playlists' ? 'video-playlists' : 'videos';
  const j = await getJSON(`https://sepiasearch.org/api/v1/search/${type}?search=${enc(q)}&start=${start}&count=${PAGE}&nsfw=false&sort=-match`);
  const items = (j.data || []).map((x) => (type === 'videos' ? sepiaItem(x) : type === 'video-channels' ? cItem(x, hostOnly(s)) : pItem(x, hostOnly(s))));
  return { items, next: start + PAGE < (j.total || 0) ? String(start + PAGE) : null };
}

export async function suggest() { return []; }

export async function stream(id) {
  const [uuid, host] = split(id);
  if (!host) throw new ContentError('Bad PeerTube id');
  let v;
  try { v = await getJSON(`${base(host)}/api/v1/videos/${uuid}`, { timeout: 15000 }); } catch (e) {
    if (e instanceof HttpError && (e.status === 404 || e.status === 403)) throw new ContentError('This video is unavailable or private.');
    throw e;
  }
  const desc = await getJSON(`${base(host)}/api/v1/videos/${uuid}/description`).then((d) => d.description).catch(() => v.description || '');
  const files = [...(v.files || []), ...(v.streamingPlaylists || []).flatMap((p) => p.files || [])].filter((f) => f.fileUrl || f.fileDownloadUrl);
  const hlsPl = (v.streamingPlaylists || []).find((p) => p.playlistUrl);
  const seen = new Set();
  const video = files.filter((f) => !f.hasAudio === false || true).map((f) => ({
    url: f.fileUrl || f.fileDownloadUrl, mime: /\.webm/.test(f.fileUrl || '') ? 'video/webm' : 'video/mp4', height: f.resolution?.id, label: f.resolution?.label || `${f.resolution?.id}p`,
    size: f.size || 0, fps: f.fps > 0 ? f.fps : undefined, videoOnly: f.hasAudio === false, ext: /\.webm/.test(f.fileUrl || '') ? 'webm' : 'mp4', audioOnly: f.resolution?.id === 0,
  })).filter((f) => { const k = f.url; if (seen.has(k)) return false; seen.add(k); return true; });
  const audio = video.filter((f) => f.audioOnly).map((f) => ({ ...f, label: 'Audio only', ext: 'm4a', mime: 'audio/mp4' }));
  const related = await getJSON(`${base(host)}/api/v1/search/videos?search=${enc((v.tags || [])[0] || v.name)}&count=12&nsfw=false`).then((j) => (j.data || []).filter((x) => x.uuid !== uuid).map((x) => vItem(x, host))).catch(() => []);
  const caps = await getJSON(`${base(host)}/api/v1/videos/${uuid}/captions`).then((j) => (j.data || []).map((c) => ({ label: c.language?.label, lang: c.language?.id, url: base(host) + c.captionPath, mime: 'text/vtt' }))).catch(() => []);
  const chap = await getJSON(`${base(host)}/api/v1/videos/${uuid}/chapters`).then((j) => (j.chapters || []).map((c) => ({ title: c.title, start: c.timecode }))).catch(() => []);
  return {
    service: SERVICE, type: 'stream', id, title: v.name, description: desc || '', descriptionIsHtml: false, uploader: v.channel?.displayName, uploaderId: `${v.channel?.name}@${v.channel?.host || host}`,
    uploaderAvatar: v.channel?.avatars?.[0]?.path ? base(v.channel.host || host) + v.channel.avatars[0].path : '', subscribers: v.channel?.followersCount ?? null,
    thumbnail: v.previewPath ? base(host) + v.previewPath : '', duration: v.duration, views: v.views, likes: v.likes, dislikes: v.dislikes, uploaded: v.publishedAt ? Date.parse(v.publishedAt) : null,
    tags: v.tags || [], category: v.category?.label, license: v.licence?.label, language: v.language?.label, live: !!v.isLive, hls: hlsPl?.playlistUrl || null, chapters: chap, subtitles: caps,
    audio, video: video.filter((f) => !f.audioOnly), related, url: v.url || `${base(host)}/w/${uuid}`, backend: host,
  };
}

export async function comments(id, page) {
  const [uuid, host] = split(id);
  const start = page ? Number(page) : 0;
  const j = await getJSON(`${base(host)}/api/v1/videos/${uuid}/comment-threads?start=${start}&count=20&sort=-createdAt`).catch(() => null);
  if (!j) return { disabled: true, items: [], next: null };
  return {
    disabled: false, next: start + 20 < j.total ? String(start + 20) : null,
    items: (j.data || []).map((c) => ({
      id: String(c.id), author: c.account?.displayName, avatar: c.account?.avatars?.[0]?.path ? base(c.account.host || host) + c.account.avatars[0].path : '', html: c.text, md: true,
      time: c.createdAt ? c.createdAt.slice(0, 10) : '', likes: null, replies: c.totalReplies,
    })),
  };
}

export async function channel(id, page, s) {
  const [name, host] = split(id);
  const start = page ? Number(page) : 0;
  const vids = await getJSON(`${base(host)}/api/v1/video-channels/${name}/videos?start=${start}&count=${PAGE}&sort=-publishedAt&nsfw=false`);
  const items = (vids.data || []).map((v) => vItem(v, host));
  const next = start + PAGE < vids.total ? String(start + PAGE) : null;
  if (page) return { info: null, items, next };
  const c = await getJSON(`${base(host)}/api/v1/video-channels/${name}`);
  const info = cItem({ ...c, host }, host);
  info.banner = c.banners?.slice(-1)[0]?.path ? base(host) + c.banners.slice(-1)[0].path : '';
  info.thumbnail = info.thumbnail || '';
  return { info, items, next };
}

export async function playlist(id) {
  const [uuid, host] = split(id);
  const [p, v] = await Promise.all([getJSON(`${base(host)}/api/v1/video-playlists/${uuid}`), getJSON(`${base(host)}/api/v1/video-playlists/${uuid}/videos?count=100`)]);
  return { info: pItem({ ...p, ownerAccount: { ...p.ownerAccount, host } }, host), items: (v.data || []).map((x) => x.video).filter(Boolean).map((x) => vItem(x, host)), next: null };
}
