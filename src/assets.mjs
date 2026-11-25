/**
 * Static asset generators for Setnik Web:
 *  - assets/styles.css  (faithful to SETNIK_brand_spec_v1.1.pdf: House Lights / Encore White / Stage Black / Clip Red, Anton + DM Sans)
 *  - assets/player.js   (HTML5 audio preview coordinator + optional Deezer JSONP progressive resolver + hub filter pills)
 *  - assets/favicon.svg (Smooth Arrow waveform-to-play icon from brand spec p.3)
 */

export function buildFaviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Setnik">
  <rect width="64" height="64" rx="14" fill="#F3EAD3"/>
  <rect x="9" y="28" width="3.5" height="8" rx="1.2" fill="#141414"/>
  <rect x="14.5" y="23" width="3.5" height="18" rx="1.2" fill="#141414"/>
  <rect x="20" y="18" width="3.5" height="28" rx="1.2" fill="#141414"/>
  <rect x="25.5" y="13" width="3.5" height="38" rx="1.2" fill="#141414"/>
  <rect x="31" y="16" width="3.5" height="32" rx="1.2" fill="#141414"/>
  <rect x="36.5" y="20" width="3.5" height="24" rx="1.2" fill="#141414"/>
  <path d="M43 20.5 L55.5 30.2 Q57.2 32 55.5 33.8 L43 43.5 Q41.5 44.5 41.5 42.5 L41.5 21.5 Q41.5 19.5 43 20.5 Z" fill="#E4574E"/>
</svg>
`;
}

export function buildStylesCss() {
  return `/* Setnik Web — Brand Spec v1.1 (Daylight & Paper: House Lights, Encore White, Stage Black, Clip Red) */
:root {
  --bg: #F3EAD3;
  --surface: #FBF8F0;
  --surface-2: #EADFC2;
  --line: #D8CCAB;
  --line-strong: #C2B38C;
  --text: #141414;
  --muted: #3A3A3A;
  --faint: #6E6755;
  --accent: #E4574E;
  --accent-hover: #CC433B;
  --accent-text: #FFFFFF;
  --good: #2F7A4D;
  --good-bg: #E5F1E9;
  --warn: #8A5A00;
  --warn-bg: #F7EDD5;
  --danger: #B3261E;
  --danger-bg: #F8E3E1;
  --font-display: 'Anton', Impact, 'Arial Narrow', sans-serif;
  --font-body: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 4px;
  --shadow-card: none;
  --shadow-hover: none;
  --max-w: 980px;
}

*, *::before, *::after {
  box-sizing: border-box;
}

html {
  background-color: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 14.5px;
  line-height: 1.5;
  -webkit-text-size-adjust: 100%;
  scroll-behavior: smooth;
}

body {
  margin: 0;
  min-height: 100vh;
  background-color: var(--bg);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E");
  display: flex;
  flex-direction: column;
}

a {
  color: var(--accent);
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  transition: color 0.12s ease;
}

a:hover {
  color: var(--accent-hover);
}

a:focus-visible, button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

img {
  max-width: 100%;
  height: auto;
  display: block;
}

/* Skip link for keyboard accessibility */
.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  background: var(--text);
  color: var(--bg);
  padding: 8px 14px;
  font-weight: 700;
  z-index: 100;
}
.skip-link:focus {
  left: 12px;
  top: 12px;
}

/* Layout containers */
.wrap {
  width: 100%;
  max-width: var(--max-w);
  margin: 0 auto;
  padding: 0 18px;
}

main {
  flex: 1 0 auto;
  padding: 16px 0 56px;
}

/* Single editorial masthead (logo + tagline + Google Play badge) */
.site-header {
  background: var(--bg);
  border-bottom: 1px solid var(--line);
}

.header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px 20px;
  flex-wrap: wrap;
  padding: 12px 0;
}

.header-brand {
  display: flex;
  align-items: baseline;
  gap: 10px 14px;
  flex-wrap: wrap;
}

.brand-link {
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  color: var(--text);
}

.brand-link:hover {
  color: var(--text);
}

.brand-wordmark {
  height: 24px;
  width: auto;
  display: block;
}

.header-tagline {
  margin: 0;
  font-size: 13.5px;
  color: var(--faint);
}

.site-nav {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}

.site-nav a {
  color: var(--text);
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
  padding: 4px 0;
  border-bottom: 2px solid transparent;
}

