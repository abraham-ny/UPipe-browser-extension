// UPipe main app: shell (rail + search bar), hash router, and theme wiring.
import { h, $, parseHash, hashFor, debounce, enc } from '../lib/util.js';
import { icon } from '../lib/icons.js';
import { SERVICES, SERVICE_ORDER } from '../lib/config.js';
import { applyTheme, watchSystemTheme } from '../lib/theme.js';
import * as store from '../lib/store.js';
import * as svc from '../lib/services/index.js';
import { parseUrl, routeFor } from '../lib/urls.js';
import { toast, errorBox } from '../lib/ui.js';

const views = {
  home: () => import('./views/home.js'),
  search: () => import('./views/search.js'),
  watch: () => import('./views/watch.js'),
  channel: () => import('./views/channel.js'),
  playlist: () => import('./views/playlist.js'),
  resolve: () => import('./views/resolve.js'),
  library: () => import('./views/library.js'),
  settings: () => import('./views/settings.js'),
  about: () => import('./views/about.js'),
};

let settings;
let page, searchInput, suggestBox, pill, current = null;
let navToken = 0;

export const getSettings = () => settings;

async function setService(id) {
  if (!SERVICES[id]) return;
  settings = await store.setSettings({ service: id });
  paint();
  const r = parseHash();
  if (r.path === 'search') location.hash = hashFor('search', { ...r.params, s: id, filter: '' });
  else if (r.path === 'home' || r.path === '') route();
  else if (['watch', 'channel', 'playlist'].includes(r.path)) location.hash = '#/';
}

function paint() {
  applyTheme(settings, activeServiceForTheme());
  document.querySelectorAll('.nav-item[data-s]').forEach((n) => n.classList.toggle('active', n.dataset.s === settings.service));
  document.querySelectorAll('.nav-item[data-r]').forEach((n) => n.classList.toggle('active', n.dataset.r === parseHash().path));
  if (pill) { pill.lastChild.textContent = SERVICES[settings.service].name; }
  if (searchInput) searchInput.placeholder = `Search ${SERVICES[settings.service].name} or paste a link…`;
}
// While viewing an item from another service, tint the UI with that service.
let override = null;
export function themeService(id) { override = id; applyTheme(settings, activeServiceForTheme()); }
const activeServiceForTheme = () => override || settings.service;

function navItem(label, ic, attrs) {
  return h('a', { class: 'nav-item', ...attrs }, icon(ic), h('span', label));
}

function buildShell() {
  const app = $('#app');
  const rail = h('nav', { class: 'rail', 'aria-label': 'Main' },
    h('a', { class: 'logo', href: '#/', title: 'UPipe home' }, icon('play')),
    navItem('Home', 'home', { href: '#/', 'data-r': '' }),
    h('div', { class: 'sep' }),
    ...SERVICE_ORDER.map((id) => {
      const s = SERVICES[id];
      return h('a', { class: 'nav-item', href: '#/', 'data-s': id, title: s.name, onclick: (e) => { e.preventDefault(); setService(id); } },
        h('span', { class: 'svc-dot', style: { background: s.color } }, s.name[0]), h('span', s.id === 'ccc' ? 'CCC' : s.name.replace('media.', '')));
    }),
    h('div', { class: 'sep' }),
    navItem('Library', 'library', { href: '#/library', 'data-r': 'library' }),
    h('div', { class: 'spacer' }),
    navItem('Settings', 'settings', { href: '#/settings', 'data-r': 'settings' }),
    navItem('About', 'info', { href: '#/about', 'data-r': 'about' }));

  pill = h('span', { class: 'svc-pill' }, h('i'), h('span'));
  searchInput = h('input', { type: 'search', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Search', id: 'q' });
  suggestBox = h('div', { class: 'suggest hide', role: 'listbox' });
  const form = h('form', { onsubmit: (e) => { e.preventDefault(); submitSearch(searchInput.value); } }, pill, searchInput,
    h('button', { class: 'icon-btn', type: 'submit', 'aria-label': 'Search' }, icon('search')));
  const search = h('div', { class: 'search' }, form, suggestBox);

  const themeBtn = h('button', { class: 'icon-btn', title: 'Cycle theme (dark / true black / light)', 'aria-label': 'Cycle theme', onclick: cycleTheme }, icon('moon'));
  const playerBtn = h('button', { class: 'icon-btn', title: 'Open audio player', 'aria-label': 'Open audio player', onclick: () => import('../lib/browser.js').then((m) => m.send({ type: 'player:open', payload: { focusOnly: true, mode: 'focus' } })) }, icon('music'));
  const topbar = h('header', { class: 'topbar' }, search, h('div', { class: 'spacer' }), playerBtn, themeBtn);
  page = h('main', { class: 'page', id: 'page', tabindex: '-1' });
  app.replaceChildren(h('div', { class: 'shell' }, rail, h('div', { class: 'main' }, topbar, page)));

  const onInput = debounce(async () => {
    const q = searchInput.value.trim();
    if (!settings.searchSuggestions && q) return hideSuggest();
    const local = (await store.getSearches()).filter((x) => x.toLowerCase().includes(q.toLowerCase())).slice(0, 5);
    const remote = q.length > 1 && settings.searchSuggestions && !parseUrl(q) ? await svc.suggest(settings.service, q) : [];
    renderSuggest(q, [...new Set([...local.map((t) => ({ t, local: true })), ...remote.map((t) => ({ t }))].map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x)).slice(0, 9));
  }, 160);
  searchInput.addEventListener('input', onInput);
  searchInput.addEventListener('focus', onInput);
  searchInput.addEventListener('keydown', (e) => {
    const btns = [...suggestBox.querySelectorAll('button')];
    const i = btns.findIndex((b) => b.classList.contains('sel'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!btns.length) return;
      e.preventDefault();
      btns.forEach((b) => b.classList.remove('sel'));
      const n = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
      btns[n].classList.add('sel');
      searchInput.value = btns[n].dataset.q;
    } else if (e.key === 'Escape') hideSuggest();
  });
  document.addEventListener('mousedown', (e) => { if (!search.contains(e.target)) hideSuggest(); });
  document.addEventListener('keydown', (e) => {
    if ((e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey))) && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); searchInput.focus(); searchInput.select(); }
  });
}

