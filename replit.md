# Workspace

## Overview

This pnpm monorepo, built with TypeScript, serves as a platform for contractor web applications under **estimators.io**. It features a shared Express API and a PostgreSQL database using Drizzle ORM. The platform provides specialized tools like AI-powered compliance scanning (EyeSpyR™) and immutable record storage (Truth-Vault™) to streamline operations for trade contractors. The long-term vision is to create a comprehensive ecosystem for contractor services, logistics, and consumer delivery, with applications such as PlowWow, Backhaul.io, and Errands.io.

Key capabilities include trade-specific web applications, centralized API and database, AI-driven compliance scanning, immutable record keeping for audits, integrated billing, payment processing, and PDF generation.

## User Preferences

I prefer iterative development with clear communication on major changes. I appreciate detailed explanations of complex technical decisions but prefer concise summaries for routine updates. I want to be consulted before any significant architectural modifications or the introduction of new external dependencies.

## System Architecture

The project is structured as a pnpm monorepo, separating deployable applications (`artifacts/`) from shared libraries (`lib/`).

**Core Technologies:**
- **Monorepo Management**: pnpm workspaces
- **Backend**: Node.js, Express, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Frontend**: React, Vite, Tailwind CSS
- **Validation**: Zod
- **API Definition**: OpenAPI specification, generating React Query hooks and Zod schemas via `orval`.
- **Build System**: esbuild, `tsc`.

**UI/UX and Design Patterns:**
- Dark-themed UIs with trade-specific accent colors.
- Consistent sidebar navigation.
- Mobile-first camera capture components (EyeSpyR).
- User-specific presets stored in `localStorage`.
- Use of specific fonts like Bebas Neue, IBM Plex Mono, Barlow Condensed, Nunito, JetBrains Mono, DM Sans.

