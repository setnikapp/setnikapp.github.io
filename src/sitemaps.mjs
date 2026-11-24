/**
 * Generates robots.txt, sitemap.xml, plain-text sitemap.txt, and .nojekyll.
 */

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildRobotsTxt(siteUrl) {
  return [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    `Sitemap: ${siteUrl}/sitemap.txt`,
    '',
  ].join('\n');
}

export function buildSitemapXml(entries) {
  const rows = entries.map((e) => [
    '  <url>',
    `    <loc>${xmlEscape(e.loc)}</loc>`,
    e.lastmod ? `    <lastmod>${xmlEscape(e.lastmod)}</lastmod>` : null,
    e.changefreq ? `    <changefreq>${xmlEscape(e.changefreq)}</changefreq>` : null,
    e.priority != null ? `    <priority>${Number(e.priority).toFixed(1)}</priority>` : null,
    '  </url>',
  ].filter(Boolean).join('\n'));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rows,
    '</urlset>',
    '',
  ].join('\n');
}

export function buildSitemapTxt(entries) {
  return `${entries.map((e) => e.loc).join('\n')}\n`;
}
