#!/usr/bin/env node
/**
 * Select upcoming weekend shows for Setnik's staggered weekly TikTok batches:
 *   - nyc_genres            (Wed): Non-electronic NYC genre roundups (Rock, Punk, Indie, Metal)
 *   - electronic_cities     (Thu): Multi-city Electronic roundups (NYC, LA, Chicago, Austin, Montréal)
 *   - electronic_spotlights (Fri): Top 2 NYC Electronic artist spotlights ranked by Deezer fan count
 *
 * Reuses Setnik Web's live data pipeline (src/fetch.mjs), mock dataset
 * (data/sample-shows.mjs), and wall-clock/formatting helpers (src/html.mjs).
 *
 * Usage:
 *   node tools/tiktok_carousels/select_shows.mjs [--batch electronic_cities|electronic_spotlights|nyc_genres] [--date YYYY-MM-DD] [--mock] [--skip-deezer] [--config path] [--out path]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { getMetro } from '../../src/config.mjs';
import {
  combineAndFilterShows,
  fetchLiveListings,
  headlinerName,
  normKeyPart,
} from '../../src/fetch.mjs';
import {
  addDaysYmd,
  dayOfWeek,
  formatDayNum,
  formatMonthShort,
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
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'genres_config.json');
const VALID_BATCHES = new Set(['nyc_genres', 'electronic_cities', 'electronic_spotlights']);
const DEEZER_TIMEOUT_MS = 5000;

const BROOKLYN_NEIGHBORHOODS = [
  'brooklyn',
  'bushwick',
  'williamsburg',
  'greenpoint',
  'bed-stuy',
  'bedford-stuyvesant',
  'crown heights',
  'gowanus',
  'red hook',
  'dumbo',
  'park slope',
  'flatbush',
  'east williamsburg',
  'sunset park',
  'boerum hill',
  'fort greene',
  'clinton hill',
  'carroll gardens',
  'prospect heights',
  'cobble hill',
];

const HOLLYWOOD_NEIGHBORHOODS = ['hollywood', 'west hollywood', 'weho'];

const GENERIC_HEADLINERS = new Set([
  '',
  'tba',
  'tbd',
  'various artists',
  'dj set',
  'open decks',
  'resident djs',
  'special guest',
  'special guests',
  'secret lineup',
]);

/**
 * Compute Setnik's 5:00 AM night-rollover effective date for a show's startsAt ISO string.
 * Shows starting between 00:00 and 04:59 belong to the previous night's calendar date.
 */
export function effectiveShowDate(startsAt) {
  const wall = parseWallClock(startsAt);
  if (!wall) return null;
  if (wall.hour < 5) {
    return addDaysYmd(wall.date, -1);
  }
  return wall.date;
}

/**
 * Compute the upcoming Fri–Sun weekend date range (YYYY-MM-DD) for a given runDate.
 * - Mon–Thu: upcoming Fri through Sun
 * - Fri: Fri through Sun
 * - Sat: Sat through Sun
 * - Sun: Sun only
 */
export function computeWeekendYmd(runDate) {
  const dow = dayOfWeek(runDate); // 0=Sun..6=Sat
  let start;
  let end;
  if (dow === 5) {
    start = runDate;
    end = addDaysYmd(runDate, 2);
  } else if (dow === 6) {
    start = runDate;
    end = addDaysYmd(runDate, 1);
  } else if (dow === 0) {
    start = runDate;
    end = runDate;
  } else {
    start = addDaysYmd(runDate, 5 - dow);
    end = addDaysYmd(start, 2);
  }
  return { start, end };
}

/** Human-readable weekend range, e.g. "Fri, Nov 27 – Sun, Nov 29". */
export function formatWeekendRange(startYmd, endYmd) {
  if (startYmd === endYmd) {
    return formatShortDate(startYmd);
  }
  return `${formatShortDate(startYmd)} – ${formatShortDate(endYmd)}`;
}

/** Uppercase banner badge for cover slides, e.g. "FRI NOV 27 – SUN NOV 29". */
export function formatWeekendBanner(startYmd, endYmd) {
  const fmt = (ymd) =>
    `${formatWeekdayShort(ymd)} ${formatMonthShort(ymd)} ${formatDayNum(ymd)}`.toUpperCase();
  if (startYmd === endYmd) {
    return fmt(startYmd);
  }
  return `${fmt(startYmd)} – ${fmt(endYmd)}`;
}