.site-nav a:hover,
.site-nav a[aria-current="page"] {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.nav-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--accent);
  color: var(--accent-text) !important;
  border-bottom: none !important;
  padding: 8px 14px !important;
  border-radius: 999px;
  font-size: 13px !important;
  font-weight: 700 !important;
  letter-spacing: 0.01em;
  text-decoration: none;
  transition: background-color 0.14s ease, transform 0.14s ease;
}

.nav-cta:hover {
  background: var(--accent-hover);
  color: var(--accent-text) !important;
  transform: translateY(-1px);
}

/* Breadcrumbs */
.breadcrumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 13px;
  color: var(--faint);
  margin: 0 0 14px;
  padding: 0;
  list-style: none;
}

.breadcrumbs li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.breadcrumbs li + li::before {
  content: "/";
  color: var(--line-strong);
}

.breadcrumbs a {
  color: var(--muted);
  text-decoration: none;
}

.breadcrumbs a:hover {
  color: var(--accent);
  text-decoration: underline;
}

/* Typography — Strictly Anton (display/section headers) + DM Sans (body/captions) */
.kicker {
  display: block;
  font-family: var(--font-body);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--faint);
  margin: 0 0 6px;
}

h1, .display-title {
  font-family: var(--font-display);
  font-weight: 400;
  letter-spacing: 0.01em;
  line-height: 1.08;
  color: var(--text);
  margin: 0 0 8px;
  font-size: clamp(1.6rem, 3.2vw, 2.15rem);
}

h2, .section-title {
  font-family: var(--font-body);
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.2;
  color: var(--text);
  font-size: 1.15rem;
  margin: 0 0 10px;
}

h3 {
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 0.98rem;
  line-height: 1.3;
  color: var(--text);
  margin: 0 0 4px;
}

.lead {
  font-size: 0.96rem;
  color: var(--muted);
  margin: 0 0 14px;
  max-width: 66ch;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.play-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--text);
  color: #FFFFFF;
  text-decoration: none;
  padding: 6px 12px 6px 10px;
  border-radius: 4px;
  border: 1px solid #2A2A2A;
  transition: background-color 0.12s ease;
}

.play-badge:hover {
  background: #2A2A2A;
  color: #FFFFFF;
}

.play-badge-icon {
  flex-shrink: 0;
  width: 18px;
  height: 20px;
  display: block;
}

.play-badge-copy {
  display: flex;
  flex-direction: column;
  line-height: 1.05;
}

.play-badge-sub {
  font-size: 8.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #CFC8B8;
}

.play-badge-main {
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #FFFFFF;
}

/* Immediate City + Date + Genre filter controls above homepage listings */
.explorer-controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--line);
}

.filter-row {
  display: flex;
  align-items: center;
  gap: 6px 10px;
  flex-wrap: wrap;
}

.filter-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--faint);
  min-width: 44px;
}

.filter-pills {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.explorer-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
  flex-wrap: wrap;
}

.explorer-more-link {
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.explorer-more-link:hover {
  text-decoration: underline;
}

.custom-dates-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 3px;
}

.custom-dates-bar[hidden] {
  display: none;
}

.date-field {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--faint);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.date-input {
  font-family: var(--font-body);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--line-strong);
  border-radius: 3px;
  padding: 4px 8px;
}

.date-input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.load-more-wrap {
  margin-top: 16px;
  text-align: center;
}

.load-more-wrap[hidden] {
  display: none;
}

.filter-pill.is-empty {
  opacity: 0.48;
}

/* Compact directory links below listings */
.directory-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}

.dir-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  padding: 2px 0;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text);
  text-decoration: none;
  transition: border-color 0.12s ease, color 0.12s ease;
}

.dir-chip:hover {
  border-bottom-color: var(--accent);
  color: var(--accent);
}

.dir-chip span {
  font-size: 12px;
  font-weight: 400;
  color: var(--faint);
}

/* Hub page header (clean editorial, no heavy box shadow) */
.hero {
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  padding: 4px 0 20px;
  box-shadow: none;
  margin-bottom: 22px;
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: 24px;
  align-items: center;
}

.hero-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
}

.stat-box {
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 10px 12px;
}

.stat-num {
  display: block;
  font-family: var(--font-display);
  font-size: 1.65rem;
  line-height: 1.05;
  color: var(--text);
}

.stat-label {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--faint);
  margin-top: 2px;
}

