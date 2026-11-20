export const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u); } };

export class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} from ${hostOf(url)}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.body = body;
  }
}
/** The content itself is unavailable (private, removed...). Retrying another instance will not help. */
export class ContentError extends Error {
  constructor(message) { super(message); this.name = 'ContentError'; }
}

export function contentErrorFrom(e) {
  if (!(e instanceof HttpError) || !e.body) return null;
  try {
    const j = JSON.parse(e.body);
    const msg = String(j.message || j.error || '');
    if (/unavailable|private|removed|deleted|not (found|available)|\bage\b|age[- ]restrict|members|copyright|terminated|does not exist/i.test(msg)) {
      return new ContentError(msg.slice(0, 220));
    }
  } catch { /* not JSON */ }
  return null;
}

async function request(url, opts, read) {
  const { method = 'GET', headers, body, timeout = 12000, signal } = opts || {};
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeout);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, { method, headers, body, signal: ctl.signal, credentials: 'omit', redirect: 'follow' });
    if (!res.ok) {
      let b = '';
      try { b = (await res.text()).slice(0, 2000); } catch { /* ignore */ }
      throw new HttpError(res.status, url, b);
    }
    return await read(res);
  } catch (e) {
    if (timedOut) throw new Error(`Timed out contacting ${hostOf(url)}`);
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export const getJSON = (url, o) => request(url, { ...o, headers: { Accept: 'application/json', ...(o && o.headers) } }, (r) => r.json());
export const getText = (url, o) => request(url, o, (r) => r.text());
export const getBlob = (url, o) => request(url, o, (r) => r.blob());
export const postJSON = (url, data, o) => request(url, {
  ...o, method: 'POST', body: JSON.stringify(data),
  headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(o && o.headers) },
}, (r) => r.json());
