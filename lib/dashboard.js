// Mini-dashboard data: free, keyless, public APIs. Every widget loads independently and fails quietly.
import { getJSON } from './http.js';
import { cached, enc } from './util.js';

const MIN = 60 * 1000;

const WMO = {
  0: ['Clear sky', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁️'], 45: ['Fog', '🌫️'], 48: ['Rime fog', '🌫️'],
  51: ['Light drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Heavy drizzle', '🌧️'], 61: ['Light rain', '🌦️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
  71: ['Light snow', '🌨️'], 73: ['Snow', '❄️'], 75: ['Heavy snow', '❄️'], 80: ['Showers', '🌦️'], 81: ['Showers', '🌧️'], 82: ['Violent showers', '⛈️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm, hail', '⛈️'], 99: ['Thunderstorm, hail', '⛈️'],
};
export const wmo = (c) => WMO[c] || WMO[Math.floor(c / 10) * 10] || ['Weather', '🌡️'];

async function locate(s) {
  if (s.weatherCity?.lat != null) return s.weatherCity;
  return cached('geo', 60 * MIN, async () => {
    const j = await getJSON('https://get.geojs.io/v1/ip/geo.json', { timeout: 5000 });
    return { name: [j.city, j.country_code].filter(Boolean).join(', ') || 'Your area', lat: +j.latitude, lon: +j.longitude };
  });
}

export async function weather(s) {
  const loc = await locate(s);
  const unit = s.units === 'imperial';
  const q = `latitude=${loc.lat}&longitude=${loc.lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=4&timezone=auto${unit ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : ''}`;
  const j = await cached('wx:' + q, 10 * MIN, () => getJSON(`https://api.open-meteo.com/v1/forecast?${q}`, { timeout: 8000 }));
  return { loc, unit: unit ? '°F' : '°C', wind: unit ? 'mph' : 'km/h', now: j.current, days: j.daily.time.map((t, i) => ({ date: t, max: j.daily.temperature_2m_max[i], min: j.daily.temperature_2m_min[i], code: j.daily.weather_code[i] })) };
}

export async function geocode(name) {
  const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${enc(name)}&count=6&language=en&format=json`, { timeout: 6000 });
  return (j.results || []).map((r) => ({ name: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude }));
}

export function topSongs(s) {
  const cc = (s.region || 'US').toLowerCase();
  return cached('songs:' + cc, 30 * MIN, async () => {
    const j = await getJSON(`https://rss.applemarketingtools.com/api/v2/${cc}/music/most-played/10/songs.json`, { timeout: 8000 });
    return (j.feed?.results || []).map((r) => ({ title: r.name, artist: r.artistName, art: (r.artworkUrl100 || '').replace('100x100', '200x200'), genre: r.genres?.[0]?.name }));
  });
}

export function markets(s) {
  const ids = (s.coins || 'bitcoin,ethereum,solana').replace(/\s/g, '');
  return cached('coins:' + ids, 3 * MIN, async () => {
    const j = await getJSON(`https://api.coingecko.com/api/v3/simple/price?ids=${enc(ids)}&vs_currencies=usd&include_24hr_change=true`, { timeout: 8000 });
    return Object.entries(j).map(([id, v]) => ({ id, usd: v.usd, change: v.usd_24h_change }));
  });
}

export function news() {
  return cached('hn', 10 * MIN, async () => {
    const ids = (await getJSON('https://hacker-news.firebaseio.com/v0/topstories.json', { timeout: 8000 })).slice(0, 6);
    const items = await Promise.all(ids.map((id) => getJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: 8000 }).catch(() => null)));
    return items.filter((x) => x && x.title).map((x) => ({ id: x.id, title: x.title, score: x.score, comments: x.descendants, url: x.url || `https://news.ycombinator.com/item?id=${x.id}`, by: x.by }));
  });
}
