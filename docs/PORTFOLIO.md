# CIF Quick Cash — Portfolio & CV Evidence Pack

A guide to presenting this project on a CV, cover letter or LinkedIn profile, and to answering the follow-up questions an interviewer will ask.

**Read this first.** The bullets below are split into two kinds:

- ✅ **Verified from this repository** — every figure is countable from the code, commit history, schema or configuration. Use these as written. If challenged, you can open the repo and point at the evidence.
- 🔢 **Needs your real business number** — the achievement is real, but only you have the figure. Each one tells you exactly where in the app to find it. **Do not ship a CV with a placeholder in it**, and do not invent a number. If you genuinely don't have it, use the fallback phrasing given, which claims scale without claiming false precision.

The honest-math rule applies throughout: use `~` for estimates, give percentages a baseline, never claim sole credit for a team outcome, and remember that a recruiter will probe every number at interview.

---

## 1. The headline block

This is the anchor entry. Everything else hangs off it.

> **Founder & Operations Lead — Christ-in-Fabian Quick Cash** (Enugwu-Aguleri, Anambra, Nigeria) · Mar 2026 – Present
>
> Founded and operate a collateral-backed micro-lending and asset-resale business, and designed and delivered the end-to-end platform it runs on — covering KYC, credit decisioning, loan servicing, arrears recovery, inventory, accounting, investor capital management and profit distribution. Sole business analyst, product owner and delivery lead across a 4-month build of a ~25,000-line production system now used daily by counter staff.

Shorter variant for a one-page CV:

> **Founder & Operations Lead — Christ-in-Fabian Quick Cash** · Mar 2026 – Present
> Built and run an asset-backed lending and resale business end to end: designed the operating model, credit and risk policy, financial rules and investor profit-sharing model, then specified and delivered the production system that automates all of it.

### Job titles this legitimately supports

Pick the one that matches the advert and lead with it — the underlying evidence is the same:

Business Analyst · Systems Analyst · Product Manager / Product Owner · Operations Analyst · Financial Analyst · Process Improvement Analyst · Data Analyst · Risk & Compliance Analyst · KYC/AML Analyst · Credit Analyst · Pricing Analyst · Management Information (MI) / Reporting Analyst · Project & Delivery Manager · Treasury / Capital Analyst

---

## 2. Business Analyst

✅ **Verified**

- Elicited and specified the complete requirement set for a lending platform spanning 15 functional modules, 50+ API endpoints and 16 data entities, delivering the full system in a 4-month build window (Mar–Jul 2026) with zero scope handed to a second analyst.
- Translated an informal, paper-based counter process into a documented 11-stage workflow with explicit entry/exit criteria at every stage, eliminating the "which steps did we actually do?" ambiguity that drives disputes in cash lending.
- Authored the business rules for loan tenure, grace periods and ownership transfer as a single canonical specification implemented once server-side, so that 15 separate screens report the same number rather than each recomputing it — removing an entire class of reconciliation defect.
- Parameterised 110 business rules (pricing, tenure, LTV caps, fees, thresholds, messaging, retention) as runtime configuration rather than code, so the owner can retune commercial policy without a development cycle or deployment risk.
- Defined a role-based access matrix across 3 role types and 15 modules, including an additive-role model that lets one person hold operational and investor permissions simultaneously without duplicate accounts.

🔢 **Needs your number**

- *"Gathered and validated requirements from [N] stakeholder groups — counter staff, investors, customers and the operations lead — across [N] structured sessions, reducing post-delivery rework to [N] change requests over [N] months."*
  → Count your actual working sessions and the number of times a rule had to be changed after go-live.
  → **Fallback if you have no count:** "Gathered requirements directly from counter staff, investors and customers through continuous on-site observation, and validated every rule against live transactions before release."

---

## 3. Systems / Technical Analyst

✅ **Verified**

