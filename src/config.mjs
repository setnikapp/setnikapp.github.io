/**
 * Central configuration and domain constants for Setnik Web.
 * Mirrors Setnik app src/lib/hosting.ts, src/lib/metros.ts, and src/lib/types.ts
 * so any package, domain, metro, or legal URL change happens in one place.
 */

export const APP_NAME = 'Setnik';
export const APP_TAGLINE = 'Never miss a set.';
export const GOOGLE_PLAY_PACKAGE_ID = 'com.setnik.app';
export const APP_URI_SCHEME = 'setnik';
export const PRIMARY_CTA_LABEL = 'Swipe & Preview Full Local Bills on Setnik';

/**
 * Fallback base URL for offline local dry-runs only.
 * In CI, GitHub Actions `actions/configure-pages` automatically supplies the real
 * deployed GitHub Pages URL (e.g. https://<setnik-user>.github.io or custom domain).
 */
export const DEFAULT_SITE_URL = 'https://setnik.example';

/**
 * Listings feed URL template, e.g.
 *   https://github.com/<owner>/setnik-listings/releases/download/listings/shows-{metro}.json
 * Supplied via LISTINGS_FEED_URL_TEMPLATE (GitHub Secret or Variable) so no account handle is hard-coded.
 */
export const DEFAULT_LISTINGS_FEED_URL_TEMPLATE = '';

/** Legal and support links (matches Setnik app src/lib/legal.ts & hosting.ts). */
export const DOCS_BASE_URL = 'https://sites.google.com/view/setnik';
export const PRIVACY_URL = `${DOCS_BASE_URL}/privacy`;
export const TERMS_URL = `${DOCS_BASE_URL}/terms`;
export const DMCA_URL = `${DOCS_BASE_URL}/dmca`;
export const SUPPORT_EMAIL = 'setnik.app@gmail.com';

/** Priority metros highlighted first in navigation, homepage, and sitemap priority. */
export const PRIORITY_METROS = ['nyc', 'la', 'chi'];

/**
 * Default metros to build: Setnik's top 10 US & Canada Wave-1 hot markets
 * (matches hot=true in Setnik app src/lib/metros.ts), with NYC, LA, and Chicago first.
 */
export const DEFAULT_METROS = ['nyc', 'la', 'chi', 'sf', 'tor', 'mtl', 'van', 'bos', 'dc', 'phl'];

/** Default lookahead window in days for upcoming shows. */
export const DEFAULT_WINDOW_DAYS = 30;

/** Canadian province / territory codes for Schema.org addressCountry + priceCurrency. */
export const CANADIAN_PROVINCES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

/**
 * Metro registry synced with Setnik app src/lib/metros.ts.
 * Includes display labels and URL slugs for high-intent local hubs.
 */
