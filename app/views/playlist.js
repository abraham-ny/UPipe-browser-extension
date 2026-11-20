import { h, fmtDur, copyText } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { SERVICES } from '../../lib/config.js';
import * as store from '../../lib/store.js';
import * as svc from '../../lib/services/index.js';
import { listRow, errorBox, playItems, toast, shareUrl, playlistPicker, emptyBox } from '../../lib/ui.js';
import { routeFor } from '../../lib/urls.js';

export async function render({ params, settings: s, setOverride }) {
  const service = SERVICES[params.s] ? params.s : s.service;
  setOverride?.(service);
  const root = h('div', h('div', { class: 'skel', style: { height: '200px', borderRadius: '20px' } }));
  const view = { el: root, title: '' };
  try {
    const first = await svc.playlist(service, params.id, null);
    const info = first.info || { title: 'Playlist', service, id: params.id };
    info.service = service; info.type = 'playlist';
    view.title = info.title;
    const items = [...first.items];
    let next = first.next;
    const list = h('div', { class: 'list' });
    const foot = h('div', { class: 'more-row' });
    const draw = (from) => items.slice(from).forEach((it, i) => list.append(listRow(it, { items, index: from + i })));
    const total = () => items.reduce((a, b) => a + (b.duration || 0), 0);
    const meta = h('div', { class: 'sub' });
    const paintMeta = () => { meta.textContent = [info.uploader, `${info.count || items.length} items`, total() ? fmtDur(total()) + (next ? '+' : '') : ''].filter(Boolean).join(' · '); };
    paintMeta();
    draw(0);
    const more = async () => {
      foot.replaceChildren(h('div', { class: 'spin' }));
      try {
        const r = await svc.playlist(service, params.id, next);
        const from = items.length; items.push(...r.items); next = r.next; draw(from); paintMeta();
        foot.replaceChildren(next ? h('button', { class: 'btn', onclick: more }, 'Load more') : '');
      } catch (e) { foot.replaceChildren(errorBox(e, more)); }
    };
    if (next) foot.replaceChildren(h('button', { class: 'btn', onclick: more }, 'Load more'));

    const saveBtn = h('button', { class: 'btn', onclick: async () => { const { promptBox } = await import('../../lib/ui.js'); const name = await promptBox('Save as local playlist', 'Name', info.title); if (!name) return; await store.createPlaylist(name, items); toast('Saved to your library'); } }, icon('add'), 'Save copy');
    root.replaceChildren(
      h('div', { class: 'row', style: { gap: '22px', alignItems: 'flex-end', flexWrap: 'wrap' } },
        h('img', { src: info.thumbnail || items[0]?.thumbnail || '', alt: '', referrerpolicy: 'no-referrer', style: { width: '210px', height: '210px', objectFit: 'cover', borderRadius: '18px', background: 'var(--card2)', boxShadow: '0 18px 50px color-mix(in srgb, var(--accent) 30%, rgba(0,0,0,.4))' } }),
        h('div', { style: { flex: 1, minWidth: '240px' } }, h('div', { class: 'tag', style: { fontSize: '11px', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent)' } }, SERVICES[service].name + ' · playlist'),
          h('h1', info.title), info.uploaderId ? h('a', { href: routeFor({ service, id: info.uploaderId, type: 'channel' }) }, info.uploader) : null, meta,
          info.description ? h('p', { class: 'muted', style: { whiteSpace: 'pre-wrap', maxWidth: '700px' } }, info.description.slice(0, 400)) : null,
          h('div', { class: 'row wrap', style: { marginTop: '12px' } },
            h('button', { class: 'btn primary', onclick: () => playItems(items.filter((i) => i.playable !== false), 0) }, icon('play'), 'Play'),
            h('button', { class: 'btn', onclick: () => { const sh = [...items].sort(() => Math.random() - 0.5); playItems(sh, 0); } }, icon('shuffle'), 'Shuffle'),
            h('button', { class: 'btn', onclick: () => playItems(items, 0, 'enqueue') }, icon('queueAdd'), 'Queue all'),
            saveBtn,
            h('button', { class: 'icon-btn', 'aria-label': 'Copy link', title: 'Copy link', onclick: async () => { await copyText(shareUrl(info)); toast('Link copied'); } }, icon('link'))))),
      h('div', { style: { height: '20px' } }), items.length ? list : emptyBox('This playlist is empty'), foot);
  } catch (e) { root.replaceChildren(errorBox(e, () => location.reload())); }
  return view;
}
