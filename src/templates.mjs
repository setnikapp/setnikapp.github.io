/**
 * HTML page templates for Setnik Web (Home, Hyperlocal Hubs, Venues, Genres, Show Leaf Pages, 404).
 *
 * SEO invariants enforced here:
 *  - Every page has exactly one <h1>, descriptive <title>, meta description, canonical <link>, and mobile viewport.
 *  - MusicEvent JSON-LD is ONLY emitted on individual show leaf pages (never on hubs), and ONLY when valid.
 *  - Every field present in MusicEvent JSON-LD is also visibly rendered in the leaf page <body>.
 *  - Every primary CTA uses playStoreUrl(pageSlug) with exact UTM referrer encoding.
 */
import {
  APP_NAME,
  APP_TAGLINE,
  DMCA_URL,
  GENRE_GROUPS,
  PRIMARY_CTA_LABEL,
  PRIORITY_METROS,
  PRIVACY_URL,
  SUPPORT_EMAIL,
  TERMS_URL,
  getMetro,
} from './config.mjs';
import {
  canonicalUrl,
  formatDayNum,
  formatLongDate,
  formatMonthShort,
  formatPrice,
  formatShortDate,
  formatShowTime,
  formatWeekdayShort,
  href,
  html,
  parseWallClock,
  playStoreUrl,
  raw,
  safeJsonLd,
  safeWebUrl,
  slugify,
} from './html.mjs';
import {
  buildBreadcrumbJsonLd,
  buildEventName,
  buildMusicEventJsonLd,
  buildShowDescription,
  buildWebSiteJsonLd,
  formatPostalAddress,
  parsePostalAddress,
} from './schema.mjs';

/**
 * Official SETNIK. wordmark PNG (900x195, exact 60:13 aspect ratio) with the
 * LED VU-meter "I" between N and K and matching Clip Red period.
 */
function wordmarkImg(basePath) {
  return html`<img class="brand-wordmark" src="${href(basePath, '/assets/wordmark.png')}" alt="SETNIK." width="120" height="26" decoding="async">`;
}

function playArrowIcon() {
  return raw(`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14Z"/></svg>`);
}

function googlePlayBadge(url, id = 'play-badge-home') {
  return html`<a class="play-badge" id="${id}" href="${url}" rel="noopener" aria-label="Get Setnik on Google Play">
    <svg class="play-badge-icon" width="22" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3.6 2.3C3.2 2.7 3 3.3 3 4.1V19.9C3 20.7 3.2 21.3 3.6 21.7L3.7 21.8L12.7 12.8V12.6V12.4L3.7 3.4L3.6 2.3Z" fill="#4285F4"/>
      <path d="M15.7 15.8L12.7 12.8V12.6V12.4L15.7 9.4L15.8 9.5L19.4 11.5C20.4 12.1 20.4 13.1 19.4 13.7L15.8 15.7L15.7 15.8Z" fill="#FBBC04"/>
      <path d="M15.8 15.7L12.7 12.6L3.6 21.7C3.9 22.1 4.5 22.1 5.2 21.7L15.8 15.7Z" fill="#EA4335"/>
      <path d="M15.8 9.5L5.2 3.5C4.5 3.1 3.9 3.1 3.6 3.5L12.7 12.6L15.8 9.5Z" fill="#34A853"/>
    </svg>
    <span class="play-badge-copy">
      <span class="play-badge-sub">GET IT ON</span>
      <span class="play-badge-main">Google Play</span>
    </span>
  </a>`;
}

function layout({
  title,
  description,
  canonicalPath,
  pageSlug,
  ctx,
  jsonLdBlocks = [],
  activeNav = '',
  noindex = false,
  ogImage = null,
  ogImageAlt = null,
  body,
}) {
  const { siteUrl, basePath, attribution, flags, generatedDate, googleSiteVerification } = ctx;
  const fullCanonical = canonicalUrl(siteUrl, canonicalPath);
  const ctaUrl = playStoreUrl(pageSlug);
  const defaultOgImage = canonicalUrl(siteUrl, '/assets/og-card.png');
  const resolvedOgImage = ogImage || defaultOgImage;
  const isDefaultOgImage = resolvedOgImage === defaultOgImage;
  const resolvedOgAlt = ogImageAlt || `${APP_NAME} — ${APP_TAGLINE} Local live music & 30-second band previews.`;

  const ldScripts = jsonLdBlocks
    .filter(Boolean)
    .map((block) => html`<script type="application/ld+json">${safeJsonLd(block)}</script>`);

  const attrLines = [...(attribution || [])];
  if (flags?.deezerEnabled && !attrLines.some((a) => /deezer/i.test(a))) {
    attrLines.push('30-second audio previews via Deezer.');
  }

  return `<!doctype html>\n${html`<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  ${googleSiteVerification ? html`<meta name="google-site-verification" content="${googleSiteVerification}">` : ''}
  ${noindex ? raw('<meta name="robots" content="noindex, follow">') : html`<link rel="canonical" href="${fullCanonical}">`}
  <meta name="theme-color" content="#F3EAD3">
  <meta property="og:site_name" content="${APP_NAME}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${fullCanonical}">
  <meta property="og:image" content="${resolvedOgImage}">
  ${isDefaultOgImage ? raw('<meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="630">') : ''}
  <meta property="og:image:alt" content="${resolvedOgAlt}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${resolvedOgImage}">
  <link rel="icon" type="image/svg+xml" href="${href(basePath, '/assets/favicon.svg')}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${href(basePath, '/assets/styles.css')}">
  ${ldScripts}
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to concert listings</a>
  <header class="site-header">
    <div class="wrap header-inner">
      <div class="header-brand">
        <a class="brand-link" href="${href(basePath, '/')}" aria-label="${APP_NAME} — ${APP_TAGLINE}">
          ${wordmarkImg(basePath)}
        </a>
        <p class="header-tagline">${APP_TAGLINE} Local concerts with 30-second band previews.</p>
      </div>
      ${googlePlayBadge(ctaUrl, 'header-play-badge')}
    </div>
  </header>

  <main id="main-content">
    <div class="wrap">
      ${body}
    </div>
  </main>

  <footer class="site-footer">
    <div class="wrap footer-grid">
      <div>
        <strong>${APP_NAME}</strong> — ${APP_TAGLINE} Free Android app for live-music discovery.
        <div class="footer-links">
          <a href="${href(basePath, '/')}">All Hubs</a>
          <a href="${href(basePath, '/venues/')}">Venues</a>
          <a href="${href(basePath, '/genres/')}">Genres</a>
          <a href="${PRIVACY_URL}" rel="noopener">Privacy</a>
          <a href="${TERMS_URL}" rel="noopener">Terms</a>
          <a href="${DMCA_URL}" rel="noopener">DMCA</a>
          <a href="mailto:${SUPPORT_EMAIL}">Contact</a>
        </div>
      </div>
      <div>
        <div>Updated daily · Last build ${generatedDate}</div>
        ${attrLines.length ? html`<div>${attrLines.join(' ')}</div>` : ''}
      </div>
    </div>
  </footer>

  <aside class="android-sticky-bar" data-android-bar hidden aria-label="Download Setnik on Android">
    <div class="android-bar-inner">
      <img class="android-bar-icon" src="${href(basePath, '/assets/favicon.svg')}" alt="" width="34" height="34" aria-hidden="true">
      <div class="android-bar-copy">
        <strong>Setnik for Android</strong>
        <span>30s band previews &amp; one-tap calendar saves</span>
      </div>
      <a class="android-bar-cta" id="android-bar-cta-${slugify(pageSlug, 36)}" href="${ctaUrl}" rel="noopener">Get App</a>
      <button type="button" class="android-bar-close" data-android-bar-close aria-label="Dismiss Android app banner">×</button>
    </div>
  </aside>

  <script src="${href(basePath, '/assets/player.js')}" defer></script>
</body>
</html>`.value}`;
}

