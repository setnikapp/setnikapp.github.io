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
 * Custom vector SETNIK. wordmark matching SETNIK_brand_spec_v1.1.pdf (p. 2):
 * Bold condensed uppercase with stacked LED VU-meter "I" (top square Clip Red #E4574E)
 * and matching Clip Red square period.
 */
function wordmarkSvg() {
  return raw(`<span class="wordmark" aria-label="SETNIK.">
  <span class="wordmark-text">SET</span><svg class="wordmark-meter" viewBox="0 0 9 29" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="0.5" y="0.5" width="8" height="4.4" fill="#E4574E"/>
    <rect x="0.5" y="6.4" width="8" height="4.4" fill="#141414"/>
    <rect x="0.5" y="12.3" width="8" height="4.4" fill="#141414"/>
    <rect x="0.5" y="18.2" width="8" height="4.4" fill="#141414"/>
    <rect x="0.5" y="24.1" width="8" height="4.4" fill="#141414"/>
  </svg><span class="wordmark-text">NIK</span><span class="wordmark-dot" aria-hidden="true"></span>
</span>`);
}

function playArrowIcon() {
  return raw(`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.53.85l11-6.86a1 1 0 0 0 0-1.7l-11-6.86A1 1 0 0 0 8 5.14Z"/></svg>`);
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
  body,
}) {
  const { siteUrl, basePath, attribution, flags, generatedDate, googleSiteVerification } = ctx;
  const fullCanonical = canonicalUrl(siteUrl, canonicalPath);
  const ctaUrl = playStoreUrl(pageSlug);

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
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
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
      <a class="brand-link" href="${href(basePath, '/')}" aria-label="${APP_NAME} — ${APP_TAGLINE}">
        ${wordmarkSvg()}
      </a>
      <nav class="site-nav" aria-label="Primary">
        <a href="${href(basePath, '/')}" ${activeNav === 'home' ? raw('aria-current="page"') : ''}>Shows</a>
        ${ctx.primaryWeekendHub ? html`<a href="${href(basePath, ctx.primaryWeekendHub.path)}" ${activeNav === 'weekend' ? raw('aria-current="page"') : ''}>This Weekend</a>` : ''}
        <a href="${href(basePath, '/venues/')}" ${activeNav === 'venues' ? raw('aria-current="page"') : ''}>Venues</a>
        <a href="${href(basePath, '/genres/')}" ${activeNav === 'genres' ? raw('aria-current="page"') : ''}>Genres</a>
        <a class="nav-cta" href="${ctaUrl}" rel="noopener">${playArrowIcon()} Get Setnik</a>
      </nav>
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
      <span class="day-count">${items.length} ${items.length === 1 ? 'show' : 'shows'}</span>
    </h2>
    <ul class="show-list">
      ${items.map((s) => renderShowCard(s, ctx))}
    </ul>
  </section>`)}`;
}

