# GitHub repository setup — About, topics, and making this shareable

Everything in this file is a manual step on github.com. It cannot be done from the codebase.

---

## 1. Current visibility — read this first

**As of this writing, `C-D4V1D/cifcash` is a PRIVATE repository.** Anyone you send the link to — a recruiter, a hiring manager, an interviewer — will see a **404 page**, not your project. The link on your CV does not work for them today.

Nothing in this repo changes that. Repository visibility is an account setting only you can change.

### Before you flip it to public

Making a repository public is **permanent for anything already in the history** — the entire commit history becomes readable, including files that were deleted later. Work through this list first.

| Check | Status | What to do |
|---|---|---|
| API keys, tokens, provider secrets in code or history | ✅ **Clear** — a full-history scan found none. All provider credentials live in the database settings document or Cloudflare Pages Secrets. | Nothing |
| `.env` files | ✅ Clear — none have ever been committed | Nothing |
| Real customer data (names, NIN/BVN, phone numbers, photographs) | ✅ Clear — customer data lives only in Cloudflare D1 and R2, never in the repo. The screenshots in `docs/screenshots/` use synthetic demo data. | Nothing |
| Default admin password hash in `schema.sql` and `migrate-admin-credentials.sql` | ⚠️ Present — it is the hash for the documented throwaway password `CifAdmin@1` | **Confirm the live admin password is no longer `CifAdmin@1`.** If it is, change it now, before going public. |
| Cloudflare D1 database IDs in `wrangler.toml` and `setup-dev-db.sh` | ⚠️ Present — not secrets on their own (they are useless without your Cloudflare account credentials) and normal to commit | Optional. Leave them, or move them to Pages environment variables if you'd rather not publish them. |
| Business phone number, address, WhatsApp number | ⚠️ Present in ~16 places | **This is already public** on your live website and marketing. No action needed unless you'd prefer a portfolio repo not to carry it. |
| VAPID public key in `wrangler.toml` | ✅ Fine — public keys are meant to be published | Nothing |

### How to change visibility

1. Go to **https://github.com/C-D4V1D/cifcash/settings**
2. Scroll to the bottom → **Danger Zone** → **Change repository visibility** → **Change to public**
3. Type the repository name to confirm

### If you'd rather not publish the live business system

Entirely reasonable — this is the operating system of a trading business, and publishing it publishes your commercial rules and your competitors' roadmap. Two alternatives:

- **Keep it private and add reviewers individually.** Settings → Collaborators → add the interviewer's GitHub username. They get read access; nobody else does. Good for a specific interview, bad for a CV link.
- **Publish a portfolio copy.** Create a new public repo (e.g. `cifcash-portfolio`) containing only `README.md`, `docs/PORTFOLIO.md` and `docs/screenshots/` — the full story, the screenshots, no source code. A recruiter reads the README anyway; almost none clone the code. This gives you a working CV link with zero commercial exposure.

---

## 2. The About panel

Go to **https://github.com/C-D4V1D/cifcash** → click the ⚙️ gear next to **About** (top right of the file list).

### Description

Paste this (350 characters, fits GitHub's limit):

```
Production platform for a collateral-backed micro-lending and asset-resale business in Anambra, Nigeria. Covers KYC/NIN verification, AI-assisted appraisal, loan servicing and interest accrual, arrears recovery, resale inventory, accounting, investor capital-days profit distribution and automated SMS. React 19 + Cloudflare Pages/D1/R2.
```

Shorter alternative if you prefer:

```
End-to-end operating system for an asset-backed lending and resale business in Nigeria — KYC, AI appraisal, loan servicing, arrears recovery, inventory, accounting and investor profit distribution.
```

### Website

```
https://cifcash.pages.dev
```

### Topics

Add all of these (type each, press Enter):

```
fintech            lending              microfinance        loan-management
kyc                credit-risk          business-analysis   product-management
operations         financial-modeling   fintech-nigeria     nigeria
react               cloudflare-workers   cloudflare-d1       cloudflare-pages
pwa                sqlite               serverless          ai-integration
```

> GitHub allows up to 20 topics. Topics are how recruiters and search find the repo — the business ones (`business-analysis`, `product-management`, `operations`, `financial-modeling`, `credit-risk`, `kyc`) matter more for your target roles than the technology ones.

### Checkboxes

- ✅ **Releases** — uncheck (you have none)
- ✅ **Packages** — uncheck
- ✅ **Deployments** — your call; it shows the Cloudflare Pages deployments, which is decent evidence the thing is actually live

---

## 3. Pin it to your profile

The About panel only helps people who already found the repo. Pinning puts it on your profile page.

1. Go to **https://github.com/C-D4V1D**
2. Click **Customize your pins**
3. Select `cifcash` (and up to 5 others)

Also worth doing while you're there: set a profile README (`C-D4V1D/C-D4V1D` repo with a `README.md`) with a two-line summary and a link to this project. It's the first thing a recruiter sees.

---

## 4. Housekeeping

- **4 open issues** on the repo. Close or triage them — an employer scanning the repo reads open issues as unfinished work.
- **178 branches.** Delete the merged ones (`copilot/*`, `claude/*`). Settings → General → enable *Automatically delete head branches* to stop it recurring. A tidy branch list reads as disciplined delivery; 178 stale branches reads as the opposite.
- **Language bar** will show ~100% JavaScript. Fine.

---

## 5. Your CV link

Once the repo is public (or you've published the portfolio copy):

```
github.com/C-D4V1D/cifcash
```

Put it in the header of your CV next to your email and LinkedIn, not buried in the project section. And check it in a private/incognito window before you send anything out — that is the only reliable test of whether a stranger can actually see it.
