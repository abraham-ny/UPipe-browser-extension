// hls.js is vendored locally (Manifest V3 forbids remote code). Loaded on demand as a classic script.
let loading = null;
export function loadHls() {
  if (globalThis.Hls) return Promise.resolve(globalThis.Hls);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('./vendor/hls.min.js', import.meta.url).href;
    s.onload = () => (globalThis.Hls ? resolve(globalThis.Hls) : reject(new Error('hls.js failed to initialise')));
    s.onerror = () => reject(new Error('Could not load hls.js'));
    document.head.append(s);
  });
  return loading;
}

/** Attach an HLS (or progressive) source to a media element. Returns a disposer. */
export async function attach(media, url, { hls, startAt = 0, onError } = {}) {
  let inst = null;
  if (hls || /\.m3u8(\?|$)/.test(url)) {
    if (media.canPlayType('application/vnd.apple.mpegurl')) { media.src = url; } else {
      const Hls = await loadHls();
      if (!Hls.isSupported()) throw new Error('This browser cannot play HLS streams');
      inst = new Hls({ startPosition: startAt || -1, enableWorker: true, lowLatencyMode: false });
      inst.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.NETWORK_ERROR) inst.startLoad();
        else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) inst.recoverMediaError();
        else onError?.(new Error('Stream error: ' + d.details));
      });
      inst.loadSource(url);
      inst.attachMedia(media);
    }
  } else {
    media.src = url;
    if (startAt) media.addEventListener('loadedmetadata', () => { media.currentTime = startAt; }, { once: true });
  }
  return () => { try { inst?.destroy(); } catch { /* ignore */ } };
}
