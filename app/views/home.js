import { h, fmtNum, fmtHours, fmtInt, enc, cached } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { SERVICES, SERVICE_ORDER, WEBSITE, GITHUB, DONATE_URL, REGIONS, VERSION } from '../../lib/config.js';
import * as store from '../../lib/store.js';
import * as svc from '../../lib/services/index.js';
import * as dash from '../../lib/dashboard.js';
import { card, pagedGrid, playItems, toast, promptBox, modal, listRow } from '../../lib/ui.js';
import { parseUrl, routeFor } from '../../lib/urls.js';
import { ext, isFirefox } from '../../lib/browser.js';

function greeting() {
  const hr = new Date().getHours();
  return hr < 5 ? 'Late-night listening' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

/** A dashboard widget that loads on its own and degrades quietly. */
function widget(title, ic, cls, load, draw, extra) {
  const body = h('div', h('div', { class: 'skel', style: { height: '90px' } }));
  const w = h('section', { class: 'panel ' + (cls || '') }, h('h3', icon(ic), h('span', title), h('span', { class: 'spacer' }), extra || null), body);
  const run = async () => {
    body.replaceChildren(h('div', { class: 'skel', style: { height: '90px' } }));
    try { body.replaceChildren(await draw(await load())); } catch (e) {
      body.replaceChildren(h('div', { class: 'muted', style: { padding: '14px 0' } }, 'Unavailable right now. ', h('a', { href: '#', onclick: (ev) => { ev.preventDefault(); run(); } }, 'Retry')));
    }
  };
  run();
  w.reload = run;
  return w;
}

async function activityWidget() {
  const [st, fav, dl, pls, subs] = await Promise.all([store.getStats(), store.getFavorites(), store.getDownloads(), store.getPlaylists(), store.getSubs()]);
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10); days.push(st.daily[d]?.seconds || 0); }
  const max = Math.max(1, ...days);
  const s = (b, l) => h('div', { class: 'stat' }, h('b', b), h('span', l));
  return h('section', { class: 'panel' }, h('h3', icon('chart'), 'Your activity'),
    h('div', { class: 'stat-grid' }, s(fmtInt(st.plays), 'tracks played'), s(fmtHours(st.seconds) || '0m', 'listening time'), s(fmtInt(fav.length), 'favorites'), s(fmtInt(subs.length + pls.length), 'subs & playlists')),
    h('div', { class: 'bars', title: 'Listening time, last 14 days' }, days.map((v) => h('i', { style: { height: Math.max(5, (v / max) * 100) + '%' }, title: fmtHours(v) }))),
    h('div', { class: 'sub', style: { marginTop: '8px' } }, `${dl.length} download${dl.length === 1 ? '' : 's'} · stored only on this device`));
}

function weatherWidget(s) {
  const change = h('button', { class: 'icon-btn', title: 'Change city', 'aria-label': 'Change weather city', onclick: async () => {
    const q = await promptBox('Weather location', 'City name');
    if (!q) return;
    try {
      const res = await dash.geocode(q);
      if (!res.length) return toast('No such place found', 'err');
      const m = modal('Choose a place', h('div', ...res.map((r) => h('button', { class: 'opt', onclick: async () => { await store.setSettings({ weatherCity: r }); m.close(); toast('Location saved'); location.reload(); } }, icon('globe'), h('div', { class: 'grow' }, h('b', r.name))))), { width: '420px' });
    } catch { toast('Lookup failed', 'err'); }
  } }, icon('globe'));
  return widget('Weather', 'cloud', '', () => dash.weather(s), (w) => {
    const [desc, em] = dash.wmo(w.now.weather_code);
    return h('div',
      h('div', { class: 'wx' }, h('div', { class: 'big' }, em), h('div', h('div', { class: 't' }, `${Math.round(w.now.temperature_2m)}${w.unit}`), h('div', { class: 'sub' }, `${desc} · feels ${Math.round(w.now.apparent_temperature)}°`))),
      h('div', { class: 'sub', style: { marginTop: '6px' } }, `${w.loc.name} · wind ${Math.round(w.now.wind_speed_10m)} ${w.wind} · ${w.now.relative_humidity_2m}% humidity`),
      h('div', { class: 'wx-days' }, w.days.map((d, i) => h('div', h('div', { class: 'muted' }, i === 0 ? 'Today' : new Date(d.date + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })), h('div', { style: { fontSize: '18px' } }, dash.wmo(d.code)[1]), h('b', `${Math.round(d.max)}°`), h('span', { class: 'muted' }, ` ${Math.round(d.min)}°`)))));
  }, change);
}