- Designed a 16-table relational data model balancing normalised financial records against a document-based transaction store, absorbing continuous change to the deal structure (multi-item baskets, payment ledgers, resale metadata, appraisal audit fields) without a schema migration per change while keeping list queries indexed and fast.
- Specified and integrated 4 external systems — a government-backed NIN/BVN identity API, Google Gemini vision, Google Lens via SerpApi, and Termii SMS — including quota management, caching, failure fallback and cost control for every one.
- Implemented Web Push from the raw specifications (VAPID/RFC 7519 and RFC 8291 payload encryption) inside a Workers runtime with no third-party library, including auto-detection and PKCS#8 wrapping of raw keys so credentials from any generator are accepted.
- Designed a tiered data-loading strategy (critical / transactional / secondary) plus local cache priming, so the operational dashboard renders immediately on a mobile connection instead of waiting on the heaviest queries.
- Built self-healing schema management: the API detects and applies missing columns and tables at runtime, and every query degrades gracefully on an un-migrated database, so a deployment can never blank the operational dashboard.
- Separated production and preview environments at the database binding level, guaranteeing that no test transaction can reach the live loan book.

---

## 4. Product Manager / Product Owner

✅ **Verified**

- Owned the product end to end — discovery, requirements, prioritisation, acceptance and release — across 488 commits and 106 merged pull requests, personally reviewing and integrating every change.
- Shipped 4 distinct user-facing products from one codebase: a public marketing site, a lead-generating instant valuation tool, a public resale storefront, and a role-gated internal operating system — each designed for a different audience and literacy level.
- Wrote all customer-facing copy in plain language for a non-technical, walk-in audience — including teaching customers to dial `*346#` to retrieve their national ID number, removing the single commonest cause of a failed intake at the counter.
- Made the deliberate product call that AI advises and the human decides: every AI-generated appraisal field stays editable by staff, with model confidence displayed and raw responses retained for audit — keeping accountability with the person signing the deal.
- Designed the system mobile-first as an installable PWA with offline support and a bottom tab bar, because counter staff work from phones, not desks.
- Instrumented third-party API consumption against free-tier limits directly in the workflow UI, so the staff member appraising an item can see remaining quota and the system blocks calls that would exceed the plan.

🔢 **Needs your number**

- *"Grew the platform to [N] active users across [N] roles, with [N]% of transactions completed on mobile."*
  → Users page for the count; your own observation for the mobile split.

---

## 5. Operations Analyst

✅ **Verified**

- Redesigned the arrears process into a rules-driven daily call queue (1 day before due, on the due date, 3 days before ownership ends, on the last day of ownership, and every 2 days while overdue), where a case only clears when a staff member logs a successful contact — replacing memory and goodwill with a closed-loop worklist.
- Built a capital-recovery queue that ranks every at-risk case by urgency — listed-for-sale, ownership-transferred, grace period, overdue, due today — and quantifies total capital at risk at the top of the screen, so the team works the money rather than the list.
- Automated the customer communication schedule across 14 message triggers covering origination, servicing, delinquency, resolution and investor governance, removing manual reminder work entirely.
- Enforced regulatory operating constraints in code: automated messaging refuses to run outside the NCC-permitted 08:00–20:00 Africa/Lagos window, preventing wasted spend on messages operators will not deliver.
- Eliminated the single point of failure in the reminder process by moving the daily trigger from a browser session to a scheduled Cloudflare Worker — reminders now go out on days when no staff member opens the app.
- Built server-side draft persistence into the intake workflow so a transaction interrupted by connectivity loss or a shift change can be resumed by any colleague from the exact step it stopped at.

🔢 **Needs your number**

- *"Reduced average time to complete a customer intake from ~[N] minutes to ~[N] minutes by replacing manual paperwork with a guided workflow and automated agreement generation."*
  → Time yourself doing it the old way vs. now. Even a small sample is defensible if you say "measured across [N] transactions".
- *"Cut arrears follow-up misses to near zero across a book of [N] active loans by moving from ad-hoc phone calls to a scheduled queue."*
  → Active loan count is on your Dashboard.
  → **Fallback:** "Moved arrears follow-up from ad-hoc calls to a scheduled queue with mandatory contact logging."

---

## 6. Financial Analyst

✅ **Verified**

