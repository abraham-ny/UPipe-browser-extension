export const VERSION = '1.0.0';
export const WEBSITE = 'https://abrahamonline.netlify.app';
export const GITHUB = 'https://github.com/abraham-ny';
// Point this at your real donation page (Ko-fi, Buy Me a Coffee, PayPal.me, GitHub Sponsors ...).
export const DONATE_URL = WEBSITE;

export const SERVICES = {
  youtube:    { id: 'youtube',    name: 'YouTube',      color: '#ff2d3b', kind: 'video', blurb: 'Videos, music and channels' },
  soundcloud: { id: 'soundcloud', name: 'SoundCloud',   color: '#ff5500', kind: 'audio', blurb: 'Tracks, remixes and artists' },
  bandcamp:   { id: 'bandcamp',   name: 'Bandcamp',     color: '#1593b8', kind: 'audio', blurb: 'Independent albums and tracks' },
  peertube:   { id: 'peertube',   name: 'PeerTube',     color: '#f5a524', kind: 'video', blurb: 'Federated, open video' },
  ccc:        { id: 'ccc',        name: 'media.ccc.de', color: '#22c55e', kind: 'video', blurb: 'Talks from the Chaos community' },
};
export const SERVICE_ORDER = ['youtube', 'soundcloud', 'bandcamp', 'peertube', 'ccc'];

export const REGIONS = {
  US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia', DE: 'Germany', FR: 'France',
  ES: 'Spain', IT: 'Italy', NL: 'Netherlands', SE: 'Sweden', IN: 'India', JP: 'Japan', KR: 'South Korea',
  BR: 'Brazil', MX: 'Mexico', ZA: 'South Africa', NG: 'Nigeria', KE: 'Kenya', GH: 'Ghana', EG: 'Egypt',
};

// Seed lists. Live lists are fetched at runtime and cached; these are the fallback.
export const DEFAULT_PIPED = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.nosebs.ru',
  'https://piped-api.privacy.com.de',
  'https://api.piped.yt',
  'https://pipedapi.drgns.space',
  'https://pipedapi.owo.si',
  'https://pipedapi.reallyaweso.me',
];
export const DEFAULT_INVIDIOUS = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://invidious.f5.si',
];

export const DEFAULT_SETTINGS = {
  theme: 'dark',            // dark | light | black | system
  accentMode: 'phantom',    // phantom (follows the service) | custom
  accentColor: '#8b5cf6',
  glow: 'normal',           // off | soft | normal | bold
  service: 'youtube',
  region: 'US',
  cardSize: 'medium',       // small | medium | large
  showAvatars: true,

  ytBackend: 'auto',        // auto | piped | invidious
  pipedInstance: '',
  invidiousInstance: '',
  instanceOnly: false,
  peertubeInstance: 'https://framatube.org',

  searchSuggestions: true,
  saveHistory: true,
  saveSearches: true,
  hideShorts: false,
  comments: true,
  dislikes: true,

  playerMode: 'window',     // window | tab
  autoplayNext: true,
  queueFromFeed: true,
  audioQuality: 'high',     // high | medium | low
  audioFormat: 'any',       // any | m4a | opus | mp3
  defaultSpeed: 1,
  volume: 0.9,

  downloadFolder: 'UPipe',
  askWhere: false,
  filenameTemplate: '{uploader} - {title}',

  dash: { recent: true, stats: true, status: true, weather: true, songs: true, markets: true, news: true },
  weatherCity: null,
  units: 'metric',
  coins: 'bitcoin,ethereum,solana',
};
