-- Sapthagiri — Test Mode
-- Migration 003, written 2026-05-29.
--
-- Adds an is_test flag to orders so Sree can submit practice orders
-- without polluting Wednesday's real analytics. Kitchen filters test
-- orders out by default (with a toggle to include them). Analytics
-- always filters them out.
--
-- Idempotent. Safe to re-run.

alter table public.orders
  add column if not exists is_test boolean not null default false;

-- Index only the test orders — they're a small subset, this keeps the
-- analytics WHERE NOT is_test path cheap.
create index if not exists orders_is_test_idx
  on public.orders (created_at desc) where is_test;

-- Refresh the get_order_status RPC to include is_test so the customer
-- status page can show a "TEST ORDER" badge when relevant.
create or replace function public.get_order_status(p_id uuid)
returns table (
  id uuid, table_id text, status text, created_at timestamptz,
  cooking_started_at timestamptz, ready_at timestamptz, served_at timestamptz,
  total_cents int, cook_medium text, crispiness text, party_size int,
  rating int, rating_at timestamptz, is_test boolean
)
language sql security definer set search_path = public as $$
  select id, table_id, status, created_at, cooking_started_at, ready_at,
         served_at, total_cents, cook_medium, crispiness, party_size,
         rating, rating_at, is_test
  from public.orders
  where id = p_id;
$$;
grant execute on function public.get_order_status(uuid) to anon, authenticated;

-- get_active_queue stays the same — wait-time math doesn't need is_test.