function songsWidget(s) {
  return widget(`Top songs · ${REGIONS[s.region] || s.region}`, 'music', '', () => dash.topSongs(s), (list) =>
    h('ul', { class: 'mini-list' }, list.slice(0, 7).map((x, i) => h('li', { class: 'click', title: 'Search this song', onclick: () => { location.hash = `#/search?q=${enc(x.artist + ' ' + x.title)}&s=${s.service}`; } },
      h('span', { class: 'n' }, i + 1), h('img', { src: x.art, alt: '', loading: 'lazy' }), h('div', { class: 'grow' }, h('b', x.title), h('span', x.artist))))));
}

function marketsWidget(s) {
  return widget('Markets', 'coin', '', () => dash.markets(s), (list) =>
    h('ul', { class: 'mini-list' }, list.map((c) => h('li', h('div', { class: 'grow' }, h('b', c.id[0].toUpperCase() + c.id.slice(1)), h('span', 'USD')),
      h('div', { style: { textAlign: 'right' } }, h('b', '$' + (c.usd >= 100 ? Math.round(c.usd).toLocaleString() : c.usd.toPrecision(4))), h('div', { class: c.change >= 0 ? 'up' : 'down', style: { fontSize: '12px' } }, `${c.change >= 0 ? '▲' : '▼'} ${Math.abs(c.change).toFixed(1)}%`))))));
}

