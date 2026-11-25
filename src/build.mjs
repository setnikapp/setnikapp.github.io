/**
 * Setnik Web Static Site Generator CLI & build API.
 *
 * Usage:
 *   node src/build.mjs                                 # Live build from Supabase + setnik-listings
 *   node src/build.mjs --mock                          # Local dry-run with realistic mock data
 *   node src/build.mjs --mock --out dist --site-url https://setnikapp.github.io
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DEFAULT_METROS,
  DEFAULT_SITE_URL,
  DEFAULT_WINDOW_DAYS,
  METROS,
  PRIORITY_METROS,
  getMetro,
  parseSiteUrl,
} from './config.mjs';
import { buildFaviconSvg, buildPlayerJs, buildStylesCss } from './assets.mjs';
import { combineAndFilterShows, fetchLiveListings, headlinerName } from './fetch.mjs';
import {
  addDaysYmd,
  canonicalUrl,
  dayOfWeek,
  formatDayNum,
  formatLongDate,
  formatMonthShort,
  formatPrice,
  formatShortDate,
  formatShowTime,
  formatWeekdayShort,
  localYmd,
  parseWallClock,
  slugify,
} from './html.mjs';
import { buildEventName } from './schema.mjs';
import { buildRobotsTxt, buildSitemapTxt, buildSitemapXml } from './sitemaps.mjs';
import {
  renderAreaHubPage,
  renderGenrePage,
  renderGenresIndexPage,
  renderHomePage,
  renderNotFoundPage,
  renderShowLeafPage,
  renderVenuePage,
  renderVenuesIndexPage,
  renderWeekendHubPage,
} from './templates.mjs';
import { buildSampleData } from '../data/sample-shows.mjs';

function writeOut(outDir, relPath, content) {
  const full = path.join(outDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

/** Determine the Fri–Sun weekend date range for a metro given `now`. */
function getWeekendRange(now, tz) {
  const today = localYmd(now, tz);
  const dow = dayOfWeek(today); // 0=Sun..6=Sat
  let start;
  let end;
  if (dow === 5) {
    start = today;
    end = addDaysYmd(today, 2);
  } else if (dow === 6) {
    start = today;
    end = addDaysYmd(today, 1);
  } else if (dow === 0) {
    start = today;
    end = today;
  } else {
    start = addDaysYmd(today, 5 - dow);
    end = addDaysYmd(start, 2);
  }
  const dateRangeLabel = start === end
    ? formatShortDate(start)
    : `${formatShortDate(start)} – ${formatShortDate(end)}`;
  return { start, end, dateRangeLabel };
}

/** Assign collision-safe canonical leaf paths (/shows/YYYY-MM-DD-venue-slug-headliner-slug/) and venue paths. */
function assignRoutes(shows) {
  const usedLeafSlugs = new Set();
  const venueSlugByKey = new Map();
  const usedVenueSlugs = new Set();

  // First pass: assign deterministic venue slugs
  for (const s of shows) {
    const vKey = `${s.venue.metro}|${s.venue.name.toLowerCase().trim()}`;
    if (!venueSlugByKey.has(vKey)) {
      let base = slugify(s.venue.name, 48);
      let candidate = base;
      if (usedVenueSlugs.has(candidate)) {
        candidate = `${base}-${slugify(s.venue.metro, 12)}`;
      }
      let n = 2;
      while (usedVenueSlugs.has(candidate)) {
        candidate = `${base}-${n++}`;
      }
      usedVenueSlugs.add(candidate);
      venueSlugByKey.set(vKey, candidate);
    }
  }

  // Second pass: assign collision-safe show leaf slugs
  return shows.map((s) => {
    const wall = parseWallClock(s.startsAt);
    const datePart = wall ? wall.date : 'upcoming';
    const vKey = `${s.venue.metro}|${s.venue.name.toLowerCase().trim()}`;
    const venueSlug = venueSlugByKey.get(vKey);
    const headSlug = slugify(headlinerName(s) || s.title || 'show', 40);
    const baseSlug = `${datePart}-${slugify(s.venue.name, 32)}-${headSlug}`;

    let leafSlug = baseSlug;
    let n = 2;
    while (usedLeafSlugs.has(leafSlug)) {
      leafSlug = `${baseSlug}-${n++}`;
    }
    usedLeafSlugs.add(leafSlug);

    return {
      ...s,
      slug: leafSlug,
      pagePath: `/shows/${leafSlug}/`,
      venueSlug,
      venuePath: `/venues/${venueSlug}/`,
    };
  });
}

