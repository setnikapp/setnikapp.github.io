import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

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
