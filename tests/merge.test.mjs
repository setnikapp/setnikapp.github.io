import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  combineAndFilterShows,
  normalizeFeedShow,
  normalizeFpRow,
  normalizeSubmissionRow,
} from '../src/fetch.mjs';
import { toZonedIso } from '../src/html.mjs';
import { buildEventName, buildMusicEventJsonLd, parsePostalAddress } from '../src/schema.mjs';

describe('schema & address parsing', () => {
  it('parses combined US street addresses from fp.venues', () => {
    const p = parsePostalAddress({
      name: 'Market Hotel',
      address: '1140 Myrtle Ave, Brooklyn, NY 11206',
      city: 'Brooklyn, NY',
      area: 'Brooklyn',
      metro: 'nyc',
      addressVisibility: 'public',
    }, 'nyc');

    assert.deepEqual(p, {
      '@type': 'PostalAddress',
      streetAddress: '1140 Myrtle Ave',
      addressLocality: 'Brooklyn',
      addressRegion: 'NY',
      postalCode: '11206',
      addressCountry: 'US',
    });
  });

  it('parses split JamBase street addresses + Canadian provinces', () => {
    const p = parsePostalAddress({
      name: 'Horseshoe Tavern',
      address: '370 Queen St W',
      city: 'Toronto, ON',
      area: 'Toronto',
      metro: 'tor',
      addressVisibility: 'public',
    }, 'tor');

    assert.deepEqual(p, {
      '@type': 'PostalAddress',
      streetAddress: '370 Queen St W',
      addressLocality: 'Toronto',
      addressRegion: 'ON',
      addressCountry: 'CA',
    });
  });

  it('rejects withheld, missing, or placeholder street addresses', () => {
    assert.equal(parsePostalAddress({
      name: 'DIY Space',
      address: '123 Secret St, Brooklyn, NY 11206',
      addressVisibility: 'neighborhood_only',
    }, 'nyc'), null);

    assert.equal(parsePostalAddress({
      name: 'Mystery Room',
      address: 'DM for address',
      addressVisibility: 'public',
    }, 'nyc'), null);

    assert.equal(parsePostalAddress({
      name: 'No Number Venue',
      address: 'Brooklyn, NY',
      addressVisibility: 'public',
    }, 'nyc'), null);
  });

  it('computes accurate America/New_York DST offsets (-04:00 EDT vs -05:00 EST)', () => {
    assert.equal(toZonedIso('2026-07-15', '20:00', 'America/New_York'), '2026-07-15T20:00:00-04:00');
    assert.equal(toZonedIso('2026-11-27', '20:00', 'America/New_York'), '2026-11-27T20:00:00-05:00');
  });

  it('never puts venue name, city, or price inside MusicEvent.name', () => {
    const show = normalizeFpRow({
      id: 'abc',
      metro: 'nyc',
      venueName: 'Gold Sounds',
      city: 'Brooklyn, NY',
      address: '44 Wilson Ave, Brooklyn, NY 11237',
      addressMode: 'registry',
      localDate: '2026-11-27',
      startLocal: '20:00',
      startsAt: '2026-11-27T20:00:00-05:00',
      headliner: 'Bad Static',
      supports: ['T@B GRRRL'],
      price: { min: 15 },
      status: 'scheduled',
      genres: ['Punk'],
      sources: [],
      conflicts: [],
      unconfirmed: false,
      pending: false,
    }, 'nyc');

    const name = buildEventName(show);
    assert.equal(name, 'Bad Static with T@B GRRRL');
    const ld = buildMusicEventJsonLd(show, 'https://setnik.example/shows/test/');
    assert.equal(ld.name, 'Bad Static with T@B GRRRL');
    assert.equal(ld.offers.price, '15');
    assert.equal(ld.offers.priceCurrency, 'USD');
  });
});

describe('Supabase & feed normalization + deduplication', () => {
  it('merges fp_public_shows over JamBase feed on same date + venue + headliner', () => {
    const now = new Date('2026-11-24T17:00:00Z');
    const fp = normalizeFpRow({
      id: 'fp-1',
      metro: 'nyc',
      venueName: 'Market Hotel',
      city: 'Brooklyn, NY',
      address: '1140 Myrtle Ave, Brooklyn, NY 11206',
      addressMode: 'registry',
      localDate: '2026-11-27',
      startLocal: '20:00',
      startsAt: '2026-11-27T20:00:00-05:00',
      headliner: 'The Serfs',
      supports: ['Cube'],
      price: { min: 18 },
      status: 'scheduled',
      genres: ['Post-Punk'],
      sources: [{ sourceType: 'venue_site', licence: 'first_party' }],
      conflicts: [],
      unconfirmed: false,
      pending: false,
    }, 'nyc');

    const jb = normalizeFeedShow({
      id: 'jb-1',
      startsAt: '2026-11-27T20:00:00-05:00',
      venue: {
        name: 'Market Hotel',
        neighborhood: 'Bushwick',
        area: 'Brooklyn',
        metro: 'nyc',
        city: 'Brooklyn, NY',
        address: '1140 Myrtle Ave',
        addressVisibility: 'public',
      },
      acts: [{ name: 'The Serfs', order: 0 }],
      genres: ['Darkwave'],
      price: { min: 25 },
      status: 'scheduled',
      source: { provider: 'jambase', url: 'https://jambase.com', fetchedAt: now.toISOString() },
    }, 'nyc');

    const merged = combineAndFilterShows([jb, fp], { now, windowDays: 30 });
    assert.equal(merged.length, 1);
    assert.equal(merged[0].price.min, 18); // First-party wins price
    assert.equal(merged[0].acts.length, 2); // First-party full bill kept
    assert.equal(merged[0].venue.neighborhood, 'Bushwick'); // Neighborhood enriched from feed
    assert.deepEqual(merged[0].genres, ['Post-Punk', 'Darkwave']); // Genres combined
  });

  it('normalizes public.submissions rows and filters outside the 30-day window', () => {
    const now = new Date('2026-11-24T17:00:00Z');
    const inWindow = normalizeSubmissionRow({
      id: 'sub-1',
      status: 'live',
      metro: 'nyc',
      acts: [{ name: 'Local Band' }],
      venue_name: 'Union Pool',
      venue_area: 'Brooklyn',
      venue_address: '484 Union Ave, Brooklyn, NY 11211',
      starts_local: '2026-11-29T20:00',
      utc_offset_min: -300,
      is_free: true,
      genres: ['Indie Rock'],
    });
    const tooFar = normalizeSubmissionRow({
      id: 'sub-2',
      status: 'live',
      metro: 'nyc',
      acts: [{ name: 'Next Year Band' }],
      venue_name: 'Union Pool',
      venue_area: 'Brooklyn',
      starts_local: '2027-02-15T20:00',
      utc_offset_min: -300,
      is_free: false,
      genres: ['Indie Rock'],
    });

    const filtered = combineAndFilterShows([inWindow, tooFar], { now, windowDays: 30 });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, 'cm-sub-1');
    assert.equal(filtered[0].price.isFree, true);
  });
});
