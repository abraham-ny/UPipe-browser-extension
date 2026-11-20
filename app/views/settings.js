import { h, hostOf } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { REGIONS, SERVICES, SERVICE_ORDER, DEFAULT_SETTINGS } from '../../lib/config.js';
import * as store from '../../lib/store.js';
import { applyTheme } from '../../lib/theme.js';
import { toast, confirmBox } from '../../lib/ui.js';
import { downloadText } from '../../lib/download.js';
import { geocode } from '../../lib/dashboard.js';
import { ext } from '../../lib/browser.js';

export async function render({ sub, settings: initial }) {
  let s = initial;
  const root = h('div');
  const save = async (patch) => { s = await store.setSettings(patch); applyTheme(s, s.service); };

  // ---- field builders
  const row = (label, desc, control) => h('div', { class: 'setting' }, h('div', { class: 'lbl' }, h('b', label), desc ? h('span', desc) : null), control);
  const toggle = (key, label, desc) => {
    const inp = h('input', { type: 'checkbox', checked: !!get(key), onchange: () => save(nest(key, inp.checked)) });
    return row(label, desc, h('label', { class: 'switch' }, inp, h('i')));
  };
  const select = (key, label, desc, opts) => {
    const sel = h('select', { class: 'field', onchange: () => save(nest(key, isNaN(+sel.value) || sel.value === '' ? sel.value : +sel.value)) },
      opts.map(([v, t]) => h('option', { value: v, selected: String(get(key)) === String(v) }, t)));
    return row(label, desc, sel);
  };
  const text = (key, label, desc, ph) => {
    const inp = h('input', { class: 'field', type: 'text', value: get(key) || '', placeholder: ph || '', style: { minWidth: '260px' }, spellcheck: 'false' });
    inp.addEventListener('change', () => save(nest(key, inp.value.trim())));
    return row(label, desc, inp);
  };
  const range = (key, label, desc, min, max, step, fmt = (v) => v) => {
    const out = h('span', { class: 'muted', style: { minWidth: '40px', textAlign: 'right' } }, fmt(get(key)));
    const inp = h('input', { type: 'range', min, max, step, value: get(key), oninput: () => { out.textContent = fmt(+inp.value); }, onchange: () => save(nest(key, +inp.value)) });
    return row(label, desc, h('div', { class: 'row' }, inp, out));
  };
  const get = (k) => k.split('.').reduce((o, p) => o?.[p], s);
  const nest = (k, v) => k.split('.').reduceRight((acc, p) => ({ [p]: acc }), v);
  const group = (id, title, ...rows) => h('section', { class: 'set-group', id: 'g-' + id }, h('h2', title), h('div', { class: 'set-card' }, rows));

  // ---- appearance
  const themeCards = h('div', { class: 'themes' }, [['dark', 'Dark', '#1d2027', '#eceef3'], ['light', 'Light', '#ffffff', '#15171c'], ['black', 'True black', '#000000', '#f2f2f4'], ['system', 'System', 'linear-gradient(90deg,#fff 50%,#1d2027 50%)', '#888']].map(([id, label, bg]) =>
    h('button', { class: 'theme-opt' + (s.theme === id ? ' on' : ''), type: 'button', onclick: async (e) => { await save({ theme: id }); themeCards.querySelectorAll('.theme-opt').forEach((n) => n.classList.remove('on')); e.currentTarget.classList.add('on'); } },
      h('div', { class: 'sw', style: { background: bg } }, h('i'), h('i')), label)));
  const swatches = h('div', { class: 'row wrap' }, SERVICE_ORDER.map((id) => h('span', { class: 'chip', style: { cursor: 'default' } }, h('i', { style: { width: '10px', height: '10px', borderRadius: '50%', background: SERVICES[id].color, display: 'inline-block' } }), SERVICES[id].name)));
  const colorInp = h('input', { type: 'color', value: s.accentColor, onchange: (e) => save({ accentColor: e.target.value }), style: { width: '44px', height: '34px', border: 0, background: 'none' } });

  const appearance = group('appearance', 'Appearance',
    h('div', { class: 'setting' }, h('div', { class: 'lbl' }, h('b', 'Theme'), h('span', 'Dark, light, or true black (pure #000 for OLED screens).')), themeCards),
    select('accentMode', 'Accent colour', 'Phantom mode re-tints the whole app to the service you are using.', [['phantom', 'Phantom (follows service)'], ['custom', 'Custom colour']]),
    row('Custom colour', 'Used when the accent mode is Custom.', colorInp),
    row('Service colours', 'Phantom accents', swatches),
    select('glow', 'Accent glow', 'Strength of the coloured haze behind the interface.', [['off', 'Off'], ['soft', 'Soft'], ['normal', 'Normal'], ['bold', 'Bold']]),
    select('cardSize', 'Card size', null, [['small', 'Compact'], ['medium', 'Comfortable'], ['large', 'Large']]));

  // ---- services
  const services = group('services', 'Services',
    select('service', 'Default service', 'Shown on the home page and searched by default.', SERVICE_ORDER.map((id) => [id, SERVICES[id].name])),
    select('region', 'Region', 'Used for YouTube trending and the top-songs chart.', Object.entries(REGIONS)),
    select('ytBackend', 'YouTube backend', 'UPipe reads YouTube through open Piped and Invidious servers, so no Google account or script is involved.', [['auto', 'Automatic (Piped, then Invidious)'], ['piped', 'Piped only'], ['invidious', 'Invidious only']]),
    text('pipedInstance', 'Preferred Piped API', 'Optional. Your own or a favourite instance; the API URL, e.g. https://pipedapi.example.com', 'https://pipedapi.…'),
    text('invidiousInstance', 'Preferred Invidious server', 'Optional. Needs the API enabled.', 'https://…'),
    toggle('instanceOnly', 'Use only my instance', 'Never fall back to other public servers (fails if yours is down).'),
    text('peertubeInstance', 'PeerTube home instance', 'Trending on the PeerTube tab comes from this instance. Search covers the whole fediverse.', 'https://framatube.org'),
    toggle('hideShorts', 'Hide Shorts in search', null),
    toggle('comments', 'Show comments', 'Where the service provides them.'),
    toggle('dislikes', 'Fetch like/dislike counts', 'Queries the community Return-YouTube-Dislike API for YouTube videos.'));

  // ---- playback
  const playback = group('playback', 'Audio player',
    select('playerMode', 'Open player in', 'The player lives on its own page so music keeps playing while you browse.', [['window', 'A small popup window'], ['tab', 'A normal tab']]),
    toggle('queueFromFeed', 'Queue the whole list', 'Clicking an item in a feed/search plays it and queues the items after it.'),
    toggle('autoplayNext', 'Autoplay related when the queue ends', 'Appends related tracks so playback keeps going.'),
    select('audioQuality', 'Audio quality', null, [['high', 'Highest'], ['medium', 'Balanced'], ['low', 'Data saver']]),
    select('audioFormat', 'Preferred format', 'Falls back automatically if unavailable.', [['any', 'Best available'], ['m4a', 'AAC / M4A'], ['opus', 'Opus'], ['mp3', 'MP3']]),
    range('defaultSpeed', 'Default speed', null, 0.5, 2, 0.05, (v) => v.toFixed(2) + '×'),
    range('volume', 'Default volume', null, 0, 1, 0.01, (v) => Math.round(v * 100) + '%'));

  // ---- downloads
  const downloads = group('downloads', 'Downloads',
    text('downloadFolder', 'Folder', 'A sub-folder inside your browser’s download directory. Leave empty for none.', 'UPipe'),
    text('filenameTemplate', 'File name template', 'Tokens: {title} {uploader} {album} {service} {id}', '{uploader} - {title}'),
    toggle('askWhere', 'Ask where to save each file', null));

  // ---- dashboard
  const cityRow = (() => {
    const label = h('span', { class: 'muted' }, s.weatherCity?.name || 'Automatic (approximate, from your IP)');
    const btn = h('button', { class: 'btn sm', onclick: async () => {
      const { promptBox } = await import('../../lib/ui.js');
      const q = await promptBox('Weather city', 'City name');
      if (!q) return;
      try { const r = await geocode(q); if (!r[0]) return toast('Not found', 'err'); await save({ weatherCity: r[0] }); label.textContent = r[0].name; } catch { toast('Lookup failed', 'err'); }
    } }, 'Change');
    const auto = h('button', { class: 'btn sm ghost', onclick: async () => { await save({ weatherCity: null }); label.textContent = 'Automatic (approximate, from your IP)'; } }, 'Auto');
    return row('Weather location', null, h('div', { class: 'row' }, label, btn, auto));
  })();
  const dashboard = group('dashboard', 'Home dashboard',
    toggle('dash.stats', 'Your activity', 'Local play counts and a 14-day chart.'),
    toggle('dash.recent', 'Continue listening', null),
    toggle('dash.weather', 'Weather', 'Open-Meteo, no key. Uses an approximate location unless you pick a city.'),
    cityRow,
    select('units', 'Units', null, [['metric', 'Metric (°C, km/h)'], ['imperial', 'Imperial (°F, mph)']]),
    toggle('dash.songs', 'Top songs chart', 'Apple Music public charts for your region.'),
    toggle('dash.markets', 'Markets', 'CoinGecko public prices.'),
    text('coins', 'Coins', 'Comma-separated CoinGecko ids', 'bitcoin,ethereum,solana'),
    toggle('dash.news', 'Tech news', 'Top Hacker News stories.'),
    toggle('dash.status', 'Service status', 'Pings each service so you can see what is reachable.'));

  // ---- privacy & data
  const file = h('input', { type: 'file', accept: 'application/json,.json', class: 'hide', onchange: async () => {
    try { await store.importAll(JSON.parse(await file.files[0].text())); toast('Backup restored'); setTimeout(() => location.reload(), 500); } catch (e) { toast(e.message, 'err'); }
  } });
  const privacy = group('privacy', 'Privacy & data',
    toggle('saveHistory', 'Keep watch & play history', 'Stored only in this browser.'),
    toggle('saveSearches', 'Remember searches', null),
    toggle('searchSuggestions', 'Search suggestions', 'Sends what you type to the active service’s suggestion endpoint.'),
    row('Backup', 'Export or restore favorites, playlists, subscriptions, history and settings.', h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: async () => downloadText(`upipe-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await store.exportAll(), null, 2)) }, icon('download'), 'Export'),
      h('button', { class: 'btn', onclick: () => file.click() }, 'Import'), file)),
    row('Reset settings', 'Restore every option to its default. Your library is kept.', h('button', { class: 'btn', onclick: async () => { if (await confirmBox('Reset settings?', 'All options return to their defaults.', 'Reset')) { await store.resetSettings(); location.reload(); } } }, 'Reset')),
    row('Erase everything', 'Deletes settings, library, history and caches stored by UPipe.', h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Erase all data?', 'This cannot be undone. Consider exporting a backup first.', 'Erase')) { await store.wipeAll(); location.reload(); } } }, icon('trash'), 'Erase')));

  const keys = group('shortcuts', 'Shortcuts',
    row('Focus search', null, h('span', h('span', { class: 'kbd' }, '/'), ' or ', h('span', { class: 'kbd' }, 'Ctrl K'))),
    row('Open UPipe from anywhere', 'Change in your browser’s extension shortcuts page.', h('span', { class: 'kbd' }, 'Alt+Shift+U')),
    row('Open audio player', null, h('span', { class: 'kbd' }, 'Alt+Shift+P')),
    row('Player: play/pause · seek · volume · next', null, h('span', h('span', { class: 'kbd' }, 'Space'), ' ', h('span', { class: 'kbd' }, '← →'), ' ', h('span', { class: 'kbd' }, '↑ ↓'), ' ', h('span', { class: 'kbd' }, 'N / P'))),
    row('Address-bar search', 'Type the keyword, press Tab or Space, then a query or link.', h('span', { class: 'kbd' }, 'up')));

  const sections = [['appearance', 'Appearance'], ['services', 'Services'], ['playback', 'Audio player'], ['downloads', 'Downloads'], ['dashboard', 'Dashboard'], ['privacy', 'Privacy & data'], ['shortcuts', 'Shortcuts']];
  const nav = h('nav', { class: 'set-nav' }, sections.map(([id, t]) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); document.getElementById('g-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, t)));
  root.append(h('h1', { style: { marginBottom: '18px' } }, 'Settings'), h('div', { class: 'set-wrap' }, nav, h('div', appearance, services, playback, downloads, dashboard, privacy, keys)));
  if (sub && document) setTimeout(() => document.getElementById('g-' + sub)?.scrollIntoView(), 50);
  return { el: root, title: 'Settings' };
}
