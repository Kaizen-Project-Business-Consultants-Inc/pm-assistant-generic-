# Kovarti PM — SEO Plan

**Domain:** kovarti.com
**Last updated:** August 26, 2026

---

## Phase 1: On-Page SEO (DONE)

All items implemented and deployed to production.

### Per-Page Meta Tags
Every public page now has unique `<title>`, `<meta description>`, Open Graph, and Twitter Card tags via the `useSEO()` React hook.

| Page | Title | Description |
|------|-------|-------------|
| Landing `/` | Kovarti PM — AI-Powered Project Management Software | Plan smarter, predict risks, and deliver on time. AI scheduling, Monte Carlo simulations, EVM, Gantt charts, and real-time collaboration. |
| Pricing `/pricing` | Pricing — Kovarti PM | Simple, transparent pricing. Free 14-day trial, Consultant Basic at $19/mo, Consultant Pro at $29/mo with AI features. No credit card required. |
| Roadmap `/roadmap` | Product Roadmap — Kovarti PM | See what we are building next. Our product roadmap is shaped by customer feedback. |
| Login `/login` | Sign In — Kovarti PM | Sign in to your Kovarti PM account. Access your projects, schedules, and AI-powered insights. |
| Register `/register` | Create Account — Kovarti PM | Start your free 14-day trial of Kovarti PM. No credit card required. AI-powered project management. |
| User Guide `/guide` | User Guide — Kovarti PM | Complete user guide for Kovarti PM. Learn how to manage projects, schedules, tasks, sprints, reports, and AI features. |
| Terms `/terms` | Terms of Service — Kovarti PM | Terms of Service for Kovarti PM. Subscription terms, AI usage limits, acceptable use, and liability. |
| Privacy `/privacy` | Privacy Policy — Kovarti PM | Privacy Policy for Kovarti PM. How we collect, use, and protect your data. PIPEDA compliant. Data hosted in Canada. |

### JSON-LD Structured Data
- **Landing page:** `SoftwareApplication` schema with pricing aggregate offer ($0–$79)
- **Pricing page:** `WebPage` with `SoftwareApplication` offers (Trial, Basic, Pro)
- **Sitewide (index.html):** `Organization` + `WebSite` schemas

### Sitemap (`/sitemap.xml`)
8 URLs indexed: `/`, `/pricing`, `/roadmap`, `/guide`, `/register`, `/login`, `/terms`, `/privacy`

### Robots.txt (`/robots.txt`)
Allows public pages, blocks 15+ auth-required routes (`/dashboard`, `/projects/`, `/admin`, `/settings`, `/meetings`, `/timesheets`, `/billing`, etc.)

### Hreflang Tags
`<link rel="alternate" hreflang="en|fr|es|x-default">` in `index.html` for multilingual support.

### Noscript Fallback
Static HTML content inside `<noscript>` for crawlers that don't execute JavaScript. Includes key features list, CTAs, and internal links.

---

## Phase 2: Technical SEO (DONE)

All items implemented and deployed to production.

### Auth Page Noindex
All authenticated pages (behind `PrivateRoute`) automatically get `<meta name="robots" content="noindex, nofollow">`. Resets to `index, follow` when navigating back to public pages.

### DNS Prefetch / Preconnect
- `preconnect` to `fonts.googleapis.com` and `fonts.gstatic.com`
- `dns-prefetch` to `js.stripe.com` and `www.googletagmanager.com`

### Font Loading
Non-render-blocking: `media="print"` with `onload` swap pattern. `<noscript>` fallback for no-JS.

### Organization Structured Data
Sitewide JSON-LD with company name, logo, support email, and website schema.

---

## Phase 3: Search Engine Registration (YOUR ACTION)

### 3.1 Google Search Console
- [ ] Go to https://search.google.com/search-console
- [ ] Add property for `kovarti.com`
- [ ] Verify ownership (recommended: DNS TXT record method via TMD cPanel)
  - Add a TXT record: `google-site-verification=XXXXXXXXX`
- [ ] Submit sitemap: enter `https://kovarti.com/sitemap.xml`
- [ ] Request indexing for the homepage URL
- [ ] Monitor "Coverage" tab for crawl errors over the next few days
- [ ] Check "Core Web Vitals" report once data appears (takes ~28 days)

### 3.2 Bing Webmaster Tools
- [ ] Go to https://www.bing.com/webmasters
- [ ] Add site `kovarti.com`
- [ ] Verify via DNS TXT record or import from Google Search Console
- [ ] Submit sitemap URL

### 3.3 Google Business Profile (optional but recommended)
- [ ] Go to https://business.google.com
- [ ] Create a profile for "Kovarti Project & Business Consulting"
- [ ] Category: "Software Company" or "Business Management Consultant"
- [ ] Add website URL, description, logo, and contact info
- [ ] This helps with branded searches and builds trust signals

