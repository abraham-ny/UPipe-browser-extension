// Cross-browser extension API handle. Firefox exposes `browser`, Chromium exposes `chrome`
// (both return promises for the APIs UPipe uses under Manifest V3).
export const ext = globalThis.browser ?? globalThis.chrome;
export const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
export const hasWindows = !!(ext && ext.windows);

export function send(message) {
  return new Promise((resolve) => {
    try {
      const r = ext.runtime.sendMessage(message, (res) => {
        void ext.runtime.lastError;
        resolve(res);
      });
      if (r && typeof r.then === 'function') r.then(resolve, () => resolve(undefined));
    } catch {
      resolve(undefined);
    }
  });
}