- Designed the full revenue-recognition model for the business, separating collected interest, resale margin (sale price less cost, never gross proceeds) and origination fees from principal movement — so the P&L reports earnings and the capital statement reports flows, with no double-counting between them.
- Built a daily interest-accrual engine with payment checkpointing: interest is charged against the principal actually outstanding on each day, so a partial repayment reduces future interest without retroactively rewriting historical accrual.
- Specified the payment-allocation policy that determines whether a partial payment hits principal or interest first based on where in the term it lands, including automatic term rollover when accrued interest is cleared on or after the due date.
- Rebuilt multi-item loans onto a single shared balance with interest swept across the whole basket before any principal is touched, and made consolidated balances reconstructable by replaying the payment ledger rather than summing lossy per-item state.
- Built a period P&L covering any month or month range with revenue decomposed by source, expense totals, net profit, capital deployed vs. returned, and four profit-pool allocations — exportable to CSV and PDF.
- Modelled available lending capital as an auditable five-line waterfall (capital invested + all-time profit − active loans − inventory − distributions) displayed line by line, with automatic alerts at a configurable low-liquidity threshold and at deficit.
- Built a capital forecasting model using linear regression over monthly history with configurable trend weighting, seasonality, forecast horizon, funding lead time and surplus-streak requirements, to answer when the business will run short and when it is holding idle cash.

🔢 **Needs your number**

- *"Managed a lending book of ~₦[N] across [N] active loans, generating ~₦[N] in recognised revenue over [N] months at a [N]% net margin."*
  → **Monthly Report → set the range to your whole trading period → the Financial Summary gives revenue, expenses and net profit; the Dashboard gives capital out and active loans.** Export the CSV and keep it — that is your evidence at interview.
- *"Recovered [N]% of capital on defaulted loans through the resale channel, at an average margin of [N]% over cost."*
  → Monthly Report → sales margin line; For Sale page for inventory.

---

## 7. Pricing & Credit Analyst

✅ **Verified**

- Designed the pricing structure end to end: a daily interest rate bandable by loan size, a bandable origination fee, LTV caps that differ by product, and a minimum-markup floor on outright purchases.
- Introduced a receipt-linked LTV uplift (40% → 50% of appraised value when the customer produces a purchase receipt) that simultaneously prices ownership risk and gives customers a direct financial incentive to provide provenance evidence.
- Specified a hard cap on advances against non-functional "parts only" items, containing exposure on the asset class with the weakest resale outcome.
- Designed the credit decision as a gated sequence — identity verification, provenance screening, physical inspection and independent valuation must all pass before an offer is calculated — with the offer itself computed as appraised value × LTV cap and checked against available lending capital in real time, so the business cannot lend money it does not have.
- Built a three-pass AI appraisal pipeline (identification with reverse-image corroboration → condition assessment → resale valuation with a price range and confidence score) to replace subjective counter pricing with an auditable, evidence-backed valuation, while keeping final judgement with the staff member.

🔢 **Needs your number**

- *"Set pricing across [N] item categories; achieved an average realised resale margin of [N]% against a [N]% target."*
  → Monthly Report → sales margin ÷ cost of items sold.

---

## 8. Risk, KYC & Compliance Analyst

✅ **Verified**

- Designed and implemented the KYC process: mandatory NIN or BVN verification against a government-backed identity API returning the registered photograph, with a caching layer keyed on ID type and number so a repeat verification is never paid for twice.
- Built a structured provenance screening framework of four questions — ownership duration, purchase location, registration in the customer's name, and shared use by third parties — each with embedded staff guidance explaining what the answer indicates about stolen-goods risk.
- Designed a discreet red-flag exit available at three separate points in the workflow, which terminates a transaction without explanation to the customer and records the reason — protecting staff safety at the counter while preserving the audit trail.
- Established a structured declined-deals register capturing date, customer, identity reference, item, reason and notes — converting rejections into a reusable risk-appetite dataset rather than losing them.
- Specified a mandatory evidence pack per transaction: customer-holding-item photograph with face and item both visible, an item-type-specific photo checklist across 8 asset classes, IMEI/serial capture with OCR confidence and manual confirmation, a signing photograph, a sealed-package photograph and a captured customer signature.
- Implemented an immutable activity log recording actor, role, entity and description for every state-changing action, with configurable retention.
- Built financial controls into the system: password re-confirmation on settings changes, receipt references on capital movements, payouts linked to the specific decisions they settle, and ad-hoc distributions disabled by default.
- Designed the legal documentation — a folded-A4 dual-copy agreement and receipt covering customer particulars, item particulars, photographic evidence and six clauses — generated automatically at the counter.
- Delivered the platform with zero credentials, API keys or secrets committed to source control; all provider credentials are held in platform secret storage.