/** 1. Homepage (/) — High-intent hyperlocal hub directory + upcoming bills */
export function renderHomePage({ shows, weekendHubs, areaHubs, venues, genres }, ctx) {
  const { siteUrl, basePath } = ctx;
  const pageSlug = 'home';
  const priorityShows = shows.filter((s) => PRIORITY_METROS.includes(s.venue.metro));
  const featuredShows = (priorityShows.length >= 6 ? priorityShows : shows).slice(0, 12);
  // Show all 10 metro hubs plus top priority borough/city hubs on the homepage (sub-neighborhoods are linked inside each metro hub)
  const homeAreaHubs = areaHubs.filter((h) => h.priority <= 2 || (h.priority === 3 && h.metro.id === 'nyc')).slice(0, 16);
  const topVenues = venues.slice(0, 12);
  const topGenres = genres.slice(0, 12);

  return layout({
    title: `${APP_NAME} — Local Live Music, Indie Concerts & Band Previews`,
    description: `Discover upcoming local concerts and live music near you across major US & Canadian cities. Browse next 30 days of shows by city, neighborhood, venue, and genre, preview bands in 30 seconds, and swipe bills on Setnik.`,
    canonicalPath: '/',
    pageSlug,
    ctx,
    activeNav: 'home',
    jsonLdBlocks: [buildWebSiteJsonLd(siteUrl)],
    body: html`
      <section class="hero">
        <div class="hero-grid">
          <div>
            <span class="kicker">Live Music Discovery · Next 30 Days</span>
            <h1>Find local concerts worth leaving the house for.</h1>
            <p class="lead">Browse upcoming club shows, indie bills, and neighborhood calendars updated daily — then listen to 30-second previews of every band on Setnik before you commit.</p>
            <div class="hero-stats">
              <div class="stat-box">
                <span class="stat-num">${shows.length}</span>
                <span class="stat-label">Upcoming shows</span>
              </div>
              <div class="stat-box">
                <span class="stat-num">${venues.length}</span>
                <span class="stat-label">Local venues</span>
              </div>
              <div class="stat-box">
                <span class="stat-num">${genres.length}</span>
                <span class="stat-label">Genres tracked</span>
              </div>
            </div>
          </div>
          <div class="cta-box">
            <span class="kicker">Android App · Free</span>
            <h2>Hear it. Press play. Go there.</h2>
            <p>Swipe tonight’s and this weekend’s local bills with instant 30-second artist previews. One swipe saves shows to your calendar.</p>
            <a class="btn-primary" id="hero-cta-play" href="${playStoreUrl(pageSlug)}" rel="noopener">
              ${playArrowIcon()} ${PRIMARY_CTA_LABEL}
            </a>
            <span class="cta-note">Free on Google Play · No account required to swipe</span>
          </div>
        </div>
      </section>

      ${weekendHubs.length ? html`<section class="section">
        <div class="section-head">
          <h2>Shows This Weekend</h2>
        </div>
        <div class="hub-grid">
          ${weekendHubs.map((hub) => html`<a class="hub-card" href="${href(basePath, hub.path)}">
            <div>
              <span class="hub-card-title">${hub.shortTitle}</span>
              <div class="hub-card-meta">${hub.dateRangeLabel} · ${hub.shows.length} ${hub.shows.length === 1 ? 'show' : 'shows'}</div>
            </div>
            <span class="hub-card-cta">See weekend bills →</span>
          </a>`)}
        </div>
      </section>` : ''}

      ${homeAreaHubs.length ? html`<section class="section">
        <div class="section-head">
          <h2>Browse by City &amp; Neighborhood</h2>
        </div>
        <div class="hub-grid">
          ${homeAreaHubs.map((hub) => html`<a class="hub-card" href="${href(basePath, hub.path)}">
            <div>
              <span class="hub-card-title">${hub.label}</span>
              <div class="hub-card-meta">${hub.shows.length} upcoming ${hub.shows.length === 1 ? 'show' : 'shows'}</div>
            </div>
            <span class="hub-card-cta">Explore live music →</span>
          </a>`)}
        </div>
      </section>` : ''}

      <section class="section">
        <div class="section-head">
          <h2>Coming Up Next</h2>
        </div>
        ${renderDateGroupedShows(featuredShows, ctx, 'Fresh listings sync daily at 6:00 AM EST. Check back shortly or open Setnik on Android.')}
      </section>

      ${topVenues.length ? html`<section class="section">
        <div class="section-head">
          <h2>Popular Venues</h2>
          <a class="section-more" href="${href(basePath, '/venues/')}">All ${venues.length} venues →</a>
        </div>
        <div class="hub-grid">
          ${topVenues.map((v) => html`<a class="hub-card" href="${href(basePath, v.path)}">
            <div>
              <span class="hub-card-title">${v.name}</span>
              <div class="hub-card-meta">${v.neighborhood || v.area} · ${v.shows.length} upcoming ${v.shows.length === 1 ? 'show' : 'shows'}</div>
            </div>
            <span class="hub-card-cta">Venue schedule →</span>
          </a>`)}
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
export function renderAreaHubPage(hub, siblingHubs, topVenues, ctx) {
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
export function renderGenrePage(genreObj, allGenres, ctx) {
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
