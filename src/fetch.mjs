/**
 * Data ingestion, normalization, and deduplication for Setnik Web.
 *
 * Matches the Setnik app's exact backend architecture:
 *  1. Supabase remote kill switches:
 *       POST /rest/v1/rpc/get_flags             -> jambase_enabled, deezer_enabled
 *       POST /rest/v1/rpc/fp_licensed_switches  -> jambase_listings
 *  2. Supabase first-party shows (fp.shows + fp.venues, private schema accessed via RPC):
 *       POST /rest/v1/rpc/fp_public_shows       body: { p_metro: "<metro>" }
 *  3. Supabase community-submitted shows (public.submissions, anon SELECT via RLS):
 *       GET  /rest/v1/submissions?select=*&metro=eq.<metro>&status=eq.live&starts_at=gt.<since>&order=starts_at.asc&limit=500
 *  4. Public listings feeds (setnik-listings GitHub Release "listings", gated by jambase_enabled):
 *       GET  https://github.com/<owner>/setnik-listings/releases/download/listings/shows-{metro}.json
 *            (configured via LISTINGS_FEED_URL_TEMPLATE secret or variable)
 *
 * Gracefully handles missing env vars, empty tables, missing optional columns, or transient fetch errors
 * without failing the build.
 */
import {
  ALLOWED_GENRES_SET,
  DEFAULT_LISTINGS_FEED_URL_TEMPLATE,
  DEFAULT_METROS,
  DEFAULT_WINDOW_DAYS,
  getMetro,
} from './config.mjs';
import {
  addDaysYmd,
  effectiveLocalYmd,
  effectiveShowDate,
  parseWallClock,
  safeWebUrl,
  toZonedIso,
} from './html.mjs';
import { ensureOffsetIso } from './schema.mjs';

const FETCH_TIMEOUT_MS = 15_000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ACT_MATCH_THRESHOLD = 0.82;

const LOCATION_ACRONYM_BLACKLIST = new Set([
  'nyc', 'ny', 'la', 'ca', 'chi', 'il', 'sf', 'tor', 'on', 'mtl', 'qc',
  'van', 'bc', 'bos', 'ma', 'dc', 'phl', 'pa', 'nj', 'bk', 'bklyn',
  'us', 'usa', 'uk', 'can', 'tx', 'fl', 'ga', 'wa', 'or', 'co', 'nv',
  'az', 'mn', 'mi', 'mo', 'oh', 'in', 'wi', 'nc', 'tn', 'ut', 'ab',
  'mb', 'ns', 'live', 'bar', 'club', 'hall', 'room', 'stage', 'all',
]);

const INITIALS_STOPWORDS = new Set([
  'the', 'of', 'and', 'for', 'at', 'in', 'on', 'to', 'a', 'an',
  'de', 'des', 'du', 'la', 'le', 'les', 'et', 'au', 'aux', 'd', 'l',
]);

const GENERIC_VENUE_CORES = new Set([
  'music', 'club', 'live', 'bar', 'room', 'stage', 'house', 'studio',
  'space', 'lounge', 'hall', 'park', 'garden', 'city', 'town', 'arts',
  'new', 'york', 'concert', 'event', 'events', 'venue', 'arena', 'civic',
]);

const ACT_STOPWORDS = new Set(['the', 'and', 'of', 'a', 'an']);

const SUBTITLE_KEYWORDS_RX =
  /\b(tour|live|release|album|ep|single|record|anniversary|night\s*\d+|show|presents?|experience|tribute|reunion|farewell|residency|showcase|party|fest|festival|world|north\s+american|us|usa|canada|canadian|uk|european|20\d{2}|18\+|21\+|all\s+ages|early|late|matinee|doors|sold\s+out|cancelled|canceled|postponed|rescheduled|moved|dj\s+set|acoustic|solo|unplugged|intimate|special\s+guests?|with|w\/|feat\.?|ft\.?|featuring)\b/i;

const PAREN_TAG_RX =
  /\b(tour|live|release|album|ep|single|record|anniversary|night\s*\d+|show|presents?|experience|tribute|reunion|farewell|residency|showcase|party|20\d{2}|18\+|21\+|all\s+ages|early|late|matinee|sold\s+out|cancelled|canceled|postponed|rescheduled|moved|dj\s+set|acoustic|solo|unplugged|full\s+band|us|uk|ca|qc|nyc|la)\b/i;

/** Normalize a string for Setnik deduplication (mirrors the Setnik app/src/lib/listings/merge.ts). */
export function normKeyPart(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/^the /, '')
    .replace(/[^a-z0-9]+/g, '');
}

