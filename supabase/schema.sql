-- Sapthagiri Dosa Ordering — Supabase schema
-- Run this in the Supabase SQL editor of a fresh project.
-- It creates two tables, enables realtime, and adds permissive policies that
-- are fine for an in-restaurant demo.  Tighten the policies before exposing
-- this publicly.

-- ───────────────────────── orders ─────────────────────────
create table if not exists public.orders (
  id                  uuid primary key default gen_random_uuid(),
  table_id            text not null,
  customer_name       text,
  notes               text,
  status              text not null default 'queued'
                        check (status in ('queued','cooking','ready','served','cancelled')),
  created_at          timestamptz not null default now(),
  cooking_started_at  timestamptz,
  ready_at            timestamptz,
  served_at           timestamptz,
  total_cents         integer not null default 0
);

create index if not exists orders_status_created_idx
  on public.orders (status, created_at);

-- ─────────────────────── order_items ──────────────────────
create table if not exists public.order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  menu_item_id text not null,      -- slug from lib/menu.ts (e.g. 'masala-dosa')
  name         text not null,      -- denormalised so the kitchen always shows the right text
  quantity     integer not null check (quantity > 0),
  unit_price_cents integer not null,
  cook_minutes numeric not null,
  category     text not null check (category in ('dosa','uttapam')),
  -- Jain-style: swap the masala filling to no-onion-no-garlic mashed potato.
  no_onion_garlic boolean not null default false,
  -- Build-your-own toppings: e.g. {paneer, cheese, mysore-chutney, chilli}
  addons       text[] not null default '{}',
  -- Kitchen has crossed this item off the to-do list.
  is_done      boolean not null default false,
  done_at      timestamptz,
  notes        text
);

create index if not exists order_items_order_idx
  on public.order_items (order_id);

-- ──────────────── Row-level security (demo policy) ────────────────
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- Everyone (anon + authenticated) can read.
drop policy if exists "orders_select_all" on public.orders;
create policy "orders_select_all" on public.orders for select using (true);
drop policy if exists "order_items_select_all" on public.order_items;
create policy "order_items_select_all" on public.order_items for select using (true);

-- Anyone can insert (customer placing an order).
drop policy if exists "orders_insert_anyone" on public.orders;
create policy "orders_insert_anyone" on public.orders for insert with check (true);
drop policy if exists "order_items_insert_anyone" on public.order_items;
create policy "order_items_insert_anyone" on public.order_items for insert with check (true);

-- Anyone can update order status (the dosa master).  In production gate this
-- behind an authenticated "kitchen" role.
drop policy if exists "orders_update_anyone" on public.orders;
create policy "orders_update_anyone" on public.orders for update using (true) with check (true);

-- ─────────────── Realtime publication ───────────────
-- Supabase's default 'supabase_realtime' publication should already exist.
-- We add our tables to it so the kitchen + customer pages get live updates.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table public.orders';
    execute 'alter publication supabase_realtime add table public.order_items';
  end if;
exception when duplicate_object then
  null;  -- already in publication, ignore
end$$;
