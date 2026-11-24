/**
 * Schema.org structured data builders for Setnik Web.
 *
 * Google Event SEO compliance rules enforced here:
 *  1. MusicEvent JSON-LD is ONLY emitted on individual show leaf pages (never on hubs).
 *  2. MusicEvent JSON-LD is ONLY emitted when the venue has a valid public physical street address.
 *  3. `name` contains ONLY the event/lineup title (never venue name, city, date, or ticket price).
 *  4. `startDate` is always a full ISO-8601 timestamp with explicit UTC offset (e.g. -05:00 / -04:00).
 *  5. Every emitted JSON-LD property corresponds to visibly rendered HTML content on the leaf page.
 */
import { APP_NAME, CANADIAN_PROVINCES, getMetro } from './config.mjs';
import {
  formatLongDate,
  formatPrice,
  formatShowTime,
  parseWallClock,
  safeWebUrl,
  toZonedIso,
} from './html.mjs';

const INVALID_ADDRESS_RX =
  /\b(tba|tbd|secret|dm for|ask a punk|on request|private|undisclosed|unknown|various|online|virtual|livestream|stream)\b/i;

/**
 * Matches a combined US/CA address like:
 *   "1140 Myrtle Ave, Brooklyn, NY 11206"
 *   "44 Wilson Ave, Brooklyn, NY"
 *   "123 Queen St W, Toronto, ON M5H 2M9"
 */
