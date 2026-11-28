#!/usr/bin/env node
/**
 * Export upcoming 14-day live concert inventory for a target metro (nyc or la)
 * to ground the TikTok Growth Research & Content Agents in real Setnik shows.
 *
 * Reuses Setnik Web's live data pipeline (src/fetch.mjs) and mock dataset
 * (data/sample-shows.mjs).
 *
 * Usage:
 *   node tools/tiktok_growth/export_metro_shows.mjs --metro nyc --date 2026-11-30 [--mock] [--out path]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getMetro } from '../../src/config.mjs';
import {
  combineAndFilterShows,
  fetchLiveListings,
  headlinerName,
} from '../../src/fetch.mjs';
import {
  addDaysYmd,
  formatPrice,
  formatShortDate,
  formatShowTime,
  formatWeekdayShort,
  localYmd,
  parseWallClock,
  toZonedIso,
} from '../../src/html.mjs';
import { buildSampleData } from '../../data/sample-shows.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function effectiveShowDate(startsAt) {
  const wall = parseWallClock(startsAt);
  if (!wall) return null;
  if (wall.hour < 5) {
    return addDaysYmd(wall.date, -1);
  }
  return wall.date;
}

function parseArgs(argv) {
  const opts = {
    metro: 'nyc',
    date: null,
    windowDays: 14,
    mock: false,
    out: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--metro' && argv[i + 1]) {
      opts.metro = argv[++i].trim().toLowerCase();
    } else if (arg === '--date' && argv[i + 1]) {
      opts.date = argv[++i].trim();
    } else if (arg === '--window-days' && argv[i + 1]) {
      opts.windowDays = Math.max(3, Math.min(30, Number.parseInt(argv[++i], 10) || 14));
    } else if (arg === '--mock') {
      opts.mock = true;
    } else if (arg === '--out' && argv[i + 1]) {
      opts.out = argv[++i];
    }
  }
  return opts;
}

function extractNumericPrice(show) {
  if (typeof show.priceMin === 'number' && Number.isFinite(show.priceMin)) {
    return show.priceMin;
  }
  const raw = String(show.priceLabel || show.priceText || '');
  const m = raw.match(/\$?\s*(\d+(?:\.\d+)?)/);
  if (m) return Number.parseFloat(m[1]);
  if (/free/i.test(raw)) return 0;
  return null;
}

function summarizeInventory(metro, runDate, windowDays, rawShows) {
  const endDate = addDaysYmd(runDate, windowDays);
  const items = [];
  const venueCounts = new Map();
  const genreCounts = new Map();

  for (const show of rawShows) {
    const effDate = effectiveShowDate(show.startsAt);
    if (!effDate || effDate < runDate || effDate > endDate) continue;

    const headliner = headlinerName(show);
    const venueName = String(show.venue?.name || show.venueName || '').trim();
    if (!headliner || !venueName) continue;

    const neighborhood = String(
      show.venue?.neighborhood || show.venue?.city || metro.displayName
    ).trim();
    const genres = Array.isArray(show.genres)
      ? show.genres.map((g) => String(g).trim()).filter(Boolean)
      : [];
    const priceNum = extractNumericPrice(show);
    const priceText = formatPrice(show) || (priceNum === 0 ? 'Free' : '');

    items.push({
      id: `${effDate}|${venueName.toLowerCase()}|${headliner.toLowerCase()}`,
      headliner,
      support: Array.isArray(show.acts)
        ? show.acts.slice(1).map((a) => String(a?.name || a || '').trim()).filter(Boolean)
        : [],
      venue: venueName,
      neighborhood,
      date: effDate,
      weekday: formatWeekdayShort(effDate) || '',
      short_date: formatShortDate(effDate) || effDate,
      time: formatShowTime(show) || '',
      price_text: priceText,
      price_num: priceNum,
      genres,
      has_preview: Boolean(show.previewUrl || show.acts?.some((a) => a?.previewUrl)),
    });

    venueCounts.set(venueName, (venueCounts.get(venueName) || 0) + 1);
    for (const g of genres) {
      const key = g.toLowerCase();
      genreCounts.set(key, (genreCounts.get(key) || 0) + 1);
    }
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue));

  const topVenues = [...venueCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }));

  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  const affordableShows = items
    .filter((s) => s.price_num !== null && s.price_num <= 25)
    .slice(0, 20);

  return {
    metro: metro.id,
    metro_display: metro.displayName,
    run_date: runDate,
    window_days: windowDays,
    total_shows: items.length,
    top_venues: topVenues,
    top_genres: topGenres,
    affordable_count: affordableShows.length,
    shows: items.slice(0, 80),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const metro = getMetro(opts.metro);
  if (!metro) {
    throw new Error(`Unknown metro '${opts.metro}'. Expected 'nyc' or 'la'.`);
  }

  const runDate = opts.date || localYmd(new Date(), metro.tz);
  const nowIso = toZonedIso(runDate, '06:00', metro.tz);
  const now = new Date(nowIso);

  let mergedShows = [];
  if (opts.mock) {
    const sample = buildSampleData(now);
    const metroShows = sample.shows.filter((s) => (s.metro || 'nyc') === metro.id);
    mergedShows = combineAndFilterShows(metroShows, {
      now,
      windowDays: opts.windowDays,
      tz: metro.tz,
    });
  } else {
    const includeListingsFeed =
      String(process.env.INCLUDE_LISTINGS_FEED || 'true').toLowerCase() !== 'false';
    const live = await fetchLiveListings({
      metros: [metro.id],
      includeListingsFeed,
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
      listingsFeedUrlTemplate: process.env.LISTINGS_FEED_URL_TEMPLATE || '',
    });
    mergedShows = combineAndFilterShows(live.shows, {
      now,
      windowDays: opts.windowDays,
      tz: metro.tz,
    });
  }

  const payload = summarizeInventory(metro, runDate, opts.windowDays, mergedShows);
  const outPath = opts.out
    ? path.resolve(opts.out)
    : path.join(REPO_ROOT, 'build', 'growth', runDate, metro.id, 'inventory.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  console.log(
    `[export_metro_shows] Exported ${payload.total_shows} ${metro.id.toUpperCase()} shows -> ${outPath}`
  );
}

main().catch((err) => {
  console.error('[export_metro_shows] Fatal:', err);
  process.exit(1);
});
