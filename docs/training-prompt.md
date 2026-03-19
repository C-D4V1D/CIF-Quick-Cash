# CIF Cash Staff Training — AI Prompt Template

Use this document to generate a step-by-step staff onboarding training plan using any AI assistant (ChatGPT, Claude, Gemini, etc.).  
Copy the prompt block below, fill in the optional **App-Specific Details** section with your real settings, and paste it into your AI assistant.

---

## Context

**CIF Cash** is a web app for managing pawn/loan/cash transactions.  
Staff use it to:
- Create and manage **Cash Advance** and **Outright Purchase** transactions
- Track **active loans**, **repayments**, **deadlines**, and **alerts**
- Log **expenses**, view **reports**, and maintain a full **audit trail**

### User Roles
| Role | Access |
|------|--------|
| Admin | Full access — settings, users, all data |
| Staff | Create/manage transactions, view loans and alerts |
| Stakeholder | Read-only — dashboard, reports, capital/profits |

### Transaction Types
- **Cash Advance** — Customer leaves item as collateral; can redeem it before the deadline
- **Outright Purchase** — Customer sells the item outright (no loan, no interest)

### Transaction Wizard (11 Steps)
1. Type — Choose Cash Advance or Outright Purchase
2. ID Verify — NIN or BVN identity check
3. Customer — Name, address, phone, family contact
4. Photos — Customer holding item + customer with ID
5. Screening — Questionnaire (ownership history, purchase source)
6. Capture — Item type + photo slots (IMEI for Smartphone/Tablet)
7. Inspection — Item-specific checklist (15+ checks)
8. AI Value — System generates estimated resale value
9. Offer — Set advance/purchase amount (auto-capped by system)
10. Agreement — Print, sign, upload signed form photo
11. Complete — Final confirmation + service fee collection

### Key Screens
- **Dashboard** — Capital available, capital out, active loans count
- **New Transaction** — Opens the 11-step wizard
- **All Transactions** — Full searchable/filterable history
- **Active Loans** — Currently open loans with deadlines
- **Deadlines & Alerts** — Color-coded urgency view
- **For Sale** — Items ready to be sold or already listed
- **Monthly Report** — Revenue, fees, interest, profit summary
- **Capital & Profits** — Capital invested vs. recovered vs. out
- **Expenses** — Log and view business expenses
- **Declined Log** — Rejected transactions with reason/notes
- **Activity Log** — Full timestamped audit trail
- **Settings** (Admin) — Rates, caps, categories, API keys
- **Users** (Admin) — Create and manage user accounts

### Default Settings (adjust to match your live values)
- Daily interest rate: 1%
- Grace period: 3 days
- Max loan days: 30
- Loan cap (no receipt): 40% of estimated value
- Loan cap (with receipt): 50% of estimated value
- Max parts-only advance: ₦5,000
- Service fee: flat fee collected at transaction start

### Reference Number Format
`CIF-DDMMYY-NNN` (e.g., `CIF-190326-042`)

### Loan Status Flow
```
Active → Due Today → Overdue → Last Day of Ownership
      → Grace Period → Last Day of Grace → Ready to Sell
```
Closed statuses: **Returned** (repaid), **Sold** (item sold), **Declined** (rejected)

---

## AI Prompt Template

> Copy everything between the `===` lines and paste into your AI assistant.  
> Replace anything in `[square brackets]` with your actual values before sending.