🔢 **Needs your number**

- *"Screened [N] customers and declined [N] transactions ([N]%) on provenance or identity grounds, with zero disputed-ownership claims to date."*
  → **Declined Log** for the decline count; Dashboard/All Transactions for the total.
  → **Fallback:** "Maintained a documented declined-deals register capturing the reason for every rejection, and completed the trading period with no disputed-ownership claims."

---

## 9. Process Improvement Analyst

✅ **Verified**

- Replaced an entirely paper-based counter process with a guided 11-step digital workflow, removing manual form-filling, manual agreement preparation and manual reminder scheduling from the daily routine.
- Designed a fractional work-credit model that solves the handoff attribution problem: 9 weighted transaction steps and 5 weighted operational tasks, each claimable once by whoever performed it, so credit for a deal started by one staff member and completed by another splits honestly.
- Made the incentive model self-reinforcing by tying the staff share of monthly profit directly to accumulated work credit — linking measurable operational effort to pay rather than to presence.
- Automated the entire monthly profit-distribution cycle: automatic generation of per-stakeholder decisions, SMS notification, a configurable decision deadline, and automatic resolution with a written plain-English explanation when a stakeholder does not respond.
- Removed recurring manual reconciliation by making every number on every screen derive from one server-side calculation engine rather than per-screen arithmetic.
- Built idempotency into work-credit awards via a database-level uniqueness constraint, so re-saving a draft or repeating a step can never double-credit a staff member.

🔢 **Needs your number**

- *"Eliminated ~[N] hours/month of manual reminder calls and ~[N] hours/month of manual monthly reconciliation through automation."*
  → Estimate honestly: reminders sent per month × minutes per call; hours you used to spend closing the month.

---

## 10. Data & MI / Reporting Analyst

✅ **Verified**

- Built the full management-information layer: an operational dashboard with 9 live KPIs, a configurable-range P&L, a staff performance view against a monthly target, an investor capital and distribution view, and a filterable audit trail — each scoped to the roles entitled to see it.
- Defined every KPI the business runs on, including available lending capital, capital out, capital at risk, overdue capital, gross profit, projected earnings (accrued interest at agreed term plus listed-inventory margin at asking price), grace-period count, ready-to-sell count and listed-inventory count.
- Attached a plain-English explanation to each metric in the interface, so staff and investors interpret the numbers the same way rather than forming private definitions.
- Delivered CSV and PDF export on the period report so figures can be taken into external analysis or shared with investors.
- Instrumented third-party API consumption as first-class operational data, tracked per service per period against plan limits and reconciled between client-side and server-side counters.

🔢 **Needs your number**

- *"Analysed [N] transactions and [N] expense records across [N] months to identify the pricing and recovery changes that lifted net margin from [N]% to [N]%."*
  → Monthly Report, month by month, gives the margin trend.
  → **Fallback (quantify the input instead of the outcome — this is legitimate):** "Analysed the full transaction and expense history across the trading period to identify pricing, tenure and recovery improvements."

---

## 11. Treasury / Capital Management

✅ **Verified**

