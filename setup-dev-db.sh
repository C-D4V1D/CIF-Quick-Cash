#!/usr/bin/env bash
# setup-dev-db.sh
#
# One-shot script to:
#   1. Create the cifcash-dev-db D1 database
#   2. Export all production data and import it into the dev database
#   3. Rewrite wrangler.toml with per-environment database bindings
#   4. Clear all transactional records from the production database
#
# Prerequisites:
#   - npx wrangler is available (installed globally or via npm run)
#   - You are authenticated with Cloudflare:
#       Option A: run `npx wrangler login` once in your terminal
#       Option B: set CLOUDFLARE_API_TOKEN in your shell environment
#
# Usage:
#   chmod +x setup-dev-db.sh
#   ./setup-dev-db.sh
#
# After the script completes, commit and push the updated wrangler.toml:
#   git add wrangler.toml
#   git commit -m "Configure separate D1 databases for production and dev environments"
#   git push

set -euo pipefail

PROD_DB="cifcash-db"
PROD_DB_ID="84f2f966-3cf2-43d5-b5bc-028435dcc419"
DEV_DB="cifcash-dev-db"
WRANGLER_TOML="wrangler.toml"
EXPORT_FILE="/tmp/cifcash-prod-export.sql"
CLEAR_SCRIPT="clear-main-records.sql"

VAPID_PUBLIC_KEY="BP170YQOAM1B98-bACXiUF8goLWbKrXQj0tNhZ8b1zmBjWhGi6am-F0JCrkxffsPwI0lFR8lEk-LIoWrTssq2P4"

echo ""
echo "========================================"
echo "  CIF Cash — Dev DB Setup"
echo "========================================"
echo ""

# ── Step 1: Create the dev D1 database ──────────────────────────────────────
echo "[1/4] Creating D1 database: $DEV_DB ..."
CREATE_OUTPUT=$(npx wrangler d1 create "$DEV_DB" 2>&1)
echo "$CREATE_OUTPUT"

# Extract the database_id from the wrangler output
# wrangler prints: database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
DEV_DB_ID=$(echo "$CREATE_OUTPUT" | grep -oP '(?<=database_id = ")[^"]+')

if [[ -z "$DEV_DB_ID" ]]; then
  echo ""
  echo "ERROR: Could not extract database_id from wrangler output."
  echo "Please create the database manually on the Cloudflare dashboard,"
  echo "note its ID, then edit wrangler.toml yourself."
  exit 1
fi

echo ""
echo "  Dev database created! ID: $DEV_DB_ID"
echo ""

# ── Step 2: Export production data ──────────────────────────────────────────
echo "[2/4] Exporting all data from production database ($PROD_DB) ..."
npx wrangler d1 export "$PROD_DB" --remote --output="$EXPORT_FILE"
echo "  Export saved to: $EXPORT_FILE"
echo ""

# ── Step 3: Import data into the dev database ────────────────────────────────
echo "[3/4] Importing production data into $DEV_DB ..."
npx wrangler d1 execute "$DEV_DB" --remote --file="$EXPORT_FILE"
echo "  Import complete."
echo ""

# ── Step 3b: Rewrite wrangler.toml with per-environment bindings ─────────────
echo "  Rewriting $WRANGLER_TOML with per-environment database bindings ..."
cat > "$WRANGLER_TOML" <<TOML
name = "cifcash"
pages_build_output_dir = "dist"

compatibility_date  = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

# VAPID public key for Web Push notifications.
# Set VAPID_PRIVATE_KEY as a Cloudflare Pages Secret (dashboard → Settings → Environment variables).
# Generate a fresh key pair with: node -e "const {subtle}=globalThis.crypto;(async()=>{const kp=await subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const pub=await subtle.exportKey('raw',kp.publicKey);const priv=await subtle.exportKey('pkcs8',kp.privateKey);const b=b=>Buffer.from(b).toString('base64url');console.log('PUBLIC:',b(pub),'\nPRIVATE:',b(priv));})()"
# CRON_SECRET: set this as a Cloudflare Pages Secret (dashboard → Settings → Environment variables).
# Generate a random value, e.g.: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Use the same value in the companion cron Worker (see cron-worker.js).
# CRON_SECRET = ""  ← do not commit the real value here

# ── Production environment (main branch) ────────────────────────────────────
[env.production]
[env.production.vars]
VAPID_PUBLIC_KEY = "$VAPID_PUBLIC_KEY"

[[env.production.d1_databases]]
binding       = "DB"
database_name = "$PROD_DB"
database_id   = "$PROD_DB_ID"

[[env.production.r2_buckets]]
binding     = "PHOTOS"
bucket_name = "cifcash-photos"

# ── Dev / Preview environment (all non-main branches) ────────────────────────
[env.preview]
[env.preview.vars]
VAPID_PUBLIC_KEY = "$VAPID_PUBLIC_KEY"

[[env.preview.d1_databases]]
binding       = "DB"
database_name = "$DEV_DB"
database_id   = "$DEV_DB_ID"

[[env.preview.r2_buckets]]
binding     = "PHOTOS"
bucket_name = "cifcash-photos"
TOML
echo "  $WRANGLER_TOML rewritten."
echo ""

# ── Step 4: Clear production records ────────────────────────────────────────
echo "[4/4] Clearing transactional records from production ($PROD_DB) ..."
echo "  (users and settings are preserved)"
npx wrangler d1 execute "$PROD_DB" --remote --file="$CLEAR_SCRIPT"
echo "  Production records cleared."
echo ""

# ── Verification ──────────────────────────────────────────────────────────────
echo "========================================"
echo "  Verification"
echo "========================================"
echo ""
echo "Dev DB transaction count (should be > 0 if prod had data):"
npx wrangler d1 execute "$DEV_DB" --remote --command="SELECT COUNT(*) AS dev_transaction_count FROM transactions;"

echo ""
echo "Production transaction count (should be 0):"
npx wrangler d1 execute "$PROD_DB" --remote --command="SELECT COUNT(*) AS prod_transaction_count FROM transactions;"

echo ""
echo "========================================"
echo "  Done! Commit the updated wrangler.toml:"
echo "========================================"
echo ""
echo "  git add wrangler.toml"
echo "  git commit -m 'Configure separate D1 databases for production and dev environments'"
echo "  git push"
echo ""
echo "  After that push, Cloudflare Pages will route:"
echo "    main branch        → $PROD_DB (production, now cleared)"
echo "    all other branches → $DEV_DB (dev, has your testing data)"
echo ""
