// Bandcamp: public discover endpoint, search page and album/track pages (parsed locally; nothing leaves your browser).
import { getJSON, getText, postJSON, ContentError } from '../http.js';
import { enc } from '../util.js';

const SERVICE = 'bandcamp';
const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const artUrl = (id, size = 9) => (id ? `https://f4.bcbits.com/img/a${id}_${size}.jpg` : '');
const origin = (u) => { try { return new URL(u).origin; } catch { return ''; } };

export const filters = [['all', 'All'], ['tracks', 'Tracks'], ['albums', 'Albums'], ['artists', 'Artists']];
const ITEM_TYPE = { all: '', tracks: 't', albums: 'a', artists: 'b' };

function hintUrl(h, type) {
  if (!h) return '';
  const base = h.custom_domain ? `https://${h.custom_domain}` : `https://${h.subdomain}.bandcamp.com`;
  return `${base}/${h.item_type === 't' || type === 't' ? 'track' : 'album'}/${h.slug}`;
}

function fromDiscover(x) {
  const url = x.item_url || x.tralbum_url || hintUrl(x.url_hints, x.type || x.item_type);
  if (!url) return null;
  const isTrack = /\/track\//.test(url);
  const artId = x.art_id || x.item_image_id || x.primary_image?.image_id || x.image_id;
  return {
    service: SERVICE, type: isTrack ? 'stream' : 'playlist', id: url, url, title: x.title || x.primary_text || x.item_title || '',
    uploader: x.band_name || x.secondary_text || x.artist || '', uploaderId: x.band_url || (x.url_hints?.subdomain ? `https://${x.url_hints.subdomain}.bandcamp.com` : origin(url)),
    thumbnail: x.item_art_url || artUrl(artId) || '', description: x.genre_text || x.genre || '',
  };
}

async function discover({ tag, slice = 'top', cursor = '*' } = {}) {
  const body = { category_id: 0, tag_norm_names: tag ? [tag] : [], geoname_id: 0, slice, time_facet_id: null, cursor, size: 40, include_result_types: ['a', 's'] };
  try {
    const j = await postJSON('https://bandcamp.com/api/discover/1/discover_web', body);
    const items = (j.results || []).map(fromDiscover).filter(Boolean);
    if (items.length) return { items, next: j.cursor && !j.batch_result_count_is_final && j.cursor !== cursor ? j.cursor : null };
  } catch { /* try legacy endpoint */ }
  const p = cursor === '*' ? 0 : Number(cursor) || 0;
  const j = await getJSON(`https://bandcamp.com/api/discover/3/get_web?g=${enc(tag || 'all')}&s=${slice}&p=${p}&gn=0&f=all&w=0`);
  return { items: (j.items || []).map(fromDiscover).filter(Boolean), next: j.more_available ? String(p + 1) : null };
}

export async function trending() {
  const r = await discover({ slice: 'top' });
  return { items: r.items, next: r.next ? 'd:' + r.next : null };
}

function parseSearch(html) {
  const doc = parse(html);
  const out = [];
  for (const li of doc.querySelectorAll('li.searchresult')) {
    const type = txt(li.querySelector('.itemtype')).toLowerCase();
    const a = li.querySelector('.heading a');
    const rawUrl = txt(li.querySelector('.itemurl')) || a?.getAttribute('href') || '';
    const url = rawUrl.split('?')[0];
    if (!url) continue;
    const img = li.querySelector('.art img');
    const thumb = img?.getAttribute('src') || '';
    const title = txt(a);
    const sub = txt(li.querySelector('.subhead'));
    const by = (sub.match(/by (.+?)(?:\s+from|$)/i) || [])[1] || '';
    if (type.startsWith('artist') || type.startsWith('label')) out.push({ service: SERVICE, type: 'channel', id: origin(url) || url, title, thumbnail: thumb, description: txt(li.querySelector('.genre')) || sub, url });
    else if (type.startsWith('track')) out.push({ service: SERVICE, type: 'stream', id: url, url, title, uploader: by, uploaderId: origin(url), thumbnail: thumb, description: sub });
    else if (type.startsWith('album')) out.push({ service: SERVICE, type: 'playlist', id: url, url, title, uploader: by, uploaderId: origin(url), thumbnail: thumb, description: txt(li.querySelector('.length')) });
  }
  const next = doc.querySelector('a.next')?.getAttribute('href') ? true : false;
  return { items: out, next };
}

