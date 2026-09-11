# CIF Quick Cash — Collateral Lending & Resale Platform

**A production business-operating system for a licensed asset-backed micro-lending and resale business in Enugwu-Aguleri, Anambra State, Nigeria.**

CIF Quick Cash (Christ-in-Fabian Quick Cash) gives people immediate cash against consumer assets — phones, laptops, TVs, generators, gas cylinders — either as a **cash advance** (the customer redeems the item later) or an **outright purchase** (the business buys and resells it). This repository holds the entire platform that runs the business end-to-end: the public-facing website, the customer self-service portal, the public resale shop, and the internal staff/admin operating system covering KYC, appraisal, disbursement, loan servicing, recovery, inventory, accounting, investor capital management and profit distribution.

It is not a demo or a course project. It is the live system the business trades on, designed from the ground up around the real operating constraints of a cash-based Nigerian storefront: intermittent connectivity, mobile-first staff, a customer base that responds to SMS and WhatsApp rather than email, informal proof of ownership, and metered third-party APIs that cost real money per call.

| | |
|---|---|
| **Live application** | https://cifcash.pages.dev |
| **Business** | Christ-in-Fabian Quick Cash — a joint venture between **Vido Hub** and **FATK Enterprises**; platform developed & managed by Vido Hub |
| **Location** | Current Filling Station, off Tourist Garden Hotel, Enugwu-Aguleri, Anambra East LGA, Anambra State, Nigeria |
| **Build window** | 12 March 2026 → 13 July 2026 |
| **Scale of codebase** | ~25,000 lines of application code · 16 database tables · 50+ API endpoints · 488 commits · 106 merged pull requests |
| **Stack** | React 19 · Vite 6 · React Router 7 · Recharts · Cloudflare Pages Functions · Cloudflare D1 (SQLite) · Cloudflare R2 · Web Push · PWA |

---

## Table of contents

