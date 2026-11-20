// UPipe background worker (service worker on Chromium, event page on Firefox).
// Deliberately tiny: no DOM, no network. It routes "open player / open app" requests and
// keeps track of the single audio-player tab so a click on a card reuses it.
import { ext } from './lib/browser.js';
import { parseUrl, routeFor, refToItem } from './lib/urls.js';

const APP = ext.runtime.getURL('app/app.html');
const PLAYER = ext.runtime.getURL('player/player.html');
const mem = ext.storage.session || ext.storage.local;

const openApp = (hash) => ext.tabs.create({ url: APP + (hash || '#/') });

async function directEnqueue(items, next) {
  const { queue } = await ext.storage.local.get('queue');
  const q = queue && Array.isArray(queue.items) ? queue : { items: [], index: -1 };
  if (next) q.items.splice(Math.max(q.index + 1, 0), 0, ...items); else q.items.push(...items);
  await ext.storage.local.set({ queue: q });
}

async function openPlayer(payload = {}) {
  const { settings } = await ext.storage.local.get('settings');
  const mode = settings?.playerMode || 'window';
  const { playerTab: live } = await mem.get('playerTab');

  if (live) {
    try {
      await ext.tabs.get(live.tabId);
      if (!payload.focusOnly) await ext.tabs.sendMessage(live.tabId, { type: 'player:command', payload });
      if (!payload.silent) {
        await ext.tabs.update(live.tabId, { active: true });
        if (live.windowId != null && ext.windows) await ext.windows.update(live.windowId, { focused: true });
      }
      return { ok: true };
    } catch {
      await mem.remove('playerTab');
    }
  }

  if (payload.mode === 'enqueue' || payload.mode === 'next') {
    await directEnqueue(payload.items || [], payload.mode === 'next');
    return { ok: true, queued: true };
  }

  await mem.set({ pendingPlay: payload });
  if (mode === 'window' && ext.windows) await ext.windows.create({ url: PLAYER, type: 'popup', width: 460, height: 780 });
  else await ext.tabs.create({ url: PLAYER });
  return { ok: true };
}

ext.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return undefined;
  if (msg.type === 'player:open') {
    openPlayer(msg.payload).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg.type === 'player:hello' && sender.tab) {
    (async () => {
      await mem.set({ playerTab: { tabId: sender.tab.id, windowId: sender.tab.windowId } });
      const { pendingPlay } = await mem.get('pendingPlay');
      await mem.remove('pendingPlay');
      sendResponse({ pending: pendingPlay || null });
    })();
    return true;
  }
  if (msg.type === 'app:open') {
    openApp(msg.hash).then(() => sendResponse({ ok: true }));
    return true;
  }
  return undefined;
});

ext.tabs.onRemoved.addListener(async (tabId) => {
  const { playerTab } = await mem.get('playerTab');
  if (playerTab?.tabId === tabId) await mem.remove('playerTab');
});

// ---- context menus ---------------------------------------------------------------------------
const PATTERNS = ['*://*.youtube.com/*', '*://youtu.be/*', '*://*.soundcloud.com/*', '*://*.bandcamp.com/*', '*://media.ccc.de/*'];
function setupMenus() {
  const ignore = () => void ext.runtime.lastError;
  Promise.resolve(ext.contextMenus.removeAll()).then(() => {
    ext.contextMenus.create({ id: 'open-link', title: 'Open link in UPipe', contexts: ['link'], targetUrlPatterns: PATTERNS }, ignore);
    ext.contextMenus.create({ id: 'play-link', title: 'Play link audio in UPipe', contexts: ['link'], targetUrlPatterns: PATTERNS }, ignore);
    ext.contextMenus.create({ id: 'open-page', title: 'Open this page in UPipe', contexts: ['page'], documentUrlPatterns: PATTERNS }, ignore);
    ext.contextMenus.create({ id: 'play-page', title: 'Play this page’s audio in UPipe', contexts: ['page'], documentUrlPatterns: PATTERNS }, ignore);
  });
}
ext.runtime.onInstalled.addListener((d) => {
  setupMenus();
  if (d.reason === 'install') openApp('#/');
});
ext.runtime.onStartup?.addListener(setupMenus);

ext.contextMenus.onClicked.addListener((info) => {
  const ref = parseUrl(info.linkUrl || info.pageUrl || '');
  if (!ref) return;
  if (String(info.menuItemId).startsWith('open') || ref.type === 'channel') openApp(routeFor(ref));
  else openPlayer({ items: [refToItem(ref)], index: 0, mode: 'play' });
});

// ---- keyboard commands -----------------------------------------------------------------------
ext.commands?.onCommand.addListener((cmd) => {
  if (cmd === 'open-upipe') openApp('#/');
  if (cmd === 'open-player') openPlayer({ focusOnly: true, mode: 'focus' });
});

// ---- omnibox: type "up <query or link>" ------------------------------------------------------
if (ext.omnibox) {
  ext.omnibox.setDefaultSuggestion?.({ description: 'Search UPipe for %s' });
  ext.omnibox.onInputEntered.addListener((text) => {
    const ref = parseUrl(text);
    openApp(ref ? routeFor(ref) : `#/search?q=${encodeURIComponent(text)}`);
  });
}