### 3.4 Google Analytics Verification
- [ ] Confirm GA4 is collecting data (check Real-Time reports)
- [ ] Set up conversions/events for:
  - Registration completed
  - Pricing page viewed
  - Checkout session started
- [ ] Link GA4 to Google Search Console for search query data

### 3.5 Rich Results Testing
- [ ] Test each public page at https://search.google.com/test/rich-results
- [ ] Verify JSON-LD is valid and recognized
- [ ] Fix any warnings (usually minor schema issues)

---

## Phase 4: Off-Page SEO & Content Marketing (YOUR ACTION)

### 4.1 Backlink Strategy
- [ ] **Product directories:** Submit to Product Hunt, G2, Capterra, GetApp, AlternativeTo, SaaSHub
- [ ] **Startup directories:** BetaList, Launching Next, StartupBase, SideProjectors
- [ ] **PM-specific directories:** PM software comparison sites, PM community forums
- [ ] **GitHub:** If any open-source components, link back to kovarti.com
- [ ] **Guest posts:** Write for PM blogs, Medium, Dev.to about project management topics
- [ ] **HARO / Connectively:** Sign up to respond to journalist queries about PM/AI topics

### 4.2 Content Marketing
- [ ] **Blog section** (future): Consider adding `/blog` with articles on:
  - "What is Earned Value Management?" (targets EVM keywords)
  - "Monte Carlo Simulation for Project Scheduling" (targets simulation keywords)
  - "AI in Project Management: A Practical Guide" (targets AI PM keywords)
  - "Gantt Chart Best Practices for 2027" (targets Gantt keywords)
  - "How to Run Effective Sprint Retrospectives" (targets agile keywords)
- [ ] Each blog post should:
  - Target a specific long-tail keyword
  - Include internal links to relevant product pages
  - Have a CTA to start a free trial
  - Be 1,500–2,500 words for SEO depth

### 4.3 Social Media Presence
- [ ] **LinkedIn company page** — post product updates, PM tips, customer stories
- [ ] **Twitter/X account** — share launches, features, engage with PM community
- [ ] **YouTube** (optional) — product demos, tutorials, webinars
- [ ] Add social profile URLs to the `sameAs` array in `index.html` Organization JSON-LD

### 4.4 Local SEO (if applicable)
- [ ] If targeting Canadian market specifically, register with Canadian business directories
- [ ] Consider `.ca` domain redirect or hreflang for Canadian audience

### 4.5 Email Marketing for SEO
- [ ] Build email list from waitlist + trial signups
- [ ] Send product updates that link back to the website
- [ ] Encourage users to share and link to the roadmap/guide pages

---

## Target Keywords

### Primary Keywords
| Keyword | Target Page | Search Intent |
|---------|-------------|---------------|
| AI project management software | Landing | Transactional |
| project management tool | Landing | Transactional |
| Kovarti PM | Landing | Branded |
| project scheduling software | Landing | Transactional |
| earned value management software | Landing | Transactional |

### Secondary Keywords
| Keyword | Target Page | Search Intent |
|---------|-------------|---------------|
| project management pricing | Pricing | Commercial |
| Monte Carlo project management | Landing | Informational |
| Gantt chart software | Landing | Transactional |
| AI scheduling tool | Landing | Transactional |
| project risk management software | Landing | Transactional |
| free project management trial | Register | Transactional |

### Long-Tail Keywords (for future blog content)
- "how to use Monte Carlo simulation for project scheduling"
- "best AI project management tools for consultants"
- "earned value management explained with examples"
- "project management software for small consulting firms"
- "Gantt chart vs Kanban board which is better"

---

## SEO Monitoring Checklist (Monthly)

- [ ] Check Google Search Console for crawl errors and indexing status
- [ ] Review search queries driving traffic (Search Console > Performance)
- [ ] Monitor Core Web Vitals scores
- [ ] Check keyword rankings for primary keywords (use Ahrefs, SEMrush, or free alternatives)
- [ ] Review and update sitemap if new public pages are added
- [ ] Check for broken links (use Screaming Frog or similar)
- [ ] Review competitor SEO strategies and adjust
- [ ] Update meta descriptions if CTR is low on specific pages

---

## Technical Files Reference

| File | Purpose |
|------|---------|
| `src/client/index.html` | Base HTML with OG tags, JSON-LD, hreflang, preconnect |
| `src/client/src/hooks/useSEO.ts` | React hook for per-page SEO metadata |
| `src/client/public/sitemap.xml` | XML sitemap for search engines |
| `src/client/public/robots.txt` | Crawler directives |
| `src/client/src/App.tsx` | PrivateRoute with noindex meta for auth pages |

---

*Generated August 26, 2026. Phase 1 & 2 implemented by Claude Code. Phase 3 & 4 are manual action items.*