function renderBreadcrumbs(items, basePath) {
  if (!items || items.length === 0) return '';
  return html`<nav aria-label="Breadcrumb">
    <ol class="breadcrumbs">
      ${items.map((item, i) => i === items.length - 1
        ? html`<li aria-current="page">${item.name}</li>`
        : html`<li><a href="${href(basePath, item.path)}">${item.name}</a></li>`)}
    </ol>
  </nav>`;
}

function renderCtaBanner(pageSlug, heading = 'Hear every band before you pick tonight’s show.') {
  const url = playStoreUrl(pageSlug);
  return html`<aside class="cta-banner" aria-label="Download Setnik on Google Play">
    <div class="cta-banner-copy">
      <span class="kicker">Free Android App</span>
      <h2>${heading}</h2>
      <p>Swipe tonight’s and this week’s local shows, hear a 30-second audio preview on every card, filter by genre or price, and save picks to your calendar in one tap.</p>
    </div>
    <div>
      <a class="btn-primary" id="cta-play-${slugify(pageSlug, 40)}" href="${url}" rel="noopener">
        ${playArrowIcon()} ${PRIMARY_CTA_LABEL}
      </a>
    </div>
  </aside>`;
}

/** Group chronologically sorted shows by local YYYY-MM-DD date string. */
function groupByDate(shows) {
  const map = new Map();
  for (const s of shows) {
    const wall = parseWallClock(s.startsAt);
    const key = wall ? wall.date : 'unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return [...map.entries()];
}

function renderShowCard(show, ctx) {
  const { basePath } = ctx;
  const wall = parseWallClock(show.startsAt);
  const ymd = wall ? wall.date : '';
  const eventName = buildEventName(show);
  const acts = [...(show.acts || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const supports = show.title
    ? acts.map((a) => a.name)
    : acts.slice(1).map((a) => a.name);
  const priceText = formatPrice(show.price);
  const timeText = formatShowTime(show);

  return html`<li
    class="show-card"
    data-show-card
    data-metro="${show.venue.metro || 'nyc'}"
    data-date="${ymd}"
    data-tonight="${show.isTonight ? '1' : '0'}"
    data-tomorrow="${show.isTomorrow ? '1' : '0'}"
    data-weekend="${show.isWeekend ? '1' : '0'}"
    data-this-week="${show.isThisWeek ? '1' : '0'}"
    data-next-week="${show.isNextWeek ? '1' : '0'}"
    data-genres="${(show.genres || []).map((g) => slugify(g)).join('|')}"
    data-free="${show.price?.isFree ? '1' : '0'}"
    data-price="${typeof show.price?.min === 'number' ? show.price.min : ''}"
  >
    <div class="date-stamp" aria-label="${ymd ? formatShortDate(ymd) : 'Date TBA'}">
      <span class="date-stamp-month">${ymd ? formatMonthShort(ymd) : ''}</span>
      <span class="date-stamp-day">${ymd ? formatDayNum(ymd) : '—'}</span>
      <span class="date-stamp-dow">${ymd ? formatWeekdayShort(ymd) : ''}</span>
    </div>
    <div class="show-card-main">
      <a class="show-card-title" href="${href(basePath, show.pagePath)}">
        ${show.status === 'cancelled' ? html`<span class="badge badge-cancelled">Cancelled</span>` : ''}
        ${show.status === 'moved' ? html`<span class="badge badge-moved">Rescheduled</span>` : ''}
        ${eventName}
      </a>
      ${supports.length ? html`<p class="show-card-supports">${show.title ? 'Featuring' : 'With'} ${supports.join(', ')}</p>` : ''}
      <div class="show-card-meta">
        <a href="${href(basePath, show.venuePath)}">${show.venue.name}</a>
        <span>${show.venue.neighborhood || show.venue.area}</span>
        <span>${timeText}</span>
      </div>
      ${show.genres && show.genres.length ? html`<div class="tag-row">
        ${show.genres.map((g) => html`<a class="tag" href="${href(basePath, `/genres/${slugify(g)}/`)}">${g}</a>`)}
      </div>` : ''}
    </div>
    <div class="show-card-action">
      ${priceText
        ? html`<span class="price-chip">${show.price?.isFree ? html`<span class="badge badge-free">Free</span>` : priceText}</span>`
        : ''}
      <a class="details-link" href="${href(basePath, show.pagePath)}">Lineup &amp; preview →</a>
    </div>
  </li>`;
}

function renderFilterBar(shows) {
  if (!shows || shows.length < 2) return '';
  const genreCounts = new Map();
  let hasFree = false;
  let hasUnder20 = false;
  for (const s of shows) {
    if (s.price?.isFree) hasFree = true;
    if (s.price?.isFree || (typeof s.price?.min === 'number' && s.price.min > 0 && s.price.min <= 20)) hasUnder20 = true;
    for (const g of s.genres || []) {
      genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
    }
  }
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6);

  return html`<div class="filter-bar" data-filter-bar role="region" aria-label="Filter shows">
    <button type="button" class="filter-pill" data-filter-kind="genre" data-filter-value="all" aria-pressed="true">All (${shows.length})</button>
    ${hasFree ? html`<button type="button" class="filter-pill" data-filter-kind="price" data-filter-value="free" aria-pressed="false">Free</button>` : ''}
    ${hasUnder20 ? html`<button type="button" class="filter-pill" data-filter-kind="price" data-filter-value="under20" aria-pressed="false">Under $20</button>` : ''}
    ${topGenres.map(([g, count]) => html`<button type="button" class="filter-pill" data-filter-kind="genre" data-filter-value="${slugify(g)}" aria-pressed="false">${g} (${count})</button>`)}
    <span class="filter-status" data-filter-status>${shows.length} ${shows.length === 1 ? 'show' : 'shows'}</span>
  </div>`;
}

function renderDateGroupedShows(shows, ctx, emptyMessage = 'No upcoming shows are listed in this window right now.') {
  if (!shows || shows.length === 0) {
    return html`<div class="empty-state">
      <p>${emptyMessage}</p>
      <p><a href="${href(ctx.basePath, '/')}">Browse all local hubs</a> or check the Setnik Android app for live community flyers.</p>
    </div>`;
  }
  const groups = groupByDate(shows);
  return html`${groups.map(([ymd, items]) => html`<section class="day-group" data-day-group>
    <h2 class="day-heading">
      <span>${ymd !== 'unknown' ? formatLongDate(ymd) : 'Upcoming'}</span>
      <span class="day-count" data-day-count>${items.length} ${items.length === 1 ? 'show' : 'shows'}</span>
    </h2>
    <ul class="show-list">
      ${items.map((s) => renderShowCard(s, ctx))}
    </ul>
  </section>`)}`;
}

/** 1. Homepage (/) — Compact logo + tagline + Google Play badge, then immediate City & Date filtered listings */
export function renderHomePage({ shows, homeShows = shows, homeMetros = [], weekendHubs, areaHubs, venues, genres }, ctx) {
  const { siteUrl, basePath } = ctx;
  const pageSlug = 'home';
  const defaultMetro = homeMetros[0] || null;
  const listings = homeShows && homeShows.length ? homeShows : shows.slice(0, 25);
  const homeAreaHubs = areaHubs.filter((h) => h.priority <= 2 || (h.priority === 3 && h.metro.id === 'nyc')).slice(0, 16);
  const topVenues = venues.slice(0, 10);
  const topGenres = genres.slice(0, 16);
  const explorerGenres = genres.map((g) => ({ name: g.name, slug: g.slug }));

  return layout({
    title: `${APP_NAME} — Local Live Music, Indie Concerts & Band Previews`,
    description: `Discover upcoming local concerts and live music near you across major US & Canadian cities. Browse shows this weekend, this week, and next week, hear 30-second band previews, and swipe bills on Setnik.`,
    canonicalPath: '/',
    pageSlug,
    ctx,
    activeNav: 'home',
    jsonLdBlocks: [buildWebSiteJsonLd(siteUrl)],
    body: html`
      <h1 class="sr-only">${APP_NAME} — Local Concerts &amp; Live Music</h1>
      <section
        class="home-explorer"
        data-home-explorer
        data-base-path="${basePath}"
        data-metros="${homeMetros.map((m) => m.id).join(',')}"
        data-default-metro="${defaultMetro ? defaultMetro.id : 'all'}"
        data-default-when="this-week"
      >
        ${homeMetros.length ? html`<div class="explorer-controls" role="region" aria-label="Filter upcoming shows by city, date, and genre">
          <div class="filter-row" role="group" aria-label="City">
            <span class="filter-label">City</span>
            <div class="filter-pills">
              ${homeMetros.map((m, idx) => html`<button
                type="button"
                class="filter-pill"
                id="city-btn-${m.id}"
                data-city-btn="${m.id}"
                data-metro-slug="${m.slug}"
                data-metro-name="${m.shortName}"
                data-metro-total="${m.totalCount}"
                data-hub-href="${href(basePath, m.hubPath)}"
                data-weekend-href="${href(basePath, m.weekendPath)}"
                aria-pressed="${idx === 0 ? 'true' : 'false'}"
              >${m.shortName}</button>`)}
              ${homeMetros.length > 1 ? html`<button
                type="button"
                class="filter-pill"
                id="city-btn-all"
                data-city-btn="all"
                data-metro-slug="all"
                data-metro-name="all cities"
                data-metro-total="${shows.length}"
                data-hub-href="${href(basePath, '/venues/')}"
                data-weekend-href="${href(basePath, weekendHubs[0]?.path || '/')}"
                aria-pressed="false"
              >All</button>` : ''}
            </div>
          </div>

          <div class="filter-row filter-row-date" role="group" aria-label="Date">
            <span class="filter-label">When</span>
            <div class="filter-pills">
              <button type="button" class="filter-pill" id="when-btn-tonight" data-when-btn="tonight" aria-pressed="false">Tonight</button>
              <button type="button" class="filter-pill" id="when-btn-tomorrow" data-when-btn="tomorrow" aria-pressed="false">Tomorrow Night</button>
              <button type="button" class="filter-pill" id="when-btn-weekend" data-when-btn="weekend" aria-pressed="false">This Weekend</button>
              <button type="button" class="filter-pill" id="when-btn-this-week" data-when-btn="this-week" aria-pressed="true">This Week</button>
              <button type="button" class="filter-pill" id="when-btn-next-week" data-when-btn="next-week" aria-pressed="false">Next Week</button>
              <button type="button" class="filter-pill" id="when-btn-custom" data-when-btn="custom" aria-pressed="false">Custom Dates</button>
              <button type="button" class="filter-pill" id="when-btn-all" data-when-btn="all" aria-pressed="false">All</button>
            </div>
            <div class="explorer-meta">
              <span class="filter-status" data-explorer-status></span>
              <button type="button" class="copy-link-btn" data-copy-filter-link aria-label="Copy shareable link to these filters">Share link</button>
              ${defaultMetro ? html`<a class="explorer-more-link" data-explorer-more href="${href(basePath, defaultMetro.hubPath)}">Full ${defaultMetro.shortName} calendar (${defaultMetro.totalCount}) →</a>` : ''}
            </div>
          </div>

          <div class="custom-dates-bar" data-custom-dates hidden role="group" aria-label="Custom date range">
            <label class="date-field">
              <span>From</span>
              <input type="date" class="date-input" id="date-from" data-date-from value="${ctx.generatedDate}" min="${ctx.generatedDate}">
            </label>
            <label class="date-field">
              <span>To</span>
              <input type="date" class="date-input" id="date-to" data-date-to value="${ctx.generatedDate}" min="${ctx.generatedDate}">
            </label>
          </div>

          ${explorerGenres.length ? html`<div class="filter-row" role="group" aria-label="Genre">
            <span class="filter-label">Genre</span>
            <div class="filter-pills">
              <button type="button" class="filter-pill" id="genre-btn-all" data-genre-btn="all" data-genre-label="All" aria-pressed="true">All</button>
              ${explorerGenres.map((g) => html`<button
                type="button"
                class="filter-pill"
                id="genre-btn-${g.slug}"
                data-genre-btn="${g.slug}"
                data-genre-label="${g.name}"
                aria-pressed="false"
              >${g.name}</button>`)}
            </div>
          </div>` : ''}
        </div>` : ''}

        <div data-explorer-list>
          ${renderDateGroupedShows(listings, ctx, 'Fresh listings sync daily at 6:00 AM EST. Check back shortly or open Setnik on Android.')}
        </div>
        <div class="load-more-wrap" data-explorer-load-more hidden>
          <button type="button" class="btn-secondary" data-load-more-btn>Show more shows</button>
        </div>
        <div class="empty-state" data-explorer-empty hidden>
          <p>No shows match those filters.</p>
          <p><button type="button" class="btn-secondary" data-explorer-reset>Show all upcoming in this city</button></p>
        </div>
      </section>

      ${homeAreaHubs.length ? html`<section class="section">
        <div class="section-head">
          <h2>Cities &amp; Neighborhoods</h2>
        </div>
        <div class="directory-chips">
          ${homeAreaHubs.map((hub) => html`<a class="dir-chip" href="${href(basePath, hub.path)}">${hub.label} <span>${hub.shows.length}</span></a>`)}
        </div>
      </section>` : ''}

      ${topVenues.length ? html`<section class="section">
        <div class="section-head">
          <h2>Popular Venues</h2>
          <a class="section-more" href="${href(basePath, '/venues/')}">All ${venues.length} venues →</a>
        </div>
        <div class="directory-chips">
          ${topVenues.map((v) => html`<a class="dir-chip" href="${href(basePath, v.path)}">${v.name} <span>${v.shows.length}</span></a>`)}
        </div>
      </section>` : ''}

      ${topGenres.length ? html`<section class="section">
        <div class="section-head">
          <h2>Browse by Genre</h2>
          <a class="section-more" href="${href(basePath, '/genres/')}">All genres →</a>
        </div>
        <div class="tag-row">
          ${topGenres.map((g) => html`<a class="tag" href="${href(basePath, g.path)}">${g.name} (${g.shows.length})</a>`)}
        </div>
      </section>` : ''}

      ${renderCtaBanner(pageSlug)}
    `,
  });
}

/** 2. Weekend Hub Page (e.g. /nyc-shows-this-weekend/) — NO Event JSON-LD! */
export function renderWeekendHubPage(hub, relatedAreaHubs, ctx) {
  const { siteUrl, basePath } = ctx;
  const crumbs = [
    { name: 'Home', path: '/', url: canonicalUrl(siteUrl, '/') },
    { name: `${hub.metro.shortName} Live Music`, path: `/${hub.metro.slug}-live-music/`, url: canonicalUrl(siteUrl, `/${hub.metro.slug}-live-music/`) },
    { name: hub.shortTitle, path: hub.path, url: canonicalUrl(siteUrl, hub.path) },
  ];

  return layout({
    title: `${hub.title} (${hub.dateRangeLabel}) | ${APP_NAME}`,
    description: `Find ${hub.shows.length} upcoming live music shows in ${hub.metro.name} this weekend (${hub.dateRangeLabel}). Sample bands and swipe local bills on ${APP_NAME}.`,
    canonicalPath: hub.path,
    pageSlug: hub.slug,
    ctx,
    activeNav: 'weekend',
    jsonLdBlocks: [buildBreadcrumbJsonLd(crumbs)],
    body: html`
      ${renderBreadcrumbs(crumbs, basePath)}
      <section class="hero">
        <span class="kicker">Weekend Live Music · ${hub.dateRangeLabel}</span>
        <h1>${hub.title}</h1>
        <p class="lead">${hub.shows.length} upcoming ${hub.shows.length === 1 ? 'concert' : 'concerts'} across ${hub.metro.name} for ${hub.dateRangeLabel}. Tap any show for full lineup details and 30-second band previews.</p>
        <div class="leaf-actions">
          <a class="btn-primary" id="hub-cta-${hub.slug}" href="${playStoreUrl(hub.slug)}" rel="noopener">
            ${playArrowIcon()} ${PRIMARY_CTA_LABEL}
          </a>
          <a class="btn-secondary" href="${href(basePath, `/${hub.metro.slug}-live-music/`)}">Full 30-day ${hub.metro.shortName} calendar</a>
        </div>
      </section>

      ${renderFilterBar(hub.shows)}
      ${renderDateGroupedShows(hub.shows, ctx, `No ${hub.metro.shortName} shows are posted for this weekend yet. Check the full 30-day calendar or open Setnik for fresh flyer uploads.`)}

      ${relatedAreaHubs.length ? html`<section class="section">
        <div class="section-head">
          <h2>Explore ${hub.metro.shortName} Areas</h2>
        </div>
        <div class="tag-row">
          ${relatedAreaHubs.map((a) => html`<a class="tag" href="${href(basePath, a.path)}">${a.label} (${a.shows.length})</a>`)}
        </div>
      </section>` : ''}

      ${renderCtaBanner(hub.slug, `Swipe ${hub.metro.shortName} shows this weekend on Setnik.`)}
    `,
  });
}

/** 3. City / Borough / Neighborhood Hub Page (e.g. /brooklyn-live-music/, /jersey-city-live-music/) — NO Event JSON-LD! */
export function renderAreaHubPage(hub, siblingHubs, topVenues, ctx, metroGenres = []) {
  const { siteUrl, basePath } = ctx;
  const crumbs = [
    { name: 'Home', path: '/', url: canonicalUrl(siteUrl, '/') },
    ...(hub.parentMetroPath && hub.parentMetroPath !== hub.path
      ? [{ name: `${hub.metro.shortName} Live Music`, path: hub.parentMetroPath, url: canonicalUrl(siteUrl, hub.parentMetroPath) }]
      : []),
    { name: `${hub.label} Live Music`, path: hub.path, url: canonicalUrl(siteUrl, hub.path) },
  ];

  return layout({
    title: `${hub.label} Live Music & Upcoming Concerts (Next 30 Days) | ${APP_NAME}`,
    description: `Browse ${hub.shows.length} upcoming live music shows and indie concerts in ${hub.label} over the next 30 days. Hear band previews and discover local venues on ${APP_NAME}.`,
    canonicalPath: hub.path,
    pageSlug: hub.slug,
    ctx,
    jsonLdBlocks: [buildBreadcrumbJsonLd(crumbs)],
    body: html`
      ${renderBreadcrumbs(crumbs, basePath)}
      <section class="hero">
        <span class="kicker">Hyperlocal Concert Guide · Next 30 Days</span>
        <h1>${hub.label} Live Music</h1>
        <p class="lead">${hub.shows.length} upcoming ${hub.shows.length === 1 ? 'show' : 'shows'} in ${hub.label}${hub.metro && hub.label !== hub.metro.name ? ` (${hub.metro.name} area)` : ''}. Updated daily with club calendars, venue pages, and local bills.</p>
        <div class="leaf-actions">
          <a class="btn-primary" id="hub-cta-${hub.slug}" href="${playStoreUrl(hub.slug)}" rel="noopener">
            ${playArrowIcon()} ${PRIMARY_CTA_LABEL}
          </a>
          ${hub.weekendPath ? html`<a class="btn-secondary" href="${href(basePath, hub.weekendPath)}">${hub.metro.shortName} Shows This Weekend</a>` : ''}
        </div>
      </section>

      ${renderFilterBar(hub.shows)}
      ${renderDateGroupedShows(hub.shows, ctx, `No upcoming shows listed in ${hub.label} right now.`)}

      ${metroGenres.length ? html`<section class="section">
        <div class="section-head">
          <h2>Browse ${hub.metro.shortName} by Genre</h2>
        </div>
        <div class="tag-row">
          ${metroGenres.map((cg) => html`<a class="tag" href="${href(basePath, cg.path)}">${cg.genreName} (${cg.shows.length})</a>`)}
        </div>
      </section>` : ''}

      ${topVenues.length ? html`<section class="section">
        <div class="section-head">
          <h2>Venues in ${hub.label}</h2>
        </div>
        <div class="hub-grid">
          ${topVenues.map((v) => html`<a class="hub-card" href="${href(basePath, v.path)}">
            <div>
              <span class="hub-card-title">${v.name}</span>
              <div class="hub-card-meta">${v.shows.length} upcoming ${v.shows.length === 1 ? 'show' : 'shows'}</div>
            </div>
            <span class="hub-card-cta">See schedule →</span>
          </a>`)}
        </div>
      </section>` : ''}

      ${siblingHubs.length ? html`<section class="section">
        <div class="section-head">
          <h2>Nearby Live Music Hubs</h2>
        </div>
        <div class="tag-row">
          ${siblingHubs.map((s) => html`<a class="tag" href="${href(basePath, s.path)}">${s.label} (${s.shows.length})</a>`)}
        </div>
      </section>` : ''}

      ${renderCtaBanner(hub.slug, `Discover ${hub.label} bands with 30-second previews.`)}
    `,
  });
}

/** 4. Venue Schedule Hub Page (e.g. /venues/market-hotel/, /venues/gold-sounds/) — NO Event JSON-LD! */
export function renderVenuePage(venue, ctx) {
  const { siteUrl, basePath } = ctx;
  const postal = parsePostalAddress(venue.sampleVenue, venue.metro.id);
  const addressLine = postal
    ? formatPostalAddress(postal)
    : (venue.sampleVenue.addressVisibility !== 'public'
      ? `${venue.neighborhood || venue.area}, ${venue.city} (address on request)`
      : [venue.neighborhood, venue.city].filter(Boolean).join(' · '));

  const crumbs = [
    { name: 'Home', path: '/', url: canonicalUrl(siteUrl, '/') },
    { name: 'Venues', path: '/venues/', url: canonicalUrl(siteUrl, '/venues/') },
    { name: venue.name, path: venue.path, url: canonicalUrl(siteUrl, venue.path) },
  ];

  const mapsQuery = postal ? formatPostalAddress(postal) : `${venue.name}, ${venue.city}`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapsQuery)}`;

  return layout({
    title: `${venue.name} Upcoming Shows & Concert Calendar (${venue.area || venue.city}) | ${APP_NAME}`,
    description: `See ${venue.shows.length} upcoming concerts at ${venue.name} in ${venue.neighborhood || venue.area}. Check showtimes, full lineups, and preview bands on ${APP_NAME}.`,
    canonicalPath: venue.path,
    pageSlug: `venue-${venue.slug}`,
    ctx,
    activeNav: 'venues',
    jsonLdBlocks: [buildBreadcrumbJsonLd(crumbs)],
    body: html`
      ${renderBreadcrumbs(crumbs, basePath)}
      <section class="hero">
        <span class="kicker">Venue Calendar · ${venue.area || venue.metro.name}</span>
        <h1>${venue.name}</h1>
        <p class="lead">${addressLine} · ${venue.shows.length} upcoming ${venue.shows.length === 1 ? 'show' : 'shows'} over the next 30 days.</p>
        <div class="leaf-actions">
          <a class="btn-primary" id="venue-cta-${venue.slug}" href="${playStoreUrl(`venue-${venue.slug}`)}" rel="noopener">
            ${playArrowIcon()} ${PRIMARY_CTA_LABEL}
          </a>
          ${postal ? html`<a class="btn-secondary" href="${mapsUrl}" target="_blank" rel="noopener">Open in Google Maps</a>` : ''}
          ${venue.areaHubPath ? html`<a class="btn-secondary" href="${href(basePath, venue.areaHubPath)}">More in ${venue.area}</a>` : ''}
        </div>
      </section>

      ${renderFilterBar(venue.shows)}
      ${renderDateGroupedShows(venue.shows, ctx, `No upcoming shows are listed for ${venue.name} in the next 30 days.`)}
      ${renderCtaBanner(`venue-${venue.slug}`, `Preview every band playing ${venue.name} on Setnik.`)}
    `,
  });
}

/** 5. Venues Directory Page (/venues/) */
export function renderVenuesIndexPage(venues, ctx) {
  const { siteUrl, basePath } = ctx;
  const crumbs = [
    { name: 'Home', path: '/', url: canonicalUrl(siteUrl, '/') },
    { name: 'Venues', path: '/venues/', url: canonicalUrl(siteUrl, '/venues/') },
  ];

  // Group venues by area
  const byArea = new Map();
  for (const v of venues) {
    const key = v.area || v.metro.name;
    if (!byArea.has(key)) byArea.set(key, []);
    byArea.get(key).push(v);
  }

  return layout({
    title: `Local Live Music Venues & Concert Calendars | ${APP_NAME}`,
    description: `Browse upcoming 30-day concert schedules across ${venues.length} local live music venues on ${APP_NAME}.`,
    canonicalPath: '/venues/',
    pageSlug: 'venues',
    ctx,
    activeNav: 'venues',
    jsonLdBlocks: [buildBreadcrumbJsonLd(crumbs)],
    body: html`
      ${renderBreadcrumbs(crumbs, basePath)}
      <section class="hero">
        <span class="kicker">Venue Directory</span>
        <h1>Local Music Venues</h1>
        <p class="lead">${venues.length} active rooms with upcoming shows in the next 30 days. Pick a venue to view its full calendar and sample billed artists.</p>
      </section>

      ${venues.length === 0
        ? html`<div class="empty-state"><p>Venue schedules populate automatically with each daily listings refresh.</p></div>`
        : [...byArea.entries()].map(([area, list]) => html`<section class="section">
            <div class="section-head">
              <h2>${area}</h2>
              <span class="day-count">${list.length} ${list.length === 1 ? 'venue' : 'venues'}</span>
            </div>
            <div class="hub-grid">
              ${list.sort((a, b) => a.name.localeCompare(b.name)).map((v) => html`<a class="hub-card" href="${href(basePath, v.path)}">
                <div>
                  <span class="hub-card-title">${v.name}</span>
                  <div class="hub-card-meta">${v.neighborhood || v.city} · ${v.shows.length} ${v.shows.length === 1 ? 'show' : 'shows'}</div>
                </div>
                <span class="hub-card-cta">Venue schedule →</span>
              </a>`)}
            </div>
          </section>`)}

      ${renderCtaBanner('venues')}
    `,
  });
}

/** 6. Genre Cluster Hub Page (e.g. /genres/punk/, /genres/shoegaze/) — NO Event JSON-LD! */
export function renderGenrePage(genreObj, allGenres, ctx, cityGenreHubs = []) {
  const { siteUrl, basePath } = ctx;
  const crumbs = [
    { name: 'Home', path: '/', url: canonicalUrl(siteUrl, '/') },
    { name: 'Genres', path: '/genres/', url: canonicalUrl(siteUrl, '/genres/') },
    { name: genreObj.name, path: genreObj.path, url: canonicalUrl(siteUrl, genreObj.path) },
  ];

  return layout({
    title: `Upcoming ${genreObj.name} Concerts & Live Shows | ${APP_NAME}`,
    description: `Explore ${genreObj.shows.length} upcoming ${genreObj.name} concerts over the next 30 days. Listen to band previews and swipe local ${genreObj.name} bills on ${APP_NAME}.`,
    canonicalPath: genreObj.path,
    pageSlug: `genre-${genreObj.slug}`,
    ctx,
    activeNav: 'genres',
    jsonLdBlocks: [buildBreadcrumbJsonLd(crumbs)],
    body: html`
      ${renderBreadcrumbs(crumbs, basePath)}
      <section class="hero">
        <span class="kicker">Genre Guide · Next 30 Days</span>
        <h1>${genreObj.name} Concerts</h1>
        <p class="lead">${genreObj.shows.length} upcoming ${genreObj.name} ${genreObj.shows.length === 1 ? 'show' : 'shows'} across tracked local venues. Filter by genre inside the Setnik Android app to hear instant band previews.</p>
        <div class="leaf-actions">
          <a class="btn-primary" id="genre-cta-${genreObj.slug}" href="${playStoreUrl(`genre-${genreObj.slug}`)}" rel="noopener">
            ${playArrowIcon()} ${PRIMARY_CTA_LABEL}
          </a>
        </div>
      </section>

      ${cityGenreHubs.length ? html`<section class="section" style="margin-top:0;margin-bottom:22px">
        <div class="section-head">
          <h2>${genreObj.name} Shows by City</h2>
        </div>
        <div class="directory-chips">
          ${cityGenreHubs.map((cg) => html`<a class="dir-chip" href="${href(basePath, cg.path)}">${cg.metro.shortName} <span>${cg.shows.length}</span></a>`)}
        </div>
      </section>` : ''}

      ${renderDateGroupedShows(genreObj.shows, ctx, `No upcoming ${genreObj.name} shows are listed right now.`)}

      <section class="section">
        <div class="section-head">
          <h2>More Genres</h2>
        </div>
        <div class="tag-row">
          ${allGenres.filter((g) => g.slug !== genreObj.slug).map((g) => html`<a class="tag" href="${href(basePath, g.path)}">${g.name} (${g.shows.length})</a>`)}
        </div>
      </section>

      ${renderCtaBanner(`genre-${genreObj.slug}`, `Filter by ${genreObj.name} and preview every band on Setnik.`)}
    `,
  });
}

/** 6b. City × Genre Hub Page (e.g. /nyc/electronic-shows/, /la/indie-rock-shows/) — NO Event JSON-LD! */
export function renderCityGenrePage(hub, siblingGenresInCity = [], otherCitiesForGenre = [], ctx) {
  const { siteUrl, basePath } = ctx;
  const metroHubPath = `/${hub.metro.slug}-live-music/`;
  const genreHubPath = `/genres/${hub.genreSlug}/`;
  const crumbs = [
    { name: 'Home', path: '/', url: canonicalUrl(siteUrl, '/') },
    { name: `${hub.metro.shortName} Live Music`, path: metroHubPath, url: canonicalUrl(siteUrl, metroHubPath) },
    { name: `${hub.genreName} Shows`, path: hub.path, url: canonicalUrl(siteUrl, hub.path) },
  ];

  return layout({
    title: `${hub.metro.shortName} ${hub.genreName} Concerts & Live Shows (Next 30 Days) | ${APP_NAME}`,
    description: `Browse ${hub.shows.length} upcoming ${hub.genreName} concerts in ${hub.metro.name} over the next 30 days. Hear 30-second band previews and swipe local ${hub.genreName} bills on ${APP_NAME}.`,
    canonicalPath: hub.path,
    pageSlug: hub.slug,
    ctx,
    jsonLdBlocks: [buildBreadcrumbJsonLd(crumbs)],
    body: html`
      ${renderBreadcrumbs(crumbs, basePath)}
      <section class="hero">
        <span class="kicker">Hyperlocal Genre Guide · ${hub.metro.name} · Next 30 Days</span>
        <h1>${hub.metro.shortName} ${hub.genreName} Shows</h1>
        <p class="lead">${hub.shows.length} upcoming ${hub.genreName} ${hub.shows.length === 1 ? 'concert' : 'concerts'} across ${hub.metro.name}. Tap any show for full lineups, venue details, and 30-second band previews.</p>
        <div class="leaf-actions">
          <a class="btn-primary" id="cg-cta-${hub.slug}" href="${playStoreUrl(hub.slug)}" rel="noopener">
            ${playArrowIcon()} ${PRIMARY_CTA_LABEL}
          </a>
          <a class="btn-secondary" href="${href(basePath, metroHubPath)}">All ${hub.metro.shortName} shows</a>
          <a class="btn-secondary" href="${href(basePath, genreHubPath)}">All ${hub.genreName} concerts</a>
        </div>
      </section>

      ${renderFilterBar(hub.shows)}
      ${renderDateGroupedShows(hub.shows, ctx, `No upcoming ${hub.genreName} shows are listed in ${hub.metro.shortName} right now.`)}

      ${siblingGenresInCity.length ? html`<section class="section">
        <div class="section-head">
          <h2>More Genres in ${hub.metro.shortName}</h2>
        </div>
        <div class="tag-row">
          ${siblingGenresInCity.map((cg) => html`<a class="tag" href="${href(basePath, cg.path)}">${cg.genreName} (${cg.shows.length})</a>`)}
        </div>
      </section>` : ''}

      ${otherCitiesForGenre.length ? html`<section class="section">
        <div class="section-head">
          <h2>${hub.genreName} Shows in Other Cities</h2>
        </div>
        <div class="directory-chips">
          ${otherCitiesForGenre.map((cg) => html`<a class="dir-chip" href="${href(basePath, cg.path)}">${cg.metro.shortName} <span>${cg.shows.length}</span></a>`)}
        </div>
      </section>` : ''}

      ${renderCtaBanner(hub.slug, `Swipe ${hub.metro.shortName} ${hub.genreName} shows with 30-second previews.`)}
    `,
  });
}

/** 7. Genres Directory Page (/genres/) */
export function renderGenresIndexPage(genres, ctx) {
  const { siteUrl, basePath } = ctx;
  const byName = new Map(genres.map((g) => [g.name, g]));
  const crumbs = [
    { name: 'Home', path: '/', url: canonicalUrl(siteUrl, '/') },
    { name: 'Genres', path: '/genres/', url: canonicalUrl(siteUrl, '/genres/') },
  ];

  return layout({
    title: `Live Music by Genre — Upcoming Local Concerts | ${APP_NAME}`,
    description: `Browse upcoming local concerts by genre: punk, indie rock, shoegaze, hardcore, post-punk, metal, folk, electronic, and more on ${APP_NAME}.`,
    canonicalPath: '/genres/',
    pageSlug: 'genres',
    ctx,
    activeNav: 'genres',
    jsonLdBlocks: [buildBreadcrumbJsonLd(crumbs)],
    body: html`
      ${renderBreadcrumbs(crumbs, basePath)}
      <section class="hero">
        <span class="kicker">Genre Clusters</span>
        <h1>Live Music by Genre</h1>
        <p class="lead">Jump straight to the scenes you care about. Every genre page updates daily with the next 30 days of local bills.</p>
      </section>

      ${GENRE_GROUPS.map((group) => {
        const items = group.genres.map((name) => byName.get(name)).filter(Boolean);
        if (!items.length) return '';
        return html`<section class="section">
          <div class="section-head">
            <h2>${group.title}</h2>
          </div>
          <div class="hub-grid">
            ${items.map((g) => html`<a class="hub-card" href="${href(basePath, g.path)}">
              <div>
                <span class="hub-card-title">${g.name}</span>
                <div class="hub-card-meta">${g.shows.length} upcoming ${g.shows.length === 1 ? 'show' : 'shows'}</div>
              </div>
              <span class="hub-card-cta">Browse ${g.name} →</span>
            </a>`)}
          </div>
        </section>`;
      })}

      ${genres.length === 0 ? html`<div class="empty-state"><p>Genre clusters appear once upcoming shows are loaded.</p></div>` : ''}
      ${renderCtaBanner('genres')}
    `,
  });
}

/**
 * 8. Individual Show Leaf Page (/shows/YYYY-MM-DD-venue-slug-headliner-slug/)
 * The ONLY page type that emits Schema.org MusicEvent JSON-LD (gated on valid public PostalAddress).
 */
export function renderShowLeafPage(show, { sameVenueShows = [], sameNightShows = [] }, ctx) {
  const { siteUrl, basePath, flags } = ctx;
  const fullCanonical = canonicalUrl(siteUrl, show.pagePath);
  const eventName = buildEventName(show);
  const description = buildShowDescription(show);
  const wall = parseWallClock(show.startsAt);
  const dateLabel = wall ? formatLongDate(wall.date) : 'Date TBA';
  const shortDateLabel = wall ? formatShortDate(wall.date) : '';
  const timeLabel = formatShowTime(show);
  const priceText = formatPrice(show.price);
  const ticketUrl = safeWebUrl(show.ticketUrl);
  const posterUrl = show.flyerImages?.[0] ? safeWebUrl(show.flyerImages[0]) : null;
  const postal = parsePostalAddress(show.venue, show.venue.metro);
  const formattedAddress = postal ? formatPostalAddress(postal) : '';

  const musicEventLd = buildMusicEventJsonLd(show, fullCanonical);
  const metro = getMetro(show.venue.metro);

  const crumbs = [
    { name: 'Home', path: '/', url: canonicalUrl(siteUrl, '/') },
    ...(show.areaHubPath ? [{ name: show.venue.area, path: show.areaHubPath, url: canonicalUrl(siteUrl, show.areaHubPath) }] : []),
    { name: show.venue.name, path: show.venuePath, url: canonicalUrl(siteUrl, show.venuePath) },
    { name: eventName, path: show.pagePath, url: fullCanonical },
  ];

  const acts = [...(show.acts || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const mapsUrl = formattedAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${show.venue.name}, ${formattedAddress}`)}`
    : null;

  const ctaUrl = playStoreUrl(show.slug);

  const statusText = show.status === 'cancelled'
    ? 'Cancelled'
    : show.status === 'moved'
      ? 'Rescheduled'
      : 'Scheduled';

  return {
    hasMusicEventLd: Boolean(musicEventLd),
    musicEventLd,
    html: layout({
      title: `${eventName} at ${show.venue.name} (${shortDateLabel}) | ${APP_NAME}`,
      description,
      canonicalPath: show.pagePath,
      pageSlug: show.slug,
      ctx,
      ogImage: posterUrl || null,
      ogImageAlt: `${eventName} at ${show.venue.name} (${shortDateLabel})`,
      jsonLdBlocks: [musicEventLd, buildBreadcrumbJsonLd(crumbs)],
      body: html`
        ${renderBreadcrumbs(crumbs, basePath)}
        <div class="leaf-grid">
          <article class="leaf-card">
            <span class="kicker">
              ${show.venue.area || metro.name} Concert · ${shortDateLabel}
              ${show.status !== 'scheduled' ? html` · <span class="badge ${show.status === 'cancelled' ? 'badge-cancelled' : 'badge-moved'}">${statusText}</span>` : ''}
            </span>
            <h1>${eventName}</h1>
            <p class="lead">${description}</p>

            ${posterUrl ? html`<figure class="leaf-poster">
              <img src="${posterUrl}" alt="${eventName} at ${show.venue.name}" loading="eager">
            </figure>` : ''}

            <dl class="leaf-facts">
              <div class="fact-item">
                <dt>Date &amp; Time</dt>
                <dd>
                  <time datetime="${show.startsAt}">${dateLabel}</time>
                  <span class="fact-sub">${timeLabel}</span>
                </dd>
              </div>
              <div class="fact-item">
                <dt>Venue</dt>
                <dd>
                  <a href="${href(basePath, show.venuePath)}">${show.venue.name}</a>
                  ${formattedAddress
                    ? html`<span class="fact-sub">${formattedAddress}</span>`
                    : html`<span class="fact-sub">${show.venue.addressVisibility !== 'public'
                      ? `${show.venue.neighborhood || show.venue.area}, ${show.venue.city} (address on request)`
                      : `${show.venue.neighborhood || show.venue.area}, ${show.venue.city}`}</span>`}
                  ${mapsUrl ? html`<span class="fact-sub"><a href="${mapsUrl}" target="_blank" rel="noopener">Directions on Google Maps</a></span>` : ''}
                </dd>
              </div>
              <div class="fact-item">
                <dt>Admission &amp; Status</dt>
                <dd>
                  ${priceText || (ticketUrl ? 'See ticket page' : 'Check with venue')}
                  <span class="fact-sub">Status: ${statusText}</span>
                </dd>
              </div>
              ${show.genres && show.genres.length ? html`<div class="fact-item">
                <dt>Genres</dt>
                <dd>
                  <div class="tag-row" style="margin-top:2px">
                    ${show.genres.map((g) => html`<a class="tag" href="${href(basePath, `/genres/${slugify(g)}/`)}">${g}</a>`)}
                  </div>
                </dd>
              </div>` : ''}
            </dl>

            ${acts.length ? html`<section aria-labelledby="lineup-heading">
              <h2 id="lineup-heading">Lineup &amp; Audio Previews</h2>
              <ul class="lineup-list">
                ${acts.map((act, idx) => {
                  const directPreview = safeWebUrl(act.previewUrl || (idx === 0 ? show.previewUrl : null));
                  const deezerId = act.links?.deezerArtistId;
                  const canLiveLookup = !directPreview && flags?.deezerEnabled !== false;
                  return html`<li class="act-row" data-act-row>
                    <div class="act-row-top">
                      <div>
                        <span class="act-name">${act.name}</span>
                        <span class="act-role">${idx === 0 ? 'Headliner' : 'Support'}</span>
                      </div>
                      ${canLiveLookup ? html`<button
                        type="button"
                        class="preview-btn"
                        id="preview-btn-${slugify(act.name, 28)}-${idx}"
                        data-preview-btn
                        data-act-name="${act.name}"
                        data-deezer-id="${deezerId || ''}"
                      >${playArrowIcon()} Play 30s preview</button>` : ''}
                    </div>
                    ${directPreview
                      ? html`<audio class="preview-audio" controls preload="none" src="${directPreview}">Your browser does not support HTML5 audio playback.</audio>
                             <span class="preview-meta">30-second audio snippet for ${act.name}</span>`
                      : (canLiveLookup
                        ? html`<audio class="preview-audio" controls preload="none" hidden>Your browser does not support HTML5 audio playback.</audio>
                               <span class="preview-meta" data-preview-meta>Tap to stream a 30-second artist preview right in your browser.</span>`
                        : '')}
                  </li>`;
                })}
              </ul>
            </section>` : ''}

            <div class="leaf-actions">
              <a class="btn-primary" id="leaf-cta-play" href="${ctaUrl}" rel="noopener">
                ${playArrowIcon()} ${PRIMARY_CTA_LABEL}
              </a>
              ${ticketUrl ? html`<a class="btn-secondary" href="${ticketUrl}" target="_blank" rel="noopener nofollow">Tickets &amp; Event Info</a>` : ''}
            </div>
          </article>

          <aside class="leaf-sidebar">
            <div class="cta-box">
              <span class="kicker">Want the full local scene?</span>
              <h2>Swipe tonight’s bills on Setnik</h2>
              <p>Auto-playing 30-second band previews, genre &amp; price filters, and one-tap calendar reminders for shows across ${metro.name}.</p>
              <a class="btn-primary" id="sidebar-cta-play" href="${ctaUrl}" rel="noopener">
                ${playArrowIcon()} ${PRIMARY_CTA_LABEL}
              </a>
              <span class="cta-note">Free on Android · Package com.setnik.app</span>
            </div>

            ${sameVenueShows.length ? html`<section class="side-panel">
              <h2>More at ${show.venue.name}</h2>
              <ul class="side-list">
                ${sameVenueShows.map((s) => {
                  const w = parseWallClock(s.startsAt);
                  return html`<li>
                    <a href="${href(basePath, s.pagePath)}">${buildEventName(s)}</a>
                    <span>${w ? formatShortDate(w.date) : ''} · ${formatShowTime(s)}</span>
                  </li>`;
                })}
              </ul>
            </section>` : ''}

            ${sameNightShows.length ? html`<section class="side-panel">
              <h2>Also on ${shortDateLabel}</h2>
              <ul class="side-list">
                ${sameNightShows.map((s) => html`<li>
                  <a href="${href(basePath, s.pagePath)}">${buildEventName(s)}</a>
                  <span>${s.venue.name} · ${s.venue.neighborhood || s.venue.area}</span>
                </li>`)}
              </ul>
            </section>` : ''}
          </aside>
        </div>
      `,
    }),
  };
}

/** 9. 404 Page (/404.html) */
export function renderNotFoundPage(ctx) {
  const { basePath } = ctx;
  return layout({
    title: `Show Not Found | ${APP_NAME}`,
    description: `That concert page has passed or moved. Browse upcoming live music shows on ${APP_NAME}.`,
    canonicalPath: '/404.html',
    pageSlug: 'not-found',
    ctx,
    noindex: true,
    body: html`
      <section class="hero">
        <span class="kicker">404 · Page Not Found</span>
        <h1>That set already wrapped.</h1>
        <p class="lead">Concert pages automatically rotate as shows pass. Jump back to upcoming live music near you or swipe fresh bills on the Setnik Android app.</p>
        <div class="leaf-actions">
          <a class="btn-primary" href="${playStoreUrl('not-found')}" rel="noopener">${playArrowIcon()} ${PRIMARY_CTA_LABEL}</a>
          <a class="btn-secondary" href="${href(basePath, '/')}">Browse upcoming shows</a>
        </div>
      </section>
    `,
  });
}