function hideSuggest() { suggestBox.classList.add('hide'); }
function renderSuggest(q, items) {
  if (!items.length || document.activeElement !== searchInput) return hideSuggest();
  suggestBox.replaceChildren(...items.map(({ t, local }) => h('button', { type: 'button', 'data-q': t, onmousedown: (e) => { e.preventDefault(); searchInput.value = t; submitSearch(t); } },
    icon(local ? 'history' : 'search'), h('span', t),
    local ? h('span', { class: 'icon-btn x', role: 'button', 'aria-label': 'Remove', onmousedown: async (e) => { e.preventDefault(); e.stopPropagation(); await store.removeSearch(t); renderSuggest(q, items.filter((i) => i.t !== t)); } }, icon('close')) : null)));
  suggestBox.classList.remove('hide');
}

async function submitSearch(q) {
  q = (q || '').trim();
  hideSuggest();
  searchInput.blur();
  if (!q) return;
  const ref = parseUrl(q);
  if (ref) { if (SERVICES[ref.service]) settings = await store.setSettings({ service: ref.service }); paint(); location.hash = routeFor(ref); return; }
  await store.addSearch(q);
  location.hash = hashFor('search', { q, s: settings.service });
}

async function cycleTheme() {
  const order = ['dark', 'black', 'light'];
  const cur = settings.theme === 'system' ? 'dark' : settings.theme;
  settings = await store.setSettings({ theme: order[(order.indexOf(cur) + 1) % order.length] });
  paint();
  toast({ dark: 'Dark theme', black: 'True black theme', light: 'Light theme' }[settings.theme]);
}

async function route() {
  const token = ++navToken;
  const { path, params } = parseHash();
  const [name, sub] = path.split('/');
  const key = name || 'home';
  const loader = views[key] || views.home;
  override = null;
  if (params.s && SERVICES[params.s] && ['watch', 'channel', 'playlist', 'search'].includes(key)) {
    // Opening an item (or a link) from another service switches the active service to match it.
    if (params.s !== settings.service) settings = await store.setSettings({ service: params.s });
    if (token !== navToken) return;
  }
  if (key === 'search' && params.q && searchInput) searchInput.value = params.q;
  paint();
  current?.dispose?.();
  current = null;
  page.replaceChildren(h('div', { class: 'spin' }));
  try {
    const mod = await loader();
    if (token !== navToken) return;
    const view = await mod.render({ params, sub, settings, page, setService, token: () => token === navToken, setOverride: themeService });
    if (token !== navToken) return view?.dispose?.();
    current = view;
    page.replaceChildren(view?.el || view);
    if (key !== 'home' || !params.keep) scrollTo({ top: params.scroll ? +params.scroll : 0 });
    document.title = (view?.title ? view.title + ' · ' : '') + 'UPipe';
  } catch (e) {
    if (token !== navToken) return;
    console.error(e);
    page.replaceChildren(errorBox(e, route));
  }
}

store.onSettings((s) => { settings = s; paint(); });
addEventListener('hashchange', route);

(async function boot() {
  settings = await store.getSettings();
  applyTheme(settings, settings.service);
  watchSystemTheme(() => { if (settings.theme === 'system') paint(); });
  buildShell();
  paint();
  // links rendered from descriptions open inside the app
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[data-internal]');
    if (a) { e.preventDefault(); location.hash = a.getAttribute('href'); }
  });
  route();
})();