- Designed a capital-days profit-allocation model that weights each investor's share by the amount contributed *and* the number of days it was actually deployed within the period, so capital placed late in a month does not earn the same as capital that sat the whole month — with both the numerator and the period denominator stored on every decision as an audit trail.
- Designed a four-pool profit-sharing structure (staff pool, possessor pool, platform/licence fee, stakeholder net) with per-stakeholder cut percentages that can be set to zero to exempt an individual entirely.
- Built a target-ownership rebalancing model: each investor carries a target and maximum ownership percentage, and any capital shortfall is allocated proportionally to allowed need without breaching anyone's cap.
- Automated capital calls and surplus returns, with configurable alerts to investors for capital deficit, low capital, transaction-level shortfall and recommended withdrawal.
- Modelled investor withdrawals as signed negative capital entries so they flow correctly through every date-weighted calculation without special-case logic.

🔢 **Needs your number**

- *"Managed a pooled capital base of ~₦[N] across [N] investors, distributing ~₦[N] in profit over [N] periods with no disputed allocation."*
  → **Capital & Profits page → Stakeholder Capital table (net capital per investor and total) and the distributions history.**

---

## 12. Project & Delivery Management

✅ **Verified**

- Delivered a production system from a standing start in 4 months (12 Mar – 13 Jul 2026), managing the work through 488 commits and 106 merged pull requests on a branch-per-change model with review before merge.
- Orchestrated AI-assisted development (Claude Code, GitHub Copilot) as a delivery method — defining requirements, reviewing every generated change, and owning integration and acceptance — achieving the output of a small team as a single person.
- Operated a two-environment deployment model with automatic production and preview routing per branch, and a documented data-cloning procedure for refreshing the development database from production.
- Maintained an incremental migration path for the live database throughout, so schema changes shipped without downtime and without losing live trading records.

---

## 13. Cover-letter paragraphs

Pick one, edit the bracketed parts, and cut it to fit.

**For a Business Analyst role:**

> I built and run a collateral-backed lending business in Anambra State, and I did the business analysis for it myself because there was nobody else to do it. That meant sitting at the counter, watching how a deal actually happens, and turning it into a specified 11-stage process with explicit gates — then writing the credit rules, the risk policy, the revenue-recognition model and the investor profit-sharing formula, and specifying the system that enforces all of them. The result is a platform of roughly 25,000 lines running 15 operational modules on 16 data entities, delivered in four months, where 110 business rules are configuration rather than code so the commercial policy can change without a development cycle. I am looking for a role where I can apply that same instinct — understand the actual operation first, then specify something that survives contact with it.

**For an Operations / Process Improvement role:**

> Running a cash-lending shop teaches you very quickly that a process which depends on someone remembering is not a process. I replaced ours: arrears follow-up became a rules-driven daily queue that only clears when a successful contact is logged; customer communication became 14 automated triggers scheduled inside the regulator's permitted messaging hours; the monthly investor profit cycle became a generated set of decisions with a deadline and automatic resolution. I also had to solve an attribution problem most incentive schemes duck — when one person starts a deal and another finishes it, who gets credit? I built a fractional per-step model that splits it honestly, and tied the staff profit pool to it. [Add your own before/after number here.]

**For a Financial Analyst role:**

> I designed the financial model for a lending and resale business and then built the engine that runs it: daily interest accrual with payment checkpointing so a partial repayment reduces future interest without rewriting history; a payment-allocation policy that routes to principal or interest depending on where in the term the payment lands, with automatic term rollover; revenue recognised as collected interest, resale margin and origination fees, kept strictly separate from principal movement. On top of that sits a period P&L over any date range, a five-line liquidity waterfall, and a regression-based capital forecast that tells the owner when the business will run short of lending money and when it is sitting on idle cash. [Add your book size and revenue here.]

---

## 14. Interview stories (STAR)

Have these three ready. Each is a real decision with a real trade-off, which is what interviewers are actually testing.

**1. The multi-item loan rebuild — "tell me about a time you got something wrong."**
*Situation:* Customers often pledge several items on one loan. The first model gave each item its own ledger.
*Task:* It produced wrong balances — one combined payment showed as several rows, per-item state drifted, and "days × rate = total" broke everywhere it was displayed.
*Action:* Rather than patching the symptoms, I re-specified a multi-item loan as one shared balance, made interest sweep across the whole basket before touching principal, made consolidated balances reconstructable by replaying the payment ledger instead of summing lossy state, audited every display in the system that used the broken formula, and added an admin override to force-consolidate loans stuck in the old shape.
*Result:* Balances became reconcilable and consistent across every screen — and the lesson I took was that a data model that doesn't match the real-world transaction will keep generating defects no matter how many you fix.