```
===
Act as a CIF Cash staff onboarding trainer.

CIF Cash is a web app for managing pawn/loan/cash transactions. I need to train new staff on a fresh empty system with no existing data. The training must be practical, sequential, and based only on the real app flow.

## App Overview
- Transaction types: Cash Advance, Outright Purchase
- User roles: Admin (full access), Staff (transactions + loans), Stakeholder (read-only)
- 11-step transaction wizard: Type → ID Verify → Customer → Photos → Screening → Capture → Inspection → AI Value → Offer → Agreement → Complete
- Key screens: Dashboard, New Transaction, All Transactions, Active Loans, Deadlines & Alerts, For Sale, Monthly Report, Capital & Profits, Expenses, Declined Log, Activity Log, Settings (admin), Users (admin)
- Reference number format: CIF-DDMMYY-NNN (e.g., CIF-190326-042)
- Loan status flow: Active → Due Today → Overdue → Last Day of Ownership → Grace Period → Last Day of Grace → Ready to Sell
- Closed statuses: Returned (repaid), Sold, Declined

## Default Settings
- Daily interest rate: [1%]
- Max loan days: [30]
- Grace period: [3 days]
- Service fee: [₦500 flat]
- Loan cap (no receipt): [40% of AI value]
- Loan cap (with receipt): [50% of AI value]
- Max parts-only advance: [₦5,000]

## Requirements
- Output a numbered list from 1 to [25] steps
- Be sequential — each step must build on the previous
- Assume an empty system with zero transactions at the start
- Include concrete example values: customer names, item types, IMEI numbers, amounts, loan days, and which options to select at each step
- Design steps so that data created in earlier steps is used in later steps (e.g., create a loan in step 4, repay it in step 10)
- Include at least one example for each of these scenarios:
  - [ ] Login and initial admin setup (settings + users)
  - [ ] Cash Advance (Smartphone with IMEI, with receipt)
  - [ ] Cash Advance (non-powered item as parts-only)
  - [ ] Outright Purchase (Laptop, no receipt)
  - [ ] Saving and resuming a Draft
  - [ ] Declining a transaction (red flag during screening)
  - [ ] Full repayment of an active loan
  - [ ] Simulating a loan approaching its deadline (create loan with short duration)
  - [ ] Viewing Deadlines & Alerts after loans are created
  - [ ] Listing an overdue item For Sale and recording a sale
  - [ ] Recording expenses
  - [ ] Viewing Capital & Profits
  - [ ] Viewing the Monthly Report
  - [ ] Reviewing the Activity Log
- Format each step as:
  **Step N — [Title]**
  - What to do: [exact actions, field values, and options to select]
  - Why it matters: [brief explanation of the business reason]

## App-Specific Details
[Paste any additional context here — e.g., your live settings screenshots, custom item categories, expense categories, WhatsApp template content, business name, stakeholder names, or anything else the AI should know to make the steps more accurate.]
===
```

---

## Coverage Checklist

Use this checklist to verify the generated training plan covers all critical areas:

- [ ] Login (Admin and Staff)
- [ ] Users — creating and managing accounts
- [ ] Settings — configuring rates, caps, grace period, categories
- [ ] New Transaction — Cash Advance full flow
- [ ] New Transaction — Outright Purchase flow
- [ ] New Transaction — Parts-Only (non-powered item)
- [ ] Drafts — saving and resuming
- [ ] Declining a transaction and viewing the Declined Log
- [ ] Active Loans — viewing the list and individual loan detail
- [ ] Repayment — full repayment workflow
- [ ] Deadlines & Alerts — viewing upcoming and overdue loans
- [ ] Sale Flow — listing for sale, recording a sale
- [ ] Transactions List — searching and filtering
- [ ] Expenses — adding and viewing expenses
- [ ] Capital & Profits — understanding invested vs. recovered
- [ ] Monthly Report — revenue, fees, interest, profit
- [ ] Activity Log — reviewing the audit trail

---

## Tips for Best Results

- **Run the prompt on a test/demo system**, not production, so staff can freely create transactions without affecting real data.
- **Adjust `[25]` steps** to 20 or 30 depending on your training session length.
- **Paste in real screenshots** or export your current Settings page to give the AI accurate cap and interest values.
- **Re-run with a follow-up prompt** asking the AI to expand any step with more detail, add SMS/WhatsApp templates, or adapt the scenario to a specific item category (e.g., motorcycles, generators).
- **Print or export the result** as a PDF training handout for new staff.