**Key Features and Implementations:**
- **EyeSpyR™ AI Compliance Scanning**: Integrates with Roboflow for trade-specific image analysis and document intelligence.
- **Jurisdiction Switcher Engine**: Configures and applies compliance rules for multiple regions (e.g., CA-BC, US-WA, UK-ENG).
- **KYC Compliance Document System**: Manages document upload, verification, OCR data extraction, and expiry monitoring.
- **Truth-Vault™ Immutable Records**: Stores immutable PostgreSQL records with a 7-year retention policy and PDF certificate generation.
- **Milestone-Based Billing**: A 4-milestone payment system integrated across contractor apps, often linked to EyeSpyR™ compliance checks.
- **PDF Generation**: Utilizes `pdfkit` and `qrcode` for verifiable PDF certificates.
- **Internationalization/Localization**: Fully globalized region system with 12 regions, each defining currency, taxes, building codes, pricing, rates, and compliance standards.
- **Fabricators.io**: Steel/metal fabrication app with trade-specific calculators (WeldCalc, CutList).
- **Drywallers.io Estimator**: Full contractor-grade multi-room project estimator. Features: multi-room project management with 13 room presets (bedroom, bathroom, kitchen, basement, garage, firewall, soundwall, etc.), per-room board type/finish level/dimensions, crew scheduling with production rate calcs, material procurement summary, profit margin analysis, building code compliance checks (wet area, fire-rated, sound-rated, multi-family), regional tax computation, and direct pipeline/invoice integration. Room data flows to Takeoff sheet for per-room material breakdown.
- **Trade-Specific Weather Pages**: All contractor apps include Weather pages with real-time Open-Meteo API data and trade-specific safety advisories.
- **God's View GPS Demo Mode**: Simulated GPS tracking for fleet management (Plow, Backhaul, Errands).
- **Backhaul.io (Fleet Load Matching)**: 3-column UI with asset tracking, load board, route preview, and payload auditing.
- **Errands.io (Consumer Delivery)**: Supports various errand types, customer info, pickup/dropoff, pricing, and tracking.
- **Supplier Orders (Hardscapes.io)**: Multi-region supplier integration with branch routing and order submission, supporting Slegg, Jewson, SiteOne, Boral.
- **Van Stock Audit System (HVACR)**: Manages parts, audit logs, and inventory for van stock.
- **Permit Spy (HVACR)**: AI-driven permit text analysis for data extraction and inspection identification.
- **Safety Credits Engine**: Reputation system with credit awards and rank tiers.
- **Snap & Post Engine**: Automates content creation from WhatsApp photos using AI, generating SEO-optimized blog posts, city pages, and dynamic XML sitemaps. Includes a Control Tower dashboard for monitoring.
- **Monthly EyeSpyR Performance Report**: Full-page report with performance metrics, including content activity, contractor pipeline, and trade/regional breakdowns, with PDF export functionality.
- **Public City Pages**: SEO landing pages with city-specific content, contractor listings, and recent posts.
- **Analytics Dashboard Upgrade**: Rebuilt analytics page pulling data from performance reports, showing content trends, contractor and city page metrics.
- **SEO Scorecard**: Dashboard for content quality grades and indexing health, with per-city breakdowns of scoring dimensions.
- **Content Feed**: Real-time stream of all Snap & Post content across the network with rich post cards and filtering options.
- **Network Directory**: Public directory of contractors with search, filter, and profile links.
- **Contractor Profile Pages**: Detailed profile pages for contractors showing stats, activity, and city coverage.
- **Roofers.io**: Full roofing contractor app at `artifacts/roofers-io/`. Red accent (`#ef4444`). Trade-specific features: Roof Inspection Report (12-area weighted scoring with Good/Fair/Poor/Critical/N/A ratings, overall grade A-F, repair recommendations), roofing estimator with presets (shingle tear-off, metal roof, TPO membrane, flashing, gutters, skylights, ice shield, soffit/fascia, chimney flashing, inspections), weather page with rooftop work safety advisories, crew management with roofing certifications, scheduling with roofing job types. All GasFitters branding replaced with Roofers.io identity.
- **Roofers.io Hub & Spoke SEO Site** at `artifacts/demo-calc/`. Features Page at `/features` with all 9 tools (Calculator, Stud Mapper, Jobs Pipeline, Invoice, Booking, Weather Brain, Nano Banana 2, EyeSpyR™, Site View), competitor comparison vs Jobber/ServiceTitan/Buildertrend, feature-by-feature table, EyeSpyR™ section with vault mock, Weather Brain section with 4 forecast states, Nano Banana 2 stats (+34% close rate), product brands (GAF/OC/CertainTeed/IKO/Atlas/Malarkey), scrolling competitor ticker, $10/mo territory lock model, and CTA. Homepage blurb promotes roofers.io as "the roofer's best management system" with live estimate preview mock and links to /features. 356 total city pages across 59 regions: **18 Lower Mainland served cities** (Metro Vancouver 7, North Shore 2, Tri-Cities 3, Fraser Valley 6) with contractor CTAs (Vee/ACC Construction), **11 Vancouver Island catch pages**, **18 Alberta catch pages**, **18 Ontario catch pages**, **10 Quebec catch pages**, **3 Manitoba catch pages**, **4 Saskatchewan catch pages**, **8 Atlantic Canada catch pages**, **16 Washington State catch pages**, **10 Oregon catch pages**, **12 California catch pages**, **9 Texas catch pages**, **8 Florida catch pages**, **5 Arizona catch pages**, **5 Colorado catch pages**, **6 Georgia catch pages**, **6 North Carolina catch pages**, **5 Tennessee catch pages**, **4 Nevada catch pages**, **5 Illinois catch pages**, **6 Ohio catch pages** (Columbus, Cleveland, Cincinnati, Akron, Toledo, Dayton), **5 Michigan catch pages** (Detroit, Grand Rapids, Ann Arbor, Lansing, Sterling Heights), **5 Virginia catch pages** (Virginia Beach, Richmond, Norfolk, Chesapeake, Arlington), **4 Minnesota catch pages** (Minneapolis, St. Paul, Rochester, Bloomington), **5 Indiana catch pages** (Indianapolis, Fort Wayne, Evansville, South Bend, Carmel), **4 Missouri catch pages** (Kansas City, St. Louis, Springfield, Columbia), **4 Maryland catch pages** (Baltimore, Rockville, Frederick, Annapolis). Plus **3 Pennsylvania** (Philadelphia, Pittsburgh, Allentown), **3 New Jersey** (Newark, Jersey City, Paterson), **3 Connecticut** (Bridgeport, New Haven, Stamford), **3 Massachusetts** (Boston, Worcester, Springfield-MA), **3 South Carolina** (Charleston-SC, Columbia-SC, Greenville-SC), **3 Alabama** (Birmingham, Huntsville, Mobile), **2 Louisiana** (New Orleans, Baton Rouge), **2 Wisconsin** (Milwaukee, Madison-WI), **2 Kentucky** (Louisville, Lexington), **2 Oklahoma** (Oklahoma City, Tulsa), **2 Iowa** (Des Moines, Cedar Rapids), **2 Utah** (Salt Lake City, Provo), plus additional WA/CA/FL cities (Stockton, Modesto, San Bernardino, Cape Coral). Disambiguated slugs: `arlington-tx`, `arlington-va`, `aurora-co`, `aurora-il`, `columbus-oh`, `roswell-ga`, `wilmington-nc`, `henderson-nv`, `rochester-mn`, `kansas-city-mo`, `springfield-mo`, `springfield-ma`, `columbia-mo`, `columbia-sc`, `charleston-sc`, `madison-wi`, `bloomington-mn`, `saint-paul`, `richmond-va`. All 258 cities have deepContent, climate, mapEmbed, FAQs, blog tidbits, local services, neighborhoods, and whyChoose. Events page covers 39 regions with 156 events. US states: WA/OR/CA/TX/FL/AZ/CO/GA/NC/TN/NV/IL/OH/MI/VA/MN/IN/MO/MD/PA/NJ/CT/MA/SC/AL/LA/WI/KY/OK/IA/UT. Sitemap at `public/sitemap.xml` with all 267 city URLs.
- **Estimators.io SaaS Landing Site**: Marketing/hub website for the entire platform at `artifacts/estimators-io/`. Sections: Hero (platform stats), Trade Apps (9 trade cards with accent colors and feature lists), System Management (12 business modules — pipeline, EyeSpyR, Truth-Vault, crew mgmt, jurisdiction, analytics, invoicing, booking, KYC, safety credits, fleet, directory), Features (IAMai, Snap & Post, audit trail, compliance, weather, calculators, field UI, shared platform), Marketing (8 marketing tools + IAM CTA linking to IndustryArmyMarketing.com/pricing), Footer. Dark theme, gradient text, glass-card design.
- **Unified Single-Site Architecture**: All 11 frontend apps are served as pages of one website by the API server (`artifacts/api-server/src/app.ts`). The API server is the sole registered artifact (kind: api, previewPath: "/"). It serves all built frontend static files in both dev and production via `express.static`. Root `/` redirects to `/estimators-io/`. Each trade app is accessible at `/<app-name>/` (e.g., `/gasfitters-io/`, `/plumbers-ltd/`). SPA deep routes are handled via fallback to index.html. Path resolution uses `REPL_HOME` env var with fallback to `/home/runner/workspace`. Individual trade app artifact registrations were removed to prevent proxy routing conflicts. All Vite configs use fallback defaults for `PORT` and `BASE_PATH` so they build without manual env vars. The build process (`artifacts/api-server/build.ts`) builds all 10 frontends then bundles the API server.
- **IAMai Chatbot**: AI-powered chat assistant deployed to all 9 apps. Reads from 7 database sources: contractors, snap_posts, city_pages, truth_vault_records (EyeSpyR scans), safety_profiles (reputation), bookings, compliance_docs (verified only). Features: trade-aware persona switching per app, geo-targeted contractor references, multi-trade cross-selling, EyeSpyR compliance verification references, safety credit leaderboard awareness, booking activity context. Security: 60s context cache, IP-based rate limiting (15 req/min), strict input validation (500 char limit, 10 msg max, role whitelist, trade key validation). API: `POST /api/iamai/chat`, `GET /api/iamai/context`. Widget: `src/components/IAMaiChat.tsx` (all apps). Each app passes its trade name and accent color. Drywallers.io uses Dashboard.tsx integration. Powered by OpenAI via Replit AI Integrations (gpt-4o-mini).

## External Dependencies

- **Database**: PostgreSQL
- **Email Service**: Resend
- **Vision AI**: Roboflow Serverless API
- **Payment Processing**: PayPal, QuickBooks Bridge
- **PDF Generation**: `pdfkit`, `qrcode`
- **AI Integration**: OpenAI via Replit AI Integrations