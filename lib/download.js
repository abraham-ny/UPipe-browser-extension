// Downloads: direct files go through the browser's download manager; HLS audio is stitched together locally.
import { ext } from './browser.js';
import { getText, getBlob } from './http.js';
import { safeName } from './util.js';
import { addDownload } from './store.js';

export function buildName(tpl, item, ext_) {
  const map = { title: item.title, uploader: item.uploader || item.artist, id: item.id, service: item.service, album: item.album };
  let name = (tpl || '{uploader} - {title}').replace(/\{(\w+)\}/g, (_, k) => map[k] || '');
  name = name.replace(/^\s*[-–]\s*|\s*[-–]\s*$/g, '').replace(/\s+-\s+-\s+/g, ' - ');
  return `${safeName(name || item.title)}.${ext_}`;
}

function fileUrl(folder, name) {
  const f = safeName(folder || '', 60).replace(/^untitled$/, '');
  return f ? `${f}/${name}` : name;
}

async function hlsToBlob(playlistUrl, onProgress) {
  const text = await getText(playlistUrl, { timeout: 20000 });
  const lines = text.split('\n').map((l) => l.trim());
  const base = new URL(playlistUrl);
  let segs = lines.filter((l) => l && !l.startsWith('#')).map((l) => new URL(l, base).href);
  // Master playlist -> pick the first variant
  if (segs.length && /\.m3u8(\?|$)/.test(segs[0])) return hlsToBlob(segs[0], onProgress);
  const mapLine = lines.find((l) => l.startsWith('#EXT-X-MAP'));
  const parts = [];
  if (mapLine) { const m = /URI="([^"]+)"/.exec(mapLine); if (m) parts.push(await getBlob(new URL(m[1], base).href, { timeout: 30000 })); }
  let done = 0;
  for (const u of segs) {
    parts.push(await getBlob(u, { timeout: 30000 }));
    onProgress?.(++done / segs.length);
  }
  return new Blob(parts);
}

/** Start a download. Resolves to a record once the browser accepted it (or the blob was handed over). */
export async function startDownload({ item, stream, kind, settings, onProgress }) {
  const e = stream.ext || (kind === 'audio' ? 'mp3' : 'mp4');
  const name = buildName(settings.filenameTemplate, item, e);
  const filename = fileUrl(settings.downloadFolder, name);
  let url = stream.url;
  let revoke = null;
  if (stream.hls) {
    const blob = await hlsToBlob(stream.url, onProgress);
    url = URL.createObjectURL(blob);
    revoke = url;
  }
  const id = await new Promise((resolve, reject) => {
    const done = (v) => { const err = ext.runtime.lastError; if (err || v === undefined) reject(new Error(err?.message || 'Download was refused by the browser')); else resolve(v); };
    try {
      const p = ext.downloads.download({ url, filename, saveAs: !!settings.askWhere, conflictAction: 'uniquify' }, done);
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (err) { reject(err); }
  });
  if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 10 * 60 * 1000);
  const rec = { id, at: Date.now(), name, kind, service: item.service, itemId: item.id, title: item.title, uploader: item.uploader, thumbnail: item.thumbnail, quality: stream.label };
  await addDownload(rec);
  return rec;
}

export const showDownload = (id) => { try { ext.downloads.show(id); } catch { /* ignore */ } };
export function downloadText(filename, text, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