export async function search(q, { filter = 'all', page = null } = {}) {
  if (page && String(page).startsWith('d:')) return discover({ cursor: page.slice(2) });
  const p = page ? Number(page) : 1;
  const html = await getText(`https://bandcamp.com/search?q=${enc(q)}&page=${p}${ITEM_TYPE[filter] ? '&item_type=' + ITEM_TYPE[filter] : ''}`);
  const r = parseSearch(html);
  return { items: r.items, next: r.next && r.items.length ? String(p + 1) : null };
}

export async function suggest(q) {
  try {
    const j = await postJSON('https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic', { search_text: q, search_filter: '', full_page: false, fan_id: null });
    const res = j.auto?.results || [];
    return [...new Set(res.map((r) => r.name).filter(Boolean))].slice(0, 8);
  } catch { return []; }
}

function ldJson(doc) {
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try { return JSON.parse(s.textContent); } catch { /* next */ }
  }
  return {};
}
function isoDur(d) {
  const m = /P(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i.exec(d || '') || [];
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
}
function tralbum(doc) {
  const el = doc.querySelector('script[data-tralbum]');
  if (!el) return null;
  try { return JSON.parse(el.getAttribute('data-tralbum')); } catch { return null; }
}
function pageTags(doc) {
  return [...doc.querySelectorAll('.tralbum-tags a.tag, a.tag')].map(txt).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
}
function trackFile(t) {
  const f = t.file || {};
  return f['mp3-128'] || f['mp3-v0'] || Object.values(f)[0] || '';
}
function ldDate(s) { const t = Date.parse(s); return Number.isNaN(t) ? null : t; }

export async function stream(id) {
  const html = await getText(id, { timeout: 15000 });
  const doc = parse(html);
  const tr = tralbum(doc);
  if (!tr) throw new ContentError('This page has no playable track.');
  const ld = ldJson(doc);
  const base = origin(id);
  const isAlbumPage = /\/album\//.test(id);
  const infos = tr.trackinfo || [];
  const wanted = isAlbumPage ? infos.find((t) => trackFile(t)) : infos[0];
  if (!wanted || !trackFile(wanted)) throw new ContentError('This track is not available for streaming.');
  const file = trackFile(wanted);
  const cover = (doc.querySelector('#tralbumArt img')?.getAttribute('src') || ld.image || '').replace(/_\d+\.jpg/, '_10.jpg');
  const artist = tr.artist || ld.byArtist?.name || txt(doc.querySelector('#name-section .fromAlbum ~ span a, #name-section a'));
  const current = tr.current || {};
  const tracksFromAlbum = infos.filter((t) => trackFile(t)).map((t) => ({
    service: SERVICE, type: 'stream', id: t.title_link ? base + t.title_link : id, url: t.title_link ? base + t.title_link : id, title: t.title, uploader: t.artist || artist,
    uploaderId: base, thumbnail: cover, duration: Math.round(t.duration || 0), album: current.title,
  }));
  const label = file.includes('?') ? 'MP3 128 kbps' : 'MP3';
  const supporters = [...doc.querySelectorAll('.collected-by .deets .fan-name, .more-thumbs .fan, .deets a')].length;
  return {
    service: SERVICE, type: 'stream', id, url: id, title: wanted.title || current.title || ld.name, uploader: artist, uploaderId: base, uploaderAvatar: doc.querySelector('.band-photo')?.getAttribute('src') || '',
    thumbnail: cover, duration: Math.round(wanted.duration || isoDur(ld.duration) || 0), views: null, likes: null,
    uploaded: ldDate(ld.datePublished) || ldDate(current.release_date) || ldDate(current.publish_date), description: (current.about || ld.description || '').trim(), descriptionIsHtml: false,
    credits: current.credits || '', tags: (Array.isArray(ld.keywords) ? ld.keywords : String(ld.keywords || '').split(',')).map((x) => x.trim()).filter(Boolean).concat(pageTags(doc)).filter((v, i, a) => v && a.indexOf(v) === i),
    category: ld.publisher?.name ? 'Label: ' + ld.publisher.name : '', album: tr.current?.title && isAlbumPage === false ? (ld.inAlbum?.name || '') : current.title,
    license: ld.copyrightNotice || '', subscribers: null, supporters, price: ld.offers?.price != null ? `${ld.offers.price} ${ld.offers.priceCurrency || ''}`.trim() : '',
    audio: [{ url: file, mime: 'audio/mpeg', ext: 'mp3', bitrate: 128000, label, size: 0 }], video: [], related: tracksFromAlbum.length > 1 ? tracksFromAlbum : [], chapters: [], subtitles: [],
    albumTracks: tracksFromAlbum,
  };
}

export async function comments() { return { disabled: true, items: [], next: null }; }

function parseGrid(doc, base) {
  const out = [];
  for (const li of doc.querySelectorAll('li.music-grid-item, .music-grid li')) {
    const a = li.querySelector('a[href]');
    if (!a) continue;
    const href = new URL(a.getAttribute('href'), base + '/').href;
    const img = li.querySelector('img');
    const thumb = img?.getAttribute('data-original') || img?.getAttribute('src') || '';
    const title = txt(li.querySelector('.title')).replace(/\s*\n.*/, '');
    const artist = txt(li.querySelector('.artist-override'));
    out.push({ service: SERVICE, type: /\/track\//.test(href) ? 'stream' : 'playlist', id: href, url: href, title, uploader: artist, uploaderId: base, thumbnail: thumb });
  }
  return out;
}

export async function channel(id, page) {
  const base = origin(id) || id;
  const html = await getText(`${base}/music`, { timeout: 15000 });
  const doc = parse(html);
  let items = parseGrid(doc, base);
  if (!items.length) {
    // single release or older layout: use the data-client-items blob
    const ci = doc.querySelector('ol[data-client-items]');
    try { items = JSON.parse(ci?.getAttribute('data-client-items') || '[]').map((x) => ({ service: SERVICE, type: x.type === 'track' ? 'stream' : 'playlist', id: base + x.page_url, url: base + x.page_url, title: x.title, uploader: x.artist || '', uploaderId: base, thumbnail: x.art_id ? artUrl(x.art_id) : '' })); } catch { /* none */ }
  }
  const name = txt(doc.querySelector('#band-name-location .title')) || txt(doc.querySelector('p.band-name')) || doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content') || new URL(base).hostname;
  const loc = txt(doc.querySelector('#band-name-location .location'));
  const bio = txt(doc.querySelector('#bio-text')) || doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  const photo = doc.querySelector('.band-photo')?.getAttribute('src') || doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
  const links = [...doc.querySelectorAll('#band-links a')].map((a) => ({ label: txt(a), url: a.href }));
  return { info: { service: SERVICE, type: 'channel', id: base, title: name, thumbnail: photo, description: [loc, bio].filter(Boolean).join('\n\n'), links, url: base }, items, next: null };
}

export async function playlist(id) {
  const html = await getText(id, { timeout: 15000 });
  const doc = parse(html);
  const tr = tralbum(doc);
  if (!tr) throw new ContentError('Could not read this album.');
  const ld = ldJson(doc);
  const base = origin(id);
  const cover = (doc.querySelector('#tralbumArt img')?.getAttribute('src') || ld.image || '').replace(/_\d+\.jpg/, '_10.jpg');
  const items = (tr.trackinfo || []).map((t) => ({
    service: SERVICE, type: 'stream', id: t.title_link ? base + t.title_link : id, url: t.title_link ? base + t.title_link : id, title: t.title, uploader: t.artist || tr.artist,
    uploaderId: base, thumbnail: cover, duration: Math.round(t.duration || 0), album: tr.current?.title, playable: !!trackFile(t),
  }));
  return {
    info: {
      service: SERVICE, type: 'playlist', id, title: tr.current?.title || ld.name, thumbnail: cover, uploader: tr.artist || ld.byArtist?.name, uploaderId: base, count: items.length,
      description: (tr.current?.about || ld.description || '').trim(), tags: (Array.isArray(ld.keywords) ? ld.keywords : []).concat(pageTags(doc)).filter((v, i, a) => v && a.indexOf(v) === i), uploaded: ldDate(ld.datePublished), url: id,
    }, items, next: null,
  };
}
