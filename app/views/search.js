import { h, hashFor } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { SERVICES } from '../../lib/config.js';
import * as svc from '../../lib/services/index.js';
import { pagedGrid, emptyBox } from '../../lib/ui.js';

export async function render({ params, settings: s }) {
  const q = params.q || '';
  const service = SERVICES[params.s] ? params.s : s.service;
  const filter = params.filter || 'all';
  const root = h('div');
  if (!q) return { el: emptyBox('Search ' + SERVICES[service].name, 'Type in the box above, or press / to focus it.', 'search'), title: 'Search' };

  const filters = svc.filtersFor(service);
  root.append(h('div', { class: 'section', style: { marginTop: 0 } }, h('div', h('div', { class: 'tag' }, SERVICES[service].name), h('h2', `Results for “${q}”`))));
  if (filters.length > 1) {
    root.append(h('div', { class: 'tabs' }, filters.map(([id, label]) => h('a', { class: 'chip' + (id === filter ? ' active' : ''), href: hashFor('search', { q, s: service, filter: id }) }, label))));
  }
  const notice = h('div');
  const grid = pagedGrid({
    size: s.cardSize,
    first: async () => {
      const r = await svc.search(service, q, { filter });
      if (r.corrected) notice.replaceChildren(h('p', { class: 'muted' }, 'Showing results for “', r.corrected, '”'));
      if (s.hideShorts) r.items = r.items.filter((x) => !x.short);
      return r;
    },
    more: async (page) => {
      const r = await svc.search(service, q, { filter, page });
      if (s.hideShorts) r.items = r.items.filter((x) => !x.short);
      return r;
    },
  });
  root.append(notice, grid);
  grid.start();
  return { el: root, title: q, dispose: () => grid.dispose() };
}
