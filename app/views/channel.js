import { h, fmtNum, linkify } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { SERVICES } from '../../lib/config.js';
import * as store from '../../lib/store.js';
import * as svc from '../../lib/services/index.js';
import { pagedGrid, errorBox, playItems, toast, shareUrl } from '../../lib/ui.js';
import { copyText } from '../../lib/util.js';

export async function render({ params, settings: s, setOverride }) {
  const service = SERVICES[params.s] ? params.s : s.service;
  setOverride?.(service);
  const root = h('div', h('div', { class: 'skel', style: { height: '160px', borderRadius: '20px' } }));
  const view = { el: root, title: '' };
  let grid;
  view.dispose = () => grid?.dispose();

  try {
    const first = await svc.channel(service, params.id, null);
    const info = first.info || { title: params.id, service, id: params.id, type: 'channel' };
    info.service = service; info.type = 'channel'; if (!info.id) info.id = params.id;
    view.title = info.title;
    const sub = h('button', { class: 'btn' }, 'Subscribe');
    const paint = async () => { const on = await store.isSubscribed(info); sub.textContent = on ? 'Subscribed' : 'Subscribe'; sub.classList.toggle('primary', on); };
    sub.onclick = async () => { const on = await store.toggleSub(info); toast(on ? 'Subscribed — saved on this device only' : 'Unsubscribed'); paint(); };
    paint();

    const banner = info.banner ? h('div', { style: { height: '160px', borderRadius: '20px', background: `center/cover url("${info.banner.replace(/"/g, '%22')}")`, marginBottom: '16px' } }) : null;
    const desc = info.description ? h('div', { class: 'sub', style: { whiteSpace: 'pre-wrap', maxWidth: '760px', overflow: 'hidden', maxHeight: '4.5em', textOverflow: 'ellipsis' } }, info.description) : null;
    const head = h('div', { class: 'row', style: { gap: '20px', alignItems: 'center', flexWrap: 'wrap' } },
      info.thumbnail ? h('img', { src: info.thumbnail, alt: '', referrerpolicy: 'no-referrer', style: { width: '112px', height: '112px', borderRadius: '50%', objectFit: 'cover', background: 'var(--card2)' } }) : null,
      h('div', { style: { flex: 1, minWidth: '220px' } }, h('div', { class: 'tag muted', style: { fontSize: '11px', fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--accent)' } }, SERVICES[service].name),
        h('h1', info.title, info.verified ? icon('verified', 'verified') : null),
        h('div', { class: 'sub' }, [info.subscribers != null ? `${typeof info.subscribers === 'number' ? fmtNum(info.subscribers) : info.subscribers} ${service === 'peertube' ? 'followers' : 'subscribers'}` : '', info.count != null ? `${info.count} items` : ''].filter(Boolean).join(' · ')),
        desc),
      h('div', { class: 'row wrap' }, sub,
        first.items.some((i) => i.type === 'stream') ? h('button', { class: 'btn primary', onclick: () => playItems(first.items, 0) }, icon('play'), 'Play all') : null,
        h('button', { class: 'icon-btn', title: 'Copy link', 'aria-label': 'Copy link', onclick: async () => { await copyText(shareUrl(info)); toast('Link copied'); } }, icon('link'))));
    const links = info.links?.length ? h('div', { class: 'tags' }, info.links.map((l) => h('a', { class: 'chip', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.label))) : null;

    let next = first.next;
    grid = pagedGrid({ size: s.cardSize, first: async () => ({ items: first.items, next }), more: async (p) => { const r = await svc.channel(service, params.id, p); return { items: r.items, next: r.next }; } });
    root.replaceChildren(banner, head, links, h('div', { class: 'section' }, h('h2', service === 'bandcamp' ? 'Discography' : 'Uploads')), grid);
    grid.start();
    if (info.description && info.description.length > 260) desc.style.cursor = 'pointer', desc.title = 'Click to expand', desc.onclick = () => { desc.style.maxHeight = desc.style.maxHeight ? '' : '4.5em'; };
  } catch (e) {
    root.replaceChildren(errorBox(e, () => location.reload()));
  }
  return view;
}
