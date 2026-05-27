#!/bin/bash
# Double-click this file to start the Sapthagiri Dosa dev server.
# It installs dependencies the first time, writes a stub .env.local
# if you haven't filled in Supabase credentials yet, and runs `npm run dev`.

set -e
cd "$(dirname "$0")"

echo ""
echo "─────────────────────────────────────────────"
echo " Sapthagiri Dosa — local dev server"
echo "─────────────────────────────────────────────"
echo ""

# Make sure .env.local exists so Next.js boots even before Supabase is set up.
if [ ! -f .env.local ]; then
  cat > .env.local <<EOF
# Placeholder values — replace with your Supabase project URL + anon key.
# Until you do, order submission and the kitchen live updates won't work,
# but you can still see the UI on every page.
NEXT_PUBLIC_SUPABASE_URL=https://demo-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=demo-anon-key-not-real
EOF
  echo "✓ Wrote stub .env.local (replace with real Supabase values when you have them)"
fi

# Install / repair node_modules. Subsequent runs are fast because npm caches.
if [ ! -x node_modules/.bin/next ]; then
  echo "→ Installing dependencies (one-time, ~90 sec)…"
  npm install --no-audit --no-fund
fi

echo ""
echo "→ Starting dev server on http://localhost:3000"
echo "  • Customer view:  http://localhost:3000/order?table=A1"
echo "  • Kitchen view:   http://localhost:3000/kitchen"
echo "  • QR sheet:       http://localhost:3000/admin/qrs"
echo ""
echo "Press Ctrl+C in this window to stop the server."
echo ""

npm run dev
