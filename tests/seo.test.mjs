import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import { buildPlayerJs } from '../src/assets.mjs';
import { buildSite } from '../src/build.mjs';
import { GOOGLE_PLAY_PACKAGE_ID, PRIMARY_CTA_LABEL } from '../src/config.mjs';
import { playStoreUrl } from '../src/html.mjs';

function walkHtmlFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkHtmlFiles(full, base));
    else if (entry.name.endsWith('.html')) out.push(path.relative(base, full));
  }
  return out;
}

function extractJsonLdBlocks(htmlContent) {
  const blocks = [];
  const rx = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = rx.exec(htmlContent)) !== null) {
    blocks.push(JSON.parse(m[1]));
  }
  return blocks;
}

function extractVisibleBody(htmlContent) {
  const bodyMatch = /<body[\s\S]*?<\/body>/i.exec(htmlContent);
  if (!bodyMatch) return '';
  return bodyMatch[0]
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

describe('setnik-web static site SEO & compliance', () => {
  it('builds a full mock site with valid HTML, sitemaps, .nojekyll, and Google-compliant MusicEvent JSON-LD', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setnik-web-test-'));
    try {
      const siteUrl = 'https://setnikapp.github.io';
      const now = new Date('2026-11-24T17:00:00Z');
      const summary = await buildSite({
        outDir: tmpDir,
        siteUrl,
        mock: true,
        now,
        log: { info: () => {}, warn: () => {} },
      });

      // Deduplication worked: 17 input records (1 duplicate Market Hotel / The Serfs) -> 16 unique shows
      assert.equal(summary.totalShows, 16);
      // 14 shows have valid public physical street addresses; 2 (Salon on Kingston withheld + The Broadway missing address) do not
      assert.equal(summary.musicEventSchemaCount, 14);
      assert.equal(summary.skippedSchemaCount, 2);

      // Required root SEO & Pages files
      assert.ok(fs.existsSync(path.join(tmpDir, '.nojekyll')), '.nojekyll must exist');
      assert.equal(fs.readFileSync(path.join(tmpDir, '.nojekyll'), 'utf8'), '');
      assert.ok(fs.existsSync(path.join(tmpDir, 'robots.txt')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'sitemap.xml')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'sitemap.txt')));
      assert.ok(fs.existsSync(path.join(tmpDir, '404.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'assets/styles.css')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'assets/player.js')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'assets/favicon.svg')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'assets/og-card.png')), 'Branded OG share card must exist');

      // Expected hyperlocal hubs (priority NYC, LA, Chicago + Toronto Canada)
      assert.ok(fs.existsSync(path.join(tmpDir, 'nyc-concerts-tonight/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'la-concerts-tonight/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'chicago-concerts-tonight/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'toronto-concerts-tonight/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'nyc-shows-this-weekend/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'la-shows-this-weekend/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'chicago-shows-this-weekend/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'chicago-live-music/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'toronto-shows-this-weekend/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'brooklyn-live-music/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'jersey-city-live-music/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'venues/gold-sounds/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'venues/market-hotel/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'venues/empty-bottle/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'genres/punk/index.html')));

      // Expected City × Genre SEO hub pages & internal cross-links
      assert.ok(summary.cityGenreHubCount >= 2, `Expected City × Genre hubs, got ${summary.cityGenreHubCount}`);
      assert.ok(fs.existsSync(path.join(tmpDir, 'nyc/indie-rock-shows/index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'nyc/post-punk-shows/index.html')));
      const nycHubHtml = fs.readFileSync(path.join(tmpDir, 'nyc-live-music/index.html'), 'utf8');
      assert.ok(nycHubHtml.includes('/nyc/indie-rock-shows/'), 'NYC metro hub should cross-link to /nyc/indie-rock-shows/');
      assert.ok(nycHubHtml.includes('/nyc-concerts-tonight/'), 'NYC metro hub should cross-link to /nyc-concerts-tonight/');
      const nycWkHtml = fs.readFileSync(path.join(tmpDir, 'nyc-shows-this-weekend/index.html'), 'utf8');
      assert.ok(nycWkHtml.includes('/nyc-concerts-tonight/'), 'NYC weekend hub should cross-link to /nyc-concerts-tonight/');
      const indieGenreHtml = fs.readFileSync(path.join(tmpDir, 'genres/indie-rock/index.html'), 'utf8');
      assert.ok(indieGenreHtml.includes('/nyc/indie-rock-shows/'), 'Indie Rock genre hub should cross-link to /nyc/indie-rock-shows/');

      // Homepage meta description length, shareable filter URL controls & in-list Preview/Save triggers
      const homeHtml = fs.readFileSync(path.join(tmpDir, 'index.html'), 'utf8');
      const homeDescMatch = /<meta name="description" content="([^"]+)"/.exec(homeHtml);
      assert.ok(homeDescMatch && homeDescMatch[1].length <= 160, `Homepage meta description should be <= 160 chars, got ${homeDescMatch?.[1]?.length}`);
      assert.ok(homeHtml.includes('data-copy-filter-link'), 'Homepage should include Share link button');
      assert.ok(homeHtml.includes('data-metro-slug="nyc"'), 'Homepage city buttons should include metro slug for shareable URLs');
      assert.ok(homeHtml.includes('data-tonight-href="/nyc-concerts-tonight/"'), 'Homepage city buttons should include tonight hub href');
      assert.ok(homeHtml.includes('data-row-preview'), 'Homepage listing rows should include in-list Preview trigger');
      assert.ok(homeHtml.includes('data-row-save'), 'Homepage listing rows should include in-list Save trigger');
      assert.ok(homeHtml.includes('data-row-feedback'), 'Homepage listing rows should include inline feedback slot');
      assert.ok(nycHubHtml.includes('data-row-preview') && nycHubHtml.includes('data-row-save'), 'Hub listing rows should include in-list Preview & Save triggers');

      // Verify full per-metro JSON indices contain 100% of shows + preview/calendar metadata
      let totalInMetroJson = 0;
      for (const mId of ['nyc', 'la', 'chi', 'tor']) {
        const jsonPath = path.join(tmpDir, 'data', `${mId}.json`);
        assert.ok(fs.existsSync(jsonPath), `Missing data/${mId}.json`);
        const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        assert.equal(payload.metro, mId);
        assert.ok(typeof payload.tz === 'string' && payload.tz.includes('/'), `Missing IANA tz in data/${mId}.json`);
        assert.ok(Array.isArray(payload.shows) && payload.shows.length > 0);
        assert.ok(payload.shows[0].hn && payload.shows[0].sa && payload.shows[0].sl, `Missing hn/sa/sl in data/${mId}.json`);
        totalInMetroJson += payload.shows.length;
      }
      assert.equal(totalInMetroJson, summary.totalShows);

      // Validate robots.txt & sitemaps
      const robots = fs.readFileSync(path.join(tmpDir, 'robots.txt'), 'utf8');
      assert.ok(robots.includes(`Sitemap: ${siteUrl}/sitemap.xml`));
      assert.ok(robots.includes(`Sitemap: ${siteUrl}/sitemap.txt`));

      const sitemapXml = fs.readFileSync(path.join(tmpDir, 'sitemap.xml'), 'utf8');
      const sitemapTxt = fs.readFileSync(path.join(tmpDir, 'sitemap.txt'), 'utf8');
      const txtUrls = sitemapTxt.trim().split('\n');
      assert.equal(txtUrls.length, summary.totalUrlsInSitemap);
      assert.ok(txtUrls.includes(`${siteUrl}/nyc/indie-rock-shows/`), 'City × Genre hub must be registered in sitemap');
      for (const u of txtUrls) {
        assert.ok(u.startsWith(`${siteUrl}/`), `Expected absolute URL in sitemap.txt, got ${u}`);
        assert.ok(sitemapXml.includes(`<loc>${u}</loc>`), `Expected ${u} in sitemap.xml`);
      }

      // Inspect EVERY generated HTML file
      const htmlFiles = walkHtmlFiles(tmpDir);
      assert.ok(htmlFiles.length >= 25);

      let checkedStaticAudio = false;
      let checkedProgressivePreview = false;
      let checkedNoSchemaBroadway = false;
      let checkedWithheldSalon = false;
      let checkedCancelledStatus = false;
      let checkedRescheduledStatus = false;

      for (const rel of htmlFiles) {
        const content = fs.readFileSync(path.join(tmpDir, rel), 'utf8');
        const blocks = extractJsonLdBlocks(content);
        const visibleText = extractVisibleBody(content);
        const isShowLeaf = rel.startsWith(`shows${path.sep}`);
        const isNotFound = rel === '404.html';

        // Single <h1> per page
        const h1Count = (content.match(/<h1\b/g) || []).length;
        assert.equal(h1Count, 1, `Expected exactly one <h1> in ${rel}, found ${h1Count}`);

        // Canonical URL on every indexable page
        if (!isNotFound) {
          assert.ok(content.includes('<link rel="canonical" href="https://'), `Missing canonical tag in ${rel}`);
        }

        // Branded Open Graph + Twitter large share card + Android-only sticky download bar on every page
        assert.ok(content.includes('<meta property="og:image" content="https://'), `Missing og:image in ${rel}`);
        assert.ok(content.includes('<meta name="twitter:card" content="summary_large_image">'), `Missing summary_large_image card in ${rel}`);
        assert.ok(content.includes('<meta name="twitter:image" content="https://'), `Missing twitter:image in ${rel}`);
        assert.ok(content.includes('data-android-bar hidden'), `Missing hidden Android sticky bar in ${rel}`);
        assert.ok(content.includes('data-android-bar-close'), `Missing Android bar dismiss button in ${rel}`);

        // Primary Google Play UTM CTA present on every page with exact encoding
        const expectedPrefix = `https://play.google.com/store/apps/details?id=${GOOGLE_PLAY_PACKAGE_ID}&amp;referrer=utm_source%3Dsetnik_web%26utm_medium%3Dseo%26utm_campaign%3D`;
        assert.ok(content.includes(expectedPrefix), `Missing properly encoded Google Play UTM CTA in ${rel}`);
        assert.ok(visibleText.includes(PRIMARY_CTA_LABEL), `Missing primary CTA label in ${rel}`);

        const eventBlocks = blocks.filter((b) => b['@type'] === 'MusicEvent' || b['@type'] === 'Event');

        if (!isShowLeaf) {
          // NEVER put Event / MusicEvent JSON-LD on hub pages!
          assert.equal(eventBlocks.length, 0, `Hub page ${rel} must NEVER contain MusicEvent/Event JSON-LD`);
          continue;
        }

        // Show leaf checks
        if (rel.includes('the-broadway')) {
          checkedNoSchemaBroadway = true;
          assert.equal(eventBlocks.length, 0, 'Show without street address must NOT emit MusicEvent JSON-LD');
        } else if (rel.includes('salon-on-kingston')) {
          checkedWithheldSalon = true;
          assert.equal(eventBlocks.length, 0, 'Withheld DIY address must NOT emit MusicEvent JSON-LD');
          assert.ok(visibleText.includes('address on request'), 'Withheld venue should show address on request');
        } else {
          assert.equal(eventBlocks.length, 1, `Show leaf with valid street address must emit 1 MusicEvent JSON-LD: ${rel}`);
          const ev = eventBlocks[0];
          assert.equal(ev['@context'], 'https://schema.org');
          assert.equal(ev['@type'], 'MusicEvent');
          assert.match(ev.startDate, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/, `Invalid startDate in ${rel}: ${ev.startDate}`);
          assert.equal(ev.location['@type'], 'Place');
          assert.equal(ev.location.address['@type'], 'PostalAddress');
          assert.ok(ev.location.address.streetAddress, `Missing streetAddress in ${rel}`);
          assert.ok(ev.location.address.addressLocality, `Missing addressLocality in ${rel}`);
          assert.ok(ev.location.address.addressRegion, `Missing addressRegion in ${rel}`);
          assert.ok(['US', 'CA'].includes(ev.location.address.addressCountry));

          // Google rule: `name` must NOT contain venue name, city, or ticket price
          assert.ok(!ev.name.includes(ev.location.name), `MusicEvent.name must not include venue name in ${rel}: ${ev.name}`);
          assert.ok(!ev.name.includes(ev.location.address.addressLocality), `MusicEvent.name must not include city in ${rel}: ${ev.name}`);
          assert.ok(!/\$\d/.test(ev.name), `MusicEvent.name must not include price in ${rel}: ${ev.name}`);

          // HTML parity: every JSON-LD field must also appear visibly in body
          assert.ok(visibleText.includes(ev.name), `JSON-LD name missing from body in ${rel}`);
          assert.ok(visibleText.includes(ev.location.name), `JSON-LD venue missing from body in ${rel}`);
          assert.ok(visibleText.includes(ev.location.address.streetAddress), `JSON-LD streetAddress missing from body in ${rel}`);
          assert.ok(visibleText.includes(ev.description), `JSON-LD description missing from body in ${rel}`);
          for (const perf of ev.performer || []) {
            assert.ok(visibleText.includes(perf.name), `JSON-LD performer "${perf.name}" missing from body in ${rel}`);
          }

          if (ev.eventStatus === 'https://schema.org/EventCancelled') checkedCancelledStatus = true;
          if (ev.eventStatus === 'https://schema.org/EventRescheduled') checkedRescheduledStatus = true;
        }

        // Audio preview checks
        if (rel.includes('market-hotel-the-serfs')) {
          checkedStaticAudio = true;
          assert.ok(content.includes('<audio class="preview-audio" controls preload="none" src="https://cdn-preview-example.setnik.invalid/previews/the-serfs-30s.mp3">'));
        }
        if (rel.includes('gold-sounds-bad-static')) {
          checkedProgressivePreview = true;
          assert.ok(content.includes('data-preview-btn'));
          assert.ok(content.includes('<audio class="preview-audio" controls preload="none" hidden>'));
        }
      }

      assert.ok(checkedStaticAudio, 'Expected to verify direct static <audio> preview on Market Hotel page');
      assert.ok(checkedProgressivePreview, 'Expected to verify progressive Deezer preview on Gold Sounds page');
      assert.ok(checkedNoSchemaBroadway, 'Expected to verify missing-address show omitted MusicEvent JSON-LD');
      assert.ok(checkedWithheldSalon, 'Expected to verify withheld DIY show omitted MusicEvent JSON-LD');
      assert.ok(checkedCancelledStatus, 'Expected to verify EventCancelled status');
      assert.ok(checkedRescheduledStatus, 'Expected to verify EventRescheduled status');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles empty show lists gracefully without failing the build', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setnik-web-empty-'));
    try {
      const summary = await buildSite({
        outDir: tmpDir,
        siteUrl: 'https://setnik.example',
        customData: { shows: [], flags: { jambaseEnabled: false, deezerEnabled: false }, attribution: [] },
        log: { info: () => {}, warn: () => {} },
      });

      assert.equal(summary.totalShows, 0);
      assert.ok(fs.existsSync(path.join(tmpDir, '.nojekyll')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'index.html')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'robots.txt')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'sitemap.xml')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'sitemap.txt')));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('escapes HTML/XSS payloads safely and respects deezer_enabled=false kill switch', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setnik-web-xss-'));
    try {
      const now = new Date('2026-11-24T17:00:00Z');
      await buildSite({
        outDir: tmpDir,
        siteUrl: 'https://setnik.example',
        now,
        customData: {
          flags: { jambaseEnabled: true, deezerEnabled: false },
          shows: [
            {
              id: 'xss-1',
              startsAt: '2026-11-28T20:00:00-05:00',
              venue: {
                name: 'Club <script>alert(1)</script>',
                neighborhood: 'Bushwick',
                area: 'Brooklyn',
                metro: 'nyc',
                city: 'Brooklyn, NY',
                address: '100 Main St, Brooklyn, NY 11206',
                addressVisibility: 'public',
              },
              acts: [{ name: 'Band "<b>Bold</b>"', order: 0 }],
              genres: ['Punk'],
              price: { min: 10 },
              status: 'scheduled',
              source: { provider: 'venue_site', url: '', fetchedAt: now.toISOString() },
            },
          ],
        },
        log: { info: () => {}, warn: () => {} },
      });

      const showDir = fs.readdirSync(path.join(tmpDir, 'shows'))[0];
      const leafHtml = fs.readFileSync(path.join(tmpDir, 'shows', showDir, 'index.html'), 'utf8');
      assert.ok(!leafHtml.includes('<script>alert(1)</script>'), 'Raw <script> tag must be escaped');
      assert.ok(leafHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Escaped text should appear safely');
      assert.ok(!leafHtml.includes('data-preview-btn'), 'Deezer preview button must be hidden when deezer_enabled is false');
      const homeHtml = fs.readFileSync(path.join(tmpDir, 'index.html'), 'utf8');
      assert.ok(!homeHtml.includes('data-row-preview'), 'In-list Deezer preview button must be hidden when deezer_enabled is false');
      assert.ok(homeHtml.includes('data-deezer-enabled="0"'), 'Explorer should propagate deezer_enabled=0');
      assert.ok(homeHtml.includes('data-row-save'), 'In-list Save trigger should still render when deezer_enabled is false');
      // Verify JSON-LD still parses cleanly even with <script> inside strings
      const blocks = extractJsonLdBlocks(leafHtml);
      assert.equal(blocks.length, 2);
      assert.equal(blocks[0]['@type'], 'MusicEvent');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('formats Google Play UTM referrer links with exact percent-encoding', () => {
    const url = playStoreUrl('nyc-shows-this-weekend');
    assert.equal(
      url,
      'https://play.google.com/store/apps/details?id=com.setnik.app&referrer=utm_source%3Dsetnik_web%26utm_medium%3Dseo%26utm_campaign%3Dnyc-shows-this-weekend',
    );
  });

  it('caps mega-hub SSR show lists at 120 rows and prunes 1-show suburb hubs across all metros', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setnik-web-cap-'));
    try {
      const now = new Date('2026-11-24T17:00:00Z');
      const shows = [];
      for (let i = 0; i < 135; i++) {
        const day = String(25 + (i % 6)).padStart(2, '0');
        shows.push({
          id: `cap-${i}`,
          startsAt: `2026-11-${day}T20:00:00-05:00`,
          venue: {
            name: `Club ${i % 10}`,
            neighborhood: 'Williamsburg',
            area: 'Brooklyn',
            metro: 'nyc',
            city: 'Brooklyn, NY',
            address: `${100 + i} Wythe Ave, Brooklyn, NY 11249`,
            addressVisibility: 'public',
          },
          acts: [{ name: `Band ${i}`, order: 0 }],
          genres: ['Indie Rock'],
          price: { min: 15 },
          status: 'scheduled',
          source: { provider: 'venue_site', url: '', fetchedAt: now.toISOString() },
        });
      }
      // Single-show NJ suburb inside NYC metro must NOT generate a thin suburb hub
      shows.push({
        id: 'suburb-single',
        startsAt: '2026-11-27T20:00:00-05:00',
        venue: {
          name: 'Tiny Room',
          neighborhood: 'Totowa',
          area: 'Totowa',
          metro: 'nyc',
          city: 'Totowa, NJ',
          address: '10 Union Blvd, Totowa, NJ 07512',
          addressVisibility: 'public',
        },
        acts: [{ name: 'Suburb Band', order: 0 }],
        genres: ['Rock'],
        price: { min: 10 },
        status: 'scheduled',
        source: { provider: 'jambase', url: '', fetchedAt: now.toISOString() },
      });

      await buildSite({
        outDir: tmpDir,
        siteUrl: 'https://setnik.example',
        now,
        customData: { shows, flags: { jambaseEnabled: true, deezerEnabled: true }, attribution: [] },
        log: { info: () => {}, warn: () => {} },
      });

      const nycHtml = fs.readFileSync(path.join(tmpDir, 'nyc-live-music/index.html'), 'utf8');
      const cardCount = (nycHtml.match(/class="show-card"/g) || []).length;
      assert.equal(cardCount, 120, `Expected mega-hub SSR cap of 120 show cards, got ${cardCount}`);
      assert.ok(nycHtml.includes('class="hub-more-callout"'), 'Mega-hub should render .hub-more-callout');
      assert.ok(nycHtml.includes('/?city=nyc&amp;when=all'), 'Mega-hub callout should link to full interactive calendar');
      assert.ok(!fs.existsSync(path.join(tmpDir, 'totowa-live-music/index.html')), '1-show NYC suburb hub should be pruned');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('clusters equivalent venue spellings into one /venues/ URL and emits tz + optional nd with 5:00 AM rollover', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setnik-web-venues-'));
    try {
      // 2026-11-28T06:00:00Z = Saturday 01:00 AM EST (NYC/MTL) & Friday 10:00 PM PST (LA)
      // Effective night date is Friday 2026-11-27 in all three metros.
      const now = new Date('2026-11-28T06:00:00Z');
      const shows = [
        {
          id: 'pianos-1',
          startsAt: '2026-11-27T21:00:00-05:00',
          priority: 3,
          venue: { name: 'Pianos', neighborhood: 'Lower East Side', area: 'Manhattan', metro: 'nyc', city: 'New York, NY', address: '158 Ludlow St, New York, NY 10002', addressVisibility: 'public' },
          acts: [{ name: 'Evening Band', order: 0 }],
          genres: ['Indie Rock'],
          price: { min: 15 },
          status: 'scheduled',
        },
        {
          id: 'pianos-2',
          startsAt: '2026-11-28T01:30:00-05:00',
          priority: 1,
          venue: { name: 'Piano’s', neighborhood: 'Lower East Side', area: 'Manhattan', metro: 'nyc', city: 'New York, NY', address: '158 Ludlow St', addressVisibility: 'public' },
          acts: [{ name: 'Late Night DJ', order: 0 }],
          genres: ['Electronic'],
          price: { min: 15 },
          status: 'scheduled',
        },
        {
          id: 'troub-1',
          startsAt: '2026-11-28T20:00:00-08:00',
          priority: 3,
          venue: { name: 'The Troubadour', neighborhood: 'West Hollywood', area: 'West Hollywood', metro: 'la', city: 'West Hollywood, CA', address: '9081 Santa Monica Blvd, West Hollywood, CA 90069', addressVisibility: 'public' },
          acts: [{ name: 'LA Band One', order: 0 }],
          genres: ['Rock'],
          price: { min: 25 },
          status: 'scheduled',
        },
        {
          id: 'troub-2',
          startsAt: '2026-11-29T20:00:00-08:00',
          priority: 1,
          venue: { name: 'Troubadour', neighborhood: 'West Hollywood', area: 'West Hollywood', metro: 'la', city: 'West Hollywood, CA', address: '9081 Santa Monica Blvd', addressVisibility: 'public' },
          acts: [{ name: 'LA Band Two', order: 0 }],
          genres: ['Rock'],
          price: { min: 25 },
          status: 'scheduled',
        },
        {
          id: 'beanfield-1',
          startsAt: '2026-11-28T20:00:00-05:00',
          priority: 3,
          venue: { name: 'Beanfield Theatre', neighborhood: 'Saint-Henri', area: 'Montréal', metro: 'mtl', city: 'Montréal, QC', address: '2490 Rue Notre-Dame O, Montréal, QC H3J 1N5', addressVisibility: 'public' },
          acts: [{ name: 'MTL Act One', order: 0 }],
          genres: ['Indie Rock'],
          price: { min: 30 },
          status: 'scheduled',
        },
        {
          id: 'beanfield-2',
          startsAt: '2026-11-29T20:00:00-05:00',
          priority: 1,
          venue: { name: 'Théâtre Beanfield', neighborhood: 'Saint-Henri', area: 'Montréal', metro: 'mtl', city: 'Montréal, QC', address: '2490 Rue Notre-Dame O', addressVisibility: 'public' },
          acts: [{ name: 'MTL Act Two', order: 0 }],
          genres: ['Indie Rock'],
          price: { min: 30 },
          status: 'scheduled',
        },
        {
          id: 'olympia-1',
          startsAt: '2026-11-28T20:00:00-05:00',
          priority: 3,
          venue: { name: "L' Olympia Theatre", neighborhood: 'Ville-Marie', area: 'Montréal', metro: 'mtl', city: 'Montréal, QC', address: '1004 Rue Sainte-Catherine E, Montréal, QC H2L 2G2', addressVisibility: 'public' },
          acts: [{ name: 'Olympia Act One', order: 0 }],
          genres: ['Pop'],
          price: { min: 35 },
          status: 'scheduled',
        },
        {
          id: 'olympia-2',
          startsAt: '2026-11-29T20:00:00-05:00',
          priority: 1,
          venue: { name: 'L’ Olympia Theatre', neighborhood: 'Ville-Marie', area: 'Montréal', metro: 'mtl', city: 'Montréal, QC', address: '1004 Rue Sainte-Catherine E', addressVisibility: 'public' },
          acts: [{ name: 'Olympia Act Two', order: 0 }],
          genres: ['Pop'],
          price: { min: 35 },
          status: 'scheduled',
        },
      ];

      const summary = await buildSite({
        outDir: tmpDir,
        siteUrl: 'https://setnik.example',
        now,
        customData: { shows, flags: { jambaseEnabled: true, deezerEnabled: true }, attribution: [] },
        log: { info: () => {}, warn: () => {} },
      });

      // 8 shows across 4 physical rooms -> exactly 4 unified /venues/ pages
      assert.equal(summary.totalShows, 8);
      assert.equal(summary.venueCount, 4);
      const venueDirs = fs.readdirSync(path.join(tmpDir, 'venues')).filter((e) => !e.endsWith('.html')).sort();
      assert.deepEqual(venueDirs, ['beanfield-theatre', 'l-olympia-theatre', 'pianos', 'the-troubadour']);

      // Verify /data/{metro}.json emits tz and optional nd only on after-midnight shows
      const nycJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'data/nyc.json'), 'utf8'));
      const laJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'data/la.json'), 'utf8'));
      const mtlJson = JSON.parse(fs.readFileSync(path.join(tmpDir, 'data/mtl.json'), 'utf8'));

      assert.equal(nycJson.tz, 'America/New_York');
      assert.equal(laJson.tz, 'America/Los_Angeles');
      assert.equal(mtlJson.tz, 'America/Toronto');
      assert.equal(nycJson.dates.today, '2026-11-27');

      const eveningItem = nycJson.shows.find((s) => s.hn === 'Evening Band');
      const lateItem = nycJson.shows.find((s) => s.hn === 'Late Night DJ');
      assert.equal(eveningItem.v, 'Pianos');
      assert.equal(lateItem.v, 'Pianos');
      assert.equal(lateItem.vp, '/venues/pianos/');
      assert.equal(eveningItem.d, '2026-11-27');
      assert.equal(eveningItem.nd, undefined);
      assert.equal(lateItem.d, '2026-11-28');
      assert.equal(lateItem.nd, '2026-11-27');
      assert.equal(lateItem.tn, 1);

      // All clustered shows share one canonical name & /venues/ URL
      assert.ok(laJson.shows.every((s) => s.v === 'The Troubadour' && s.vp === '/venues/the-troubadour/'));
      assert.ok(
        mtlJson.shows
          .filter((s) => s.hn.startsWith('MTL Act'))
          .every((s) => s.v === 'Beanfield Theatre' && s.vp === '/venues/beanfield-theatre/'),
      );
      assert.ok(
        mtlJson.shows
          .filter((s) => s.hn.startsWith('Olympia Act'))
          .every((s) => s.v === "L' Olympia Theatre" && s.vp === '/venues/l-olympia-theatre/'),
      );

      // Tonight hub at 1:00 AM EST Sat includes both Fri 9 PM and Sat 1:30 AM shows
      const tonightHtml = fs.readFileSync(path.join(tmpDir, 'nyc-concerts-tonight/index.html'), 'utf8');
      assert.ok(tonightHtml.includes('Evening Band'));
      assert.ok(tonightHtml.includes('Late Night DJ'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('computes live client-side dates in city IANA tz with 5:00 AM rollover, hides >3h past shows, and advances stale custom dates', async () => {
    const playerCode = buildPlayerJs();
    // Ensure generated player.js has valid JavaScript syntax
    assert.doesNotThrow(() => new Function(playerCode));

    const makeMockElement = (tag, attrs = {}) => {
      const listeners = {};
      const classSet = new Set();
      const children = [];
      const attrMap = { ...attrs };
      let textVal = '';
      const node = {
        tagName: tag.toUpperCase(),
        value: attrs.value || '',
        min: attrs.min || '',
        hidden: false,
        get textContent() { return textVal; },
        set textContent(v) {
          textVal = v == null ? '' : String(v);
          children.length = 0;
        },
        href: '',
        className: '',
        children,
        classList: {
          add: (c) => classSet.add(c),
          remove: (c) => classSet.delete(c),
          toggle: (c, force) => (force ? classSet.add(c) : classSet.delete(c)),
          contains: (c) => classSet.has(c),
        },
        getAttribute: (k) => (Object.prototype.hasOwnProperty.call(attrMap, k) ? attrMap[k] : null),
        setAttribute: (k, v) => { attrMap[k] = String(v); },
        addEventListener: (ev, fn) => {
          listeners[ev] = listeners[ev] || [];
          listeners[ev].push(fn);
        },
        dispatch: (ev) => {
          (listeners[ev] || []).forEach((fn) => fn({ target: node }));
        },
        appendChild: (child) => {
          if (child && child._isFragment) {
            children.push(...child.children);
          } else {
            children.push(child);
          }
          return child;
        },
        querySelector: () => null,
        querySelectorAll: () => [],
      };
      return node;
    };

    const collectText = (node) => {
      if (!node) return '';
      if (node._isText) return node.textContent;
      return (node.textContent || '') + (node.children || []).map(collectText).join(' ');
    };

    const runExplorerSession = async ({ fakeNowIso, urlSearch = '', payloads }) => {
      let currentNowMs = Date.parse(fakeNowIso);
      const RealDate = Date;
      function MockDate(...args) {
        if (!(this instanceof MockDate)) return new RealDate(currentNowMs).toString();
        if (args.length === 0) return new RealDate(currentNowMs);
        return new RealDate(...args);
      }
      MockDate.now = () => currentNowMs;
      MockDate.UTC = RealDate.UTC;
      MockDate.parse = RealDate.parse;
      MockDate.prototype = RealDate.prototype;

      const cityNyc = makeMockElement('button', { 'data-city-btn': 'nyc', 'data-metro-slug': 'nyc', 'data-metro-name': 'NYC', 'data-metro-total': '4', 'data-hub-href': '/nyc-live-music/', 'data-tonight-href': '/nyc-concerts-tonight/', 'data-weekend-href': '/nyc-shows-this-weekend/' });
      const cityLa = makeMockElement('button', { 'data-city-btn': 'la', 'data-metro-slug': 'la', 'data-metro-name': 'LA', 'data-metro-total': '2', 'data-hub-href': '/la-live-music/', 'data-tonight-href': '/la-concerts-tonight/', 'data-weekend-href': '/la-shows-this-weekend/' });
      const whenTonight = makeMockElement('button', { 'data-when-btn': 'tonight' });
      const whenTomorrow = makeMockElement('button', { 'data-when-btn': 'tomorrow' });
      const whenWeekend = makeMockElement('button', { 'data-when-btn': 'weekend' });
      const whenThisWeek = makeMockElement('button', { 'data-when-btn': 'this-week' });
      const whenNextWeek = makeMockElement('button', { 'data-when-btn': 'next-week' });
      const whenCustom = makeMockElement('button', { 'data-when-btn': 'custom' });
      const whenAll = makeMockElement('button', { 'data-when-btn': 'all' });
      const genreAll = makeMockElement('button', { 'data-genre-btn': 'all', 'data-genre-label': 'All' });
      const customBar = makeMockElement('div');
      // Stale build-time custom date defaults (3 days old!)
      const dateFromInput = makeMockElement('input', { value: '2026-11-24', min: '2026-11-24' });
      const dateToInput = makeMockElement('input', { value: '2026-11-24', min: '2026-11-24' });
      const listEl = makeMockElement('div');
      const loadMoreWrap = makeMockElement('div');
      const loadMoreBtn = makeMockElement('button');
      const expStatus = makeMockElement('span');
      const expMore = makeMockElement('a');
      const expEmpty = makeMockElement('div');

      const explorer = makeMockElement('section', {
        'data-base-path': '',
        'data-deezer-enabled': '1',
        'data-metros': 'nyc,la',
        'data-default-metro': 'nyc',
        'data-default-when': 'tonight',
      });
      explorer.querySelector = (sel) => ({
        '[data-custom-dates]': customBar,
        '[data-date-from]': dateFromInput,
        '[data-date-to]': dateToInput,
        '[data-explorer-list]': listEl,
        '[data-explorer-load-more]': loadMoreWrap,
        '[data-load-more-btn]': loadMoreBtn,
        '[data-explorer-status]': expStatus,
        '[data-explorer-more]': expMore,
        '[data-explorer-empty]': expEmpty,
      }[sel] || null);
      explorer.querySelectorAll = (sel) => ({
        '[data-city-btn]': [cityNyc, cityLa],
        '[data-when-btn]': [whenTonight, whenTomorrow, whenWeekend, whenThisWeek, whenNextWeek, whenCustom, whenAll],
        '[data-genre-btn]': [genreAll],
      }[sel] || []);

      const doc = {
        body: { classList: { add: () => {}, remove: () => {} } },
        head: { appendChild: () => {} },
        addEventListener: () => {},
        querySelector: (sel) => (sel === '[data-home-explorer]' ? explorer : null),
        querySelectorAll: () => [],
        createElement: (tag) => makeMockElement(tag),
        createTextNode: (text) => ({ _isText: true, textContent: String(text) }),
        createDocumentFragment: () => ({ _isFragment: true, children: [], appendChild(c) { this.children.push(c); return c; } }),
      };

      const win = {
        location: {
          href: `https://setnik.example/${urlSearch}`,
          origin: 'https://setnik.example',
          pathname: '/',
          search: urlSearch,
          hash: '',
        },
        history: { replaceState: () => {} },
        addEventListener: () => {},
      };

      const sandbox = {
        Date: MockDate,
        Intl,
        URL,
        URLSearchParams,
        Promise,
        Number,
        String,
        Array,
        Object,
        Boolean,
        Error,
        RegExp,
        setTimeout,
        clearTimeout,
        encodeURIComponent,
        navigator: { userAgent: '' },
        window: win,
        document: doc,
        fetch: (url) => {
          const m = /\/data\/([^/.]+)\.json/.exec(url);
          const data = m ? payloads[m[1]] : null;
          return Promise.resolve({
            ok: Boolean(data),
            status: data ? 200 : 404,
            json: () => Promise.resolve(data),
          });
        },
      };

      vm.runInNewContext(playerCode, sandbox);
      const flush = () => new Promise((r) => setTimeout(r, 15));
      await flush();

      return {
        setNow: (iso) => { currentNowMs = Date.parse(iso); },
        click: async (btn) => { btn.dispatch('click'); await flush(); },
        text: () => collectText(listEl),
        status: () => expStatus.textContent,
        dateFromInput,
        dateToInput,
        buttons: { cityNyc, cityLa, whenTonight, whenTomorrow, whenWeekend, whenThisWeek, whenNextWeek, whenCustom, whenAll },
      };
    };

    // Build-time flags (tn/tm/wk/tw/nw) are intentionally STALE (all 0) to prove client computes dates live from data.tz!
    const payloads = {
      nyc: {
        metro: 'nyc',
        tz: 'America/New_York',
        dates: { today: '2026-11-24' },
        shows: [
          { p: '/shows/past/', sl: 'past', n: 'Past Over 3h Show', hn: 'Past', d: '2026-11-27', dl: 'Friday, November 27, 2026', sa: '2026-11-27T23:00:00-05:00', ts: Date.parse('2026-11-27T23:00:00-05:00'), v: 'V1', vp: '/venues/v1/', m: 'nyc', g: [], tn: 0, tm: 0, wk: 0, tw: 0, nw: 0 },
          { p: '/shows/late/', sl: 'late', n: 'After Midnight Live Set', hn: 'Late', d: '2026-11-28', nd: '2026-11-27', dl: 'Saturday, November 28, 2026', sa: '2026-11-28T01:30:00-05:00', ts: Date.parse('2026-11-28T01:30:00-05:00'), v: 'V1', vp: '/venues/v1/', m: 'nyc', g: [], tn: 0, tm: 0, wk: 0, tw: 0, nw: 0 },
          { p: '/shows/sat/', sl: 'sat', n: 'Saturday Evening Show', hn: 'Sat', d: '2026-11-28', dl: 'Saturday, November 28, 2026', sa: '2026-11-28T20:00:00-05:00', ts: Date.parse('2026-11-28T20:00:00-05:00'), v: 'V1', vp: '/venues/v1/', m: 'nyc', g: [], tn: 0, tm: 0, wk: 0, tw: 0, nw: 0 },
          { p: '/shows/nextwk/', sl: 'nextwk', n: 'Next Week Show', hn: 'Next', d: '2026-12-05', dl: 'Saturday, December 5, 2026', sa: '2026-12-05T20:00:00-05:00', ts: Date.parse('2026-12-05T20:00:00-05:00'), v: 'V1', vp: '/venues/v1/', m: 'nyc', g: [], tn: 0, tm: 0, wk: 0, tw: 0, nw: 0 },
        ],
      },
      la: {
        metro: 'la',
        tz: 'America/Los_Angeles',
        dates: { today: '2026-11-24' },
        shows: [
          { p: '/shows/la-late/', sl: 'la-late', n: 'LA Late Friday Set', hn: 'LA Late', d: '2026-11-28', nd: '2026-11-27', dl: 'Saturday, November 28, 2026', sa: '2026-11-28T01:30:00-08:00', ts: Date.parse('2026-11-28T01:30:00-08:00'), v: 'V2', vp: '/venues/v2/', m: 'la', g: [], tn: 0, tm: 0, wk: 0, tw: 0, nw: 0 },
          { p: '/shows/la-sat/', sl: 'la-sat', n: 'LA Saturday Show', hn: 'LA Sat', d: '2026-11-28', dl: 'Saturday, November 28, 2026', sa: '2026-11-28T20:00:00-08:00', ts: Date.parse('2026-11-28T20:00:00-08:00'), v: 'V2', vp: '/venues/v2/', m: 'la', g: [], tn: 0, tm: 0, wk: 0, tw: 0, nw: 0 },
        ],
      },
    };

    // 1. At 2026-11-28T08:00:00Z = Saturday 03:00 AM EST (NYC effective night = Friday 2026-11-27)
    const session = await runExplorerSession({ fakeNowIso: '2026-11-28T08:00:00Z', payloads });
    // Past 23:00 show is 4h old (>3h) -> hidden; 01:30 AM show (nd=2026-11-27) is 1.5h old -> visible in Tonight!
    assert.ok(!session.text().includes('Past Over 3h Show'), 'Show >3h past start must be hidden');
    assert.ok(session.text().includes('After Midnight Live Set'), 'After-midnight show (nd=2026-11-27) must appear in Tonight before 5 AM');
    assert.ok(!session.text().includes('Saturday Evening Show'), 'Saturday night show must not appear in Friday Tonight');
    // Stale default custom-date pickers advanced from 2026-11-24 -> 2026-11-27 / 2026-12-04
    assert.equal(session.dateFromInput.value, '2026-11-27');
    assert.equal(session.dateFromInput.min, '2026-11-27');
    assert.equal(session.dateToInput.value, '2026-12-04');

    // Tomorrow (2026-11-28) shows Saturday Evening Show; Next Week shows 2026-12-05
    await session.click(session.buttons.whenTomorrow);
    assert.ok(session.text().includes('Saturday Evening Show'));
    assert.ok(!session.text().includes('After Midnight Live Set'));
    await session.click(session.buttons.whenNextWeek);
    assert.ok(session.text().includes('Next Week Show'));

    // 2. Advance clock to 2026-11-28T10:30:00Z = 05:30 AM EST (NYC rolled to Sat 2026-11-28) vs 02:30 AM PST (LA still Fri 2026-11-27!)
    session.setNow('2026-11-28T10:30:00Z');
    await session.click(session.buttons.whenTonight);
    assert.ok(session.text().includes('Saturday Evening Show'), 'NYC after 5 AM rolls Tonight to Saturday');
    assert.ok(!session.text().includes('After Midnight Live Set'), 'NYC after 5 AM drops Friday-night show from Tonight');

    await session.click(session.buttons.cityLa);
    assert.ok(session.text().includes('LA Late Friday Set'), 'LA at 2:30 AM PST still treats Friday night as Tonight');
    assert.ok(!session.text().includes('LA Saturday Show'));

    // 3. Explicit URL custom dates are never overwritten by default advancement
    const customSession = await runExplorerSession({
      fakeNowIso: '2026-11-28T08:00:00Z',
      urlSearch: '?city=nyc&when=custom&from=2026-12-05&to=2026-12-10',
      payloads,
    });
    assert.equal(customSession.dateFromInput.value, '2026-12-05');
    assert.equal(customSession.dateToInput.value, '2026-12-10');
    assert.ok(customSession.text().includes('Next Week Show'));
  });

  it('contains no personal account handle or legacy app names in any repository file', () => {
    // Constructed dynamically so this guard file never contains a forbidden literal.
    const SEP = '[\\s_-]*';
    const words = (...parts) => parts.join(SEP);
    const forbidden = [
      { label: 'personal handle', rx: new RegExp(words('hbn', 'mu' + 'sic'), 'i') },
      { label: 'legacy name 1', rx: new RegExp(words('pu' + 'll', 'u' + 'p'), 'i') },
      { label: 'legacy name 2', rx: new RegExp(words('sh' + 'ow', 'u' + 'p'), 'i') },
      { label: 'legacy name 3', rx: new RegExp(words('co' + 'me', 'th' + 'ru'), 'i') },
      { label: 'legacy name 4', rx: new RegExp('gig' + 'mate', 'i') },
    ];

    const rootDir = path.resolve(import.meta.dirname, '..');
    const scanDirs = ['src', 'data', 'tests', '.github'];
    const files = ['package.json', 'README.md', '.gitignore'];
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else files.push(path.relative(rootDir, full));
      }
    };
    scanDirs.forEach((d) => walk(path.join(rootDir, d)));

    const hits = [];
    for (const rel of files) {
      const full = path.join(rootDir, rel);
      if (!fs.existsSync(full)) continue;
      const lines = fs.readFileSync(full, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        for (const f of forbidden) {
          if (f.rx.test(line)) hits.push(`${rel}:${idx + 1} [${f.label}] ${line.trim().slice(0, 100)}`);
        }
      });
    }
    assert.deepEqual(hits, [], `Forbidden strings found:\n${hits.join('\n')}`);
  });
});
