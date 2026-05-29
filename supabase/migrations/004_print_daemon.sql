-- =====================================================================
-- 004: Print daemon support
-- The headless print-daemon (scripts/print-daemon) prints each new order to
-- the kitchen printer exactly once. `printed_at` lets it dedupe and survive
-- restarts without reprinting old tickets.
-- =====================================================================

alter table public.orders
  add column if not exists printed_at timestamptz;

-- Fast lookup of orders the daemon still needs to print.
create index if not exists orders_unprinted_idx
  on public.orders (created_at)
  where printed_at is null;

-- Backfill: treat every EXISTING order as already printed, so turning the
-- daemon on for the first time doesn't spew the whole history. New orders go
-- out with printed_at = null and get picked up.
update public.orders set printed_at = now() where printed_at is null;
