import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  actSimilarity,
  cleanActForMatch,
  cleanPrice,
  combineAndFilterShows,
  mergeTwoShows,
  normalizeFeedShow,
  normalizeFpRow,
  normalizeSubmissionRow,
  sameShow,
  sameVenueName,
  venueKey,
} from '../src/fetch.mjs';
import { effectiveLocalYmd, effectiveShowDate, toZonedIso } from '../src/html.mjs';
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

  it('computes effectiveShowDate and effectiveLocalYmd with 5:00 AM night rollover', () => {
    assert.equal(effectiveShowDate('2026-11-27T23:59:00-05:00'), '2026-11-27');
    assert.equal(effectiveShowDate('2026-11-28T00:00:00-05:00'), '2026-11-27');
    assert.equal(effectiveShowDate('2026-11-28T04:59:00-05:00'), '2026-11-27');
    assert.equal(effectiveShowDate('2026-11-28T05:00:00-05:00'), '2026-11-28');
    assert.equal(effectiveShowDate('2027-01-01T02:30:00-05:00'), '2026-12-31');

    // 2026-11-28T08:30:00Z is 03:30 EST in NYC -> still 2026-11-27 night
    assert.equal(effectiveLocalYmd(new Date('2026-11-28T08:30:00Z'), 'America/New_York'), '2026-11-27');
    // 2026-11-28T10:30:00Z is 05:30 EST in NYC (rolled over) vs 02:30 PST in LA (still previous night)
    assert.equal(effectiveLocalYmd(new Date('2026-11-28T10:30:00Z'), 'America/New_York'), '2026-11-28');
    assert.equal(effectiveLocalYmd(new Date('2026-11-28T10:30:00Z'), 'America/Los_Angeles'), '2026-11-27');
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

  it('matches equivalent venue spellings via venueKey and sameVenueName', () => {
    assert.equal(venueKey('Pianos'), venueKey("Piano's"));
    assert.equal(venueKey('Pianos'), venueKey('Piano’s'));
    assert.equal(venueKey('The Troubadour'), venueKey('Troubadour'));
    assert.equal(venueKey('Le National'), venueKey('National'));
    assert.equal(venueKey('Les Foufounes Électriques'), venueKey('Foufounes Electriques'));
    assert.equal(venueKey("L' Olympia Theatre"), venueKey('L’ Olympia Theatre'));

    assert.equal(sameVenueName('Pianos', 'Piano’s'), true);
    assert.equal(sameVenueName('The Troubadour', 'Troubadour'), true);
    assert.equal(sameVenueName('Beanfield Theatre', 'Théâtre Beanfield'), true);
    assert.equal(sameVenueName('Bell Centre', 'Centre Bell'), true);
    assert.equal(sameVenueName('Bell Center', 'Bell Centre'), true);
    assert.equal(sameVenueName("L' Olympia Theatre", 'L’ Olympia Theatre'), true);
    assert.equal(sameVenueName("L'Olympia", "L' Olympia Theatre"), true);
    assert.equal(
      sameVenueName('Société des arts technologiques (SAT)', 'Society for Arts and Technology (SAT)'),
      true,
    );
    assert.equal(sameVenueName('Société des arts technologiques (SAT)', 'SAT'), true);
    assert.equal(sameVenueName('Société des arts technologiques', 'Society for Arts and Technology (SAT)'), true);

    // Distinct venues must not falsely collide
    assert.equal(sameVenueName('Bowery Ballroom', 'Bowery Electric'), false);
    assert.equal(sameVenueName('The Echo', 'Echoplex'), false);
    assert.equal(sameVenueName('Club Alpha (NYC)', 'Club Beta (NYC)'), false);
    assert.equal(sameVenueName('Club 1', 'Club 2'), false);
  });

  it('matches acts fuzzily across tour subtitles, co-bills, flipped headliners, and guards short names & early/late sets', () => {
    assert.equal(cleanActForMatch('Fontaines D.C. - Romance Tour'), 'fontaines dc');
    assert.equal(cleanActForMatch('Khruangbin: A LA SALA Tour 2026'), 'khruangbin');
    assert.equal(cleanActForMatch('koleżanka Album Release'), 'kolezanka');
    assert.equal(cleanActForMatch('An Evening With Goose'), 'goose');
    assert.equal(cleanActForMatch('SZA - SOS Tour'), 'sza');

    assert.ok(actSimilarity('Fontaines D.C. - Romance Tour', 'Fontaines DC') >= 0.95);
    assert.ok(actSimilarity('Alvvays', 'Alvays') >= 0.82);

    // Short names & distinct numbered names must not falsely match
    assert.equal(actSimilarity('X', 'X'), 1);
    assert.equal(actSimilarity('X', 'XX'), 0);
    assert.equal(actSimilarity('X', 'Xiu Xiu'), 0);
    assert.equal(actSimilarity('Air', 'Fair'), 0);
    assert.equal(actSimilarity('Low', 'Slow'), 0);
    assert.ok(actSimilarity('Dehd', 'Dead') < 0.82);
    assert.equal(actSimilarity('Band 30', 'Band 60'), 0);

    const mkShow = (overrides) => ({
      id: overrides.id || 's1',
      startsAt: overrides.startsAt || '2026-11-27T20:00:00-05:00',
      timeTba: overrides.timeTba,
      venue: { name: overrides.venueName || 'Pianos', metro: overrides.metro || 'nyc' },
      acts: (overrides.acts || ['Dehd']).map((name, order) => ({ name, order })),
      genres: [],
      price: {},
      status: 'scheduled',
    });

    // Co-bill & flipped headliners merge across venue spelling variants
    assert.equal(
      sameShow(
        mkShow({ venueName: 'Pianos', acts: ['Dehd / Deeper'] }),
        mkShow({ venueName: 'Piano’s', acts: ['Deeper', 'Dehd'], startsAt: '2026-11-27T20:30:00-05:00' }),
      ),
      true,
    );

    // Early/late sets >= 2h apart stay separate
    assert.equal(
      sameShow(
        mkShow({ venueName: 'Village Vanguard', acts: ['Bill Frisell'], startsAt: '2026-11-27T19:30:00-05:00' }),
        mkShow({ venueName: 'Village Vanguard', acts: ['Bill Frisell'], startsAt: '2026-11-27T21:30:00-05:00' }),
      ),
      false,
    );

    // Real start time >= 2h from a timeTba 20:00 placeholder still merges
    assert.equal(
      sameShow(
        mkShow({ venueName: 'Village Vanguard', acts: ['Bill Frisell'], startsAt: '2026-11-27T20:00:00-05:00', timeTba: true }),
        mkShow({ venueName: 'Village Vanguard', acts: ['Bill Frisell'], startsAt: '2026-11-27T22:30:00-05:00' }),
      ),
      true,
    );

    // Late-night cross-midnight duplicate (23:30 Fri vs 00:30 Sat, effective night = Fri) merges
    assert.equal(
      sameShow(
        mkShow({ venueName: 'Société des arts technologiques (SAT)', metro: 'mtl', acts: ['Four Tet (Live)'], startsAt: '2026-11-27T23:30:00-05:00' }),
        mkShow({ venueName: 'Society for Arts and Technology (SAT)', metro: 'mtl', acts: ['Four Tet'], startsAt: '2026-11-28T00:30:00-05:00' }),
      ),
      true,
    );
  });

  it('prefers real startsAt over timeTba placeholder and merges act metadata fuzzily in mergeTwoShows & combineAndFilterShows', () => {
    const now = new Date('2026-11-24T17:00:00Z');
    const fpTba = normalizeFpRow({
      id: 'fp-tba',
      metro: 'nyc',
      venueName: 'Pianos',
      city: 'New York, NY',
      address: '158 Ludlow St, New York, NY 10002',
      addressMode: 'registry',
      localDate: '2026-11-27',
      startLocal: null, // produces 20:00 placeholder + timeTba: true
      startsAt: null,
      headliner: 'Fontaines D.C. - Romance Tour',
      supports: ['Been Stellar'],
      price: { min: 20 },
      status: 'scheduled',
      genres: ['Post-Punk'],
      sources: [{ sourceType: 'flyer', licence: 'first_party' }],
    }, 'nyc');

    const jbReal = normalizeFeedShow({
      id: 'jb-real',
      startsAt: '2026-11-27T22:30:00-05:00',
      venue: {
        name: 'Piano’s',
        neighborhood: 'Lower East Side',
        area: 'Manhattan',
        metro: 'nyc',
        city: 'New York, NY',
        address: '158 Ludlow St',
        addressVisibility: 'public',
      },
      acts: [
        {
          name: 'Fontaines DC',
          order: 0,
          previewUrl: 'https://cdn.example/fontaines.mp3',
          links: { deezerArtistId: 998877 },
        },
      ],
      genres: ['Indie Rock'],
      price: { min: 30 },
      status: 'scheduled',
      source: { provider: 'jambase', url: 'https://jambase.com', fetchedAt: now.toISOString() },
    }, 'nyc');

    assert.equal(fpTba.timeTba, true);
    const direct = mergeTwoShows(fpTba, jbReal);
    assert.equal(direct.startsAt, '2026-11-27T22:30:00-05:00');
    assert.equal(direct.timeTba, undefined);
    assert.equal(direct.acts[0].previewUrl, 'https://cdn.example/fontaines.mp3');
    assert.equal(direct.acts[0].links?.deezerArtistId, 998877);

    const combined = combineAndFilterShows([fpTba, jbReal], { now, windowDays: 30 });
    assert.equal(combined.length, 1);
    assert.equal(combined[0].startsAt, '2026-11-27T22:30:00-05:00');
    assert.equal(combined[0].timeTba, undefined);
    assert.equal(combined[0].price.min, 20);
    assert.equal(combined[0].acts.length, 2);
    assert.equal(combined[0].acts[0].links?.deezerArtistId, 998877);
  });

  it('keeps early and late sets separate and honors 5:00 AM rollover in combineAndFilterShows', () => {
    const early = normalizeFeedShow({
      id: 'early',
      startsAt: '2026-11-27T19:00:00-05:00',
      venue: { name: 'Blue Note', metro: 'nyc', city: 'New York, NY', address: '131 W 3rd St', addressVisibility: 'public' },
      acts: [{ name: 'Robert Glasper', order: 0 }],
      genres: ['Jazz & Improv'],
      status: 'scheduled',
    }, 'nyc');
    const late = normalizeFeedShow({
      id: 'late',
      startsAt: '2026-11-27T22:00:00-05:00',
      venue: { name: 'Blue Note', metro: 'nyc', city: 'New York, NY', address: '131 W 3rd St', addressVisibility: 'public' },
      acts: [{ name: 'Robert Glasper', order: 0 }],
      genres: ['Jazz & Improv'],
      status: 'scheduled',
    }, 'nyc');
    const afterMidnight = normalizeFeedShow({
      id: 'after-mid',
      startsAt: '2026-11-28T03:00:00-05:00',
      venue: { name: 'Nowadays', metro: 'nyc', city: 'Queens, NY', address: '56-06 Cooper Ave', addressVisibility: 'public' },
      acts: [{ name: 'Avalon Emerson', order: 0 }],
      genres: ['Electronic'],
      status: 'scheduled',
    }, 'nyc');

    // At 2:00 AM EST Sat (07:00Z), effective night is still Fri 2026-11-27 -> all 3 remain in window
    const beforeRollover = combineAndFilterShows([early, late, afterMidnight], {
      now: new Date('2026-11-28T07:00:00Z'),
      windowDays: 30,
    });
    assert.equal(beforeRollover.length, 3);

    // At 5:00 AM EST Sat (10:00Z), effective night rolls to Sat 2026-11-28 -> all 3 Fri-night shows roll off
    const afterRollover = combineAndFilterShows([early, late, afterMidnight], {
      now: new Date('2026-11-28T10:00:00Z'),
      windowDays: 30,
    });
    assert.equal(afterRollover.length, 0);
  });

  it('coerces string prices, normalizes $0 to isFree, detects explicit free titles, and merges partial price objects', () => {
    assert.deepEqual(cleanPrice({ min: '$15', max: '20.50' }), { min: 15, max: 20.5 });
    assert.deepEqual(cleanPrice('$18 ADV / $22 DOS'), { min: 18, max: 22 });
    assert.deepEqual(cleanPrice('Free / NOTAFLOF'), { isFree: true, notaflof: true });
    assert.deepEqual(cleanPrice({ min: 0, max: 0 }), { isFree: true });
    assert.deepEqual(cleanPrice({ min: 25, max: 15 }), { min: 15, max: 25 });
    assert.deepEqual(cleanPrice({}, 'Sunday Jazz (Free Show)'), { isFree: true });
    assert.deepEqual(cleanPrice({}, 'Late Night — No Cover'), { isFree: true });
    // Band names containing "Free" must NOT be misclassified as free shows
    assert.deepEqual(cleanPrice({}, 'Free Throw'), {});
    assert.deepEqual(cleanPrice({}, 'Free Range'), {});

    // Partial primary price ({ notaflof: true }) inherits secondary numeric price without losing notaflof
    const fpNotaflof = normalizeFpRow({
      id: 'fp-notaflof',
      metro: 'nyc',
      venueName: 'Trans-Pecos',
      city: 'Ridgewood, NY',
      address: '915 Wyckoff Ave, Ridgewood, NY 11385',
      addressMode: 'registry',
      localDate: '2026-11-27',
      startLocal: '20:00',
      startsAt: '2026-11-27T20:00:00-05:00',
      headliner: 'Asher White',
      price: { notaflof: true },
      status: 'scheduled',
      genres: ['Experimental'],
      sources: [{ sourceType: 'flyer', licence: 'first_party' }],
    }, 'nyc');

    const feedPriced = normalizeFeedShow({
      id: 'feed-priced',
      startsAt: '2026-11-27T20:00:00-05:00',
      venue: { name: 'Trans-Pecos', metro: 'nyc', city: 'Ridgewood, NY', address: '915 Wyckoff Ave', addressVisibility: 'public' },
      acts: [{ name: 'Asher White', order: 0 }],
      genres: ['Experimental'],
      price: { min: '15', max: '$20' },
      status: 'scheduled',
    }, 'nyc');

    const merged = mergeTwoShows(fpNotaflof, feedPriced);
    assert.deepEqual(merged.price, { min: 15, max: 20, notaflof: true });

    // Concrete primary numeric price still wins cleanly without leaking secondary max
    const fpNumeric = { ...fpNotaflof, price: { min: 12 } };
    const mergedNumeric = mergeTwoShows(fpNumeric, { ...feedPriced, price: { min: 15, max: 25, notaflof: true } });
    assert.deepEqual(mergedNumeric.price, { min: 12, notaflof: true });
  });
});