export const METROS = [
  { id: 'nyc', slug: 'nyc', name: 'New York City', shortName: 'NYC', state: 'NY', tz: 'America/New_York', hot: true, softLaunch: true },
  { id: 'la', slug: 'la', name: 'Los Angeles', shortName: 'LA', state: 'CA', tz: 'America/Los_Angeles', hot: true, softLaunch: true },
  { id: 'chi', slug: 'chicago', name: 'Chicago', shortName: 'Chicago', state: 'IL', tz: 'America/Chicago', hot: true, softLaunch: false },
  { id: 'sf', slug: 'sf-bay-area', name: 'San Francisco Bay Area', shortName: 'SF Bay Area', state: 'CA', tz: 'America/Los_Angeles', hot: true, softLaunch: false },
  { id: 'tor', slug: 'toronto', name: 'Toronto', shortName: 'Toronto', state: 'ON', tz: 'America/Toronto', hot: true, softLaunch: false },
  { id: 'mtl', slug: 'montreal', name: 'Montréal', shortName: 'Montréal', state: 'QC', tz: 'America/Toronto', hot: true, softLaunch: false },
  { id: 'van', slug: 'vancouver', name: 'Vancouver', shortName: 'Vancouver', state: 'BC', tz: 'America/Vancouver', hot: true, softLaunch: false },
  { id: 'bos', slug: 'boston', name: 'Boston', shortName: 'Boston', state: 'MA', tz: 'America/New_York', hot: true, softLaunch: false },
  { id: 'dc', slug: 'washington-dc', name: 'Washington, DC', shortName: 'DC', state: 'DC', tz: 'America/New_York', hot: true, softLaunch: false },
  { id: 'phl', slug: 'philadelphia', name: 'Philadelphia', shortName: 'Philly', state: 'PA', tz: 'America/New_York', hot: true, softLaunch: false },
  { id: 'atl', slug: 'atlanta', name: 'Atlanta', shortName: 'Atlanta', state: 'GA', tz: 'America/New_York', hot: false, softLaunch: false },
  { id: 'mia', slug: 'miami', name: 'Miami', shortName: 'Miami', state: 'FL', tz: 'America/New_York', hot: false, softLaunch: false },
  { id: 'sea', slug: 'seattle', name: 'Seattle', shortName: 'Seattle', state: 'WA', tz: 'America/Los_Angeles', hot: false, softLaunch: false },
  { id: 'aus', slug: 'austin', name: 'Austin', shortName: 'Austin', state: 'TX', tz: 'America/Chicago', hot: false, softLaunch: false },
  { id: 'nash', slug: 'nashville', name: 'Nashville', shortName: 'Nashville', state: 'TN', tz: 'America/Chicago', hot: false, softLaunch: false },
  { id: 'den', slug: 'denver', name: 'Denver', shortName: 'Denver', state: 'CO', tz: 'America/Denver', hot: false, softLaunch: false },
  { id: 'dal', slug: 'dallas-fort-worth', name: 'Dallas–Fort Worth', shortName: 'DFW', state: 'TX', tz: 'America/Chicago', hot: false, softLaunch: false },
  { id: 'hou', slug: 'houston', name: 'Houston', shortName: 'Houston', state: 'TX', tz: 'America/Chicago', hot: false, softLaunch: false },
  { id: 'phx', slug: 'phoenix', name: 'Phoenix', shortName: 'Phoenix', state: 'AZ', tz: 'America/Phoenix', hot: false, softLaunch: false },
  { id: 'sd', slug: 'san-diego', name: 'San Diego', shortName: 'San Diego', state: 'CA', tz: 'America/Los_Angeles', hot: false, softLaunch: false },
  { id: 'por', slug: 'portland', name: 'Portland', shortName: 'Portland', state: 'OR', tz: 'America/Los_Angeles', hot: false, softLaunch: false },
  { id: 'lv', slug: 'las-vegas', name: 'Las Vegas', shortName: 'Las Vegas', state: 'NV', tz: 'America/Los_Angeles', hot: false, softLaunch: false },
  { id: 'msp', slug: 'minneapolis-st-paul', name: 'Minneapolis–St. Paul', shortName: 'Twin Cities', state: 'MN', tz: 'America/Chicago', hot: false, softLaunch: false },
  { id: 'det', slug: 'detroit', name: 'Detroit', shortName: 'Detroit', state: 'MI', tz: 'America/Detroit', hot: false, softLaunch: false },
  { id: 'nola', slug: 'new-orleans', name: 'New Orleans', shortName: 'New Orleans', state: 'LA', tz: 'America/Chicago', hot: false, softLaunch: false },
  { id: 'pit', slug: 'pittsburgh', name: 'Pittsburgh', shortName: 'Pittsburgh', state: 'PA', tz: 'America/New_York', hot: false, softLaunch: false },
  { id: 'bal', slug: 'baltimore', name: 'Baltimore', shortName: 'Baltimore', state: 'MD', tz: 'America/New_York', hot: false, softLaunch: false },
  { id: 'stl', slug: 'st-louis', name: 'St. Louis', shortName: 'St. Louis', state: 'MO', tz: 'America/Chicago', hot: false, softLaunch: false },
  { id: 'kc', slug: 'kansas-city', name: 'Kansas City', shortName: 'Kansas City', state: 'MO', tz: 'America/Chicago', hot: false, softLaunch: false },
  { id: 'orl', slug: 'orlando', name: 'Orlando', shortName: 'Orlando', state: 'FL', tz: 'America/New_York', hot: false, softLaunch: false },
  { id: 'tpa', slug: 'tampa', name: 'Tampa', shortName: 'Tampa', state: 'FL', tz: 'America/New_York', hot: false, softLaunch: false },
  { id: 'clt', slug: 'charlotte', name: 'Charlotte', shortName: 'Charlotte', state: 'NC', tz: 'America/New_York', hot: false, softLaunch: false },
  { id: 'rdu', slug: 'raleigh-durham', name: 'Raleigh–Durham', shortName: 'Triangle', state: 'NC', tz: 'America/New_York', hot: false, softLaunch: false },
  { id: 'slc', slug: 'salt-lake-city', name: 'Salt Lake City', shortName: 'SLC', state: 'UT', tz: 'America/Denver', hot: false, softLaunch: false },
  { id: 'cmh', slug: 'columbus', name: 'Columbus', shortName: 'Columbus', state: 'OH', tz: 'America/New_York', hot: false, softLaunch: false },
  { id: 'cle', slug: 'cleveland', name: 'Cleveland', shortName: 'Cleveland', state: 'OH', tz: 'America/New_York', hot: false, softLaunch: false },
  { id: 'cin', slug: 'cincinnati', name: 'Cincinnati', shortName: 'Cincinnati', state: 'OH', tz: 'America/New_York', hot: false, softLaunch: false },
  { id: 'ind', slug: 'indianapolis', name: 'Indianapolis', shortName: 'Indy', state: 'IN', tz: 'America/Indiana/Indianapolis', hot: false, softLaunch: false },
  { id: 'mke', slug: 'milwaukee', name: 'Milwaukee', shortName: 'Milwaukee', state: 'WI', tz: 'America/Chicago', hot: false, softLaunch: false },
  { id: 'sat', slug: 'san-antonio', name: 'San Antonio', shortName: 'San Antonio', state: 'TX', tz: 'America/Chicago', hot: false, softLaunch: false },
  { id: 'sac', slug: 'sacramento', name: 'Sacramento', shortName: 'Sacramento', state: 'CA', tz: 'America/Los_Angeles', hot: false, softLaunch: false },
  { id: 'cgy', slug: 'calgary', name: 'Calgary', shortName: 'Calgary', state: 'AB', tz: 'America/Edmonton', hot: false, softLaunch: false },
  { id: 'edm', slug: 'edmonton', name: 'Edmonton', shortName: 'Edmonton', state: 'AB', tz: 'America/Edmonton', hot: false, softLaunch: false },
  { id: 'ott', slug: 'ottawa', name: 'Ottawa', shortName: 'Ottawa', state: 'ON', tz: 'America/Toronto', hot: false, softLaunch: false },
  { id: 'wpg', slug: 'winnipeg', name: 'Winnipeg', shortName: 'Winnipeg', state: 'MB', tz: 'America/Winnipeg', hot: false, softLaunch: false },
  { id: 'yqb', slug: 'quebec-city', name: 'Québec City', shortName: 'Québec City', state: 'QC', tz: 'America/Toronto', hot: false, softLaunch: false },
  { id: 'hfx', slug: 'halifax', name: 'Halifax', shortName: 'Halifax', state: 'NS', tz: 'America/Halifax', hot: false, softLaunch: false },
];