/* Primary Conversion CTA Band / Card */
.cta-box {
  background: var(--text);
  color: var(--bg);
  border-radius: var(--radius-lg);
  padding: clamp(20px, 3.2vw, 28px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 6px 24px rgba(20, 20, 20, 0.14);
}

.cta-box .kicker {
  color: #C7BEA8;
  margin-bottom: 0;
}

.cta-box h2, .cta-box h3 {
  color: var(--bg);
  margin: 0;
}

.cta-box p {
  margin: 0;
  color: #DFD7C3;
  font-size: 0.95rem;
}

.cta-banner {
  background: var(--text);
  color: var(--bg);
  border-radius: var(--radius-lg);
  padding: clamp(22px, 3.5vw, 32px);
  margin: 34px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}

.cta-banner-copy {
  max-width: 56ch;
}

.cta-banner-copy h2 {
  color: var(--bg);
  margin: 4px 0 8px;
}

.cta-banner-copy p {
  color: #DFD7C3;
  margin: 0;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--accent);
  color: var(--accent-text);
  text-decoration: none;
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 0.9rem;
  line-height: 1.25;
  padding: 10px 16px;
  border-radius: 4px;
  border: 0;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.btn-primary:hover {
  background: var(--accent-hover);
  color: var(--accent-text);
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.88rem;
  padding: 8px 14px;
  border-radius: 4px;
  border: 1px solid var(--text);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.btn-secondary:hover {
  background: var(--text);
  color: var(--bg);
}

.cta-note {
  font-size: 12px;
  color: #B9B09A;
}

/* Hub navigation chips & filter bar */
.section {
  margin-top: 28px;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--line);
  padding-bottom: 6px;
  margin-bottom: 12px;
}

.section-head h2 {
  margin: 0;
}

.section-more {
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
}

.hub-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
}

.hub-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 6px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 12px 14px;
  text-decoration: none;
  color: var(--text);
  transition: border-color 0.12s ease;
}

.hub-card:hover {
  border-color: var(--text);
  color: var(--text);
}

.hub-card-title {
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 0.98rem;
  line-height: 1.25;
  color: var(--text);
}

.hub-card-meta {
  font-size: 12.5px;
  color: var(--faint);
}

.hub-card-cta {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--accent);
}

/* Filter bar on hubs */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  margin: 0 0 16px;
}

.filter-pill {
  appearance: none;
  background: transparent;
  border: 1px solid var(--line-strong);
  color: var(--text);
  font-family: var(--font-body);
  font-size: 12.5px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 3px;
  cursor: pointer;
  transition: background-color 0.1s ease, border-color 0.1s ease, color 0.1s ease;
}

.filter-pill:hover {
  border-color: var(--text);
  background: var(--surface);
}

.filter-pill[aria-pressed="true"] {
  background: var(--text);
  border-color: var(--text);
  color: var(--bg);
}

.filter-status {
  font-size: 12.5px;
  color: var(--faint);
  margin-left: auto;
}

/* Date-grouped editorial concert rows (hairline-ruled, zero drop shadows) */
.day-group {
  margin-bottom: 22px;
}

.day-heading {
  font-family: var(--font-body);
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text);
  margin: 0;
  padding: 6px 0;
  border-bottom: 1.5px solid var(--text);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.day-count {
  font-family: var(--font-body);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--faint);
  letter-spacing: 0.03em;
  text-transform: none;
}

.show-list {
  display: block;
  list-style: none;
  margin: 0;
  padding: 0;
}

.show-card {
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: baseline;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  padding: 10px 4px;
  transition: background-color 0.1s ease;
}

.show-card:hover {
  background: rgba(251, 248, 240, 0.72);
}

.show-card[hidden] {
  display: none;
}

.date-stamp {
  background: transparent;
  border: 0;
  border-radius: 0;
  text-align: left;
  padding: 0;
  line-height: 1.15;
}

.date-stamp-month {
  display: block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--faint);
}

.date-stamp-day {
  display: block;
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--text);
  margin: 0;
}

.date-stamp-dow {
  display: block;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--faint);
}

.show-card-main {
  min-width: 0;
}

.show-card-title {
  display: inline-block;
  font-family: var(--font-body);
  font-weight: 700;
  font-size: 1rem;
  line-height: 1.28;
  color: var(--text);
  text-decoration: none;
  margin-bottom: 2px;
}

.show-card-title:hover {
  color: var(--accent);
  text-decoration: underline;
}

