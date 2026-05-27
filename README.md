# Sapthagiri — Dosa Ordering (trial build)

Two-sided ordering app for the dosa station.

- **Customer** scans the QR taped to their table → picks items → sees live status + a count-down wait estimate.
- **Dosa master** opens `/kitchen` on a tablet → sees the 3 oldest active orders in a FIFO batch → taps **Start → Ready → Served**.
- **Manager** opens `/admin/qrs` → prints one sheet with a QR for every table.

Stack: **Next.js 14** (App Router) + **TypeScript** + **Tailwind** + **Supabase** (Postgres + Realtime).

## What's in the menu

All items from the printed menu, minus your exclusions (any **rava** dosa, **pav bhaji** dosa, **pesarattu upma**, **upma**, **chole bhatura**). 26 items total: 20 dosas + 6 uttapams.

Customers can tap **"No onion, no garlic"** on any masala-filled dosa to switch the potato filling to Jain-style. The flag is highlighted in red on the kitchen card so the master sees it at a glance.

## Wait-time logic

- Dosa cook time: 6 min (5–7 range shown to the customer).
- Uttapam cook time: 8.5 min (8–9 range).
- Kitchen has **4 parallel tava slots** (configurable in `lib/timing.ts`).
- For each queued order, we walk it through the slots FIFO and add its cook time to the earliest-free slot, then add the customer's own cook time.
- Customer sees a friendly range like "6 – 10 min" that ticks down every 15 seconds.

## One-time setup

### 1. Supabase project

1. Go to https://supabase.com → **New project** (pick the closest region).
2. When it's ready, open **SQL Editor** → paste the contents of `supabase/schema.sql` → **Run**. This creates `orders` + `order_items` and enables realtime.
3. **Project Settings → API** → copy the **Project URL** and the **anon public** key.

### 2. Local env

```bash
cp .env.local.example .env.local
# edit .env.local and paste the URL + anon key from step 1.3
```

### 3. Install + run

```bash
npm install
npm run dev
```

### 4. Pages

| URL                       | Who                | What it does                                    |
| ------------------------- | ------------------ | ----------------------------------------------- |
| `/`                       | Anyone             | Landing — links to all flows                    |
| `/admin/qrs`              | Manager            | Print sheet of QR codes, one per table          |
| `/order?table=A3`         | Customer (via QR)  | Pick items, add no-onion-no-garlic, submit      |
| `/status/<order-id>`      | Customer           | Live status + wait-time count-down              |
| `/kitchen`                | Dosa master        | FIFO batch of 3 orders + Start/Ready/Served     |

## For Wednesday's trial

1. Run `npm run dev` on the laptop.
2. Find the laptop's local IP (`ifconfig` on Mac, look for `en0`). Phones need to be on the same Wi-Fi.
3. Set `NEXT_PUBLIC_BASE_URL` is **not needed** — the QR page uses `window.location.origin` so whatever URL you're at when you print is what gets encoded. Open `http://YOUR-LAPTOP-IP:3000/admin/qrs` and print from there so the QRs point to the LAN address.
4. Open `/kitchen` on the kitchen tablet.
5. Test with one phone before the trial: scan A1, order a Masala Dosa with "no onion no garlic", verify it shows up red on the kitchen screen.

## Why no voice today

You asked for the fastest possible build for today's trial. Voice was nice-to-have; the kitchen card has big tap-targets (Start / Ready / ↩ / ✕) that work well on a tablet. Voice can slot in later — the kitchen page is one component and adding a mic button + Web Speech API listener is ~50 lines.

## Project layout

```
app/
  page.tsx                  landing
  admin/qrs/page.tsx        printable QR sheet
  order/page.tsx            customer order form
  status/[id]/page.tsx      customer's live status
  kitchen/page.tsx          dosa master display
lib/
  menu.ts                   20 dosas + 6 uttapams + masala-filling flag
  tables.ts                 23 tables, taken from your Clover Dining screenshot
  timing.ts                 wait-time math (PARALLEL_SLOTS=4, DISPLAY_BATCH=3)
  supabase.ts               Supabase client + DB row types
supabase/
  schema.sql                run once in the SQL editor
```

## Tuning

- **More parallel cooks?** Change `PARALLEL_SLOTS` in `lib/timing.ts`.
- **Show 4 instead of 3 active orders?** Change `DISPLAY_BATCH`.
- **Add a table?** Append to `lib/tables.ts` — appears on QR sheet automatically.
- **Different cook time?** Change `DOSA_COOK` / `UTTAPAM_COOK` in `lib/menu.ts`.