export function headlinerName(show) {
  const sorted = [...(show.acts || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return sorted[0]?.name || show.title || '';
}

/** Deduplication key: effective night date | normalized venue | normalized headliner. */
export function dedupeKey(show) {
  const date = effectiveShowDate(show.startsAt) || String(show.startsAt || '').slice(0, 10);
  return [date, normKeyPart(show.venue?.name), normKeyPart(headlinerName(show))].join('|');
}

function stripDiacriticsLower(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’‘`´ʼ]/g, "'");
}

function isSubsequence(needle, haystack) {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/**
 * Canonical normalized venue key handling accents, apostrophes (Pianos/Piano's),
 * leading English/French articles (The/Le/Les/L'), Theater/Theatre, and Center/Centre.
 */
export function venueKey(name) {
  let s = stripDiacriticsLower(name).replace(/&/g, ' and ').trim();
  // Normalize parenthesized leading articles like "(Le) Poisson Rouge"
  s = s.replace(/^\((the|le|les)\)\s+/, '$1 ');
  // Strip leading English/French articles: The, Le, Les, L' (with optional space)
  s = s.replace(/^(?:the\s+|les?\s+|l'\s*)/, '');
  // Remove remaining apostrophes so Piano's === Pianos, Baby's === Babys
  s = s.replace(/'/g, '');
  // Normalize British/French/US spellings
  s = s.replace(/\btheatre\b/g, 'theater').replace(/\bcentre\b/g, 'center');
  return s.replace(/[^a-z0-9]+/g, ' ').trim();
}

function stripParentheticals(raw) {
  return String(raw || '').replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ').trim();
}

function venueCoreTokens(key) {
  return key.split(' ').filter((t) => t && t !== 'theater' && t !== 'center');
}

function extractVenueAcronymInfo(raw) {
  const lowered = stripDiacriticsLower(raw);
  const outer = stripParentheticals(lowered);
  const outerWords = outer.replace(/'/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  const allInitials = outerWords.map((w) => w[0]).join('');
  const contentWords = outerWords.filter((w) => !INITIALS_STOPWORDS.has(w));
  const contentInitials = contentWords.map((w) => w[0]).join('');

  const explicit = new Set();
  const rx = /[\(\[]([a-z0-9]{2,6})[\)\]]/g;
  let m;
  while ((m = rx.exec(lowered)) !== null) {
    const code = m[1];
    if (LOCATION_ACRONYM_BLACKLIST.has(code)) continue;
    if (!outerWords.length || isSubsequence(code, allInitials) || code === contentInitials) {
      explicit.add(code);
    }
  }

  // Standalone short acronym venue name (e.g. "SAT", "La SAT", "LPR")
  const standalone = venueKey(outer).replace(/^la\s+/, '');
  if (/^[a-z]{2,5}$/.test(standalone) && !LOCATION_ACRONYM_BLACKLIST.has(standalone)) {
    explicit.add(standalone);
  }

  const implicit = new Set();
  if (contentWords.length >= 3 && /^[a-z]{3,6}$/.test(contentInitials) && !LOCATION_ACRONYM_BLACKLIST.has(contentInitials)) {
    implicit.add(contentInitials);
  }

  return { explicit, implicit };
}

/**
 * Determine whether two venue names in the same metro refer to the same physical room.
 * Handles apostrophes, leading The/Le/Les/L', Theater/Theatre, Center/Centre,
 * French/English word-order flips (Beanfield Theatre / Théâtre Beanfield),
 * and bilingual parenthetical acronyms like (SAT).
 */
export function sameVenueName(a, b) {
  const ka = venueKey(a);
  const kb = venueKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.replace(/\s+/g, '') === kb.replace(/\s+/g, '')) return true;

  // Compare with parenthetical qualifiers stripped (e.g. "SAT" suffix or "(NYC)" city tag)
  const sa = venueKey(stripParentheticals(a));
  const sb = venueKey(stripParentheticals(b));
  if (sa && sb) {
    if (sa === sb || sa.replace(/\s+/g, '') === sb.replace(/\s+/g, '')) return true;
  }

  // Sorted tokens handle French/English flips: "Beanfield Theatre" <-> "Théâtre Beanfield", "Bell Centre" <-> "Centre Bell"
  const sortedA = ka.split(' ').sort().join(' ');
  const sortedB = kb.split(' ').sort().join(' ');
  if (sortedA === sortedB) return true;
  if (sa && sb && sa.split(' ').sort().join(' ') === sb.split(' ').sort().join(' ')) return true;

  // Optional "theater"/"center" suffix/prefix: "L'Olympia" <-> "L' Olympia Theatre"
  const coreA = venueCoreTokens(sa || ka);
  const coreB = venueCoreTokens(sb || kb);
  if (coreA.length > 0 && coreB.length > 0) {
    const coreKeyA = coreA.slice().sort().join(' ');
    const coreKeyB = coreB.slice().sort().join(' ');
    const isSubstantive = coreA.length >= 2 || (coreA[0].length >= 4 && !GENERIC_VENUE_CORES.has(coreA[0]));
    if (isSubstantive && coreKeyA === coreKeyB) return true;
  }

  // Bilingual parenthetical acronyms: e.g. "Société des arts technologiques (SAT)" <-> "Society for Arts and Technology (SAT)" / "SAT"
  const infoA = extractVenueAcronymInfo(a);
  const infoB = extractVenueAcronymInfo(b);
  for (const code of infoA.explicit) {
    if (infoB.explicit.has(code) || infoB.implicit.has(code)) return true;
  }
  for (const code of infoB.explicit) {
    if (infoA.implicit.has(code)) return true;
  }

  return false;
}

/**
 * Clean an act or event title for fuzzy comparison: strips tour subtitles,
 * release/age/live tags, promoter "presents:" prefixes, inline support clauses,
 * diacritics, dotted initials, apostrophes, and leading "The".
 */
export function cleanActForMatch(name) {
  let s = stripDiacriticsLower(name).trim();
  if (!s) return '';

  // Strip promoter prefixes like "Bowery Presents: Band Name"
  s = s.replace(/^[^:]{2,40}\bpresents\s*[:\-–—]\s*/, '');
  // Strip "An Evening With ..."
  s = s.replace(/^(?:an\s+)?evening\s+with\s+/, '');

  // Strip parenthetical / bracketed qualifier tags (or trailing parens when prefix is non-empty)
  s = s.replace(/\s*\(([^)]*)\)/g, (full, inner, offset) => {
    if (offset > 1 && PAREN_TAG_RX.test(inner)) return '';
    return full;
  });
  s = s.replace(/\s*\[([^\]]*)\]/g, (full, inner, offset) => {
    if (offset > 1 && PAREN_TAG_RX.test(inner)) return '';
    return full;
  });

  // Strip trailing tour/event subtitles after delimiter (: , - , – , — , | )
  const sepMatch = /^(.{1,80}?)\s*(?::\s+|\s+[-–—|]\s+)(.+)$/.exec(s);
  if (sepMatch && SUBTITLE_KEYWORDS_RX.test(sepMatch[2])) {
    s = sepMatch[1].trim();
  }

  // Strip inline support clauses ("Band A w/ Band B", "Band A with Band B", "Band A feat. Band B")
  s = s.replace(/^(.{2,}?)\s+(?:w\/|with|feat\.?|ft\.?|featuring)\s+.+$/, '$1');

  // Strip unpunctuated trailing tour / album-release suffixes
  s = s.replace(/^(.{2,}?)\s+(?:album|record|ep|single)\s+release(?:\s+(?:show|party|concert))?$/, '$1');
  s = s.replace(/^(.{2,}?)\s+(?:(?:north\s+american|world|us|usa|canada|canadian|uk|european|spring|summer|fall|winter|20\d{2})\s+)*tour(?:\s+20\d{2})?$/, '$1');
  s = s.replace(/^(.{2,}?)\s+live\s+(?:in|at)\s+[a-z0-9\s]+$/, '$1');

  // Collapse dotted initials ("D.C." -> "dc", "R.E.M." -> "rem", "A.G." -> "ag") and title abbreviations
  s = s.replace(/\b(st|dr|mr|mrs|ms|jr|sr)\./g, '$1');
  let prev;
  do {
    prev = s;
    s = s.replace(/\b([a-z])\.([a-z])\b/g, '$1$2').replace(/\b([a-z]{2,})\.(?=\s|$)/g, '$1');
  } while (s !== prev);
  s = s.replace(/\b([a-z])\.(?=\s|$)/g, '$1');

  s = s
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  return s;
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (a.length > b.length) [a, b] = [b, a];
  let prev = new Array(a.length + 1);
  let curr = new Array(a.length + 1);
  for (let i = 0; i <= a.length; i++) prev[i] = i;
  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    const bj = b.charCodeAt(j - 1);
    for (let i = 1; i <= a.length; i++) {
      const cost = a.charCodeAt(i - 1) === bj ? 0 : 1;
      curr[i] = Math.min(prev[i] + 1, curr[i - 1] + 1, prev[i - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

function prefixBeforeSubtitle(raw) {
  const s = stripDiacriticsLower(raw).trim();
  const m = /^(.{1,80}?)\s*(?::\s+|\s+[-–—|]\s+).+$/.exec(s);
  return m ? cleanActForMatch(m[1]) : '';
}

/**
 * Similarity score in [0, 1] between two act names.
 * Guards against false positives on short names (<=3 chars require exact match)
 * and distinct numeric suffixes (e.g. Band 10 vs Band 11).
 */
export function actSimilarity(rawA, rawB) {
  const a = cleanActForMatch(rawA);
  const b = cleanActForMatch(rawB);
  if (!a || !b) return 0;
  if (a === b) return 1;

  const ac = a.replace(/\s+/g, '');
  const bc = b.replace(/\s+/g, '');
  if (ac === bc) return 0.98;

  // Handle untagged subtitle separators like "METZ: Strange Peace" vs "METZ"
  const pa = prefixBeforeSubtitle(rawA);
  const pb = prefixBeforeSubtitle(rawB);
  if ((pa && pa === b) || (pb && pb === a) || (pa && pb && pa === pb)) {
    return 0.95;
  }

  // Short names (<= 3 chars, e.g. "X", "Air", "Low") require exact match after cleaning
  if (Math.min(ac.length, bc.length) <= 3) return 0;

  // Distinct embedded numbers (e.g. "Band 30" vs "Band 60", "Sum 41" vs "Sum 42") never fuzzy-match
  const numsA = ac.match(/\d+/g) || [];
  const numsB = bc.match(/\d+/g) || [];
  if ((numsA.length > 0 || numsB.length > 0) && numsA.join(',') !== numsB.join(',')) {
    return 0;
  }

  // Word-boundary prefix match for untagged subtitles / backing bands ("Rev. Vince Anderson" vs "... & The Love Choir")
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if ((shorter.length >= 5 || (shorter.includes(' ') && shorter.length >= 4)) && longer.startsWith(`${shorter} `)) {
    return 0.9;
  }

  // Token-set overlap (ignoring filler words when substantive tokens exist)
  const rawTokA = a.split(' ').filter(Boolean);
  const rawTokB = b.split(' ').filter(Boolean);
  const tokA = new Set(rawTokA.filter((t) => !ACT_STOPWORDS.has(t)));
  const tokB = new Set(rawTokB.filter((t) => !ACT_STOPWORDS.has(t)));
  let tokenDice = 0;
  if (tokA.size > 0 && tokB.size > 0) {
    let inter = 0;
    for (const t of tokA) {
      if (tokB.has(t)) inter++;
    }
    if (inter === tokA.size && inter === tokB.size) return 0.95;
    tokenDice = (2 * inter) / (tokA.size + tokB.size);
  }

  const editSim = 1 - levenshtein(ac, bc) / Math.max(ac.length, bc.length);
  return Math.max(editSim, tokenDice);
}

function splitCoBillParts(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const out = [s];
  // Split explicit co-bill delimiters: " / ", " // ", " + " (not "+ the"), " w/ ", " with ", " feat. ", " ft. ", " b2b ", ", "
  const parts = s.split(/\s*(?:\s\/+\s|\s\+\s(?!the\b)|\s+(?:w\/|with|feat\.?|ft\.?|featuring|b2b)\s+|,\s+(?!the\b))/i);
  if (parts.length > 1) {
    for (const p of parts) {
      const trimmed = p.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  // Split "Band A & Band B" co-bills (avoiding "Band & The Backing Band")
  const ampParts = s.split(/\s+&\s+(?!the\b)/i);
  if (ampParts.length > 1) {
    for (const p of ampParts) {
      const trimmed = p.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

function collectShowActNames(show) {
  const sorted = [...(show.acts || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const headRaw = sorted[0]?.name || show.title || '';
  const headCandidates = splitCoBillParts(headRaw);
  const allCandidates = [];
  const seen = new Set();
  const pushAll = (raw) => {
    for (const part of splitCoBillParts(raw)) {
      const key = cleanActForMatch(part);
      if (key && !seen.has(key)) {
        seen.add(key);
        allCandidates.push(part);
      }
    }
  };
  for (const act of sorted) pushAll(act.name);
  if (show.title) pushAll(show.title);
  return { headCandidates, allCandidates };
}

/**
 * Determine whether two show records represent the same concert.
 * Checks metro, effective night date, fuzzy venue match, >=2h early/late set separation,
 * and fuzzy act/co-bill/flipped-headliner matching.
 */
export function sameShow(a, b) {
  if (!a || !b) return false;
  if ((a.venue?.metro || '') !== (b.venue?.metro || '')) return false;

  const nightA = effectiveShowDate(a.startsAt);
  const nightB = effectiveShowDate(b.startsAt);
  if (!nightA || !nightB || nightA !== nightB) return false;

  if (!sameVenueName(a.venue?.name, b.venue?.name)) return false;

  // Keep distinct early/late sets (>= 2h apart) separate when both start times are real.
  if (!a.timeTba && !b.timeTba) {
    const ta = Date.parse(a.startsAt);
    const tb = Date.parse(b.startsAt);
    if (Number.isFinite(ta) && Number.isFinite(tb) && Math.abs(ta - tb) >= TWO_HOURS_MS) {
      return false;
    }
  }

  const actsA = collectShowActNames(a);
  const actsB = collectShowActNames(b);
  if (actsA.allCandidates.length === 0 || actsB.allCandidates.length === 0) return false;

  // 1. Headliner (or co-bill component of headliner) matches any billed act on the other record
  for (const ha of actsA.headCandidates) {
    for (const cb of actsB.allCandidates) {
      if (actSimilarity(ha, cb) >= ACT_MATCH_THRESHOLD) return true;
    }
  }
  for (const hb of actsB.headCandidates) {
    for (const ca of actsA.allCandidates) {
      if (actSimilarity(hb, ca) >= ACT_MATCH_THRESHOLD) return true;
    }
  }

  // 2. Multi-act support overlap (>= 2 matching acts across the two bills)
  let shared = 0;
  for (const ca of actsA.allCandidates) {
    if (actsB.allCandidates.some((cb) => actSimilarity(ca, cb) >= ACT_MATCH_THRESHOLD)) {
      shared++;
      if (shared >= 2) return true;
    }
  }

  return false;
}

const GENRE_BY_LOWER = new Map([...ALLOWED_GENRES_SET].map((g) => [g.toLowerCase(), g]));
GENRE_BY_LOWER.set('club & techno', 'Electronic');
GENRE_BY_LOWER.set('club and techno', 'Electronic');
GENRE_BY_LOWER.set('edm', 'Electronic');

function cleanGenres(rawGenres) {
  if (!Array.isArray(rawGenres)) return [];
  const out = [];
  for (const g of rawGenres) {
    if (typeof g !== 'string') continue;
    const mapped = GENRE_BY_LOWER.get(g.trim().toLowerCase());
    if (mapped && !out.includes(mapped)) {
      out.push(mapped);
    }
  }
  return out;
}

const EXPLICIT_FREE_TITLE_RX =
  /(?:^|[\s\-–—:(/\[])(?:free\s+(?:show|admission|entry|concert|event|music|jazz|gig|night|live)|no\s+cover)(?:$|[\s\-–—:)/\]!.,])|\((?:free|no\s+cover)\)|\[(?:free|no\s+cover)\]/i;

function parsePriceAmount(val) {
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0 ? val : undefined;
  }
  if (typeof val === 'string') {
    const cleaned = val.trim().replace(/^(?:US|CA|C)?\$\s*/i, '').replace(/,/g, '');
    if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return undefined;
    const n = Number(cleaned);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  return undefined;
}

/**
 * Normalize a price object or string (coercing "$15"/"15", normalizing $0 to isFree,
 * and detecting explicit free-show/no-cover cues in an optional event title).
 */
export function cleanPrice(raw, fallbackTitle = '') {
  let min;
  let max;
  let isFree = false;
  let notaflof = false;

  if (typeof raw === 'string') {
    const s = raw.trim();
    if (/\b(free|no\s+cover)\b/i.test(s)) isFree = true;
    if (/\b(notaflof|sliding\s+scale|pay\s+what\s+you\s+can|pwyc|donation)\b/i.test(s)) notaflof = true;
    const amounts = [...s.matchAll(/\$\s*(\d+(?:\.\d{1,2})?)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (amounts.length === 1) {
      min = amounts[0];
    } else if (amounts.length >= 2) {
      min = Math.min(...amounts);
      max = Math.max(...amounts);
    } else if (!isFree) {
      min = parsePriceAmount(s);
    }
  } else if (raw && typeof raw === 'object') {
    min = parsePriceAmount(raw.min ?? raw.priceMin ?? raw.price_min ?? raw.amount);
    max = parsePriceAmount(raw.max ?? raw.priceMax ?? raw.price_max);
    isFree = raw.isFree === true || raw.is_free === true;
    notaflof = raw.notaflof === true;
  }

  if (min != null && max != null && max < min) {
    [min, max] = [max, min];
  }
  if (min === 0 && (max == null || max === 0)) {
    isFree = true;
    min = undefined;
    max = undefined;
  }
  if (!isFree && min == null && max == null && typeof fallbackTitle === 'string' && EXPLICIT_FREE_TITLE_RX.test(fallbackTitle)) {
    isFree = true;
  }

  return {
    ...(min != null ? { min } : {}),
    ...(max != null ? { max } : {}),
    ...(isFree ? { isFree: true } : {}),
    ...(notaflof ? { notaflof: true } : {}),
  };
}

function mergePrices(primaryPrice, secondaryPrice) {
  const p = primaryPrice || {};
  const s = secondaryPrice || {};
  const pHasValue = p.isFree === true || p.min != null || p.max != null;
  const sHasValue = s.isFree === true || s.min != null || s.max != null;
  const base = pHasValue ? p : (sHasValue ? s : {});
  const notaflof = p.notaflof === true || s.notaflof === true;
  return {
    ...base,
    ...(notaflof ? { notaflof: true } : {}),
  };
}

/** Infer NYC borough/area from a city or address string when fp.shows lacks venue.area. */
export function inferAreaFromCity(city, address, metroId) {
  const hay = `${city || ''} ${address || ''}`.toLowerCase();
  if (metroId === 'nyc') {
    if (hay.includes('brooklyn')) return 'Brooklyn';
    if (
      hay.includes('queens') || hay.includes('ridgewood') || hay.includes('astoria') ||
      hay.includes('long island city') || hay.includes('maspeth') || hay.includes('flushing')
    ) return 'Queens';
    if (hay.includes('bronx')) return 'Bronx';
    if (hay.includes('staten island')) return 'Staten Island';
    if (
      hay.includes('jersey city') || hay.includes('hoboken') || hay.includes('newark') ||
      hay.includes('montclair') || hay.includes('clifton') || hay.includes('rutherford') ||
      /\b,?\s*nj\b/i.test(hay)
    ) return 'North Jersey';
    if (hay.includes('manhattan') || hay.includes('new york')) return 'Manhattan';
    return 'New York City';
  }
  const firstCity = String(city || '').split(',')[0].trim();
  return firstCity || getMetro(metroId).name;
}

/** Infer city ("Brooklyn, NY") from an address string ("1140 Myrtle Ave, Brooklyn, NY 11206"). */
function inferCityFromAddress(address, metroId) {
  if (typeof address === 'string') {
    const m = /,\s*([^,]+),\s*([A-Za-z]{2})\b/.exec(address);
    if (m) return `${m[1].trim()}, ${m[2].toUpperCase()}`;
  }
  const metro = getMetro(metroId);
  return `${metro.name}, ${metro.state}`;
}

/** Normalize an act entry (preserving optional previewUrl / deezerArtistId if supplied). */
function normalizeAct(rawAct, index) {
  if (typeof rawAct === 'string') {
    const name = rawAct.trim();
    return name ? { name, order: index } : null;
  }
  if (!rawAct || typeof rawAct !== 'object') return null;
  const name = typeof rawAct.name === 'string' ? rawAct.name.trim() : '';
  if (!name) return null;
  const previewUrl = safeWebUrl(rawAct.previewUrl ?? rawAct.preview_url ?? rawAct.links?.previewUrl);
  const deezerArtistId = Number.isFinite(Number(rawAct.links?.deezerArtistId ?? rawAct.deezerArtistId ?? rawAct.deezer_artist_id))
    ? Number(rawAct.links?.deezerArtistId ?? rawAct.deezerArtistId ?? rawAct.deezer_artist_id)
    : undefined;
  return {
    name,
    order: typeof rawAct.order === 'number' ? rawAct.order : index,
    ...(previewUrl ? { previewUrl } : {}),
    ...(deezerArtistId ? { links: { ...(rawAct.links || {}), deezerArtistId } } : rawAct.links ? { links: rawAct.links } : {}),
  };
}

/**
 * Convert a row returned by Supabase RPC `public.fp_public_shows(p_metro)` into a normalized Show.
 * Matches the Setnik app/src/lib/fpMerge.ts `parseFpRows` & `fromRow`.
 */
export function normalizeFpRow(r, fallbackMetro) {
  if (!r || typeof r !== 'object') return null;
  if (r.pending === true) return null;
  const id = typeof r.id === 'string' && r.id ? r.id : null;
  const metro = typeof r.metro === 'string' && r.metro ? r.metro : fallbackMetro;
  const venueName = typeof r.venueName === 'string' && r.venueName.trim() ? r.venueName.trim() : null;
  const headliner = typeof r.headliner === 'string' && r.headliner.trim() ? r.headliner.trim() : null;
  if (!id || !metro || !venueName || !headliner) return null;

  const startsAt = ensureOffsetIso(
    r.startsAt || (r.localDate ? `${r.localDate}T${(r.startLocal || '20:00').slice(0, 5)}:00` : null),
    metro,
  );
  if (!startsAt) return null;

  const doorsAt = r.doorsAt
    ? ensureOffsetIso(r.doorsAt, metro)
    : (r.localDate && r.doorsLocal ? ensureOffsetIso(`${r.localDate}T${r.doorsLocal.slice(0, 5)}:00`, metro) : null);

  const addressMode = r.addressMode === 'registry' ? 'registry' : 'withheld';
  const address = addressMode === 'registry' && typeof r.address === 'string' && r.address.trim() ? r.address.trim() : undefined;
  const city = (typeof r.city === 'string' && r.city.trim()) ? r.city.trim() : inferCityFromAddress(address, metro);
  const area = (typeof r.area === 'string' && r.area.trim()) ? r.area.trim() : inferAreaFromCity(city, address, metro);
  const neighborhood = (typeof r.neighborhood === 'string' && r.neighborhood.trim()) ? r.neighborhood.trim() : area;

  const supports = Array.isArray(r.supports) ? r.supports : [];
  const acts = [
    normalizeAct(
      typeof r.previewUrl === 'string' || typeof r.preview_url === 'string'
        ? { name: headliner, order: 0, previewUrl: r.previewUrl ?? r.preview_url }
        : headliner,
      0,
    ),
    ...supports.map((s, i) => normalizeAct(s, i + 1)),
  ].filter(Boolean);

  const imageUrl = safeWebUrl(r.imageUrl);
  const sourceType = Array.isArray(r.sources) && r.sources.some((s) => s?.sourceType === 'venue_site') ? 'venue_site' : 'flyer';
  const sourceUrl = Array.isArray(r.sources) ? safeWebUrl(r.sources.find((s) => s?.url)?.url) : null;

  return {
    id: `fp:${id}`,
    title: typeof r.title === 'string' && r.title.trim() ? r.title.trim() : undefined,
    startsAt,
    ...(doorsAt ? { doorsAt } : {}),
    timeTba: r.timeTba === true || !r.startLocal ? true : undefined,
    venue: {
      name: venueName,
      neighborhood,
      area,
      metro,
      city,
      ...(address ? { address } : {}),
      addressVisibility: address ? 'public' : 'on_request',
      ...(typeof r.lat === 'number' && Number.isFinite(r.lat) ? { lat: r.lat } : {}),
      ...(typeof r.lng === 'number' && Number.isFinite(r.lng) ? { lng: r.lng } : {}),
    },
    acts,
    genres: cleanGenres(r.genres),
    price: cleanPrice(
      r.price ?? (r.price_min != null || r.price_max != null || r.is_free === true
        ? { min: r.price_min, max: r.price_max, isFree: r.is_free === true, notaflof: r.notaflof === true }
        : null),
      typeof r.title === 'string' ? r.title : '',
    ),
    ...(imageUrl ? { flyerImages: [imageUrl] } : {}),
    ticketUrl: safeWebUrl(r.ticketUrl) ?? undefined,
    previewUrl: safeWebUrl(r.previewUrl ?? r.preview_url) ?? undefined,
    status: r.status === 'cancelled' || r.status === 'moved' ? r.status : 'scheduled',
    source: {
      provider: sourceType,
      url: sourceUrl || '',
      fetchedAt: r.sources?.[0]?.fetchedAt || new Date().toISOString(),
    },
    priority: 3, // First-party Supabase data wins field conflicts
  };
}

function offsetMinToString(min) {
  const n = Math.trunc(Number(min) || 0);
  const sign = n < 0 ? '-' : '+';
  const a = Math.abs(n);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/**
 * Convert a row from Supabase `public.submissions` table into a normalized Show.
 * Matches the Setnik app/src/lib/community/form.ts `rowToShow`.
 */
export function normalizeSubmissionRow(row) {
  if (!row || typeof row !== 'object') return null;
  if (row.status && row.status !== 'live') return null;
  const id = typeof row.id === 'string' && row.id ? row.id : null;
  const metro = typeof row.metro === 'string' && row.metro ? row.metro : null;
  const venueName = typeof row.venue_name === 'string' && row.venue_name.trim() ? row.venue_name.trim() : null;
  const venueArea = typeof row.venue_area === 'string' && row.venue_area.trim() ? row.venue_area.trim() : null;
  if (!id || !metro || !venueName || !venueArea) return null;

  const metroObj = getMetro(metro);
  const acts = (Array.isArray(row.acts) ? row.acts : []).map((a, i) => normalizeAct(a, i)).filter(Boolean);
  const title = typeof row.title === 'string' && row.title.trim() ? row.title.trim() : undefined;
  if (acts.length === 0 && !title) return null;

  const startsAt = row.starts_local && row.utc_offset_min != null
    ? `${row.starts_local}:00${offsetMinToString(row.utc_offset_min)}`
    : ensureOffsetIso(row.starts_local || row.starts_at, metro);
  if (!startsAt) return null;

  const address = typeof row.venue_address === 'string' && row.venue_address.trim() ? row.venue_address.trim() : undefined;
  const area = metro === 'nyc' ? inferAreaFromCity(venueArea, address, metro) : venueArea;

  return {
    id: `cm-${id}`,
    title,
    startsAt,
    venue: {
      name: venueName,
      neighborhood: venueArea,
      area,
      metro,
      city: `${venueArea}, ${metroObj.state}`,
      ...(address ? { address } : {}),
      addressVisibility: address ? 'public' : 'neighborhood_only',
    },
    acts,
    genres: cleanGenres(row.genres),
    price: cleanPrice({
      min: row.price_min,
      max: row.price_max,
      isFree: row.is_free === true,
      notaflof: row.notaflof === true,
    }, title || ''),
    ticketUrl: safeWebUrl(row.ticket_url ?? row.source_url) ?? undefined,
    previewUrl: safeWebUrl(row.preview_url) ?? undefined,
    status: 'scheduled',
    source: {
      provider: 'community',
      url: safeWebUrl(row.source_url) || '',
      fetchedAt: row.created_at || new Date().toISOString(),
    },
    priority: 2,
  };
}

/**
 * Normalize a Show object from `setnik-listings` release feeds (`shows-{metro}.json`) or mock fixtures.
 * Matches the Setnik app/src/lib/listings/validate.ts `cleanShow`.
 */
export function normalizeFeedShow(raw, fallbackMetro) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : null;
  const v = raw.venue;
  if (!id || !v || typeof v !== 'object' || typeof v.name !== 'string' || !v.name.trim()) return null;

  const metro = (typeof v.metro === 'string' && v.metro) || fallbackMetro || 'nyc';
  const startsAt = ensureOffsetIso(raw.startsAt, metro);
  if (!startsAt) return null;

  const acts = (Array.isArray(raw.acts) ? raw.acts : []).map((a, i) => normalizeAct(a, i)).filter(Boolean);
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined;
  if (acts.length === 0 && !title) return null;

  const doorsAt = raw.doorsAt ? ensureOffsetIso(raw.doorsAt, metro) : undefined;
  const endsAt = raw.endsAt ? ensureOffsetIso(raw.endsAt, metro) : undefined;
  const area = (typeof v.area === 'string' && v.area.trim()) || inferAreaFromCity(v.city, v.address, metro);
  const neighborhood = (typeof v.neighborhood === 'string' && v.neighborhood.trim()) || area;
  const city = (typeof v.city === 'string' && v.city.trim()) || inferCityFromAddress(v.address, metro);
  const addressVisibility = ['public', 'neighborhood_only', 'on_request'].includes(v.addressVisibility)
    ? v.addressVisibility
    : 'public';
  const address = typeof v.address === 'string' && v.address.trim() ? v.address.trim() : undefined;
  const images = (Array.isArray(raw.flyerImages) ? raw.flyerImages : []).map(safeWebUrl).filter(Boolean);

  return {
    id,
    title,
    startsAt,
    ...(doorsAt ? { doorsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
    ...(raw.timeTba === true ? { timeTba: true } : {}),
    venue: {
      name: v.name.trim(),
      neighborhood,
      area,
      metro,
      city,
      ...(address ? { address } : {}),
      addressVisibility,
      ...(typeof v.lat === 'number' && Number.isFinite(v.lat) ? { lat: v.lat } : {}),
      ...(typeof v.lng === 'number' && Number.isFinite(v.lng) ? { lng: v.lng } : {}),
    },
    acts,
    genres: cleanGenres(raw.genres),
    price: cleanPrice(raw.price, title || ''),
    ...(images.length ? { flyerImages: images } : {}),
    ...(typeof raw.flyerCredit === 'string' && raw.flyerCredit.trim() ? { flyerCredit: raw.flyerCredit.trim() } : {}),
    ticketUrl: safeWebUrl(raw.ticketUrl) ?? undefined,
    previewUrl: safeWebUrl(raw.previewUrl ?? raw.preview_url) ?? undefined,
    status: raw.status === 'cancelled' || raw.status === 'moved' ? raw.status : 'scheduled',
    source: {
      provider: typeof raw.source?.provider === 'string' ? raw.source.provider : 'feed',
      url: safeWebUrl(raw.source?.url) || '',
      fetchedAt: typeof raw.source?.fetchedAt === 'string' ? raw.source.fetchedAt : '',
    },
    priority: 1,
  };
}

function findMatchingAct(act, candidates) {
  if (!candidates || candidates.length === 0) return null;
  const exactKey = normKeyPart(act.name);
  if (exactKey) {
    const exact = candidates.find((c) => normKeyPart(c.name) === exactKey);
    if (exact) return exact;
  }
  let best = null;
  let bestScore = ACT_MATCH_THRESHOLD;
  for (const c of candidates) {
    const score = actSimilarity(act.name, c.name);
    if (score >= bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

/** Merge two records representing the same show, preferring higher-priority source while enriching missing fields. */
export function mergeTwoShows(existing, incoming) {
  const [primary, secondary] = (incoming.priority ?? 1) > (existing.priority ?? 1)
    ? [incoming, existing]
    : [existing, incoming];

  // Cancelled status always wins so we never advertise a cancelled show as scheduled.
  const status = existing.status === 'cancelled' || incoming.status === 'cancelled'
    ? 'cancelled'
    : (primary.status !== 'scheduled' ? primary.status : secondary.status);

  // Respect non-public address visibility if either record explicitly withheld a private/DIY address.
  const address = primary.venue.addressVisibility === 'public' && primary.venue.address
    ? primary.venue.address
    : (secondary.venue.addressVisibility === 'public' && secondary.venue.address ? secondary.venue.address : undefined);
  const addressVisibility = address ? 'public' : (primary.venue.addressVisibility || secondary.venue.addressVisibility);

  // Prefer a concrete startsAt over a timeTba 20:00 placeholder even when the placeholder has higher priority.
  const primaryHasRealTime = !primary.timeTba && Boolean(primary.startsAt);
  const secondaryHasRealTime = !secondary.timeTba && Boolean(secondary.startsAt);
  const startsAt = primaryHasRealTime
    ? primary.startsAt
    : (secondaryHasRealTime ? secondary.startsAt : (primary.startsAt || secondary.startsAt));
  const timeTba = (primaryHasRealTime || secondaryHasRealTime)
    ? undefined
    : ((primary.timeTba || secondary.timeTba) ? true : undefined);

  // Merge acts while keeping richer lineup and fuzzily enriching previewUrl / deezerArtistId links.
  const primaryIsBase = primary.acts.length >= secondary.acts.length;
  const baseActs = primaryIsBase ? primary.acts : secondary.acts;
  const otherActs = primaryIsBase ? secondary.acts : primary.acts;
  const acts = baseActs.map((a, idx) => {
    const other = findMatchingAct(a, otherActs);
    const pref = primaryIsBase ? a : (other || a);
    const fallback = primaryIsBase ? other : a;
    const previewUrl = pref?.previewUrl || fallback?.previewUrl;
    const mergedLinks = (fallback?.links || pref?.links)
      ? { ...(fallback?.links || {}), ...(pref?.links || {}) }
      : undefined;
    return {
      ...other,
      ...a,
      order: idx,
      ...(previewUrl ? { previewUrl } : {}),
      ...(mergedLinks ? { links: mergedLinks } : {}),
    };
  });

  const genres = [...new Set([...(primary.genres || []), ...(secondary.genres || [])])];

  return {
    ...secondary,
    ...primary,
    startsAt,
    status,
    title: primary.title || secondary.title,
    doorsAt: primary.doorsAt || secondary.doorsAt,
    endsAt: primary.endsAt || secondary.endsAt,
    timeTba,
    venue: {
      ...secondary.venue,
      ...primary.venue,
      neighborhood: primary.venue.neighborhood && primary.venue.neighborhood !== primary.venue.area
        ? primary.venue.neighborhood
        : (secondary.venue.neighborhood || primary.venue.neighborhood),
      area: primary.venue.area || secondary.venue.area,
      city: primary.venue.city || secondary.venue.city,
      address,
      addressVisibility,
      lat: primary.venue.lat ?? secondary.venue.lat,
      lng: primary.venue.lng ?? secondary.venue.lng,
    },
    acts,
    genres,
    price: mergePrices(primary.price, secondary.price),
    ticketUrl: primary.ticketUrl || secondary.ticketUrl,
    previewUrl: primary.previewUrl || secondary.previewUrl,
    flyerImages: primary.flyerImages?.length ? primary.flyerImages : secondary.flyerImages,
  };
}

/** Deduplicate and sort shows chronologically, filtering to the [today, today + windowDays] night window. */
export function combineAndFilterShows(shows, { now = new Date(), windowDays = DEFAULT_WINDOW_DAYS } = {}) {
  const windowByMetro = new Map();
  const buckets = new Map();

  for (const s of shows) {
    if (!s) continue;
    const nightDate = effectiveShowDate(s.startsAt);
    if (!nightDate) continue;
    const metro = getMetro(s.venue?.metro);
    let win = windowByMetro.get(metro.id);
    if (!win) {
      const today = effectiveLocalYmd(now, metro.tz);
      win = { today, maxDate: addDaysYmd(today, windowDays) };
      windowByMetro.set(metro.id, win);
    }
    if (nightDate < win.today || nightDate > win.maxDate) continue;

    const bucketKey = `${metro.id}|${nightDate}`;
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = [];
      buckets.set(bucketKey, bucket);
    }

    const matchIndices = [];
    for (let i = 0; i < bucket.length; i++) {
      if (sameShow(bucket[i], s)) matchIndices.push(i);
    }

    if (matchIndices.length === 0) {
      bucket.push(s);
    } else {
      let merged = mergeTwoShows(bucket[matchIndices[0]], s);
      // Merge any additional transitively matching entries (only if still compatible, so early/late sets never collapse)
      for (let j = matchIndices.length - 1; j >= 1; j--) {
        if (sameShow(merged, bucket[matchIndices[j]])) {
          merged = mergeTwoShows(merged, bucket[matchIndices[j]]);
          bucket.splice(matchIndices[j], 1);
        }
      }
      bucket[matchIndices[0]] = merged;
    }
  }

  const combined = [];
  for (const bucket of buckets.values()) {
    for (const show of bucket) combined.push(show);
  }

  return combined.sort((a, b) => {
    const tDiff = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
    if (tDiff !== 0) return tDiff;
    return a.venue.name.localeCompare(b.venue.name) || headlinerName(a).localeCompare(headlinerName(b));
  });
}

async function fetchJson(url, options = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: ctl.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function supabaseHeaders(anonKey) {
  return {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/** Read Setnik's remote kill switches from Supabase (defaults to all ON if unavailable). */
export async function fetchKillSwitches(supabaseUrl, anonKey, log = console) {
  const result = { jambaseEnabled: true, deezerEnabled: true };
  if (!supabaseUrl || !anonKey) return result;
  const base = supabaseUrl.replace(/\/+$/, '');
  const headers = supabaseHeaders(anonKey);

  try {
    const flags = await fetchJson(`${base}/rest/v1/rpc/get_flags`, { method: 'POST', headers, body: '{}' });
    if (Array.isArray(flags)) {
      for (const row of flags) {
        if (row?.key === 'jambase_enabled' && typeof row.enabled === 'boolean') result.jambaseEnabled = row.enabled;
        if (row?.key === 'deezer_enabled' && typeof row.enabled === 'boolean') result.deezerEnabled = row.enabled;
      }
    }
  } catch (err) {
    log.warn?.(`[warn] Could not read get_flags() from Supabase (${err.message}); using defaults.`);
  }

  try {
    const sw = await fetchJson(`${base}/rest/v1/rpc/fp_licensed_switches`, { method: 'POST', headers, body: '{}' });
    if (sw && typeof sw === 'object' && sw.jambase_listings === false) {
      result.jambaseEnabled = false;
    }
  } catch (err) {
    log.warn?.(`[warn] Could not read fp_licensed_switches() from Supabase (${err.message}); using defaults.`);
  }

  return result;
}

/**
 * Fetch upcoming shows across configured metros from Supabase (fp_public_shows RPC + public.submissions)
 * and optionally public setnik-listings release feeds.
 */
export async function fetchLiveListings({
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseAnonKey = process.env.SUPABASE_ANON_KEY,
  metros = DEFAULT_METROS,
  windowDays = DEFAULT_WINDOW_DAYS,
  includeListingsFeed = process.env.INCLUDE_LISTINGS_FEED !== 'false',
  feedUrlTemplate = process.env.LISTINGS_FEED_URL_TEMPLATE || DEFAULT_LISTINGS_FEED_URL_TEMPLATE,
  now = new Date(),
  log = console,
} = {}) {
  const warnings = [];
  const attribution = new Set();
  const rawShows = [];
  const cleanSupabaseUrl = (supabaseUrl || '').trim().replace(/\/+$/, '');
  const cleanAnonKey = (supabaseAnonKey || '').trim();

  if (!cleanSupabaseUrl || !cleanAnonKey) {
    const msg = 'SUPABASE_URL or SUPABASE_ANON_KEY is not set; skipping Supabase RPC/table queries.';
    warnings.push(msg);
    log.warn?.(`[warn] ${msg}`);
  }

  const flags = await fetchKillSwitches(cleanSupabaseUrl, cleanAnonKey, log);
  const sinceIso = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();

  for (const metro of metros) {
    // 1. Supabase first-party shows via public.fp_public_shows(p_metro) RPC
    if (cleanSupabaseUrl && cleanAnonKey) {
      try {
        const rows = await fetchJson(`${cleanSupabaseUrl}/rest/v1/rpc/fp_public_shows`, {
          method: 'POST',
          headers: supabaseHeaders(cleanAnonKey),
          body: JSON.stringify({ p_metro: metro }),
        });
        if (Array.isArray(rows)) {
          for (const r of rows) {
            const show = normalizeFpRow(r, metro);
            if (show) rawShows.push(show);
          }
        }
      } catch (err) {
        const msg = `Supabase fp_public_shows(${metro}) failed: ${err.message}`;
        warnings.push(msg);
        log.warn?.(`[warn] ${msg}`);
      }

      // 2. Supabase community submissions via public.submissions (anon SELECT via RLS)
      try {
        const params = new URLSearchParams({
          select: '*',
          metro: `eq.${metro}`,
          status: 'eq.live',
          starts_at: `gt.${sinceIso}`,
          order: 'starts_at.asc',
          limit: '500',
        });
        const rows = await fetchJson(`${cleanSupabaseUrl}/rest/v1/submissions?${params}`, {
          method: 'GET',
          headers: supabaseHeaders(cleanAnonKey),
        });
        if (Array.isArray(rows)) {
          for (const r of rows) {
            const show = normalizeSubmissionRow(r);
            if (show) rawShows.push(show);
          }
        }
      } catch (err) {
        const msg = `Supabase public.submissions(${metro}) failed: ${err.message}`;
        warnings.push(msg);
        log.warn?.(`[warn] ${msg}`);
      }
    }

    // 3. Public setnik-listings release feed (gated by jambase_enabled kill switch)
    if (includeListingsFeed && flags.jambaseEnabled && feedUrlTemplate) {
      const feedUrl = feedUrlTemplate.replace('{metro}', encodeURIComponent(metro));
      try {
        const feed = await fetchJson(feedUrl, { headers: { Accept: 'application/json' } });
        if (feed && Array.isArray(feed.shows)) {
          for (const item of feed.shows) {
            const show = normalizeFeedShow(item, metro);
            if (show) rawShows.push(show);
          }
          if (Array.isArray(feed.attribution)) {
            for (const line of feed.attribution) {
              if (typeof line === 'string' && line.trim()) attribution.add(line.trim());
            }
          }
        }
      } catch (err) {
        const msg = `Public listings feed (${metro}) unavailable: ${err.message}`;
        warnings.push(msg);
        log.warn?.(`[warn] ${msg}`);
      }
    }
  }

  const shows = combineAndFilterShows(rawShows, { now, windowDays });
  return {
    shows,
    flags,
    attribution: [...attribution],
    warnings,
  };
}