.show-card-supports {
  font-size: 0.88rem;
  color: var(--muted);
  margin: 0 0 3px;
}

.show-card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  font-size: 12.5px;
  color: var(--faint);
}

.show-card-meta a {
  color: var(--muted);
  font-weight: 600;
  text-decoration: none;
}

.show-card-meta a:hover {
  color: var(--accent);
  text-decoration: underline;
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}

.tag {
  display: inline-block;
  background: transparent;
  border: 1px solid var(--line);
  color: var(--faint);
  font-size: 11px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 2px;
  text-decoration: none;
}

a.tag:hover {
  border-color: var(--text);
  color: var(--text);
}

.badge {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 1px 5px;
  border-radius: 2px;
  margin-right: 5px;
  vertical-align: middle;
}

.badge-free {
  background: var(--good-bg);
  color: var(--good);
}

.badge-cancelled {
  background: var(--danger-bg);
  color: var(--danger);
}

.badge-moved {
  background: var(--warn-bg);
  color: var(--warn);
}

.show-card-action {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.price-chip {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  white-space: nowrap;
}

.details-link {
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}

/* Leaf Show Page */
.leaf-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.leaf-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  padding: clamp(20px, 3.5vw, 32px);
  box-shadow: var(--shadow-card);
}

.leaf-poster {
  margin: 0 0 18px;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--surface-2);
}

.leaf-poster img {
  width: 100%;
  max-height: 360px;
  object-fit: cover;
}

.leaf-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px;
  margin: 20px 0;
  padding: 16px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}

.fact-item dt {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--faint);
  margin: 0 0 4px;
}

.fact-item dd {
  margin: 0;
  font-size: 0.96rem;
  color: var(--text);
  font-weight: 500;
}

.fact-sub {
  display: block;
  font-size: 13px;
  color: var(--faint);
  font-weight: 400;
  margin-top: 2px;
}

.lineup-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.act-row {
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.act-row-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.act-name {
  font-weight: 700;
  font-size: 1rem;
  color: var(--text);
}

.act-role {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--faint);
  margin-left: 8px;
}

.preview-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  background: var(--accent);
  color: var(--accent-text);
  border: 0;
  border-radius: 3px;
  padding: 6px 12px;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 0.14s ease, transform 0.14s ease;
}

.preview-btn:hover {
  background: var(--accent-hover);
  transform: translateY(-1px);
}

.preview-btn:disabled {
  opacity: 0.65;
  cursor: wait;
}

.preview-audio {
  width: 100%;
  height: 40px;
  accent-color: var(--accent);
}

.preview-meta {
  font-size: 12px;
  color: var(--faint);
}

.leaf-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.leaf-sidebar {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.side-panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  padding: 18px;
  box-shadow: var(--shadow-card);
}

.side-panel h2 {
  font-size: 1.25rem;
  margin-bottom: 10px;
}

.side-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 10px;
}

.side-list li {
  border-top: 1px solid var(--line);
  padding-top: 10px;
}

.side-list li:first-child {
  border-top: 0;
  padding-top: 0;
}

.side-list a {
  display: block;
  font-weight: 700;
  color: var(--text);
  text-decoration: none;
  font-size: 0.94rem;
}

.side-list a:hover {
  color: var(--accent);
}

.side-list span {
  display: block;
  font-size: 12px;
  color: var(--faint);
  margin-top: 2px;
}

/* Empty state */
.empty-state {
  background: var(--surface);
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius-md);
  padding: 28px 20px;
  text-align: center;
  color: var(--muted);
}

/* Footer */
.site-footer {
  border-top: 1px solid var(--line);
  background: var(--surface);
  padding: 28px 0 40px;
  font-size: 13px;
  color: var(--faint);
}

.footer-grid {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 20px;
  flex-wrap: wrap;
}

.footer-links {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 8px 0 0;
}

.footer-links a {
  color: var(--muted);
  text-decoration: none;
}

.footer-links a:hover {
  color: var(--accent);
  text-decoration: underline;
}

/* Responsive */
@media (max-width: 820px) {
  .hero-grid,
  .leaf-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .show-card {
    grid-template-columns: 54px minmax(0, 1fr);
    align-items: start;
  }
  .show-card-action {
    grid-column: 2;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    margin-top: 4px;
    padding-top: 8px;
    border-top: 1px solid var(--line);
  }
  .hero-stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .stat-num {
    font-size: 1.35rem;
  }
}
`;
}

export function buildPlayerJs() {
  return `/* Setnik Web — lightweight HTML5 audio previews + hub filter pills (zero dependencies) */