**2. The ownership-window rule — "tell me about a subtle requirement."**
*Situation:* Paying interest extends a customer's deadline. Company policy also holds items for a maximum tenure.
*Task:* Anchoring the sale window only on the customer's deadline meant a short 7-day loan could become sale-eligible on day 11 — long before company policy allowed the item to be sold.
*Action:* I specified the sale window as gated by *the later of* the customer's current deadline and the company's maximum-tenure day, and had status transitions computed in Africa/Lagos time rather than UTC so they happen at Nigerian midnight.
*Result:* Extensions still work, policy is never breached, and no loan changes status an hour early. It's the kind of rule that looks like a detail until it costs you an item or a customer.

**3. Cost control on metered APIs — "tell me about a constraint you designed around."**
*Situation:* Identity verification and AI valuation both cost money per call, on a thin-margin book.
*Task:* Keep the quality of the decision without letting API spend scale with footfall.
*Action:* I cached every successful identity verification uniquely by ID type and number so a repeat customer is never paid for twice, tracked consumption per service against plan limits, surfaced live remaining quota inside the appraisal workflow so staff can see it, blocked calls that would exceed the plan, and designed a manual fallback so the counter keeps working when an API fails or times out.
*Result:* API cost became predictable and bounded rather than a function of footfall, and no external dependency can stop a transaction.

---

## 15. ATS keywords

Weave these into the bullets naturally; do not list them as a block.

Requirements elicitation · Process mapping · Business process re-engineering · Stakeholder management · Functional specification · User stories & acceptance criteria · Gap analysis · Data modelling · Systems integration · API integration · UAT · Role-based access control · KYC · AML · Identity verification (NIN/BVN) · Credit risk · Risk appetite · Fraud screening · Audit trail · Regulatory compliance · Loan servicing · Arrears management · Collections · Revenue recognition · P&L analysis · Financial modelling · Forecasting · Liquidity management · Working capital · Treasury · Profit allocation · Unit economics · Pricing strategy · LTV · Inventory management · KPI definition · Management information · Dashboard design · CSV/PDF reporting · Data analysis · SQL · Product ownership · Backlog prioritisation · Agile delivery · Release management · Change management · Automation · Cost control · Vendor management

---

## 16. Where to find your real numbers

Log into the portal and pull these before you finalise anything. Keep the CSV exports — at interview, being able to say "I have the export" is worth more than the number itself.

| Figure you need | Where it is |
|---|---|
| Total loans written, total disbursed | **Monthly Report** → set range to the full trading period → New Loans, Capital deployed |
| Revenue, expenses, net profit, margin | **Monthly Report** → Financial Summary (+ CSV export) |
| Revenue split (interest / sale margin / fees) | **Monthly Report** → Revenue Breakdown |
| Active loans, capital out, capital at risk | **Dashboard** |
| Overdue count and overdue capital | **Dashboard** / **Recovery Queue** |
| Items sold, resale margin | **Monthly Report** → Sales margin; **For Sale** page |
| Customers declined and why | **Declined Log** |
| Investor count, capital pool, distributions | **Capital & Profits** |
| Staff count, per-staff throughput | **Users**; **Profile → Staff Performance** |
| Messages sent, delivery rate | **Settings → Messaging** → SMS logs |
| Month-on-month margin trend | **Monthly Report**, run month by month |

**Three rules when you write the numbers in:**

1. Percentages need a baseline. "Reduced processing time by 30% (from 10 days to 7)" survives a follow-up question. "Reduced processing time by 30%" does not.
2. Use `~` for anything estimated. `~₦40,000` reads as an honest estimate; `₦41,873` that you cannot reproduce reads as invented.
3. If you don't have the figure, quantify the *input* instead — scale of effort is a legitimate substitute. "Analysed 8 months of transaction and expense records" is a real, defensible claim.
