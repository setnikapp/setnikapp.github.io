#!/usr/bin/env node
/**
 * Select upcoming NYC/NJ weekend shows per configured TikTok carousel genre.
 *
 * Reuses Setnik Web's live data pipeline (src/fetch.mjs), mock dataset
 * (data/sample-shows.mjs), and wall-clock/formatting helpers (src/html.mjs).
 *
 * Usage:
 *   node tools/tiktok_carousels/select_shows.mjs [--date YYYY-MM-DD] [--mock] [--config path] [--out path]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { getMetro } from '../../src/config.mjs';
import { combineAndFilterShows, fetchLiveListings, headlinerName } from '../../src/fetch.mjs';
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
} from '../../src/html.mjs';
import { buildSampleData } from '../../data/sample-shows.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'genres_config.json');

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

/** Convert a normalized Setnik Show object into the carousel selection schema. */
function serializeShow(show, runDate) {
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
  };
}

/**
 * Select 2–4 soonest NYC/NJ weekend shows per configured genre.
 * Prefers shows not already used by another genre, falling back to reuse
 * only if needed to hit `min_cards_per_genre`.
 */
export function selectShowsForGenres(shows, config, runDate) {
  const metroId = config.metro_id || 'nyc';
  const cardsPerGenre = Number(config.cards_per_genre ?? 4);
  const minCards = Number(config.min_cards_per_genre ?? 2);
  const { start: weekendStart, end: weekendEnd } = computeWeekendYmd(runDate);

  // Filter to target metro, non-cancelled, and Fri–Sun weekend (with 5:00 AM night rollover)
  const weekendShows = shows
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

    selectedGenres.push({
      slug: genreCfg.slug,
      display_name: genreCfg.display_name,
      filter_label: genreCfg.filter_label,
      cover_title: genreCfg.cover_title,
      accent_color: genreCfg.accent_color,
      hashtags: Array.isArray(genreCfg.hashtags) ? genreCfg.hashtags.slice(0, 5) : [],
      shows: picked.map((s) => serializeShow(s, runDate)),
    });
  }

  return {
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

function parseArgs(argv) {
  const args = {
    date: null,
    mock: false,
    config: DEFAULT_CONFIG_PATH,
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--mock') {
      args.mock = true;
    } else if (tok === '--date' && argv[i + 1]) {
      args.date = argv[++i];
    } else if (tok === '--config' && argv[i + 1]) {
      args.config = argv[++i];
    } else if (tok === '--out' && argv[i + 1]) {
      args.out = argv[++i];
    } else if (tok === '--help' || tok === '-h') {
      console.log(
        'Usage: node tools/tiktok_carousels/select_shows.mjs [--date YYYY-MM-DD] [--mock] [--config path] [--out path]',
      );
      process.exit(0);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const metro = getMetro(config.metro_id || 'nyc');

  const now = args.date ? new Date(`${args.date}T19:00:00Z`) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error(`Invalid --date value: ${args.date}`);
  }
  const runDate = args.date || localYmd(now, metro.tz);

  let shows;
  if (args.mock) {
    const sample = buildSampleData(now);
    shows = combineAndFilterShows(sample.shows, { now, windowDays: 14 });
  } else {
    const live = await fetchLiveListings({
      metros: [metro.id],
      windowDays: 14,
      now,
    });
    shows = live.shows;
  }

  const selection = selectShowsForGenres(shows, config, runDate);
  selection.generated_at = new Date().toISOString();
  selection.source_mode = args.mock ? 'mock' : 'live';

  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(REPO_ROOT, 'build', 'carousel_selected', runDate, 'selected.json');

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(selection, null, 2)}\n`, 'utf8');

  console.log(
    `[select_shows] ${runDate} (${selection.source_mode}): ${selection.total_weekend_shows} ${metro.id.toUpperCase()} weekend shows -> ${selection.genres.length} genre carousels written to ${outPath}`,
  );
  for (const g of selection.genres) {
    console.log(`  - ${g.slug} (${g.display_name}): ${g.shows.length} shows [${g.shows.map((s) => s.headliner).join(', ')}]`);
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
