import { SERVICES } from './config.js';

const GLOW = { off: 0, soft: 10, normal: 18, bold: 30 };
const TINT = { off: 0, soft: 3, normal: 6, bold: 10 };

export function resolveTheme(pref) {
  if (pref === 'system') return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return ['dark', 'light', 'black'].includes(pref) ? pref : 'dark';
}

export function luminance(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => {
    const c = parseInt(x, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Phantom accent: the whole UI re-tints itself to the brand colour of the active service. */
export function applyTheme(s, serviceId) {
  const root = document.documentElement;
  const theme = resolveTheme(s.theme);
  const svc = SERVICES[serviceId || s.service] || SERVICES.youtube;
  const accent = s.accentMode === 'custom' && /^#[\da-f]{6}$/i.test(s.accentColor) ? s.accentColor : svc.color;
  const glow = GLOW[s.glow] ?? 18;
  const tint = TINT[s.glow] ?? 6;
  root.dataset.theme = theme;
  root.dataset.service = svc.id;
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-fg', luminance(accent) > 0.45 ? '#111' : '#fff');
  root.style.setProperty('--glow', `${theme === 'black' ? glow * 0.85 : glow}%`);
  root.style.setProperty('--tint', `${theme === 'black' ? 0 : tint}%`);
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta); }
  meta.content = accent;
}

export function watchSystemTheme(cb) {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