(function () {
  'use strict';

  // Ensure only one <audio> preview plays at a time.
  document.addEventListener('play', function (e) {
    if (!e.target || e.target.tagName !== 'AUDIO') return;
    document.querySelectorAll('audio').forEach(function (el) {
      if (el !== e.target && !el.paused) el.pause();
    });
  }, true);

  // Hub page client-side genre/price filters (static HTML remains 100% crawlable).
  var filterBar = document.querySelector('[data-filter-bar]');
  if (filterBar) {
    var buttons = Array.prototype.slice.call(filterBar.querySelectorAll('[data-filter-value]'));
    var cards = Array.prototype.slice.call(document.querySelectorAll('[data-show-card]'));
    var groups = Array.prototype.slice.call(document.querySelectorAll('[data-day-group]'));
    var statusEl = filterBar.querySelector('[data-filter-status]');

    function applyFilter(kind, value) {
      var visible = 0;
      cards.forEach(function (card) {
        var match = true;
        if (kind === 'genre' && value !== 'all') {
          var genres = (card.getAttribute('data-genres') || '').split('|');
          match = genres.indexOf(value) !== -1;
        } else if (kind === 'price' && value === 'free') {
          match = card.getAttribute('data-free') === '1';
        } else if (kind === 'price' && value === 'under20') {
          var p = Number(card.getAttribute('data-price'));
          match = card.getAttribute('data-free') === '1' || (!Number.isNaN(p) && p > 0 && p <= 20);
        }
        card.hidden = !match;
        if (match) visible++;
      });

      groups.forEach(function (g) {
        var hasVisible = g.querySelector('[data-show-card]:not([hidden])');
        g.hidden = !hasVisible;
      });

      if (statusEl) {
        statusEl.textContent = visible + (visible === 1 ? ' show' : ' shows');
      }
    }

    buttons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        buttons.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
        btn.setAttribute('aria-pressed', 'true');
        applyFilter(btn.getAttribute('data-filter-kind') || 'genre', btn.getAttribute('data-filter-value') || 'all');
      });
    });
  }

  // Homepage City + Date + Genre explorer backed by full per-metro JSON indices (/data/{metro}.json)
  // so 100% of upcoming shows (never truncated) are searchable across Tonight, Tomorrow, Weekend, This/Next Week, Custom Dates, and every Genre.
  var explorer = document.querySelector('[data-home-explorer]');
  if (explorer) {
    var basePath = explorer.getAttribute('data-base-path') || '';
    var allMetroIds = (explorer.getAttribute('data-metros') || '').split(',').filter(Boolean);
    var cityBtns = Array.prototype.slice.call(explorer.querySelectorAll('[data-city-btn]'));
    var whenBtns = Array.prototype.slice.call(explorer.querySelectorAll('[data-when-btn]'));
    var genreBtns = Array.prototype.slice.call(explorer.querySelectorAll('[data-genre-btn]'));
    var customBar = explorer.querySelector('[data-custom-dates]');
    var dateFromInput = explorer.querySelector('[data-date-from]');
    var dateToInput = explorer.querySelector('[data-date-to]');
    var listEl = explorer.querySelector('[data-explorer-list]');
    var loadMoreWrap = explorer.querySelector('[data-explorer-load-more]');
    var loadMoreBtn = explorer.querySelector('[data-load-more-btn]');
    var expStatus = explorer.querySelector('[data-explorer-status]');
    var expMore = explorer.querySelector('[data-explorer-more]');
    var expEmpty = explorer.querySelector('[data-explorer-empty]');
    var expReset = explorer.querySelector('[data-explorer-reset]');

    var activeCity = explorer.getAttribute('data-default-metro') || 'all';
    var activeWhen = explorer.getAttribute('data-default-when') || 'this-week';
    var activeGenre = 'all';
    var PAGE_SIZE = 40;
    var renderLimit = PAGE_SIZE;
    var metroCache = {};
    var requestSeq = 0;

    if (dateFromInput && dateToInput && dateFromInput.value) {
      var d0 = new Date(dateFromInput.value + 'T12:00:00Z');
      if (!Number.isNaN(d0.getTime())) {
        d0.setUTCDate(d0.getUTCDate() + 7);
        dateToInput.value = d0.toISOString().slice(0, 10);
      }
    }

    function loadMetro(id) {
      if (metroCache[id]) return Promise.resolve(metroCache[id]);
      return fetch(basePath + '/data/' + encodeURIComponent(id) + '.json')
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        })
        .then(function (data) {
          var shows = (data && Array.isArray(data.shows)) ? data.shows : [];
          metroCache[id] = shows;
          return shows;
        })
        .catch(function () { return []; });
    }

    function loadShowsForCity(city) {
      if (city === 'all') {
        return Promise.all(allMetroIds.map(loadMetro)).then(function (lists) {
          var merged = [];
          lists.forEach(function (arr) { Array.prototype.push.apply(merged, arr); });
          merged.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
          return merged;
        });
      }
      return loadMetro(city);
    }

    function matchesWhen(show, when, customFrom, customTo) {
      if (when === 'tonight') return show.tn === 1;
      if (when === 'tomorrow') return show.tm === 1;
      if (when === 'weekend') return show.wk === 1;
      if (when === 'this-week') return show.tw === 1;
      if (when === 'next-week') return show.nw === 1;
      if (when === 'custom') {
        var cd = show.d || '';
        return Boolean(cd && (!customFrom || cd >= customFrom) && (!customTo || cd <= customTo));
      }
      return true;
    }

    function el(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = String(text);
      return node;
    }

    function buildShowRow(s) {
      var li = el('li', 'show-card');

      var stamp = el('div', 'date-stamp');
      stamp.appendChild(el('span', 'date-stamp-month', s.mo || ''));
      stamp.appendChild(el('span', 'date-stamp-day', s.dy || '—'));
      stamp.appendChild(el('span', 'date-stamp-dow', s.dw || ''));
      li.appendChild(stamp);

      var main = el('div', 'show-card-main');
      var titleLink = el('a', 'show-card-title');
      titleLink.href = basePath + s.p;
      if (s.st === 'cancelled') titleLink.appendChild(el('span', 'badge badge-cancelled', 'Cancelled'));
      else if (s.st === 'moved') titleLink.appendChild(el('span', 'badge badge-moved', 'Rescheduled'));
      titleLink.appendChild(document.createTextNode(s.n || ''));
      main.appendChild(titleLink);

      if (s.sup) main.appendChild(el('p', 'show-card-supports', s.sup));

      var meta = el('div', 'show-card-meta');
      var vLink = el('a', '', s.v || '');
      vLink.href = basePath + s.vp;
      meta.appendChild(vLink);
      if (s.nb) meta.appendChild(el('span', '', s.nb));
      if (s.t) meta.appendChild(el('span', '', s.t));
      main.appendChild(meta);

      if (s.g && s.g.length) {
        var tagRow = el('div', 'tag-row');
        s.g.forEach(function (pair) {
          var a = el('a', 'tag', pair[0]);
          a.href = basePath + '/genres/' + pair[1] + '/';
          tagRow.appendChild(a);
        });
        main.appendChild(tagRow);
      }
      li.appendChild(main);

      var action = el('div', 'show-card-action');
      if (s.pr) {
        var priceChip = el('span', 'price-chip');
        if (s.fr === 1) priceChip.appendChild(el('span', 'badge badge-free', 'Free'));
        else priceChip.textContent = s.pr;
        action.appendChild(priceChip);
      }
      var det = el('a', 'details-link', 'Lineup & preview →');
      det.href = basePath + s.p;
      action.appendChild(det);
      li.appendChild(action);

      return li;
    }

    function renderMatched(shows) {
      if (!listEl) return;
      var slice = shows.slice(0, renderLimit);
      var frag = document.createDocumentFragment();
      var groups = [];
      var groupMap = {};

      slice.forEach(function (s) {
        var key = s.d || 'unknown';
        if (!groupMap[key]) {
          groupMap[key] = { label: s.dl || 'Upcoming', items: [] };
          groups.push(groupMap[key]);
        }
        groupMap[key].items.push(s);
      });

      groups.forEach(function (g) {
        var sec = el('section', 'day-group');
        var h2 = el('h2', 'day-heading');
        h2.appendChild(el('span', '', g.label));
        h2.appendChild(el('span', 'day-count', g.items.length + (g.items.length === 1 ? ' show' : ' shows')));
        sec.appendChild(h2);

        var ul = el('ul', 'show-list');
        g.items.forEach(function (s) { ul.appendChild(buildShowRow(s)); });
        sec.appendChild(ul);
        frag.appendChild(sec);
      });

      listEl.textContent = '';
      listEl.appendChild(frag);

      if (loadMoreWrap && loadMoreBtn) {
        var remaining = shows.length - slice.length;
        loadMoreWrap.hidden = remaining <= 0;
        if (remaining > 0) {
          loadMoreBtn.textContent = 'Show more (' + remaining + ' remaining)';
        }
      }
    }

    function updateGenreCounts(whenFiltered) {
      var counts = {};
      whenFiltered.forEach(function (s) {
        (s.g || []).forEach(function (pair) {
          counts[pair[1]] = (counts[pair[1]] || 0) + 1;
        });
      });

      genreBtns.forEach(function (btn) {
        var slug = btn.getAttribute('data-genre-btn') || 'all';
        var label = btn.getAttribute('data-genre-label') || btn.textContent;
        if (slug === 'all') {
          btn.textContent = 'All (' + whenFiltered.length + ')';
          btn.classList.remove('is-empty');
        } else {
          var c = counts[slug] || 0;
          btn.textContent = c > 0 ? label + ' (' + c + ')' : label;
          btn.classList.toggle('is-empty', c === 0);
        }
      });
    }

    function updateMoreLink() {
      var selectedCityBtn = cityBtns.find(function (b) { return b.getAttribute('data-city-btn') === activeCity; });
      if (!expMore || !selectedCityBtn) return;
      var name = selectedCityBtn.getAttribute('data-metro-name') || '';
      var total = selectedCityBtn.getAttribute('data-metro-total') || '';
      var hubHref = selectedCityBtn.getAttribute('data-hub-href') || '/';
      var wkHref = selectedCityBtn.getAttribute('data-weekend-href') || hubHref;
      if (activeCity === 'all') {
        expMore.href = hubHref;
        expMore.textContent = 'Browse all venues →';
      } else if (activeWhen === 'weekend') {
        expMore.href = wkHref;
        expMore.textContent = 'All ' + name + ' weekend shows →';
      } else {
        expMore.href = hubHref;
        expMore.textContent = 'Full ' + name + ' calendar (' + total + ') →';
      }
    }

    var lastMatched = [];

    function syncExplorer(resetPage) {
      if (resetPage !== false) renderLimit = PAGE_SIZE;
      if (customBar) customBar.hidden = activeWhen !== 'custom';
      updateMoreLink();

      var customFrom = dateFromInput ? dateFromInput.value : '';
      var customTo = dateToInput ? dateToInput.value : '';
      var seq = ++requestSeq;

      if (expStatus) expStatus.textContent = 'Loading…';

      loadShowsForCity(activeCity).then(function (cityShows) {
        if (seq !== requestSeq) return;
        var whenMatched = cityShows.filter(function (s) {
          return matchesWhen(s, activeWhen, customFrom, customTo);
        });
        updateGenreCounts(whenMatched);

        var matched = activeGenre === 'all'
          ? whenMatched
          : whenMatched.filter(function (s) {
              return (s.g || []).some(function (pair) { return pair[1] === activeGenre; });
            });

        lastMatched = matched;
        renderMatched(matched);
        if (expEmpty) expEmpty.hidden = matched.length > 0;
        if (expStatus) {
          expStatus.textContent = matched.length + (matched.length === 1 ? ' show' : ' shows');
        }
      });
    }

    cityBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeCity = btn.getAttribute('data-city-btn') || 'all';
        cityBtns.forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
        syncExplorer(true);
      });
    });

    whenBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeWhen = btn.getAttribute('data-when-btn') || 'all';
        whenBtns.forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
        syncExplorer(true);
      });
    });

    if (dateFromInput) {
      dateFromInput.addEventListener('change', function () {
        if (dateToInput && dateToInput.value && dateFromInput.value && dateToInput.value < dateFromInput.value) {
          dateToInput.value = dateFromInput.value;
        }
        syncExplorer(true);
      });
    }
    if (dateToInput) {
      dateToInput.addEventListener('change', function () {
        if (dateFromInput && dateFromInput.value && dateToInput.value && dateToInput.value < dateFromInput.value) {
          dateFromInput.value = dateToInput.value;
        }
        syncExplorer(true);
      });
    }

    genreBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeGenre = btn.getAttribute('data-genre-btn') || 'all';
        genreBtns.forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); });
        syncExplorer(true);
      });
    });

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', function () {
        renderLimit += PAGE_SIZE;
        renderMatched(lastMatched);
      });
    }

    if (expReset) {
      expReset.addEventListener('click', function () {
        activeWhen = 'all';
        activeGenre = 'all';
        whenBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-when-btn') === 'all' ? 'true' : 'false'); });
        genreBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-genre-btn') === 'all' ? 'true' : 'false'); });
        syncExplorer(true);
      });
    }

    syncExplorer(true);
  }

  // Progressive Deezer 30-second preview lookup via JSONP (mirrors the Setnik app's src/lib/deezer.ts).
  // Used only when an act has no static previewUrl baked into the page and deezer_enabled is ON.
  function normalizeName(name) {
    return String(name || '')
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\\s+/g, ' ');
  }

  function namesMatch(a, b) {
    var x = normalizeName(a);
    var y = normalizeName(b);
    if (!x || !y) return false;
    var strip = function (s) { return s.replace(/^the /, ''); };
    return x === y || strip(x) === strip(y);
  }

  function isCollab(name) {
    return /\\s\\/\\s|\\bw\\/|\\bpresents?\\b|\\bfeat\\.?\\b/i.test(String(name || ''));
  }

  var cbCounter = 0;
  function jsonp(url) {
    return new Promise(function (resolve, reject) {
      var cbName = '__setnikDz_' + (++cbCounter) + '_' + Date.now();
      var script = document.createElement('script');
      var timer = setTimeout(function () {
        cleanup();
        reject(new Error('timeout'));
      }, 9000);

      function cleanup() {
        clearTimeout(timer);
        try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[cbName] = function (data) {
        cleanup();
        resolve(data);
      };
      script.onerror = function () {
        cleanup();
        reject(new Error('network'));
      };
      script.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'output=jsonp&callback=' + cbName;
      document.head.appendChild(script);
    });
  }

  async function resolveDeezerPreview(actName, explicitArtistId) {
    if (!explicitArtistId && isCollab(actName)) return null;
    var artistId = explicitArtistId;
    if (!artistId) {
      var res = await jsonp('https://api.deezer.com/search/artist?q=' + encodeURIComponent(actName) + '&limit=8');
      var candidates = (res && Array.isArray(res.data)) ? res.data : [];
      var exact = candidates.filter(function (c) {
        return namesMatch(actName, c.name) && Number(c.nb_album || 0) > 0;
      });
      if (!exact.length) return null;
      exact.sort(function (a, b) { return Number(b.nb_fan || 0) - Number(a.nb_fan || 0); });
      artistId = exact[0].id;
    }
    var top = await jsonp('https://api.deezer.com/artist/' + encodeURIComponent(artistId) + '/top?limit=5');
    var tracks = (top && Array.isArray(top.data)) ? top.data : [];
    var track = tracks.find(function (t) { return typeof t.preview === 'string' && t.preview.length > 0; });
    if (!track) return null;
    return {
      title: track.title_short || track.title || '',
      artist: (track.artist && track.artist.name) || actName,
      previewUrl: track.preview
    };
  }

  document.querySelectorAll('[data-preview-btn]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      var row = btn.closest('[data-act-row]');
      if (!row) return;
      var audio = row.querySelector('audio');
      var status = row.querySelector('[data-preview-meta]');
      var actName = btn.getAttribute('data-act-name') || '';
      var artistId = btn.getAttribute('data-deezer-id') || '';

      if (audio && audio.src) {
        audio.hidden = false;
        if (audio.paused) audio.play().catch(function () {});
        else audio.pause();
        return;
      }

      btn.disabled = true;
      if (status) status.textContent = 'Finding 30-second preview…';
      try {
        var found = await resolveDeezerPreview(actName, artistId);
        if (!found) {
          btn.disabled = false;
          btn.textContent = 'No preview found';
          if (status) status.textContent = 'No catalog preview available — discover more local bills on Setnik.';
          return;
        }
        if (audio) {
          audio.src = found.previewUrl;
          audio.hidden = false;
          audio.play().catch(function () {});
        }
        btn.disabled = false;
        btn.textContent = 'Playing preview';
        if (status) status.textContent = '30s clip: “' + found.title + '” by ' + found.artist + ' (via Deezer)';
      } catch (_) {
        btn.disabled = false;
        if (status) status.textContent = 'Preview unavailable right now — listen directly in the Setnik Android app.';
      }
    });
  });
})();
`;
}
