import { h } from '../../lib/util.js';
import { icon } from '../../lib/icons.js';
import { SERVICES, SERVICE_ORDER, VERSION, WEBSITE, GITHUB, DONATE_URL } from '../../lib/config.js';
import { ext, isFirefox } from '../../lib/browser.js';

export async function render() {
  const root = h('div');
  const link = (href, label, ic, primary) => h('a', { class: 'btn' + (primary ? ' primary' : ''), href, target: '_blank', rel: 'noopener noreferrer' }, icon(ic), label);
  root.append(
    h('div', { class: 'hero' }, h('div', h('h1', 'UPipe ', h('span', { class: 'muted', style: { fontSize: '16px', fontWeight: 400 } }, 'v' + VERSION)), h('p', 'A lightweight, privacy-friendly front-end for the open web’s media, inspired by NewPipe. No accounts, no Google scripts, no tracking.')),
      h('div', { class: 'actions' }, link(DONATE_URL, 'Donate', 'coffee', true), link(WEBSITE, 'Website', 'globe'), link(GITHUB, 'GitHub', 'code'))),
    h('div', { class: 'about-grid' },
      h('section', { class: 'panel' }, h('h3', icon('music'), 'Supported services'),
        h('ul', { class: 'mini-list' }, SERVICE_ORDER.map((id) => h('li', h('span', { class: 'svc-dot', style: { background: SERVICES[id].color } }, SERVICES[id].name[0]), h('div', { class: 'grow' }, h('b', SERVICES[id].name), h('span', SERVICES[id].blurb))))),
        h('p', { class: 'sub', style: { whiteSpace: 'normal', marginTop: '8px' } }, 'Like NewPipe, UPipe talks to each service’s public web endpoints, or to open front-end APIs for YouTube. If a service changes something, a fix may be needed.')),
      h('section', { class: 'panel' }, h('h3', icon('shield'), 'Privacy'),
        h('table', { class: 't' },
          h('tr', h('td', 'Accounts'), h('td', 'None. Nothing to sign in to.')),
          h('tr', h('td', 'Your data'), h('td', 'Favorites, playlists, subscriptions and history live in this browser’s extension storage only.')),
          h('tr', h('td', 'Analytics'), h('td', 'None. UPipe has no server and sends no telemetry.')),
          h('tr', h('td', 'Network'), h('td', 'Requests go straight from your browser to the services and public APIs you use (see Settings).')))),
      h('section', { class: 'panel' }, h('h3', icon('info'), 'This build'),
        h('table', { class: 't' },
          h('tr', h('td', 'Browser'), h('td', isFirefox ? 'Firefox' : 'Chromium-based')),
          h('tr', h('td', 'Extension ID'), h('td', ext.runtime.id || '—')),
          h('tr', h('td', 'Manifest'), h('td', 'V3')),
          h('tr', h('td', 'Open-source'), h('td', 'hls.js (Apache-2.0) is bundled for HLS playback.')))),
      h('section', { class: 'panel' }, h('h3', icon('info'), 'Good to know'),
        h('p', { style: { margin: 0 } }, 'Please respect creators and each site’s terms of service: download only what you have the right to keep. Free public servers can be slow or temporarily down; pick your own instance under Settings → Services for the best reliability.'))));
  return { el: root, title: 'About' };
}
