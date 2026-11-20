import { h, fmtDur, timeAgo, hashFor } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import * as store from '../../lib/store.js';
import { card, listRow, emptyBox, playItems, toast, confirmBox, promptBox, itemMenu } from '../../lib/ui.js';
import { showDownload } from '../../lib/download.js';
import { SERVICES } from '../../lib/config.js';
import { itemRoute } from '../../lib/urls.js';

const TABS = [['favorites', 'Favorites', 'heart'], ['history', 'History', 'history'], ['playlists', 'Playlists', 'list'], ['subscriptions', 'Subscriptions', 'user'], ['downloads', 'Downloads', 'download']];

export async function render({ sub, params, settings: s }) {
  const tab = TABS.some((t) => t[0] === sub) ? sub : sub === 'pl' ? 'playlists' : 'favorites';
  const root = h('div');
  const body = h('div');
  const rerender = () => draw();
  root.append(h('div', { class: 'section', style: { marginTop: 0 } }, h('h2', 'Library'), h('span', { class: 'muted' }, 'Stored only in this browser. No account.')),
    h('div', { class: 'tabs' }, TABS.map(([id, label, ic]) => h('a', { class: 'chip' + (id === tab ? ' active' : ''), href: `#/library/${id}` }, icon(ic), label))), body);

  async function draw() {
    body.replaceChildren();
    if (sub === 'pl') return drawPlaylist();
    if (tab === 'favorites') {
      const l = await store.getFavorites();
      if (!l.length) return body.append(emptyBox('No favorites yet', 'Tap the heart on any track or video.', 'heart'));
      body.append(h('div', { class: 'row', style: { marginBottom: '12px' } }, h('button', { class: 'btn primary', onclick: () => playItems(l, 0) }, icon('play'), 'Play all'), h('button', { class: 'btn', onclick: () => playItems([...l].sort(() => Math.random() - 0.5), 0) }, icon('shuffle'), 'Shuffle')),
        h('div', { class: 'grid small' }, l.map((it, i) => card(it, { items: l, index: i, onChange: rerender }))));
    } else if (tab === 'history') {
      const l = await store.getHistory();
      if (!l.length) return body.append(emptyBox('Nothing here yet', s.saveHistory ? 'Things you open will appear here.' : 'History is turned off in Settings → Privacy.', 'history'));
      body.append(h('div', { class: 'row', style: { marginBottom: '12px' } }, h('span', { class: 'muted' }, `${l.length} items`), h('span', { class: 'spacer' }),
        h('button', { class: 'btn danger sm', onclick: async () => { if (await confirmBox('Clear history?', 'This removes every watched and played item from this device.', 'Clear')) { await store.clearHistory(); rerender(); } } }, icon('trash'), 'Clear history')),
        h('div', { class: 'list' }, l.map((it, i) => h('div', { style: { position: 'relative' } }, listRow(it, { items: l.filter((x) => x.type === 'stream'), index: l.filter((x) => x.type === 'stream').indexOf(it), number: timeAgo(it.at).replace(' ago', ''), onChange: rerender })))));
    } else if (tab === 'playlists') {
      const pls = await store.getPlaylists();
      body.append(h('div', { class: 'row', style: { marginBottom: '12px' } }, h('button', { class: 'btn primary', onclick: async () => { const n = await promptBox('New playlist', 'Playlist name'); if (n) { await store.createPlaylist(n); rerender(); } } }, icon('add'), 'New playlist')));
      if (!pls.length) return body.append(emptyBox('No playlists yet', 'Create one, or save any YouTube / album playlist as a copy.', 'list'));
      body.append(h('div', { class: 'grid small' }, pls.map((p) => h('a', { class: 'card', href: hashFor('library/pl', { id: p.id }) },
        h('div', { class: 'thumb sq' }, p.items[0]?.thumbnail ? h('img', { src: p.items[0].thumbnail, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null, h('span', { class: 'badge' }, `${p.items.length} items`)),
        h('div', { class: 'title' }, p.name)))));
    } else if (tab === 'subscriptions') {
      const l = await store.getSubs();
      if (!l.length) return body.append(emptyBox('No subscriptions', 'Subscriptions are saved on this device only. Open a channel and press Subscribe.', 'user'));
      body.append(h('div', { class: 'grid small' }, l.map((c) => card({ ...c, type: 'channel' }, { onChange: rerender }))));
    } else if (tab === 'downloads') {
      const l = await store.getDownloads();
      if (!l.length) return body.append(emptyBox('No downloads yet', 'Files you save with UPipe are listed here.', 'download'));
      body.append(h('div', { class: 'row', style: { marginBottom: '12px' } }, h('span', { class: 'spacer' }), h('button', { class: 'btn sm danger', onclick: async () => { await store.clearDownloads(); rerender(); } }, icon('trash'), 'Clear list (files stay)')),
        h('div', { class: 'list' }, l.map((d) => h('div', { class: 'list-row', onclick: () => showDownload(d.id) },
          h('div', { class: 'idx' }, icon(d.kind === 'audio' ? 'music' : 'play')), h('img', { class: 't', src: d.thumbnail || '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => { e.target.style.visibility = 'hidden'; } }),
          h('div', { style: { minWidth: 0 } }, h('div', { class: 'title', style: { WebkitLineClamp: 1 } }, d.name), h('div', { class: 'sub' }, [SERVICES[d.service]?.name, d.quality, timeAgo(d.at)].filter(Boolean).join(' · '))),
          h('div', { class: 'dur' }, 'Show'), h('button', { class: 'icon-btn', 'aria-label': 'Remove from list', onclick: async (e) => { e.stopPropagation(); await store.removeDownload(d.id); rerender(); } }, icon('close'))))));
    }
  }

  async function drawPlaylist() {
    const pls = await store.getPlaylists();
    const p = pls.find((x) => x.id === params.id);
    if (!p) return body.append(emptyBox('Playlist not found'));
    const items = p.items;
    body.append(h('div', { class: 'row wrap', style: { marginBottom: '14px' } }, h('h1', p.name), h('span', { class: 'muted' }, `${items.length} items · ${fmtDur(items.reduce((a, b) => a + (b.duration || 0), 0))}`), h('span', { class: 'spacer' }),
      h('button', { class: 'btn primary', onclick: () => playItems(items, 0) }, icon('play'), 'Play'),
      h('button', { class: 'btn', onclick: () => playItems(items, 0, 'enqueue') }, icon('queueAdd'), 'Queue'),
      h('button', { class: 'btn', onclick: async () => { const n = await promptBox('Rename playlist', 'Name', p.name); if (n) { await store.updatePlaylist(p.id, (x) => { x.name = n; }); rerender(); } } }, 'Rename'),
      h('button', { class: 'btn danger', onclick: async () => { if (await confirmBox('Delete playlist?', `“${p.name}” will be removed.`, 'Delete')) { await store.deletePlaylist(p.id); location.hash = '#/library/playlists'; } } }, icon('trash'), 'Delete')));
    if (!items.length) return body.append(emptyBox('Empty playlist', 'Use “Add to playlist” on any track.', 'list'));
    body.append(h('div', { class: 'list' }, items.map((it, i) => h('div', { class: 'list-row', onclick: () => playItems(items, i) },
      h('div', { class: 'idx' }, i + 1), h('img', { class: 't', src: it.thumbnail || '', loading: 'lazy', referrerpolicy: 'no-referrer' }),
      h('div', { style: { minWidth: 0 } }, h('a', { class: 'title', style: { WebkitLineClamp: 1, color: 'var(--text)' }, href: itemRoute(it), onclick: (e) => e.stopPropagation() }, it.title), h('div', { class: 'sub' }, it.uploader || '')),
      h('div', { class: 'dur' }, it.duration ? fmtDur(it.duration) : ''),
      h('div', { class: 'row' },
        h('button', { class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0, onclick: async (e) => { e.stopPropagation(); await store.updatePlaylist(p.id, (x) => { [x.items[i - 1], x.items[i]] = [x.items[i], x.items[i - 1]]; }); rerender(); } }, h('span', '↑')),
        h('button', { class: 'icon-btn', 'aria-label': 'Remove', onclick: async (e) => { e.stopPropagation(); await store.updatePlaylist(p.id, (x) => { x.items.splice(i, 1); }); rerender(); } }, icon('close')))))));
  }

  draw();
  return { el: root, title: 'Library' };
}