function newsWidget() {
  return widget('Tech news', 'news', '', () => dash.news(), (list) =>
    h('ul', { class: 'mini-list' }, list.map((n) => h('li', h('div', { class: 'grow' }, h('a', { href: n.url, target: '_blank', rel: 'noopener noreferrer', style: { whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', color: 'var(--text)' } }, n.title), h('span', `${n.score} points · ${n.comments ?? 0} comments`))))));
}

const PINGS = { youtube: 'https://pipedapi.kavin.rocks', soundcloud: 'https://api-v2.soundcloud.com', bandcamp: 'https://bandcamp.com', peertube: 'https://sepiasearch.org', ccc: 'https://api.media.ccc.de' };
async function ping(url) {
  const t = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 6000);
  try { await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: ctl.signal }); return Math.round(performance.now() - t); } catch { return null; } finally { clearTimeout(timer); }
}
function statusWidget() {
  const list = h('ul', { class: 'mini-list' });
  const rows = SERVICE_ORDER.map((id) => {
    const dot = h('span', { class: 'dot-wait' }), ms = h('span', { class: 'muted' }, '…');
    list.append(h('li', dot, h('div', { class: 'grow' }, h('b', SERVICES[id].name)), ms));
    ping(PINGS[id]).then((t) => { dot.className = t == null ? 'dot-bad' : 'dot-ok'; ms.textContent = t == null ? 'unreachable' : t + ' ms'; });
  });
  return h('section', { class: 'panel' }, h('h3', icon('pulse'), 'Service status'), list, h('div', { class: 'sub', style: { marginTop: '8px' } }, 'Live reachability from your connection'));
}

function supportWidget() {
  return h('section', { class: 'panel cta' },
    h('div', h('h3', icon('coffee'), 'Support UPipe'), h('p', { style: { margin: '0 0 4px', fontWeight: 650, fontSize: '16px' } }, 'Free, open and account-free.'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'UPipe is built by Vitalsoft. If it saves you a few ads, a coffee keeps the updates coming.')),
    h('div', { class: 'btns' },
      h('a', { class: 'btn primary', href: DONATE_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('coffee'), 'Donate'),
      h('a', { class: 'btn', href: WEBSITE, target: '_blank', rel: 'noopener noreferrer' }, icon('globe'), 'My website'),
      h('a', { class: 'btn', href: GITHUB, target: '_blank', rel: 'noopener noreferrer' }, icon('code'), 'GitHub')));
}

export async function render({ settings: s, setService }) {
  const root = h('div');
  const sv = SERVICES[s.service];

  const paste = h('input', { type: 'text', placeholder: 'Paste a YouTube, SoundCloud, Bandcamp, PeerTube or media.ccc.de link…', 'aria-label': 'Paste a link' });
  const open = (val) => {
    const ref = parseUrl(val);
    if (!ref) return toast('That does not look like a supported link', 'err');
    store.setSettings({ service: ref.service }).then(() => { location.hash = routeFor(ref); });
  };
  paste.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(paste.value); });
  paste.addEventListener('paste', () => setTimeout(() => { if (parseUrl(paste.value)) open(paste.value); }, 0));

  const hero = h('div', { class: 'hero' },
    h('div', h('h1', greeting()), h('p', 'Watch, listen and download without an account, ads or tracking. Pick a service, search, or paste a link.')),
    h('div', { class: 'actions' },
      h('a', { class: 'btn primary', href: DONATE_URL, target: '_blank', rel: 'noopener noreferrer' }, icon('coffee'), 'Donate'),
      h('a', { class: 'btn', href: WEBSITE, target: '_blank', rel: 'noopener noreferrer' }, icon('globe'), 'Website')));

  const tiles = h('div', { class: 'svc-tiles' }, SERVICE_ORDER.map((id) => {
    const x = SERVICES[id];
    return h('button', { class: 'svc-tile' + (id === s.service ? ' active' : ''), style: { '--c': x.color }, onclick: () => setService(id) },
      h('div', { class: 'dot' }, x.name[0]), h('b', x.name), h('span', x.blurb));
  }));

  const d = s.dash || {};
  root.append(hero);
  if (isFirefox) {
    // Firefox treats MV3 host permissions as grantable by the user; ask once if they are missing.
    const origins = ext.runtime.getManifest().host_permissions || [];
    ext.permissions.contains({ origins }).then((ok) => {
      if (ok) return;
      const bar = h('div', { class: 'errbox', style: { marginBottom: '14px', borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 8%, var(--card))' } }, icon('shield'),
        h('div', { style: { flex: 1 } }, h('b', 'One more step for Firefox'), h('div', { class: 'muted' }, 'Allow UPipe to contact SoundCloud, Bandcamp and the other services directly from your browser. Nothing else is accessed.'),
          h('div', { class: 'row' }, h('button', { class: 'btn primary sm', onclick: async () => { const granted = await ext.permissions.request({ origins }); if (granted) { bar.remove(); toast('Access granted'); } } }, 'Grant access'))));
      hero.after(bar);
    }).catch(() => {});
  }
  root.append(h('div', { class: 'paste' }, paste), tiles);

  const grid = h('div', { class: 'dash', style: { marginTop: '18px' } });
  if (d.stats) activityWidget().then((w) => grid.prepend(w));
  if (d.weather) grid.append(weatherWidget(s));
  if (d.songs) grid.append(songsWidget(s));
  if (d.markets) grid.append(marketsWidget(s));
  if (d.news) grid.append(newsWidget());
  if (d.status) grid.append(statusWidget());
  grid.append(supportWidget());
  root.append(grid);

  if (d.recent) {
    const hist = (await store.getHistory()).slice(0, 12);
    if (hist.length) {
      root.append(h('div', { class: 'section' }, h('h2', 'Continue listening'), h('a', { class: 'btn sm ghost', href: '#/library/history' }, 'History')),
        h('div', { class: 'grid small' }, hist.map((it, i) => card(it, { items: hist, index: i }))));
    }
  }

  const regionSel = s.service === 'youtube' ? h('select', { class: 'field', style: { minWidth: 0 }, 'aria-label': 'Region', onchange: async (e) => { await store.setSettings({ region: e.target.value }); location.reload(); } },
    Object.entries(REGIONS).map(([k, v]) => h('option', { value: k, selected: k === s.region }, v))) : null;
  root.append(h('div', { class: 'section' }, h('div', h('div', { class: 'tag' }, sv.name), h('h2', { id: 'feed-h' }, 'Trending now')), regionSel,
    h('button', { class: 'icon-btn', title: 'Refresh', 'aria-label': 'Refresh', onclick: () => feed.start() }, icon('refresh'))));
  const feed = pagedGrid({
    size: s.cardSize,
    first: async () => ({ ...(await svc.trending(s.service)), next: null }),
    more: async () => ({ items: [], next: null }),
  });
  root.append(feed);
  feed.start();

  return { el: root, title: 'Home', dispose: () => feed.dispose() };
}
