/**
 * Safe HTML templating helpers, URL/slug builders, date/time formatters,
 * and Google Play UTM referrer link builder.
 */
import { GOOGLE_PLAY_PACKAGE_ID } from './config.mjs';

const RAW = Symbol('raw_html');

/** Marks an already-escaped HTML fragment so html`` does not double-escape it. */
export function raw(value) {
  return { [RAW]: true, value: value == null ? '' : String(value) };
}

/** Escapes HTML special characters to prevent broken markup or XSS from external listings. */
export function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPart(part) {
  if (part == null || part === false) return '';
  if (Array.isArray(part)) return part.map(renderPart).join('');
  if (typeof part === 'object' && part[RAW]) return part.value;
  return escapeHtml(part);
}

/** Tagged template literal that auto-escapes interpolated values unless wrapped in raw(). */
export function html(strings, ...values) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += renderPart(values[i]);
  }
  return raw(out);
}

/** Safely serializes JSON-LD inside a <script type="application/ld+json"> block. */
export function safeJsonLd(obj) {
  return raw(
    JSON.stringify(obj, null, 2)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029'),
  );
}

/** URL-safe ASCII slug from arbitrary text (accents stripped, lowercase, hyphenated). */
export function slugify(text, maxLen = 64) {
  if (!text) return 'item';
  const s = String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return (s || 'item').slice(0, maxLen).replace(/-+$/, '') || 'item';
}

/** Prefix a site-root path (e.g. '/shows/...') with the configured basePath ('' or '/setnik-web'). */
export function href(basePath, path) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${basePath}${cleanPath}`;
}

/** Build an absolute canonical URL for sitemap, canonical <link>, and JSON-LD url fields. */
export function canonicalUrl(siteUrl, path) {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${siteUrl}${cleanPath}`;
}

/**
 * Build Google Play install CTA link with exact UTM referrer encoding:
 * https://play.google.com/store/apps/details?id=com.setnik.app&referrer=utm_source%3Dsetnik_web%26utm_medium%3Dseo%26utm_campaign%3D<page_slug>
 */
export function playStoreUrl(pageSlug, packageId = GOOGLE_PLAY_PACKAGE_ID) {
  const cleanSlug = slugify(pageSlug || 'home', 96);
  const referrer = `utm_source=setnik_web&utm_medium=seo&utm_campaign=${cleanSlug}`;
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageId)}&referrer=${encodeURIComponent(referrer)}`;
}

/**
 * Parse the wall-clock parts directly from an ISO-8601 string with offset
 * (e.g. "2026-11-27T20:00:00-05:00") so display dates never shift across server timezones.
 */
export function parseWallClock(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4]),
    minute: Number(m[5]),
    second: Number(m[6] || '0'),
    offset: m[7],
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: `${m[4]}:${m[5]}`,
  };
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function dayOfWeek(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function formatShortDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = dayOfWeek(ymd);
  return `${WEEKDAYS_SHORT[dow]}, ${MONTHS_SHORT[m - 1]} ${d}`;
}

export function formatLongDate(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = dayOfWeek(ymd);
  return `${WEEKDAYS_LONG[dow]}, ${MONTHS_LONG[m - 1]} ${d}, ${y}`;
}

export function formatMonthShort(ymd) {
  const [, m] = ymd.split('-').map(Number);
  return MONTHS_SHORT[m - 1] || '';
}

export function formatDayNum(ymd) {
  return String(Number(ymd.split('-')[2]));
}

export function formatWeekdayShort(ymd) {
  return WEEKDAYS_SHORT[dayOfWeek(ymd)] || '';
}

export function format12Hour(hour, minute) {
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return minute === 0 ? `${h12}:00 ${period}` : `${h12}:${String(minute).padStart(2, '0')} ${period}`;
}

export function formatShowTime(show) {
  if (show.timeTba) return 'Time TBA';
  const start = parseWallClock(show.startsAt);
  if (!start) return 'Time TBA';
  const startStr = format12Hour(start.hour, start.minute);
  if (show.doorsAt) {
    const doors = parseWallClock(show.doorsAt);
    if (doors && (doors.hour !== start.hour || doors.minute !== start.minute)) {
      return `Doors ${format12Hour(doors.hour, doors.minute)} · Show ${startStr}`;
    }
  }
  return startStr;
}

export function formatPrice(price) {
  if (!price) return '';
  if (price.isFree) return 'Free';
  if (price.notaflof) {
    if (price.min != null && price.max != null && price.min !== price.max) {
      return `$${price.min}–$${price.max} (sliding scale)`;
    }
    if (price.min != null) return `$${price.min} (sliding scale)`;
    return 'Sliding scale / NOTAFLOF';
  }
  if (price.min != null && price.max != null && price.min !== price.max) {
    return `$${price.min}–$${price.max}`;
  }
  if (price.min != null) return `$${price.min}`;
  if (price.max != null) return `$${price.max}`;
  return '';
}

/** Get YYYY-MM-DD for a Date object in a specific IANA timezone. */
export function localYmd(date, tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Add N calendar days to a YYYY-MM-DD string. */
export function addDaysYmd(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Effective night date (YYYY-MM-DD) for a show timestamp.
 * Shows starting between 00:00 and 04:59 local wall-clock time belong to the previous night.
 */
export function effectiveShowDate(startsAt) {
  const wall = typeof startsAt === 'object' && startsAt !== null && 'date' in startsAt
    ? startsAt
    : parseWallClock(startsAt);
  if (!wall) return null;
  return wall.hour < 5 ? addDaysYmd(wall.date, -1) : wall.date;
}

/**
 * Effective local night date (YYYY-MM-DD) for a Date object in an IANA timezone.
 * Local times from 00:00 to 04:59 belong to the previous night (5:00 AM rollover).
 */
export function effectiveLocalYmd(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = Number(parts.hour) % 24;
  return hour < 5 ? addDaysYmd(ymd, -1) : ymd;
}

/**
 * Compute an exact ISO-8601 timestamp with UTC offset for local date + time in an IANA timezone.
 * Used whenever an input record lacks an explicit offset (e.g., America/New_York -> -05:00 or -04:00).
 */
export function toZonedIso(ymd, hhmm = '20:00', tz = 'America/New_York') {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = (hhmm || '20:00').slice(0, 5).split(':').map(Number);
  // Start with a UTC guess at the wall-clock time, then find what wall clock tz shows at that instant.
  const guessMs = Date.UTC(y, m - 1, d, hh, mm, 0);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const partsOf = (ms) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  };
  // Two-step fixed-point refinement handles DST transitions cleanly.
  let offsetMin = Math.round((partsOf(guessMs) - guessMs) / 60_000);
  const exactUtc = guessMs - offsetMin * 60_000;
  offsetMin = Math.round((partsOf(exactUtc) - exactUtc) / 60_000);

  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const offH = String(Math.floor(abs / 60)).padStart(2, '0');
  const offM = String(abs % 60).padStart(2, '0');
  const pad2 = (n) => String(n).padStart(2, '0');
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}:00${sign}${offH}:${offM}`;
}

/** Check whether a URL is a safe http/https URL. */
export function safeWebUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.length > 2000) return null;
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}
