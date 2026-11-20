// SoundCloud short links and permalinks: ask the API what the link points to, then redirect.
import { h } from '../../lib/util.js';
import * as svc from '../../lib/services/index.js';
import { errorBox } from '../../lib/ui.js';
import { routeFor } from '../../lib/urls.js';

export async function render({ params }) {
  const el = h('div', h('div', { class: 'spin' }), h('p', { class: 'muted', style: { textAlign: 'center' } }, 'Resolving link…'));
  svc.resolve(params.s, params.id).then((it) => {
    location.replace(routeFor({ service: it.service, id: it.id, type: it.type }));
  }).catch((e) => el.replaceChildren(errorBox(e)));
  return { el, title: 'Opening…' };
}