export const METRO_BY_ID = new Map(METROS.map((m) => [m.id, m]));

export function getMetro(id) {
  return METRO_BY_ID.get(id) ?? METROS[0];
}

/** Canonical genre groups synced with Setnik app src/lib/types.ts. */
export const GENRE_GROUPS = [
  { title: 'Rock & Indie', genres: ['Rock', 'Indie Rock', 'Garage', 'Psych', 'Shoegaze', 'Noise Rock'] },
  { title: 'Punk & Hardcore', genres: ['Punk', 'Hardcore', 'Screamo', 'Emo', 'Post-Punk'] },
  { title: 'Metal & Heavy', genres: ['Metal', 'Sludge & Doom'] },
  { title: 'Electronic & Dark', genres: ['Electronic', 'Darkwave', 'Industrial'] },
  { title: 'Folk & Roots', genres: ['Folk', 'Country', 'Blues'] },
  { title: 'Pop, Hip-Hop & Soul', genres: ['Pop', 'Hip-Hop', 'Soul & Gospel'] },
  { title: 'Jazz, Classical & Experimental', genres: ['Jazz & Improv', 'Classical', 'Experimental'] },
  { title: 'Latin & Reggae', genres: ['Latin', 'Reggae'] },
];

export const ALL_GENRES = GENRE_GROUPS.flatMap((g) => g.genres);
export const ALLOWED_GENRES_SET = new Set(ALL_GENRES);

/** Normalize a site URL (no trailing slash) and derive its basePath ('' or '/repo'). */
export function parseSiteUrl(rawUrl) {
  const cleaned = (rawUrl || DEFAULT_SITE_URL).trim().replace(/\/+$/, '');
  const u = new URL(cleaned);
  const basePath = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
  return {
    siteUrl: `${u.origin}${basePath}`,
    origin: u.origin,
    basePath,
  };
}