1. [The business](#1-the-business)
2. [Screenshots](#2-screenshots)
3. [The operating model](#3-the-operating-model)
4. [Product surface](#4-product-surface)
5. [The financial engine](#5-the-financial-engine)
6. [Capital, investors and profit distribution](#6-capital-investors-and-profit-distribution)
7. [Staff performance & the points model](#7-staff-performance--the-points-model)
8. [Automation](#8-automation)
9. [KYC, risk and compliance](#9-kyc-risk-and-compliance)
10. [Architecture](#10-architecture)
11. [Data model](#11-data-model)
12. [Security](#12-security)
13. [Running it locally](#13-running-it-locally)
14. [Repository map](#14-repository-map)

> 📄 **[docs/PORTFOLIO.md](docs/PORTFOLIO.md)** — the skills, decisions and business outcomes behind this build, written up as CV and interview evidence.

---

## 1. The business

### What it sells

Two products, both settled in cash across the counter:

| Product | Mechanics | Revenue |
|---|---|---|
| **Cash Advance** | Customer pledges an item and walks out with cash. They have an agreed term (default 30 days) to repay principal plus accrued interest and recover the item. Unredeemed items transfer to the business under the signed agreement and are resold. | Daily interest (default **1 %/day** on outstanding principal) + a one-off service fee (default **₦1,000**) + resale margin on forfeited items |
| **Outright Purchase** | Customer sells the item immediately. No obligation, no return. | Resale margin (minimum markup target **20 %**) |

### How pricing is controlled

Every commercial parameter is configuration, not code — the admin can retune the whole book from the Settings screen without a deploy:

| Lever | Default | What it controls |
|---|---|---|
| `interestRate` | 1 %/day | Daily interest on outstanding principal (band-able by loan size via `interestRateRanges`) |
| `loanCapNoReceipt` / `loanCapWithReceipt` | 40 % / 50 % | Maximum advance as a % of appraised resale value — a **receipt-linked LTV uplift** that both prices ownership risk and incentivises customers to produce proof of purchase |
| `outrightCapNoReceipt` / `outrightCapWithReceipt` | 40 % / 50 % | Same, for outright buys |
| `serviceFee` | ₦1,000 | Origination fee (band-able by loan size) |
| `maxLoanDays` | 30 | Company maximum tenure — the ownership-transfer boundary |
| `graceDays` | 3 | Post-deadline grace before an item becomes sale-eligible |
| `targetSellPct` / `minSellBonus` | 75 % / 20 % | Resale pricing floor and target margin |
| `outrightMinMarkupPct` | 20 % | Minimum acceptable markup on an outright buy |
| `maxPartsOnlyAdvance` | ₦5,000 | Hard cap on non-functional ("parts only") items |
| `capitalLowThreshold` | ₦50,000 | Liquidity alarm threshold |
| `defaultTotalCutPct` / `cutSplit` | 15 % / 50-15-35 | Profit-sharing model (see §6) |

There are **110 configurable settings** in total across six admin tabs — business profile, finance, categories, messaging, integrations and security.

### The ownership timeline

The single most important rule in the business, encoded once and enforced everywhere:

```
dateGiven ──── customer term (loanDays) ────▶ deadlineDate
                                              │
                       company max tenure ────┼──▶ maxLoanDays from dateGiven
                                              │
                    anchor = LATER of the two ▼
     ACTIVE   │  OWNED_BY_BUSINESS  │  GRACE_PERIOD  │  ELIGIBLE_FOR_SALE
   before anchor      on anchor      anchor+1..+grace    anchor+grace+1 →
```

The sale window is gated by **the later of** the customer's (extendable) deadline and the company's maximum tenure day. That subtlety exists because a customer who pays interest gets their deadline pushed out — but a 7-day loan must never become sale-eligible on day 11 when company policy holds items for 30 days. Status is computed in **Africa/Lagos time**, not UTC, so transitions happen at Nigerian midnight rather than 01:00 WAT.

---

## 2. Screenshots

> All screenshots below were captured from the running application against a **synthetic demo dataset**. No real customer names, ID numbers, phone numbers, photographs or transaction values appear anywhere in this repository.

### Public site

| Landing page | Instant valuation |
|---|---|
| ![Public landing page](docs/screenshots/01-public-landing.png) | ![Public item valuation](docs/screenshots/02-public-valuation.png) |
| Plain-language explainer of both products, the step-by-step process, what to bring, and shop location/hours. Written for a walk-in customer, not a fintech user. | A free AI-backed "how much can I get?" estimator, rate-limited per IP per day, that converts browsers into walk-ins. |

| Public resale shop | Customer loan-status portal |
|---|---|
| ![Public shop](docs/screenshots/03-public-shop.png) | ![Customer portal](docs/screenshots/04-public-loan-status.png) |
| Forfeited and purchased inventory listed for public sale, with per-item share links carrying Open Graph previews for WhatsApp. | Self-service balance lookup so customers can check what they owe without calling the shop. |

### Staff & admin portal

| Login | Dashboard |
|---|---|
| ![Staff login](docs/screenshots/05-staff-login.png) | ![Dashboard](docs/screenshots/06-dashboard.png) |
| Role-based sign-in with brute-force lockout. | Live treasury and book position: available lending capital, capital out, gross profit, projected earnings, grace-period and ready-to-sell counts, overdue capital. |

| All transactions | Recovery queue |
|---|---|
| ![All transactions](docs/screenshots/07-all-transactions.png) | ![Recovery queue](docs/screenshots/08-recovery-queue.png) |
| The full loan book with status, type and date filters, sorting and search. | Capital-recovery worklist sorted from most urgent — listed-for-sale and ownership states down to today's follow-ups — with capital-at-risk quantified. |

| Daily follow-ups | For-sale inventory |
|---|---|
| ![Daily follow-ups](docs/screenshots/09-daily-follow-ups.png) | ![For sale inventory](docs/screenshots/10-for-sale-inventory.png) |
| A rules-driven call queue: 1 day before due, on the due date, 3 days before ownership ends, on the last day, and every 2 days while overdue. A loan clears only when a successful contact is logged. | Inventory management for items the business now owns — pricing, listing to the public shop, and days-on-shelf tracking. |

| Monthly / period report | Capital & profit distribution |
|---|---|
| ![Monthly report](docs/screenshots/11-monthly-report.png) | ![Capital and profits](docs/screenshots/12-capital-and-profits.png) |
| P&L over any month or month range: revenue split by interest, sale margin and service fees; expenses; net profit; capital deployed vs. returned; and the four profit pools. CSV and PDF export. | Investor ledger, capital-days share computation, liquidity waterfall ("how this is calculated"), and per-period distribute-or-reinvest decisions. |

| Expenses | Declined log |
|---|---|
| ![Expenses](docs/screenshots/13-expenses.png) | ![Declined log](docs/screenshots/14-declined-log.png) |
| Categorised expense register with date-range filters, attribution to the staff member who recorded it, and search. | Every rejected deal, with reason — a risk-appetite dataset and an audit trail proving declines were principled. |

| Activity log | User management |
|---|---|
| ![Activity log](docs/screenshots/15-activity-log.png) | ![User management](docs/screenshots/16-user-management.png) |
| Immutable audit trail of every state-changing action, filterable by user, category, free text and date. | Accounts, primary role plus additive roles, activation state and credential resets. |

| Settings | Profile |
|---|---|
| ![Settings](docs/screenshots/17-settings.png) | ![Profile](docs/screenshots/18-profile.png) |
| 110 parameters across six tabs, gated behind password re-confirmation. | Per-user contact details, signature capture, financial summary, personal activity and notification centre. |

| New-transaction wizard | Transaction detail |
|---|---|
| ![New transaction wizard](docs/screenshots/19-new-transaction-wizard.png) | ![Transaction detail](docs/screenshots/20-transaction-detail.png) |
| The 11-step counter workflow (see §3). | Full case file: customer, KYC result, item evidence, appraisal, agreement, payment ledger and contact history. |

### Mobile (PWA)

| Landing | Dashboard | Transactions |
|---|---|---|
| ![Mobile landing](docs/screenshots/21-mobile-landing.png) | ![Mobile dashboard](docs/screenshots/22-mobile-dashboard.png) | ![Mobile transactions](docs/screenshots/23-mobile-transactions.png) |

The whole portal is installable as a PWA with an offline service worker and a bottom tab bar — staff run it from a phone at the counter, not a desktop.

---

## 3. The operating model

### The 11-step counter workflow

Every deal is captured through a guarded wizard. Each step has completion criteria; staff cannot skip ahead, and progress auto-saves as a server-side draft so a colleague can pick up a half-finished case or the same staff member can resume after losing signal.

| # | Step | What happens | Gate |
|---|---|---|---|
| 1 | **Type** | Cash advance or outright purchase | Selection required |
| 2 | **ID verify** | NIN or BVN lookup against a government-backed identity API, with returned photo | Verified (or explicitly attempted, per policy setting) |
| 3 | **Customer** | Name, address, two phone numbers, family/neighbour referee | Phone 1 must be **rung in front of the staff member** and marked called; 11-digit validation |
| 4 | **Photos** | Customer holding the item, face and item both visible | Mandatory |
| 5 | **Screening** | Four provenance questions: how long owned, where bought, registered in their name, anyone else using it — plus a red-flag switch | Red flag ends the deal quietly, logged as declined |
| 6 | **Capture** | Item-type-specific photo checklist (7 slots for a smartphone, 7 for a laptop, 6 for a generator, …), IMEI/serial capture, receipt capture | All required slots filled; powers-on gate |
| 7 | **Inspection** | Item-type-specific functional checklist (12 checklists across item classes) | Checklist completed |
| 8 | **AI valuation** | Three-run appraisal pipeline (below) | Item type, brand, model and a value must be present |
| 8b | **Items** | Multi-item basket — repeat 4–8 for each additional item on one loan | — |
| 9 | **Offer** | Cash offer computed from appraised value × LTV cap, checked against available lending capital | Offer > 0 and date set |
| 10 | **Agreement** | Generates a folded-A4 booklet agreement/receipt (jsPDF + html2canvas), captures the signing photo, sealed-package confirmation and customer signature | Signed, terms confirmed, package sealed |
| 11 | **Complete** | Transaction written, storage tag printed, confirmation SMS fired, staff points awarded | — |

### The AI appraisal pipeline

Pricing a second-hand asset accurately is the core margin decision in this business. It runs as three auditable passes rather than one opaque call:

1. **Identification & spec verification** — Gemini vision over the captured photo set extracts type, brand, model, colour and key specs; Google Lens (via SerpApi) reverse-image search corroborates the model; a verification pass marks the model `YES` / `CORRECTED` / unverified. Confidence is surfaced as a percentage on screen.
2. **Condition description** — a structured narrative of wear, damage and functional state, derived from the photos and the inspection checklist.
3. **Resale valuation** — a two-stage sequential workflow producing a new-market reference price, a resale estimate, a low–high range, a price basis and a valuation confidence.

Every field stays **editable by the staff member**; the AI advises, the human decides. Raw model responses are stored per run for audit. If any call fails or times out, the wizard drops into manual mode rather than blocking the counter.

Because these APIs are metered, the app tracks usage against free-tier limits (Gemini requests/day and /minute, SerpApi searches/month, identity-verification credits), shows live consumption in the wizard header, blocks calls that would exceed the plan, and caches every successful NIN/BVN lookup so the same identity is never paid for twice.

---

## 4. Product surface

### Public (no login)

- **Landing page** — the two products, a six-step "how it works", what to bring, address, hours, WhatsApp deep-link, directions, and a discreet staff-login link. SEO and Open Graph metadata tuned for `en_NG`.
- **Instant valuation** (`/get-estimate`) — a free AI estimate, IP rate-limited (default 3/day) with a server-side counter table, used as a lead-generation funnel.
- **Public shop** (`/shop`, `/shop/:id`) — forfeited and purchased inventory. Individual item pages are served by a dedicated Pages Function that injects per-item Open Graph tags into the SPA shell, so a WhatsApp share renders the item photo, title and price instead of a generic card. Optional sold-history display and automated periodic price drops.
- **Customer portal** (`/check-loan-status`) — self-service balance and status lookup.

### Internal (role-gated)

Fifteen modules, each visible only to the roles that need it:

| Module | staff | admin | stakeholder |
|---|:-:|:-:|:-:|
| Dashboard | ✓ | ✓ | ✓ |
| New transaction | ✓ | ✓ | |
| All transactions | ✓ | ✓ | ✓ |
| Recovery queue | ✓ | ✓ | |
| Daily follow-ups | ✓ | ✓ | |
| For sale | ✓ | ✓ | ✓ |
| Monthly report | | ✓ | ✓ |
| Capital & profits | | ✓ | ✓ |
| Expenses | ✓ | ✓ | ✓ |
| Declined log | ✓ | ✓ | |
| Activity log | ✓ | ✓ | ✓ |
| Settings | | ✓ | |
| Users | | ✓ | |
| Profile | ✓ | ✓ | ✓ |

Roles are **additive** — a user carries one primary role plus a list of extra roles, so the COO can be `staff` *and* `stakeholder` and see both operational queues and their own investor position.

### Printed artefacts

Cash businesses run on paper. The app generates three:

- **Cash Advance Agreement / Outright Purchase Receipt** — a folded-A4 booklet in two copies (business and customer), laid out as four panels printed front-and-back: cover and signature panel, customer and item particulars, item photographs and clauses 1–2, clauses 3–6. Produced with jsPDF + html2canvas so it is a real PDF rather than a browser print dialog.
- **Storage tag** — an A5 tag attached to the sealed item in the store, carrying reference, customer, item, dates, status and amount.
- **Period report** — a print/PDF rendering of the monthly or multi-month P&L.

---

## 5. The financial engine

This is where most of the engineering depth sits. The rules below are implemented once, server-side, and every screen that shows a number derives it from the same functions.

### Interest accrual with checkpointing

Interest is charged daily on the **principal actually outstanding on each day**. When a payment reduces principal, the system does not retroactively rewrite history: it *checkpoints* the accrual. Interest accrued up to the payment (at the old principal) is folded into `carriedInterestOwed`, and the accrual anchor resets to the payment date, so only days after the checkpoint are charged at the new, lower principal.

### Partial payments and rollover

Which bucket a partial payment hits depends on **when in the term it lands**:

| Timing | Allocation | Effect |
|---|---|---|
| Day 1 … `loanDays - 1` ("on time") | **Principal first**, leftover to interest | Reduces tomorrow's daily interest; deadline untouched (term hasn't elapsed) |
| Day `loanDays` onward ("due/overdue") | **Interest first**, leftover to principal | If interest clears fully, the loan **rolls over**: a fresh cycle starts today and the deadline extends by a full term |

A payment that covers everything owed is a full payoff, not a partial. `dateGiven` never changes — it stays the true origination date for reporting — while `cycleStart` anchors the current term.

### Multi-item loans as one shared balance

A customer can pledge several items on a single loan. Early versions modelled this as one ledger per item, which produced lossy per-item state and displayed one combined payment as several rows. The current model treats a multi-item loan as **one shared balance**:

- A combined payment sweeps **interest across the whole basket before touching any principal**.
- Consolidated loans are rebuilt by **replaying the payment ledger**, not by summing lossy per-item state.
- Legacy per-item fragments written in the same instant are regrouped into the single payment the customer actually made, non-destructively and with identical totals.
- Admins can force-consolidate a loan stuck in the old shape.

### Revenue recognition

Revenue is recognised as **interest actually collected** (`interestApplied` on ledger entries), **sale margin** (`salePrice − cashAdvance`, never the gross sale price), and **service fees** on new loans. Principal returning is capital flow, not revenue — so the monthly report separates "capital deployed" and "capital returned" from the P&L entirely.

### Liquidity

Available lending capital is computed as a transparent waterfall, shown to the admin line by line:

```
  total capital invested (contributions − withdrawals)
+ all-time profit (interest + sale margins + service fees − expenses)
− money out on active loans
− capital tied up in for-sale inventory
− profit already distributed to stakeholders
= available for lending
```

Falling below `capitalLowThreshold` raises a dashboard alarm; going negative raises a deficit alarm and drives the contribution plan in §6.

### Capital forecasting

A prediction engine models the capital position forward: linear regression over recent monthly history, a configurable trend weight, a seasonality index, forecast horizon in months, lead time in days for funds to arrive, a surplus-streak requirement before recommending withdrawals, and a peak grace factor. It answers the two questions an owner actually asks — *will I run out of lending money, and when?* and *am I sitting on idle cash I should return to investors?*

---

## 6. Capital, investors and profit distribution

The business runs on pooled investor capital, so profit has to be split fairly between people who put money in at different times and in different amounts.

### Capital-days

A stakeholder's share of a period's profit is proportional to their **capital-days** — every contribution (or withdrawal, signed negative) weighted by the number of days it was actually deployed inside that period. Putting ₦500,000 in on the 28th does not earn the same as ₦500,000 that sat there all month.

```
capital_days(stakeholder) = Σ  signed_amount × days_active_within_period
share                     = capital_days / Σ all capital_days
```

Both the numerator and the denominator are stored on every decision row as an audit trail.

### The four-pool split

Gross profit allocated to a stakeholder has a configurable **total cut** taken off it (default 15 %, settable to 0 % to exempt a stakeholder entirely). Those cuts aggregate into one pool, then split globally:

| Pool | Default | Distributed by |
|---|---|---|
| **Staff pool** | 50 % | Staff points earned in the period (see §7) |
| **Possessor pool** | 15 % | Per-transaction possessor, by item revenue |
| **Platform / license fee** | 35 % | Folded into the platform recipient's stakeholder line |
| **Stakeholder net** | remainder | Back to the stakeholder |

### Distribute-or-reinvest, with a deadline

At the start of each month the system auto-generates a decision row per stakeholder for the previous period: their profit amount, their capital-days, the maximum they can reinvest (driven by the current capital shortfall and their target/max ownership percentages), and the balance they can take. Each stakeholder is notified by SMS and has a configurable window (default 3 days) to choose. If they don't respond, the system **auto-resolves** and writes a plain-English `system_note` explaining what it decided and why. Payouts are recorded against the specific decision IDs they settle, so the money trail reconciles.

### Ownership targeting

Each stakeholder carries a `targetPercent` and a `maxPercent`. When the business is short of capital, expected contributions are computed to move everyone toward their target without breaching their cap, and the shortfall is allocated proportionally to allowed need. When there's a sustained surplus, the system recommends withdrawals instead. Either way stakeholders can be alerted automatically by SMS.

---

## 7. Staff performance & the points model

Paying a flat bonus rewards presence, not contribution — and in a shop where one person takes the customer in and another finishes the deal two hours later, "who did this loan?" has no single answer. So credit is fractional and per-step.

Each lifecycle step carries a weight; whoever performs it claims that fraction, once (enforced by a unique constraint on user + entity + step, so re-saving a draft never double-credits):

| Step | Weight | | Task | Weight |
|---|---|---|---|---|
| Cash disbursement | 0.27 | | Expense entry | 0.05 |
| Repayment collection | 0.20 | | Customer follow-up log | 0.02 |
| ID verification | 0.15 | | Inventory update | 0.02 |
| Item photo | 0.10 | | SMS send | 0.01 |
| Item appraisal | 0.10 | | Agreement reprint | 0.01 |
| Customer intake | 0.08 | | | |
| Agreement print | 0.05 | | | |
| Default handling / listing | 0.03 | | | |
| Sale completion | 0.02 | | | |

Admin-only governance actions deliberately carry zero weight. The whole map is overridable in settings. Points drive the staff-performance view (against a configurable monthly target) and the split of the staff profit pool — so operational effort translates directly into pay, and a handoff splits credit honestly between both people.

---

## 8. Automation

### SMS lifecycle (Termii)

Fourteen distinct triggers cover the customer journey end to end, each with its own editable template, its own on/off switch and its own schedule:

- **Origination** — cash advance confirmation; outright purchase confirmation
- **Servicing** — due-date reminders (default 2, 1 and 0 days before); mid-loan balance reminder at the term midpoint; partial-payment receipt
- **Delinquency** — overdue reminders (default 1, 3 and 5 days past due) carrying the live balance-if-repaid-today; ownership-transfer warnings (3 days and last day)
- **Resolution** — redemption/full-repayment confirmation; ownership-transferred notice; item-listed-for-sale notice; sale receipt to the buyer
- **Governance** — monthly profit decision notice; capital deficit, capital low, transaction shortfall and withdrawal-recommendation alerts to stakeholders

Operational details that matter in Nigeria: **NCC quiet hours are enforced** — auto-send refuses to run between 20:00 and 08:00 Africa/Lagos, because operators block delivery in that window. Delivery receipts arrive on a Termii webhook and are normalised into standard statuses (`DeliveredToTerminal`, `Expired`, `DND`, `Undeliverable`, …) with substring-ordering care so `undeliverable` never matches as `delivered`. Failed sends retry after a configurable number of days. Credit balance is polled, shown in the UI, and raises a low-credit prompt with bank details for recharge.

### Scheduled delivery

The browser triggers auto-send once per session — which fails silently on a day nobody opens the app. A companion Cloudflare Worker (`cron-worker.js`) fires `POST /api/sms/auto-send` daily at 08:00 UTC (09:00 WAT) authenticated by a shared `X-Cron-Secret`, so reminders go out whether or not staff log in.

### Web Push

Push notifications are implemented from first principles against the raw Web Push specs — VAPID JWTs signed with ECDSA P-256 (RFC 7519) and payloads encrypted with ECDH + HKDF + AES-128-GCM (RFC 8291) — inside the Workers runtime, with no `web-push` dependency. Raw 32-byte private keys are auto-detected and wrapped in PKCS#8 DER so keys from any generator work. Expired subscriptions are pruned silently, and push failure can never fail the primary request.

### Other automation

- **Auto-generation** of monthly distribution decisions, and auto-resolution of decisions left undecided past deadline
- **Automated periodic price drops** on shop listings at a configurable interval
- **Self-healing schema** — the API detects and applies missing columns/tables at runtime, and every query has graceful fallbacks for un-migrated databases, so a deploy never blanks the dashboard
- **Activity-log retention** pruning at a configurable horizon

---

## 9. KYC, risk and compliance

**Identity.** NIN or BVN verified against a government-backed API returning the registered photograph, with a caching layer keyed on ID type + number so repeat verifications are free. Verification can be made strictly mandatory or advisory per policy. The landing page teaches customers to dial `*346#` to retrieve their NIN, removing the commonest cause of a failed intake.

**Provenance screening.** Four structured questions — ownership duration, purchase location, registration in the customer's name, shared use by anyone else — each with contextual guidance for the staff member explaining *why* the answer matters (short ownership plus inconsistent answers suggests stolen goods; SIM and IMEI should match the person presenting; a device a boss or partner also uses needs their permission to pledge).

**Red-flag handling.** A single switch ends the transaction **quietly** — no explanation to the customer, no confrontation at the counter — and writes a declined-log entry with the reason. There are one-click decline reasons at three separate wizard steps ("inconsistent answers", "suspicious origin", "flagged by staff", "refused photos or terms"), so a staff member under pressure always has a safe exit.

**Evidence.** Every deal is documented with a customer-holding-item photo showing both face and item, an item-type-specific photo checklist, IMEI/serial capture with OCR confidence and manual confirmation, a signing photograph, a sealed-package photograph, and a refined customer signature (grayscale → adaptive threshold → ink recolour → bounding-box crop → transparent PNG).

**Audit.** Every state-changing action is written to an immutable activity log with actor, role, entity and a human-readable description. The declined log is a deliberate risk-appetite dataset, not a bin.

**Financial controls.** Settings changes require password re-confirmation. Capital entries carry a method and receipt reference. Profit payouts are linked to the specific decisions they settle. Ad-hoc distributions are disabled by default.

---

## 10. Architecture

```
┌──────────────────────────── Cloudflare Pages ────────────────────────────┐
│                                                                          │
│  React 19 SPA (Vite 6)                     Pages Functions (Workers)     │
│  ├─ public site / shop / portal            ├─ /api/[[route]].mjs         │
│  ├─ staff & admin portal                   │   50+ endpoints, session    │
│  ├─ PWA + service worker (offline)         │   auth, RBAC, business      │
│  ├─ local cache layer (instant boot)       │   rules, integrations       │
│  └─ jsPDF / html2canvas print artefacts    └─ /shop/[id].js  (OG tags)   │
│                                                                          │
└──────────┬──────────────────────┬──────────────────────┬─────────────────┘
           │                      │                      │
     ┌─────▼─────┐        ┌───────▼──────┐      ┌────────▼────────┐
     │   D1      │        │      R2      │      │  External APIs  │
     │ (SQLite)  │        │   (photos)   │      │  Gemini · SerpApi│
     │ 16 tables │        │              │      │  NIN/BVN · Termii│
     └───────────┘        └──────────────┘      └─────────────────┘
                                                          ▲
                                          ┌───────────────┴──────────────┐
                                          │ cifcash-cron Worker          │
                                          │ daily 08:00 UTC → auto-send  │
                                          └──────────────────────────────┘
```

**Why this shape.** The whole platform runs on Cloudflare's free and near-free tiers — Pages, D1, R2, Workers — which for a storefront business in Anambra is the difference between a viable operating cost and none at all. There is no server to patch, no container to keep alive, and edge deployment means the app is fast on a Nigerian mobile connection.

**Performance decisions that came from the shop floor:**

- **Tiered bootstrap** — `critical` (settings + summary counts), `transactions` (paginated book), `secondary` (expenses, capital, users, declines) load independently so the dashboard paints before the heavy queries finish.
- **Local cache priming** — state initialises from `localStorage` and is revalidated in the background, so a staff member reopening the PWA sees their book instantly rather than a spinner.
- **Graceful degradation everywhere** — a failed drafts query returns an empty drafts list instead of blanking the dashboard; a missing table is caught and treated as empty; push and SMS failures never fail the request that triggered them.
- **Image compression client-side** before upload (max 1400 px, quality 0.82) because staff are uploading over mobile data.
- **Environment separation** — the `main` branch deploys to the production D1 database; every other branch deploys to a preview database, so no test transaction can ever touch the live book.

---

## 11. Data model

| Table | Purpose |
|---|---|
| `users` | Accounts, primary + additive roles, activation, contact details, stored signature |
| `transactions` | The loan/purchase book — JSON document per deal plus indexed status and timestamps |
| `drafts` | Server-side wizard state, so a half-finished deal survives a lost connection or a shift change |
| `settings` | The 110-key configuration document |
| `expenses` | Categorised operating expenses attributed to the staff member who recorded them |
| `capital` | Investor contributions and withdrawals, signed by type, with method and receipt |
| `profit_distributions` | Payouts, linked to the decision IDs they settle |
| `distribution_decisions` | Per-stakeholder, per-period profit decisions: amount, capital-days, denominator, reinvest/distribute split, decision, deadline, auto-resolution flag and system note |
| `declined_log` | Every rejected deal with reason |
| `activity_logs` | Immutable audit trail |
| `staff_points` | Fractional per-step work credit, uniquely constrained against double-crediting |
| `sms_logs` | One row per outgoing message with provider response, message ID and delivery receipt |
| `nin_bvn_cache` | Paid identity-verification results, uniquely keyed to avoid paying twice |
| `login_attempts` | Brute-force tracking |
| `public_valuation_requests` | Per-IP rate limiting for the free public estimator |
| `push_subscriptions` | Web Push endpoints and keys per device |

Transactions are stored as JSON documents with indexed status and timestamps — the deal shape evolved constantly (multi-item baskets, payment ledgers, sale metadata, AI audit fields) and a document column absorbed that without a migration per change, while the indexed columns kept list queries fast.

---

## 12. Security

- **Sessions** — HttpOnly, Secure, SameSite=Lax cookies; separate short and long (remember-me) cookies with mutual invalidation; configurable timeout (default 8 h)
- **Passwords** — PBKDF2-SHA256 at 100,000 iterations (the Workers Web Crypto ceiling), with transparent rehash-on-login upgrade for legacy hashes
- **Brute force** — failed attempts tracked per username with a configurable threshold (default 5) and cooldown (default 15 min), cleared on success
- **Authorisation** — role checks server-side on every endpoint, not just in the UI; disabled accounts are ejected on the next page load rather than waiting for cookie expiry
- **Sensitive operations** — settings writes require password re-confirmation
- **Secrets** — no API key, token or credential is committed. Provider keys live in the settings document or Cloudflare Pages Secrets (`VAPID_PRIVATE_KEY`, `CRON_SECRET`); only the VAPID **public** key is in source, where it belongs
- **Input handling** — parameterised SQL throughout; HTML escaping in every server-rendered fragment; strict phone and ID format validation
- **Cron authentication** — the scheduled auto-send endpoint accepts a shared secret header as an alternative to session auth, and refuses to run if the secret is unset

---

## 13. Running it locally

```bash
npm install

# Frontend only (public pages; API calls will fail)
npm run dev

# Full stack against a local D1 + R2 (recommended)
npm run build
npx wrangler pages dev dist \
  --d1 DB=cifcash-local-db \
  --r2 PHOTOS \
  --persist-to .wrangler-local

# Apply the schema to the local database
npx wrangler d1 execute cifcash-local-db --local --file=schema.sql
```

The default seeded administrator is `cifadmin` / `CifAdmin@1` — **change it immediately** on any real deployment.

Deployment is automatic: `main` → production D1 (`cifcash-prod-db`), any other branch → preview D1. The companion cron Worker is deployed separately:

```bash
npx wrangler deploy cron-worker.js --name cifcash-cron --compatibility-date 2024-09-23
# then add the cron trigger: 0 8 * * *
```

---

## 14. Repository map

```
├── src/
│   ├── App.jsx                  Application: routing, all pages, wizard, financial engine
│   ├── PrintAgreement.jsx       Folded-A4 agreement & receipt PDF generation
│   ├── PrintMonthReport.jsx     Period report PDF
│   ├── PrintStorageTag.jsx      A5 item storage tag
│   ├── ProfilePage/             Profile modules: activity, financial summary, staff
│   │                            performance, signature capture, notifications, contact
│   ├── utils/signatureRefine.js Client-side signature cleanup (threshold → crop → PNG)
│   ├── sw.js                    Service worker (offline + push handling)
│   └── theme.js
├── functions/
│   ├── api/[[route]].mjs        The entire backend: 50+ endpoints, auth, RBAC, loan
│   │                            engine, SMS, push, distributions, integrations
│   └── shop/[id].js             Per-item Open Graph injection for share previews
├── docs/screenshots/            Screenshots (synthetic demo data)
├── schema.sql                   Database schema
├── migrate-*.sql                Incremental migrations for live databases
├── cron-worker.js               Scheduled daily SMS auto-send Worker
├── setup-dev-db.sh              Production → dev database cloning utility
└── wrangler.toml                Pages + D1 + R2 bindings, per-environment
```

---

## Credits

Built and operated by **[C-D4V1D](https://github.com/C-D4V1D)** for Christ-in-Fabian Quick Cash — a joint venture between Vido Hub and FATK Enterprises. The business requirements, operating model, financial rules, risk policy and product design are original work; implementation was carried out with AI pair-programming assistance (Claude Code and GitHub Copilot), reviewed and integrated across 106 pull requests.
