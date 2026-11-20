import { ext, send } from '../lib/browser.js';
import { h, $ } from '../lib/util.js';
import { icon } from '../lib/icons.js';
import { SERVICES, SERVICE_ORDER, DONATE_URL, WEBSITE } from '../lib/config.js';
import { applyTheme } from '../lib/theme.js';
import { getSettings, setSettings } from '../lib/store.js';
import { parseUrl, routeFor, refToItem } from '../lib/urls.js';

(async function () {
  let s = await getSettings();
  applyTheme(s, s.service);
  const root = $('#root');
  const openApp = async (hash) => { await send({ type: 'app:open', hash }); window.close(); };

  const input = h('input', { type: 'text', placeholder: `Search ${SERVICES[s.service].name} or paste a link`, 'aria-label': 'Search or paste link', autofocus: true });
  const go = h('form', { class: 'go', onsubmit: (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return openApp('#/');
    const ref = parseUrl(v);
    if (ref) setSettings({ service: ref.service }).then(() => openApp(routeFor(ref)));
    else openApp(`#/search?q=${encodeURIComponent(v)}&s=${s.service}`);
  } }, input, h('button', { class: 'icon-btn', type: 'submit', 'aria-label': 'Go' }, icon('search')));

  const chips = h('div', { class: 'chips' }, SERVICE_ORDER.map((id) => h('button', { class: 'chip' + (id === s.service ? ' active' : ''), onclick: async () => {
    s = await setSettings({ service: id }); applyTheme(s, id);
    chips.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('active', SERVICE_ORDER[i] === id));
    input.placeholder = `Search ${SERVICES[id].name} or paste a link`;
  } }, SERVICES[id].name)));

  root.append(h('div', { class: 'head' }, h('div', { class: 'logo' }, icon('play')), h('div', h('b', 'UPipe'), h('div', { class: 'muted', style: { fontSize: '12px' } }, 'NewPipe for the web'))), go, chips);

  // current tab -> open/play in UPipe
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    const ref = tab?.url ? parseUrl(tab.url) : null;
    if (ref) {
      const sv = SERVICES[ref.service];
      root.append(h('div', { class: 'tab' }, h('span', { class: 'svc-dot', style: { background: sv.color } }, sv.name[0]),
        h('div', { class: 'grow' }, h('b', tab.title || sv.name), h('span', `Detected on ${sv.name}`)),
        h('button', { class: 'btn sm primary', onclick: () => openApp(routeFor(ref)) }, 'Open'),
        ref.type === 'stream' || ref.type === 'resolve' ? h('button', { class: 'icon-btn', title: 'Play audio', 'aria-label': 'Play audio', onclick: async () => { await send({ type: 'player:open', payload: { items: [refToItem(ref)], index: 0, mode: 'play' } }); window.close(); } }, icon('play')) : null));
    }
  } catch { /* no tab access */ }

  root.append(
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onclick: () => openApp('#/') }, icon('home'), 'Open UPipe'),
      h('button', { class: 'btn', onclick: async () => { await send({ type: 'player:open', payload: { focusOnly: true, mode: 'focus' } }); window.close(); } }, icon('music'), 'Audio player'),
      h('button', { class: 'btn', onclick: () => openApp('#/library') }, icon('library'), 'Library'),
      h('button', { class: 'btn', onclick: () => openApp('#/settings') }, icon('settings'), 'Settings')),
    h('div', { class: 'foot' }, h('a', { href: DONATE_URL, target: '_blank', rel: 'noopener noreferrer' }, '☕ Donate'), h('a', { href: WEBSITE, target: '_blank', rel: 'noopener noreferrer' }, 'Website')));
})();