/** Format relative day label for a show card relative to runDate (e.g. "Tonight", "Tomorrow", "Fri, Nov 27"). */
export function formatRelativeDay(effectiveDate, runDate) {
  if (effectiveDate === runDate) return 'Tonight';
  if (effectiveDate === addDaysYmd(runDate, 1)) return 'Tomorrow';
  return formatShortDate(effectiveDate);
}

function isBrooklynShow(show) {
  const hay = [
    show?.venue?.neighborhood,
    show?.venue?.area,
    show?.venue?.city,
    show?.neighborhood,
    show?.area,
    show?.city,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return BROOKLYN_NEIGHBORHOODS.some((kw) => hay.includes(kw));
}

function isHollywoodShow(show) {
  const hay = [
    show?.venue?.neighborhood,
    show?.venue?.area,
    show?.venue?.city,
    show?.neighborhood,
    show?.area,
    show?.city,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return HOLLYWOOD_NEIGHBORHOODS.some((kw) => hay.includes(kw));
}

/**
 * Resolve the primary #<city> or high-visibility #<neighborhood> hashtag for Electronic shows.
 * Replaces #<city> with #brooklyn (or #hollywood in LA) when a single spotlight show or
 * majority of roundup shows take place in that high-visibility neighborhood.
 */
export function resolveLocationHashtag(metroId, shows, defaultTag = '#nyc') {
  if (!Array.isArray(shows) || shows.length === 0) return defaultTag;
  if (metroId === 'nyc') {
    const bkCount = shows.filter(isBrooklynShow).length;
    if (bkCount > shows.length / 2) {
      return '#brooklyn';
    }
    return '#nyc';
  }
  if (metroId === 'la') {
    const hwCount = shows.filter(isHollywoodShow).length;
    if (shows.length === 1 && hwCount === 1) {
      return '#hollywood';
    }
    return '#losangeles';
  }
  return defaultTag;
}

/** Build the exact 5 hashtags for Electronic posts: #<city|neighborhood> #rave #edm #concerts #livemusic. */
export function buildElectronicHashtags(metroId, shows, config, defaultTag = '#nyc') {
  const locTag = resolveLocationHashtag(metroId, shows, defaultTag);
  const base = Array.isArray(config?.electronic_base_hashtags)
    ? config.electronic_base_hashtags
    : ['#rave', '#edm', '#concerts', '#livemusic'];
  const combined = [locTag, ...base.filter((t) => String(t).toLowerCase() !== locTag.toLowerCase())];
  return combined.slice(0, 5);
}

/** Strip common live/DJ suffixes from a headliner string before querying Deezer. */
export function cleanArtistNameForLookup(rawName) {
  let cleaned = String(rawName || '').trim();
  cleaned = cleaned.replace(/\s*[\(\[](?:dj\s*set|live(?:\s*set)?|hybrid\s*set|extended\s*set|all\s*night\s*long|b2b[^\)\]]*)[\)\]]/gi, '');
  cleaned = cleaned.replace(/\s+(?:dj\s*set|all\s*night\s*long)$/i, '');
  // For "Artist A b2b Artist B", look up the primary billed artist
  const b2bIdx = cleaned.search(/\s+b2b\s+/i);
  if (b2bIdx > 0) {
    cleaned = cleaned.slice(0, b2bIdx);
  }
  return cleaned.trim();
}