function metroRank(metroId) {
  const idx = DEFAULT_METROS.indexOf(metroId);
  return idx >= 0 ? idx : 999;
}

/** Build all hyperlocal hubs (weekend hubs, metro/borough/city/neighborhood hubs, venues, genres). */
function buildCollections(routedShows, now) {
  const showsByMetro = new Map();
  for (const s of routedShows) {
    const mId = s.venue.metro || 'nyc';
    if (!showsByMetro.has(mId)) showsByMetro.set(mId, []);
    showsByMetro.get(mId).push(s);
  }

  // 1. Weekend hubs + date-bucket tags + full per-metro JSON payloads (ordered NYC, LA, Chicago first)
  const weekendHubs = [];
  const homeMetros = [];
  const metroPayloads = new Map();

  for (const [mId, list] of showsByMetro.entries()) {
    const metro = getMetro(mId);
    const today = localYmd(now, metro.tz);
    const tomorrow = addDaysYmd(today, 1);
    const weekEnd = addDaysYmd(today, 6);
    const nextWeekStart = addDaysYmd(today, 7);
    const nextWeekEnd = addDaysYmd(today, 13);
    const range = getWeekendRange(now, metro.tz);

    const wkShows = [];
    const serializedShows = [];

    for (const s of list) {
      const w = parseWallClock(s.startsAt);
      const d = w?.date || '';
      const isTonight = Boolean(d && d === today);
      const isTomorrow = Boolean(d && d === tomorrow);
      const isWeekend = Boolean(d && d >= range.start && d <= range.end);
      const isThisWeek = Boolean(d && d >= today && d <= weekEnd);
      const isNextWeek = Boolean(d && d >= nextWeekStart && d <= nextWeekEnd);
      s.isTonight = isTonight;
      s.isTomorrow = isTomorrow;
      s.isWeekend = isWeekend;
      s.isThisWeek = isThisWeek;
      s.isNextWeek = isNextWeek;
      if (isWeekend) wkShows.push(s);

      const acts = [...(s.acts || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const supports = s.title ? acts.map((a) => a.name) : acts.slice(1).map((a) => a.name);
      const supportsLine = supports.length ? `${s.title ? 'Featuring' : 'With'} ${supports.join(', ')}` : '';

      serializedShows.push({
        p: s.pagePath,
        n: buildEventName(s),
        sup: supportsLine,
        d,
        dl: d ? formatLongDate(d) : 'Upcoming',
        mo: d ? formatMonthShort(d) : '',
        dy: d ? formatDayNum(d) : '—',
        dw: d ? formatWeekdayShort(d) : '',
        t: formatShowTime(s),
        v: s.venue.name,
        vp: s.venuePath,
        nb: s.venue.neighborhood || s.venue.area || '',
        m: metro.id,
        g: (s.genres || []).map((g) => [g, slugify(g, 40)]),
        pr: formatPrice(s.price),
        fr: s.price?.isFree ? 1 : 0,
        st: s.status === 'cancelled' ? 'cancelled' : (s.status === 'moved' ? 'moved' : ''),
        ts: new Date(s.startsAt).getTime() || 0,
        tn: isTonight ? 1 : 0,
        tm: isTomorrow ? 1 : 0,
        wk: isWeekend ? 1 : 0,
        tw: isThisWeek ? 1 : 0,
        nw: isNextWeek ? 1 : 0,
      });
    }

    metroPayloads.set(metro.id, {
      metro: metro.id,
      dates: {
        today,
        tomorrow,
        weekendStart: range.start,
        weekendEnd: range.end,
        weekEnd,
        nextWeekStart,
        nextWeekEnd,
      },
      shows: serializedShows,
    });

    const slug = `${metro.slug}-shows-this-weekend`;
    weekendHubs.push({
      slug,
      path: `/${slug}/`,
      metro,
      title: `${metro.shortName} Shows This Weekend`,
      shortTitle: `${metro.shortName} This Weekend`,
      dateRangeLabel: range.dateRangeLabel,
      shows: wkShows,
    });

    homeMetros.push({
      id: metro.id,
      slug: metro.slug,
      name: metro.name,
      shortName: metro.shortName,
      hubPath: `/${metro.slug}-live-music/`,
      weekendPath: `/${slug}/`,
      totalCount: list.length,
    });
  }
  weekendHubs.sort((a, b) => metroRank(a.metro.id) - metroRank(b.metro.id) || b.shows.length - a.shows.length);
  homeMetros.sort((a, b) => metroRank(a.id) - metroRank(b.id) || b.totalCount - a.totalCount);

  // Initial SSR shows for homepage first paint & crawlers (default metro's This Week, fallback to upcoming)
  const defaultMetroId = homeMetros[0]?.id;
  const defaultList = defaultMetroId ? (showsByMetro.get(defaultMetroId) || []) : routedShows;
  const defaultThisWeek = defaultList.filter((s) => s.isThisWeek);
  const homeShows = (defaultThisWeek.length ? defaultThisWeek : defaultList).slice(0, 25);

  // 2. City / Borough / Neighborhood hubs (e.g. /nyc-live-music/, /brooklyn-live-music/, /jersey-city-live-music/)
  const areaMap = new Map();
  const addAreaHub = (keySlug, label, metro, showsList, priority) => {
    const slug = `${keySlug}-live-music`;
    const existing = areaMap.get(slug);
    if (!existing) {
      areaMap.set(slug, {
        slug,
        path: `/${slug}/`,
        label,
        metro,
        parentMetroPath: `/${metro.slug}-live-music/`,
        weekendPath: `/${metro.slug}-shows-this-weekend/`,
        priority,
        shows: [...showsList],
      });
    } else {
      const seenIds = new Set(existing.shows.map((x) => x.slug));
      for (const s of showsList) {
        if (!seenIds.has(s.slug)) existing.shows.push(s);
      }
    }
  };

  for (const [mId, list] of showsByMetro.entries()) {
    const metro = getMetro(mId);
    const isPriority = PRIORITY_METROS.includes(mId);
    // Metro-level hub (e.g. /nyc-live-music/, /la-live-music/, /chicago-live-music/)
    addAreaHub(metro.slug, metro.name, metro, list, 1);

    // Group by area (e.g. Brooklyn, Manhattan, Queens, North Jersey)
    const byArea = new Map();
    const byCity = new Map();
    const byNeighborhood = new Map();

    for (const s of list) {
      if (s.venue.area) {
        if (!byArea.has(s.venue.area)) byArea.set(s.venue.area, []);
        byArea.get(s.venue.area).push(s);
      }
      const cityName = String(s.venue.city || '').split(',')[0].trim();
      if (cityName) {
        if (!byCity.has(cityName)) byCity.set(cityName, []);
        byCity.get(cityName).push(s);
      }
      if (s.venue.neighborhood) {
        if (!byNeighborhood.has(s.venue.neighborhood)) byNeighborhood.set(s.venue.neighborhood, []);
        byNeighborhood.get(s.venue.neighborhood).push(s);
      }
    }

    // Boroughs / primary areas (require >= 2 shows outside NYC to avoid thin 1-show suburb pages across 10 metros)
    for (const [area, items] of byArea.entries()) {
      if (mId !== 'nyc' && items.length < 2) continue;
      const aSlug = slugify(area, 40);
      if (aSlug === metro.slug || aSlug === slugify(metro.name, 40)) continue;
      addAreaHub(aSlug, area, metro, items, 2);
    }

    // Distinct cities (e.g. Jersey City in NYC metro; >= 2 shows elsewhere to prevent thin hubs)
    for (const [cityName, items] of byCity.entries()) {
      if (mId !== 'nyc' && items.length < 2) continue;
      const cSlug = slugify(cityName, 40);
      if (cSlug === metro.slug || cSlug === slugify(metro.name, 40) || cSlug === 'new-york') continue;
      if (areaMap.has(`${cSlug}-live-music`)) continue;
      addAreaHub(cSlug, cityName, metro, items, 3);
    }

    // High-density neighborhoods (>= 2 shows in priority metros, >= 3 elsewhere)
    const minNeighborhoodShows = isPriority ? 2 : 3;
    for (const [nb, items] of byNeighborhood.entries()) {
      if (items.length < minNeighborhoodShows) continue;
      const nSlug = slugify(nb, 40);
      if (nSlug === metro.slug || nSlug === slugify(metro.name, 40) || areaMap.has(`${nSlug}-live-music`)) continue;
      addAreaHub(nSlug, nb, metro, items, 4);
    }
  }

  const areaHubs = [...areaMap.values()].sort(
    (a, b) =>
      a.priority - b.priority ||
      metroRank(a.metro.id) - metroRank(b.metro.id) ||
      b.shows.length - a.shows.length ||
      a.label.localeCompare(b.label),
  );

  // Attach best matching areaHubPath to each show for breadcrumbs
  for (const s of routedShows) {
    const areaSlug = `${slugify(s.venue.area || '', 40)}-live-music`;
    const cityName = String(s.venue.city || '').split(',')[0].trim();
    const citySlug = `${slugify(cityName, 40)}-live-music`;
    const metroSlug = `${getMetro(s.venue.metro).slug}-live-music`;
    if (areaMap.has(areaSlug)) s.areaHubPath = areaMap.get(areaSlug).path;
    else if (areaMap.has(citySlug)) s.areaHubPath = areaMap.get(citySlug).path;
    else if (areaMap.has(metroSlug)) s.areaHubPath = areaMap.get(metroSlug).path;
  }

  // 3. Venue schedules (/venues/<venue-slug>/)
  const venueMap = new Map();
  for (const s of routedShows) {
    if (!venueMap.has(s.venueSlug)) {
      venueMap.set(s.venueSlug, {
        slug: s.venueSlug,
        path: s.venuePath,
        name: s.venue.name,
        area: s.venue.area,
        neighborhood: s.venue.neighborhood,
        city: s.venue.city,
        metro: getMetro(s.venue.metro),
        areaHubPath: s.areaHubPath,
        sampleVenue: s.venue,
        shows: [],
      });
    }
    const v = venueMap.get(s.venueSlug);
    v.shows.push(s);
    // Prefer a sample venue record that has a verified public street address
    if (s.venue.addressVisibility === 'public' && s.venue.address && !v.sampleVenue.address) {
      v.sampleVenue = s.venue;
    }
  }
  const venues = [...venueMap.values()].sort(
    (a, b) => b.shows.length - a.shows.length || metroRank(a.metro.id) - metroRank(b.metro.id) || a.name.localeCompare(b.name),
  );

  // 4. Genre clusters (/genres/<genre-slug>/)
  const genreMap = new Map();
  for (const s of routedShows) {
    for (const g of s.genres || []) {
      const gSlug = slugify(g, 40);
      if (!genreMap.has(gSlug)) {
        genreMap.set(gSlug, {
          slug: gSlug,
          path: `/genres/${gSlug}/`,
          name: g,
          shows: [],
        });
      }
      genreMap.get(gSlug).shows.push(s);
    }
  }
  const genres = [...genreMap.values()].sort(
    (a, b) => b.shows.length - a.shows.length || a.name.localeCompare(b.name),
  );

  return { weekendHubs, areaHubs, venues, genres, homeMetros, homeShows, metroPayloads };
}

/** Build the complete static site into `outDir`. */
export async function buildSite({
  outDir = path.resolve(process.cwd(), 'dist'),
  staticDir = path.resolve(process.cwd(), 'static'),
  siteUrl: rawSiteUrl = process.env.SITE_URL || DEFAULT_SITE_URL,
  googleSiteVerification = process.env.GOOGLE_SITE_VERIFICATION || '',
  metros = DEFAULT_METROS,
  windowDays = DEFAULT_WINDOW_DAYS,
  mock = false,
  customData = null,
  now = new Date(),
  log = console,
} = {}) {
  const { siteUrl, basePath } = parseSiteUrl(rawSiteUrl);
  const generatedDate = now.toISOString().slice(0, 10);

  // Clean output directory for a reproducible build
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  // Copy any user-supplied passthrough files (e.g., static/.well-known/assetlinks.json or googleXXXX.html)
  if (staticDir && fs.existsSync(staticDir)) {
    fs.cpSync(staticDir, outDir, { recursive: true });
  }

  // Load shows from customData, mock generator, or live Supabase + setnik-listings
  let dataset;
  if (customData) {
    dataset = {
      shows: combineAndFilterShows(customData.shows || [], { now, windowDays }),
      flags: customData.flags || { jambaseEnabled: true, deezerEnabled: true },
      attribution: customData.attribution || [],
      warnings: customData.warnings || [],
    };
  } else if (mock) {
    const sample = buildSampleData(now);
    dataset = {
      ...sample,
      shows: combineAndFilterShows(sample.shows, { now, windowDays }),
    };
  } else {
    dataset = await fetchLiveListings({ metros, windowDays, now, log });
  }

  const routedShows = assignRoutes(dataset.shows);
  const { weekendHubs, areaHubs, venues, genres, homeMetros, homeShows, metroPayloads } = buildCollections(routedShows, now);

  const ctx = {
    siteUrl,
    basePath,
    generatedDate,
    googleSiteVerification: googleSiteVerification.trim(),
    flags: dataset.flags,
    attribution: dataset.attribution,
    primaryWeekendHub: weekendHubs[0] || null,
  };

  // Write static assets & complete per-metro JSON indices for zero-truncation homepage filtering
  writeOut(outDir, 'assets/styles.css', buildStylesCss());
  writeOut(outDir, 'assets/player.js', buildPlayerJs());
  writeOut(outDir, 'assets/favicon.svg', buildFaviconSvg());
  writeOut(outDir, '.nojekyll', '');
  for (const [mId, payload] of metroPayloads.entries()) {
    writeOut(outDir, path.join('data', `${mId}.json`), JSON.stringify(payload));
  }

  const sitemapEntries = [];
  const registerUrl = (relPath, priority, changefreq = 'daily') => {
    sitemapEntries.push({
      loc: canonicalUrl(siteUrl, relPath),
      lastmod: generatedDate,
      changefreq,
      priority,
    });
  };

  // 1. Homepage
  writeOut(
    outDir,
    'index.html',
    renderHomePage({ shows: routedShows, homeShows, homeMetros, weekendHubs, areaHubs, venues, genres }, ctx),
  );
  registerUrl('/', 1.0, 'daily');

  // 2. Weekend hub pages
  for (const hub of weekendHubs) {
    const relatedAreas = areaHubs.filter((a) => a.metro.id === hub.metro.id);
    writeOut(outDir, path.join(hub.slug, 'index.html'), renderWeekendHubPage(hub, relatedAreas, ctx));
    registerUrl(hub.path, PRIORITY_METROS.includes(hub.metro.id) ? 0.9 : 0.8, 'daily');
  }

  // 3. City / Borough / Neighborhood hub pages
  for (const hub of areaHubs) {
    const siblings = areaHubs.filter((a) => a.slug !== hub.slug && a.metro.id === hub.metro.id).slice(0, 10);
    const hubVenueSlugs = new Set(hub.shows.map((s) => s.venueSlug));
    const hubVenues = venues.filter((v) => hubVenueSlugs.has(v.slug)).slice(0, 8);
    writeOut(outDir, path.join(hub.slug, 'index.html'), renderAreaHubPage(hub, siblings, hubVenues, ctx));
    registerUrl(hub.path, PRIORITY_METROS.includes(hub.metro.id) ? 0.8 : 0.7, 'daily');
  }

  // 4. Venue directory & individual venue schedule pages
  writeOut(outDir, path.join('venues', 'index.html'), renderVenuesIndexPage(venues, ctx));
  registerUrl('/venues/', 0.7, 'daily');
  for (const v of venues) {
    writeOut(outDir, path.join('venues', v.slug, 'index.html'), renderVenuePage(v, ctx));
    registerUrl(v.path, 0.7, 'daily');
  }

  // 5. Genre directory & individual genre hub pages
  writeOut(outDir, path.join('genres', 'index.html'), renderGenresIndexPage(genres, ctx));
  registerUrl('/genres/', 0.7, 'daily');
  for (const g of genres) {
    writeOut(outDir, path.join('genres', g.slug, 'index.html'), renderGenrePage(g, genres, ctx));
    registerUrl(g.path, 0.7, 'daily');
  }

  // 6. Individual Show Leaf Pages (with gated MusicEvent JSON-LD)
  let musicEventSchemaCount = 0;
  let skippedSchemaCount = 0;
  for (const show of routedShows) {
    const showDate = parseWallClock(show.startsAt)?.date;
    const sameVenueShows = routedShows
      .filter((other) => other.slug !== show.slug && other.venueSlug === show.venueSlug)
      .slice(0, 5);
    const sameNightShows = routedShows
      .filter((other) => other.slug !== show.slug && other.venue.metro === show.venue.metro && parseWallClock(other.startsAt)?.date === showDate)
      .slice(0, 5);

    const rendered = renderShowLeafPage(show, { sameVenueShows, sameNightShows }, ctx);
    if (rendered.hasMusicEventLd) musicEventSchemaCount++;
    else skippedSchemaCount++;

    writeOut(outDir, path.join('shows', show.slug, 'index.html'), rendered.html);
    registerUrl(show.pagePath, PRIORITY_METROS.includes(show.venue.metro) ? 0.8 : 0.7, 'daily');
  }

  // 7. 404 Page (excluded from sitemaps)
  writeOut(outDir, '404.html', renderNotFoundPage(ctx));

  // 8. robots.txt, sitemap.xml, sitemap.txt
  writeOut(outDir, 'robots.txt', buildRobotsTxt(siteUrl));
  writeOut(outDir, 'sitemap.xml', buildSitemapXml(sitemapEntries));
  writeOut(outDir, 'sitemap.txt', buildSitemapTxt(sitemapEntries));

  const summary = {
    outDir,
    siteUrl,
    basePath,
    generatedDate,
    totalShows: routedShows.length,
    musicEventSchemaCount,
    skippedSchemaCount,
    weekendHubCount: weekendHubs.length,
    areaHubCount: areaHubs.length,
    venueCount: venues.length,
    genreCount: genres.length,
    totalUrlsInSitemap: sitemapEntries.length,
    warnings: dataset.warnings,
    flags: dataset.flags,
  };

  log.info?.(
    `[setnik-web] Built ${summary.totalUrlsInSitemap} pages into ${outDir} ` +
    `(${summary.totalShows} shows: ${summary.musicEventSchemaCount} with MusicEvent JSON-LD, ${summary.skippedSchemaCount} without street address; ` +
    `${summary.weekendHubCount} weekend hubs, ${summary.areaHubCount} area hubs, ${summary.venueCount} venues, ${summary.genreCount} genres).`,
  );

  return summary;
}

function parseCliArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mock' || a === '--sample') opts.mock = true;
    else if (a === '--out' && argv[i + 1]) opts.outDir = path.resolve(argv[++i]);
    else if (a === '--site-url' && argv[i + 1]) opts.siteUrl = argv[++i];
    else if (a === '--window-days' && argv[i + 1]) opts.windowDays = Number(argv[++i]);
    else if (a === '--now' && argv[i + 1]) opts.now = new Date(argv[++i]);
    else if (a === '--metros' && argv[i + 1]) {
      const val = argv[++i].trim();
      opts.metros = val.toLowerCase() === 'all'
        ? METROS.map((m) => m.id)
        : val.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
  }
  if (!opts.metros && process.env.SETNIK_METROS) {
    const val = process.env.SETNIK_METROS.trim();
    opts.metros = val.toLowerCase() === 'all'
      ? METROS.map((m) => m.id)
      : val.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return opts;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  buildSite(parseCliArgs(process.argv.slice(2))).catch((err) => {
    console.error('[setnik-web] Fatal build error:', err);
    process.exit(1);
  });
}