const FULL_ADDRESS_RX =
  /^([^,]+?),\s*([^,]+?),\s*([A-Za-z]{2})(?:\s+([0-9]{5}(?:-[0-9]{4})?|[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d))?$/;

const CITY_REGION_RX = /^([^,]+?),\s*([A-Za-z]{2})(?:\s+([0-9]{5}(?:-[0-9]{4})?|[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d))?$/;

/** Basic check that a street line looks like a real physical street address (e.g. "44 Wilson Ave"). */
function looksLikeStreetAddress(street) {
  if (!street) return false;
  const s = street.trim();
  if (s.length < 5 || s.length > 160) return false;
  if (INVALID_ADDRESS_RX.test(s)) return false;
  // Require a leading street number (e.g. "44 Wilson Ave", "56-06 Cooper Ave") plus alphabetic street name.
  return /^\d+[A-Za-z0-9-]*\s+[A-Za-z]/.test(s);
}

/**
 * Parse venue address fields into a strict Schema.org PostalAddress, or return null
 * if the show lacks a verified public physical street address.
 */
export function parsePostalAddress(venue, metroId) {
  if (!venue || venue.addressVisibility !== 'public') return null;
  const rawAddr = typeof venue.address === 'string' ? venue.address.trim() : '';
  if (!rawAddr || INVALID_ADDRESS_RX.test(rawAddr)) return null;

  const metro = getMetro(metroId || venue.metro);
  let streetAddress = '';
  let addressLocality = '';
  let addressRegion = '';
  let postalCode = '';

  const fullMatch = FULL_ADDRESS_RX.exec(rawAddr);
  if (fullMatch) {
    streetAddress = fullMatch[1].trim();
    addressLocality = fullMatch[2].trim();
    addressRegion = fullMatch[3].toUpperCase();
    postalCode = (fullMatch[4] || '').trim().toUpperCase();
  } else {
    // JamBase / split form: venue.address is the street ("44 Wilson Ave"), venue.city is "Brooklyn, NY".
    streetAddress = rawAddr.split(',')[0].trim();
    const cityStr = typeof venue.city === 'string' ? venue.city.trim() : '';
    const cityMatch = CITY_REGION_RX.exec(cityStr);
    if (cityMatch) {
      addressLocality = cityMatch[1].trim();
      addressRegion = cityMatch[2].toUpperCase();
      postalCode = (cityMatch[3] || '').trim().toUpperCase();
    } else {
      addressLocality = (cityStr || venue.area || metro.name || '').trim();
      addressRegion = (metro.state || '').toUpperCase();
    }
  }

  if (!looksLikeStreetAddress(streetAddress)) return null;
  if (!addressLocality || !addressRegion) return null;

  const addressCountry = CANADIAN_PROVINCES.has(addressRegion) ? 'CA' : 'US';
  const postal = {
    '@type': 'PostalAddress',
    streetAddress,
    addressLocality,
    addressRegion,
    ...(postalCode ? { postalCode } : {}),
    addressCountry,
  };
  return postal;
}

/** Format a parsed PostalAddress as a single visible street line matching JSON-LD. */
export function formatPostalAddress(postal) {
  if (!postal) return '';
  const tail = [postal.addressLocality, postal.addressRegion].filter(Boolean).join(', ');
  return postal.postalCode ? `${postal.streetAddress}, ${tail} ${postal.postalCode}` : `${postal.streetAddress}, ${tail}`;
}

/**
 * Event/lineup name ONLY for Schema.org `MusicEvent.name` and leaf `<h1>`.
 * Strictly excludes venue name, city, date, and ticket price.
 */
export function buildEventName(show) {
  const acts = [...(show.acts || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((a) => a.name).filter(Boolean);
  const title = typeof show.title === 'string' ? show.title.trim() : '';
  if (title) {
    return title;
  }
  if (acts.length === 0) return 'Live Music Showcase';
  if (acts.length === 1) return acts[0];
  if (acts.length === 2) return `${acts[0]} with ${acts[1]}`;
  if (acts.length === 3) return `${acts[0]} with ${acts[1]} and ${acts[2]}`;
  return `${acts[0]} with ${acts[1]}, ${acts[2]} + more`;
}

/**
 * Natural-language factual description visibly displayed on the show leaf page
 * and reused verbatim in MusicEvent.description so HTML and JSON-LD always match.
 */
export function buildShowDescription(show) {
  const name = buildEventName(show);
  const wall = parseWallClock(show.startsAt);
  const datePart = wall ? formatLongDate(wall.date) : '';
  const timePart = formatShowTime(show);
  const acts = [...(show.acts || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((a) => a.name).filter(Boolean);

  const locParts = [show.venue.name];
  if (show.venue.neighborhood && show.venue.neighborhood.toLowerCase() !== (show.venue.area || '').toLowerCase()) {
    locParts.push(show.venue.neighborhood);
  }
  if (show.venue.city) {
    locParts.push(show.venue.city);
  } else if (show.venue.area) {
    locParts.push(show.venue.area);
  }

  const parts = [];
  if (show.status === 'cancelled') {
    parts.push(`Cancelled: ${name} originally scheduled for ${datePart} at ${locParts.join(', ')}.`);
  } else if (show.status === 'moved') {
    parts.push(`Rescheduled: ${name} at ${locParts.join(', ')} on ${datePart} (${timePart}).`);
  } else {
    parts.push(`${name} live at ${locParts.join(', ')} on ${datePart} (${timePart}).`);
  }

  if (acts.length > 1) {
    parts.push(`Lineup: ${acts.join(', ')}.`);
  }
  if (show.genres && show.genres.length > 0) {
    parts.push(`Genres: ${show.genres.join(', ')}.`);
  }
  const priceText = formatPrice(show.price);
  if (priceText) {
    parts.push(`Admission: ${priceText}.`);
  }
  return parts.join(' ');
}

/** Ensure an ISO timestamp has an explicit numeric UTC offset (-05:00 / -04:00, never offsetless). */
export function ensureOffsetIso(iso, metroId) {
  if (!iso || typeof iso !== 'string') return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}$/.test(iso)) {
    return iso.length === 22 ? `${iso.slice(0, 16)}:00${iso.slice(16)}` : iso;
  }
  const metro = getMetro(metroId);
  const localMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (localMatch) {
    return toZonedIso(localMatch[1], localMatch[2], metro.tz);
  }
  const dateOnly = /^(\d{4}-\d{2}-\d{2})$/.exec(iso);
  if (dateOnly) {
    return toZonedIso(dateOnly[1], '20:00', metro.tz);
  }
  return null;
}

function mapEventStatus(status) {
  if (status === 'cancelled') return 'https://schema.org/EventCancelled';
  if (status === 'moved') return 'https://schema.org/EventRescheduled';
  return 'https://schema.org/EventScheduled';
}

/**
 * Build Google-compliant Schema.org MusicEvent JSON-LD for a single concert leaf page.
 * Returns null if the show lacks a valid public physical street address or valid startDate.
 */
export function buildMusicEventJsonLd(show, canonicalPageUrl) {
  const postalAddress = parsePostalAddress(show.venue, show.venue.metro);
  if (!postalAddress) return null;

  const startDate = ensureOffsetIso(show.startsAt, show.venue.metro);
  if (!startDate) return null;

  const endDate = show.endsAt ? ensureOffsetIso(show.endsAt, show.venue.metro) : null;
  const doorTime = show.doorsAt ? ensureOffsetIso(show.doorsAt, show.venue.metro) : null;

  const acts = [...(show.acts || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).filter((a) => a.name);
  const location = {
    '@type': 'Place',
    name: show.venue.name,
    address: postalAddress,
  };
  if (typeof show.venue.lat === 'number' && typeof show.venue.lng === 'number' && Number.isFinite(show.venue.lat) && Number.isFinite(show.venue.lng)) {
    location.geo = {
      '@type': 'GeoCoordinates',
      latitude: show.venue.lat,
      longitude: show.venue.lng,
    };
  }

  const event = {
    '@context': 'https://schema.org',
    '@type': 'MusicEvent',
    name: buildEventName(show),
    startDate,
    ...(endDate ? { endDate } : {}),
    ...(doorTime ? { doorTime } : {}),
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    eventStatus: mapEventStatus(show.status),
    location,
    description: buildShowDescription(show),
    url: canonicalPageUrl,
  };

  if (acts.length > 0) {
    event.performer = acts.map((act) => ({
      '@type': 'MusicGroup',
      name: act.name,
    }));
  }

  const image = show.flyerImages?.[0] ? safeWebUrl(show.flyerImages[0]) : null;
  if (image) {
    event.image = [image];
  }

  // Emit `offers` only when price or ticket URL is available and visibly rendered on the page.
  const ticketUrl = safeWebUrl(show.ticketUrl);
  const currency = postalAddress.addressCountry === 'CA' ? 'CAD' : 'USD';
  const hasNumericPrice = show.price && (show.price.isFree === true || typeof show.price.min === 'number' || typeof show.price.max === 'number');
  if (hasNumericPrice || ticketUrl) {
    const offer = {
      '@type': 'Offer',
      url: ticketUrl || canonicalPageUrl,
      priceCurrency: currency,
      availability: show.status === 'cancelled'
        ? 'https://schema.org/Discontinued'
        : 'https://schema.org/InStock',
    };
    if (show.price?.isFree) {
      offer.price = '0';
    } else if (typeof show.price?.min === 'number') {
      offer.price = String(show.price.min);
    } else if (typeof show.price?.max === 'number') {
      offer.price = String(show.price.max);
    }
    event.offers = offer;
  }

  return event;
}

/** BreadcrumbList JSON-LD (safe on both hub pages and leaf pages; never triggers Event schema rules). */
export function buildBreadcrumbJsonLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** WebSite JSON-LD for the homepage only. */
export function buildWebSiteJsonLd(siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: APP_NAME,
    url: `${siteUrl}/`,
    description: 'Discover upcoming local concerts and indie live music, preview bands in 30 seconds, and never miss a set.',
  };
}