async function fetchJsonWithTimeout(url, timeoutMs = DEEZER_TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look up an artist's Deezer fan count (`nb_fan`) for weekend spotlight ranking.
 * Gracefully returns 0 on network errors or unmatched artists.
 */
export async function lookupDeezerFans(headliner, { deezerArtistId = null, fetchFn = fetchJsonWithTimeout } = {}) {
  const cleaned = cleanArtistNameForLookup(headliner);
  const targetNorm = normKeyPart(cleaned);
  if (!targetNorm || GENERIC_HEADLINERS.has(cleaned.toLowerCase())) {
    return 0;
  }

  if (deezerArtistId) {
    const direct = await fetchFn(`https://api.deezer.com/artist/${encodeURIComponent(String(deezerArtistId))}`);
    if (direct && typeof direct.nb_fan === 'number' && Number.isFinite(direct.nb_fan)) {
      return direct.nb_fan;
    }
  }

  const data = await fetchFn(
    `https://api.deezer.com/search/artist?q=${encodeURIComponent(cleaned)}&limit=5`,
  );
  const items = Array.isArray(data?.data) ? data.data : [];
  if (items.length === 0) return 0;

  let bestExact = -1;
  for (const item of items) {
    if (!item || typeof item.name !== 'string') continue;
    const candNorm = normKeyPart(item.name);
    const fans = typeof item.nb_fan === 'number' && Number.isFinite(item.nb_fan) ? item.nb_fan : 0;
    if (candNorm === targetNorm && fans > bestExact) {
      bestExact = fans;
    }
  }
  if (bestExact >= 0) return bestExact;

  // Fallback: accept a close match only if the normalized name contains the full query and length is similar
  let bestClose = 0;
  for (const item of items) {
    if (!item || typeof item.name !== 'string') continue;
    const candNorm = normKeyPart(item.name);
    const fans = typeof item.nb_fan === 'number' && Number.isFinite(item.nb_fan) ? item.nb_fan : 0;
    if (
      targetNorm.length >= 4 &&
      (candNorm.startsWith(targetNorm) || targetNorm.startsWith(candNorm)) &&
      Math.abs(candNorm.length - targetNorm.length) <= 4 &&
      fans > bestClose
    ) {
      bestClose = fans;
    }
  }
  return bestClose;
}

/** Convert a normalized Setnik Show object into the carousel selection schema. */
function serializeShow(show, runDate, { deezerFans = null } = {}) {
  const wall = parseWallClock(show.startsAt);
  const effDate = effectiveShowDate(show.startsAt) || wall?.date || runDate;
  const sortedActs = [...(show.acts || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const headliner = headlinerName(show) || 'Live Show';
  const supportActs = sortedActs
    .slice(1)
    .map((a) => String(a?.name || '').trim())
    .filter(Boolean);

  const rawTime = formatShowTime(show);
  // Keep card time concise (strip "Doors ... · Show " prefix for compact mobile card row if present)
  const shortTime = rawTime.includes('· Show ') ? rawTime.split('· Show ')[1] : rawTime;
  const priceDisplay = formatPrice(show.price) || '';
  const imageUrl =
    Array.isArray(show.flyerImages) && typeof show.flyerImages[0] === 'string' && show.flyerImages[0].trim()
      ? show.flyerImages[0].trim()
      : null;

  return {
    id: show.id,
    headliner,
    support_acts: supportActs,
    venue_name: show.venue?.name || 'TBA',
    neighborhood: show.venue?.neighborhood || show.venue?.area || '',
    area: show.venue?.area || '',
    city: show.venue?.city || '',
    starts_at: show.startsAt,
    local_date: wall?.date || effDate,
    effective_date: effDate,
    weekday_short: formatWeekdayShort(effDate),
    month_short: formatMonthShort(effDate),
    day_num: formatDayNum(effDate),
    relative_day: formatRelativeDay(effDate, runDate),
    short_date: formatShortDate(effDate),
    time_display: shortTime,
    full_time_display: rawTime,
    price_display: priceDisplay,
    genres: Array.isArray(show.genres) ? show.genres : [],
    image_url: imageUrl,
    ticket_url: show.ticketUrl || null,
    status: show.status || 'scheduled',
    ...(deezerFans != null ? { deezer_fans: deezerFans } : {}),
  };
}

function filterWeekendShowsForMetro(shows, metroId, weekendStart, weekendEnd) {
  return shows
    .filter((s) => {
      if (!s || s.status === 'cancelled') return false;
      if (s.venue?.metro !== metroId) return false;
      const eff = effectiveShowDate(s.startsAt);
      if (!eff) return false;
      return eff >= weekendStart && eff <= weekendEnd;
    })
    .sort((a, b) => {
      const tDiff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
      if (tDiff !== 0) return tDiff;
      return (a.venue?.name || '').localeCompare(b.venue?.name || '');
    });
}

/**
 * Wednesday batch: Select 2–4 soonest NYC/NJ weekend shows per non-electronic genre.
 * Prefers shows not already used by another genre, falling back to reuse only if needed
 * to hit `min_cards_per_genre`.
 */
export function selectShowsForGenres(shows, config, runDate) {
  const metroId = config.metro_id || 'nyc';
  const cardsPerGenre = Number(config.cards_per_genre ?? 4);
  const minCards = Number(config.min_cards_per_genre ?? 2);
  const { start: weekendStart, end: weekendEnd } = computeWeekendYmd(runDate);

  const weekendShows = filterWeekendShowsForMetro(shows, metroId, weekendStart, weekendEnd);
  const usedIds = new Set();
  const selectedGenres = [];
  const skippedGenres = [];

  for (const genreCfg of config.genres || []) {
    const targetLabel = String(genreCfg.filter_label || genreCfg.display_name || '').toLowerCase();
    const matching = weekendShows.filter((s) =>
      (s.genres || []).some((g) => String(g).toLowerCase() === targetLabel),
    );

    const fresh = matching.filter((s) => !usedIds.has(s.id));
    const reused = matching.filter((s) => usedIds.has(s.id));

    const picked = fresh.slice(0, cardsPerGenre);
    if (picked.length < minCards) {
      const needed = minCards - picked.length;
      picked.push(...reused.slice(0, needed));
    }

    if (picked.length < minCards) {
      skippedGenres.push({
        slug: genreCfg.slug,
        display_name: genreCfg.display_name,
        found: matching.length,
        required: minCards,
      });
      continue;
    }

    for (const show of picked) {
      usedIds.add(show.id);
    }

    const hashtags =
      targetLabel === 'electronic'
        ? buildElectronicHashtags(metroId, picked, config, '#nyc')
        : Array.isArray(genreCfg.hashtags)
          ? genreCfg.hashtags.slice(0, 5)
          : [];

    selectedGenres.push({
      kind: 'roundup',
      slug: genreCfg.slug,
      metro_id: metroId,
      city_label: config.city_label || 'NYC / NJ',
      city_short: 'NYC',
      deck_city_label: config.deck_city_label || 'New York · 25 mi',
      display_name: genreCfg.display_name,
      filter_label: genreCfg.filter_label,
      cover_title: genreCfg.cover_title,
      accent_color: genreCfg.accent_color,
      hashtags,
      shows: picked.map((s) => serializeShow(s, runDate)),
    });
  }

  return {
    batch: 'nyc_genres',
    run_date: runDate,
    metro_id: metroId,
    city_label: config.city_label || 'NYC / NJ',
    weekend_start: weekendStart,
    weekend_end: weekendEnd,
    weekend_range: formatWeekendRange(weekendStart, weekendEnd),
    weekend_banner: formatWeekendBanner(weekendStart, weekendEnd),
    total_weekend_shows: weekendShows.length,
    genres: selectedGenres,
    skipped_genres: skippedGenres,
  };
}

/**
 * Thursday batch: Select 2–4 soonest Electronic weekend shows for each configured city
 * (NYC, LA, Chicago, Austin, Montréal).
 */
export function selectElectronicCities(shows, config, runDate) {
  const cardsPerGenre = Number(config.cards_per_genre ?? 4);
  const minCards = Number(config.min_cards_per_genre ?? 2);
  const { start: weekendStart, end: weekendEnd } = computeWeekendYmd(runDate);

  const selectedGenres = [];
  const skippedGenres = [];
  let totalWeekendShows = 0;

  for (const cityCfg of config.electronic_cities || []) {
    const metroId = cityCfg.metro_id;
    const metroWeekend = filterWeekendShowsForMetro(shows, metroId, weekendStart, weekendEnd);
    totalWeekendShows += metroWeekend.length;

    const targetLabel = String(cityCfg.filter_label || 'Electronic').toLowerCase();
    const matching = metroWeekend.filter((s) =>
      (s.genres || []).some((g) => String(g).toLowerCase() === targetLabel),
    );

    const picked = matching.slice(0, cardsPerGenre);
    if (picked.length < minCards) {
      skippedGenres.push({
        slug: cityCfg.slug,
        display_name: cityCfg.display_name,
        found: matching.length,
        required: minCards,
      });
      continue;
    }

    const hashtags = buildElectronicHashtags(metroId, picked, config, cityCfg.city_hashtag || '#nyc');

    selectedGenres.push({
      kind: 'roundup',
      slug: cityCfg.slug,
      metro_id: metroId,
      city_label: cityCfg.city_label || getMetro(metroId).name,
      city_short: cityCfg.city_short || getMetro(metroId).shortName,
      deck_city_label: cityCfg.deck_city_label || `${getMetro(metroId).name} · 25 mi`,
      display_name: cityCfg.display_name || `${getMetro(metroId).shortName} Electronic`,
      filter_label: cityCfg.filter_label || 'Electronic',
      cover_title: cityCfg.cover_title,
      accent_color: cityCfg.accent_color || '#E4574E',
      hashtags,
      shows: picked.map((s) => serializeShow(s, runDate)),
    });
  }

  return {
    batch: 'electronic_cities',
    run_date: runDate,
    metro_id: 'multi',
    city_label: 'Multi-City',
    weekend_start: weekendStart,
    weekend_end: weekendEnd,
    weekend_range: formatWeekendRange(weekendStart, weekendEnd),
    weekend_banner: formatWeekendBanner(weekendStart, weekendEnd),
    total_weekend_shows: totalWeekendShows,
    genres: selectedGenres,
    skipped_genres: skippedGenres,
  };
}

/**
 * Friday batch: Select top N (default 2) most popular NYC Electronic shows of the weekend
 * ranked by Deezer artist fan count (`nb_fan`), producing 2-slide standalone spotlight posts.
 */
export async function selectElectronicSpotlights(
  shows,
  config,
  runDate,
  { skipDeezer = false, fanLookupFn = lookupDeezerFans } = {},
) {
  const spotCfg = config.electronic_spotlights || {};
  const metroId = spotCfg.metro_id || 'nyc';
  const targetLabel = String(spotCfg.filter_label || 'Electronic').toLowerCase();
  const desiredCount = Number(spotCfg.count ?? 2);
  const { start: weekendStart, end: weekendEnd } = computeWeekendYmd(runDate);

  const weekendShows = filterWeekendShowsForMetro(shows, metroId, weekendStart, weekendEnd);
  const electronicShows = weekendShows.filter((s) =>
    (s.genres || []).some((g) => String(g).toLowerCase() === targetLabel),
  );

  // Score each candidate show by Deezer fan count of its headliner
  const fanCache = new Map();
  const scored = [];
  for (const show of electronicShows) {
    const headliner = headlinerName(show);
    const cleaned = cleanArtistNameForLookup(headliner);
    if (!cleaned || GENERIC_HEADLINERS.has(cleaned.toLowerCase())) {
      continue;
    }

    const sortedActs = [...(show.acts || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const headAct = sortedActs[0] || null;
    const deezerArtistId = headAct?.links?.deezerArtistId ?? null;
    const cacheKey = deezerArtistId ? `id:${deezerArtistId}` : `name:${normKeyPart(cleaned)}`;

    let fans = 0;
    if (typeof show.mockDeezerFans === 'number' && Number.isFinite(show.mockDeezerFans)) {
      fans = show.mockDeezerFans;
    } else if (!skipDeezer) {
      if (fanCache.has(cacheKey)) {
        fans = fanCache.get(cacheKey);
      } else {
        fans = await fanLookupFn(headliner, { deezerArtistId });
        fanCache.set(cacheKey, fans);
      }
    }

    scored.push({
      show,
      headliner,
      headlinerNorm: normKeyPart(cleaned),
      fans,
      hasImage: Boolean(Array.isArray(show.flyerImages) && show.flyerImages[0]),
      startsMs: new Date(show.startsAt).getTime(),
    });
  }

  scored.sort((a, b) => {
    if (b.fans !== a.fans) return b.fans - a.fans;
    if (a.hasImage !== b.hasImage) return a.hasImage ? -1 : 1;
    return a.startsMs - b.startsMs;
  });

  // Pick top distinct headliners
  const picked = [];
  const seenArtists = new Set();
  for (const cand of scored) {
    if (seenArtists.has(cand.headlinerNorm)) continue;
    seenArtists.add(cand.headlinerNorm);
    picked.push(cand);
    if (picked.length >= desiredCount) break;
  }

  const selectedGenres = [];
  const skippedGenres = [];

  if (picked.length === 0) {
    skippedGenres.push({
      slug: 'nyc-electronic-spotlights',
      display_name: 'NYC Electronic Spotlights',
      found: electronicShows.length,
      required: 1,
    });
  } else {
    picked.forEach((item, idx) => {
      const rank = idx + 1;
      const serialized = serializeShow(item.show, runDate, { deezerFans: item.fans });
      const hashtags = buildElectronicHashtags(
        metroId,
        [item.show],
        config,
        spotCfg.city_hashtag || '#nyc',
      );
      const locPill = isBrooklynShow(item.show)
        ? 'BROOKLYN'
        : (serialized.neighborhood || spotCfg.city_short || 'NYC').toUpperCase();

      selectedGenres.push({
        kind: 'spotlight',
        slug: `nyc-electronic-spotlight-${rank}`,
        metro_id: metroId,
        city_label: locPill,
        city_short: isBrooklynShow(item.show) ? 'Brooklyn' : (spotCfg.city_short || 'NYC'),
        deck_city_label: spotCfg.deck_city_label || 'New York · 25 mi',
        display_name: `Spotlight: ${serialized.headliner}`,
        filter_label: spotCfg.filter_label || 'Electronic',
        cover_title: `${serialized.headliner.toUpperCase()}`,
        accent_color: spotCfg.accent_color || '#E4574E',
        hashtags,
        deezer_fans: item.fans,
        shows: [serialized],
      });
    });
  }

  return {
    batch: 'electronic_spotlights',
    run_date: runDate,
    metro_id: metroId,
    city_label: spotCfg.city_label || 'NYC / NJ',
    weekend_start: weekendStart,
    weekend_end: weekendEnd,
    weekend_range: formatWeekendRange(weekendStart, weekendEnd),
    weekend_banner: formatWeekendBanner(weekendStart, weekendEnd),
    total_weekend_shows: weekendShows.length,
    genres: selectedGenres,
    skipped_genres: skippedGenres,
  };
}

/**
 * Supplementary mock Electronic shows (used ONLY when `--mock` is passed to this CLI)
 * so all 3 batches (including multi-city Electronic & Deezer-ranked NYC Spotlights)
 * can be exercised end-to-end offline without modifying `data/sample-shows.mjs`.
 */
function buildMockElectronicShows(runDate) {
  const { start: fri } = computeWeekendYmd(runDate);
  const sat = addDaysYmd(fri, 1);
  const sun = addDaysYmd(fri, 2);

  const mk = ({
    id,
    metro,
    tz,
    day,
    time,
    venueName,
    neighborhood,
    area,
    city,
    headliner,
    supports = [],
    priceMin = 25,
    priceMax = 35,
    mockDeezerFans = 0,
  }) => ({
    id,
    startsAt: toZonedIso(day, time, tz),
    venue: {
      name: venueName,
      neighborhood,
      area,
      metro,
      city,
      addressVisibility: 'public',
    },
    acts: [
      { name: headliner, order: 0 },
      ...supports.map((name, i) => ({ name, order: i + 1 })),
    ],
    genres: ['Electronic'],
    price: { min: priceMin, max: priceMax },
    status: 'scheduled',
    source: { provider: 'mock', url: '', fetchedAt: new Date().toISOString() },
    mockDeezerFans,
  });

  return [
    // NYC Electronic (3 Brooklyn + 1 Manhattan -> #brooklyn for roundup & Brooklyn spotlights)
    mk({
      id: 'mock-nyc-elec-1',
      metro: 'nyc',
      tz: 'America/New_York',
      day: fri,
      time: '23:00',
      venueName: 'Nowadays',
      neighborhood: 'Bushwick',
      area: 'Brooklyn',
      city: 'Brooklyn, NY',
      headliner: 'Four Tet',
      supports: ['Avalon Emerson'],
      priceMin: 30,
      priceMax: 40,
      mockDeezerFans: 520000,
    }),
    mk({
      id: 'mock-nyc-elec-2',
      metro: 'nyc',
      tz: 'America/New_York',
      day: sat,
      time: '22:30',
      venueName: 'Basement NY',
      neighborhood: 'Bushwick',
      area: 'Brooklyn',
      city: 'Brooklyn, NY',
      headliner: 'VTSS',
      supports: ['D.Dan', 'Nene H'],
      priceMin: 28,
      priceMax: 35,
      mockDeezerFans: 118000,
    }),
    mk({
      id: 'mock-nyc-elec-3',
      metro: 'nyc',
      tz: 'America/New_York',
      day: sat,
      time: '22:00',
      venueName: 'Public Records',
      neighborhood: 'Gowanus',
      area: 'Brooklyn',
      city: 'Brooklyn, NY',
      headliner: 'Floating Points',
      supports: ['Daphni'],
      priceMin: 35,
      priceMax: 45,
      mockDeezerFans: 310000,
    }),
    mk({
      id: 'mock-nyc-elec-4',
      metro: 'nyc',
      tz: 'America/New_York',
      day: sun,
      time: '21:00',
      venueName: 'Le Bain',
      neighborhood: 'Meatpacking District',
      area: 'Manhattan',
      city: 'New York, NY',
      headliner: 'Octo Octa',
      supports: ['Eris Drew'],
      priceMin: 20,
      priceMax: 25,
      mockDeezerFans: 64000,
    }),
    // LA Electronic
    mk({
      id: 'mock-la-elec-1',
      metro: 'la',
      tz: 'America/Los_Angeles',
      day: fri,
      time: '22:00',
      venueName: 'Sound Nightclub',
      neighborhood: 'Hollywood',
      area: 'Los Angeles',
      city: 'Los Angeles, CA',
      headliner: 'Mall Grab',
      supports: ['Effy'],
      priceMin: 30,
      priceMax: 40,
    }),
    mk({
      id: 'mock-la-elec-2',
      metro: 'la',
      tz: 'America/Los_Angeles',
      day: sat,
      time: '23:00',
      venueName: 'Into The Woods Warehouse',
      neighborhood: 'Arts District',
      area: 'Los Angeles',
      city: 'Los Angeles, CA',
      headliner: 'DJ Heartstring',
      supports: ['Narciss'],
      priceMin: 25,
      priceMax: 35,
    }),
    // Chicago Electronic
    mk({
      id: 'mock-chi-elec-1',
      metro: 'chi',
      tz: 'America/Chicago',
      day: fri,
      time: '22:00',
      venueName: 'Smartbar',
      neighborhood: 'Lakeview',
      area: 'Chicago',
      city: 'Chicago, IL',
      headliner: 'Honey Dijon',
      supports: ['Derrick Carter'],
      priceMin: 25,
      priceMax: 35,
    }),
    mk({
      id: 'mock-chi-elec-2',
      metro: 'chi',
      tz: 'America/Chicago',
      day: sat,
      time: '22:30',
      venueName: 'Podlasie Club',
      neighborhood: 'Avondale',
      area: 'Chicago',
      city: 'Chicago, IL',
      headliner: 'Logic1000',
      supports: ['Shaun J. Wright'],
      priceMin: 20,
      priceMax: 25,
    }),
    // Austin Electronic
    mk({
      id: 'mock-aus-elec-1',
      metro: 'aus',
      tz: 'America/Chicago',
      day: fri,
      time: '21:30',
      venueName: 'The Concourse Project',
      neighborhood: 'Southeast Austin',
      area: 'Austin',
      city: 'Austin, TX',
      headliner: 'Fred again..',
      supports: ['Sammy Virji'],
      priceMin: 45,
      priceMax: 65,
    }),
    mk({
      id: 'mock-aus-elec-2',
      metro: 'aus',
      tz: 'America/Chicago',
      day: sat,
      time: '22:00',
      venueName: 'Kingdom',
      neighborhood: 'Downtown',
      area: 'Austin',
      city: 'Austin, TX',
      headliner: 'salute',
      supports: ['Interplanetary Criminal'],
      priceMin: 25,
      priceMax: 35,
    }),
    // Montréal Electronic
    mk({
      id: 'mock-mtl-elec-1',
      metro: 'mtl',
      tz: 'America/Toronto',
      day: fri,
      time: '23:00',
      venueName: 'Stereo Nightclub',
      neighborhood: 'Village',
      area: 'Montréal',
      city: 'Montréal, QC',
      headliner: 'Kaytranada',
      supports: ['Lou Phelps'],
      priceMin: 35,
      priceMax: 45,
    }),
    mk({
      id: 'mock-mtl-elec-2',
      metro: 'mtl',
      tz: 'America/Toronto',
      day: sat,
      time: '22:00',
      venueName: 'SAT (Société des arts technologiques)',
      neighborhood: 'Quartier des Spectacles',
      area: 'Montréal',
      city: 'Montréal, QC',
      headliner: 'Marie Davidson',
      supports: ['Priori'],
      priceMin: 28,
      priceMax: 35,
    }),
  ];
}

function parseArgs(argv) {
  const args = {
    batch: 'nyc_genres',
    date: null,
    mock: false,
    skipDeezer: false,
    config: DEFAULT_CONFIG_PATH,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--mock') {
      args.mock = true;
    } else if (tok === '--skip-deezer') {
      args.skipDeezer = true;
    } else if (tok === '--batch' && argv[i + 1]) {
      args.batch = argv[++i];
    } else if (tok === '--date' && argv[i + 1]) {
      args.date = argv[++i];
    } else if (tok === '--config' && argv[i + 1]) {
      args.config = argv[++i];
    } else if (tok === '--out' && argv[i + 1]) {
      args.out = argv[++i];
    } else if (tok === '--help' || tok === '-h') {
      console.log(
        'Usage: node tools/tiktok_carousels/select_shows.mjs [--batch nyc_genres|electronic_cities|electronic_spotlights] [--date YYYY-MM-DD] [--mock] [--skip-deezer] [--config path] [--out path]',
      );
      process.exit(0);
    }
  }
  if (!VALID_BATCHES.has(args.batch)) {
    throw new Error(`Invalid --batch '${args.batch}'. Expected one of: ${[...VALID_BATCHES].join(', ')}`);
  }
  return args;
}

function metrosForBatch(batch, config) {
  if (batch === 'electronic_cities') {
    const ids = (config.electronic_cities || []).map((c) => c.metro_id).filter(Boolean);
    return [...new Set(ids)];
  }
  if (batch === 'electronic_spotlights') {
    return [config.electronic_spotlights?.metro_id || 'nyc'];
  }
  return [config.metro_id || 'nyc'];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const targetMetros = metrosForBatch(args.batch, config);

  const now = args.date ? new Date(`${args.date}T19:00:00Z`) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid --date value: ${args.date}`);
  }
  const runDate = args.date || localYmd(now, 'America/New_York');

  let shows;
  if (args.mock) {
    const sample = buildSampleData(now);
    const extraElectronic = buildMockElectronicShows(runDate);
    shows = combineAndFilterShows([...sample.shows, ...extraElectronic], { now, windowDays: 14 });
  } else {
    const live = await fetchLiveListings({
      metros: targetMetros,
      windowDays: 14,
      now,
    });
    shows = live.shows;
  }

  let selection;
  if (args.batch === 'electronic_cities') {
    selection = selectElectronicCities(shows, config, runDate);
  } else if (args.batch === 'electronic_spotlights') {
    selection = await selectElectronicSpotlights(shows, config, runDate, {
      skipDeezer: args.skipDeezer || args.mock,
    });
  } else {
    selection = selectShowsForGenres(shows, config, runDate);
  }

  selection.generated_at = new Date().toISOString();
  selection.source_mode = args.mock ? 'mock' : 'live';

  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(REPO_ROOT, 'build', 'carousel_selected', runDate, 'selected.json');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(selection, null, 2)}\n`, 'utf8');

  console.log(
    `[select_shows] ${runDate} batch=${args.batch} (${selection.source_mode}): ${selection.total_weekend_shows} weekend shows across [${targetMetros.join(',')}] -> ${selection.genres.length} carousel(s) written to ${outPath}`,
  );
  for (const g of selection.genres) {
    const fanNote = g.deezer_fans != null ? ` (${g.deezer_fans.toLocaleString('en-US')} Deezer fans)` : '';
    console.log(
      `  - ${g.slug} (${g.display_name})${fanNote}: ${g.shows.length} show(s) [${g.shows.map((s) => s.headliner).join(', ')}] | tags: ${g.hashtags.join(' ')}`,
    );
  }
  for (const sk of selection.skipped_genres) {
    console.log(`  - [skipped] ${sk.slug}: only ${sk.found}/${sk.required} shows`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[select_shows] Fatal error: ${err.stack || err.message}`);
    process.exit(1);
  });
}
