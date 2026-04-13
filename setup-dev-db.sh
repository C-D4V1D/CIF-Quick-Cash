#!/usr/bin/env bash
# setup-dev-db.sh
#
# One-shot script to:
#   1. Create the cifcash-dev-db D1 database
#   2. Export all production data and import it into the dev database
#   3. Patch wrangler.toml with the new dev database ID
#   4. Clear all transactional records from the production database
#
# Prerequisites:
#   - npx wrangler is available (comes with the project's devDependencies or globally)
#   - You are authenticated: run `npx wrangler login` once if not already done
#     OR set the CLOUDFLARE_API_TOKEN environment variable
#
# Usage:
#   chmod +x setup-dev-db.sh
#   ./setup-dev-db.sh

set -euo pipefail

PROD_DB="cifcash-db"
DEV_DB="cifcash-dev-db"
WRANGLER_TOML="wrangler.toml"
EXPORT_FILE="/tmp/cifcash-prod-export.sql"
CLEAR_SCRIPT="clear-main-records.sql"

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
  echo "then set DEV_DB_ID in this script and re-run from step 2."
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

# ── Step 3b: Patch wrangler.toml with the real dev DB id ─────────────────────
echo "  Patching $WRANGLER_TOML with dev database id ..."
sed -i "s|database_id   = \"DEV_DB_ID_PLACEHOLDER\"|database_id   = \"$DEV_DB_ID\"|" "$WRANGLER_TOML"
echo "  $WRANGLER_TOML updated."
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
echo "  Done! Next steps:"
echo "========================================"
echo ""
echo "  1. Review the changes to $WRANGLER_TOML (git diff wrangler.toml)"
echo "  2. Commit and push:"
echo "       git add wrangler.toml"
echo "       git commit -m 'Configure separate D1 databases for production and dev environments'"
echo "       git push -u origin claude/clone-main-to-dev-YaiMK"
echo ""
echo "  3. Cloudflare Pages will pick up the new bindings on the next deployment:"
echo "       - main branch    → uses cifcash-db    (production, now cleared)"
echo "       - all other branches → uses cifcash-dev-db (dev, has your testing data)"
echo ""
