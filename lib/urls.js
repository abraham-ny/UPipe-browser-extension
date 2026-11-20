// Pure URL helpers (no DOM, safe in the background worker).
const YT_ID = /^[\w-]{11}$/;
const SC_RESERVED = new Set(['discover', 'search', 'stream', 'you', 'upload', 'charts', 'pages', 'terms-of-use', 'jobs', 'mobile', 'imprint', 'popular', 'login', 'signin']);

export function parseUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music|gaming)\./, '');
  const seg = u.pathname.split('/').filter(Boolean);
  const t = u.searchParams.get('t') || u.searchParams.get('start');

  if (host === 'youtu.be') {
    return YT_ID.test(seg[0] || '') ? { service: 'youtube', type: 'stream', id: seg[0], t } : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = u.searchParams.get('v');
    const list = u.searchParams.get('list');
    if (seg[0] === 'watch' && YT_ID.test(v || '')) return { service: 'youtube', type: 'stream', id: v, t };
    if (seg[0] === 'playlist' && list) return { service: 'youtube', type: 'playlist', id: list };
    if (['shorts', 'embed', 'live', 'v'].includes(seg[0]) && YT_ID.test(seg[1] || '')) return { service: 'youtube', type: 'stream', id: seg[1], t };
    if (seg[0] === 'channel' && seg[1]) return { service: 'youtube', type: 'channel', id: seg[1] };
    if (seg[0] && seg[0].startsWith('@')) return { service: 'youtube', type: 'channel', id: seg[0] };
    if ((seg[0] === 'c' || seg[0] === 'user') && seg[1]) return { service: 'youtube', type: 'channel', id: '@' + seg[1] };
    return null;
  }
  if (host === 'soundcloud.com' || host === 'on.soundcloud.com') {
    if (seg.length && !SC_RESERVED.has(seg[0])) return { service: 'soundcloud', type: 'resolve', id: u.origin.replace('//m.', '//') + u.pathname };
    return null;
  }
  if (host === 'media.ccc.de') {
    if (seg[0] === 'v' && seg[1]) return { service: 'ccc', type: 'stream', id: seg[1] };
    if (seg[0] === 'c' && seg[1]) return { service: 'ccc', type: 'channel', id: seg[1] };
    return null;
  }
  if (host.endsWith('.bandcamp.com')) {
    const origin = u.origin;
    if (seg[0] === 'track' && seg[1]) return { service: 'bandcamp', type: 'stream', id: `${origin}/track/${seg[1]}` };
    if (seg[0] === 'album' && seg[1]) return { service: 'bandcamp', type: 'playlist', id: `${origin}/album/${seg[1]}` };
    if (!seg.length || seg[0] === 'music') return { service: 'bandcamp', type: 'channel', id: origin };
    return null;
  }
  // Any host that serves /watch?v=<id> is a YouTube front-end (Piped, Invidious, ...)
  if (seg[0] === 'watch' && YT_ID.test(u.searchParams.get('v') || '')) return { service: 'youtube', type: 'stream', id: u.searchParams.get('v'), t };
  // PeerTube (any instance)
  const pt = u.host;
  if (seg[0] === 'w' && seg[1] === 'p' && seg[2]) return { service: 'peertube', type: 'playlist', id: `${seg[2]}@${pt}` };
  if (seg[0] === 'w' && seg[1]) return { service: 'peertube', type: 'stream', id: `${seg[1]}@${pt}`, t };
  if (seg[0] === 'videos' && (seg[1] === 'watch' || seg[1] === 'embed') && seg[2] === 'playlist' && seg[3]) return { service: 'peertube', type: 'playlist', id: `${seg[3]}@${pt}` };
  if (seg[0] === 'videos' && (seg[1] === 'watch' || seg[1] === 'embed') && seg[2]) return { service: 'peertube', type: 'stream', id: `${seg[2]}@${pt}`, t };
  if ((seg[0] === 'c' || seg[0] === 'video-channels') && seg[1] && !seg[1].includes('@')) return { service: 'peertube', type: 'channel', id: `${seg[1]}@${pt}` };
  return null;
}

export function routeFor(ref) {
  const q = new URLSearchParams({ s: ref.service, id: ref.id });
  if (ref.t) q.set('t', ref.t);
  const page = ref.type === 'channel' ? 'channel'
    : (ref.type === 'playlist' || ref.type === 'album') ? 'playlist'
    : ref.type === 'resolve' ? 'resolve' : 'watch';
  return `#/${page}?${q}`;
}

export const itemRoute = (item) => routeFor(item);

export function refToItem(ref) {
  const type = ref.type === 'playlist' || ref.type === 'album' ? 'playlist' : ref.type === 'resolve' ? 'resolve' : 'stream';
  return { service: ref.service, id: ref.id, type, title: ref.id, url: ref.id };
}
