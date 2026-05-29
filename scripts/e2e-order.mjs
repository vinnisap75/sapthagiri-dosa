// One-off E2E probe against the REAL Supabase (customer write/read path).
// Places a Saturday-buffet TEST order (is_test=true → excluded from analytics,
// hidden on the kitchen board by default), then reads it back through the same
// public RPCs the customer status page uses. Run: node scripts/e2e-order.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const items = [
  { menu_item_id: "masala-dosa",        name: "Masala Dosa",        quantity: 2, unit_price_cents: 899,  cook_minutes: 6, category: "dosa" },
  { menu_item_id: "sada-dosa",          name: "Sada Dosa",          quantity: 1, unit_price_cents: 799,  cook_minutes: 6, category: "dosa" },
  { menu_item_id: "mysore-masala-dosa", name: "Mysore Masala Dosa", quantity: 1, unit_price_cents: 1299, cook_minutes: 6, category: "dosa" },
];
const total = items.reduce((s, i) => s + i.unit_price_cents * i.quantity, 0);

const ok = (m) => console.log("  ✓ " + m);
const bad = (m) => console.log("  ✗ " + m);

const order = await (async () => {
  console.log("① PLACE ORDER (customer path, is_test=true) …");
  const { data, error } = await sb.from("orders").insert({
    table_id: "A1", customer_name: "E2E Buffet Test",
    notes: "automated end-to-end test — Saturday buffet", party_size: 2,
    total_cents: total, is_test: true,
  }).select().single();
  if (error) { bad("order insert: " + error.message); process.exit(1); }
  ok(`order ${data.id} | status=${data.status} | is_test=${data.is_test}`);
  const { error: ie } = await sb.from("order_items").insert(items.map((i) => ({ ...i, order_id: data.id })));
  if (ie) { bad("items insert: " + ie.message); process.exit(1); }
  ok(`${items.length} items inserted, total $${(total / 100).toFixed(2)}`);
  return data;
})();

console.log("② READ BACK via public RPCs …");
const { data: st, error: se } = await sb.rpc("get_order_status", { p_id: order.id });
se ? bad("get_order_status: " + se.message) : ok(`get_order_status → status=${st?.[0]?.status}, table=${st?.[0]?.table_id}`);
const { data: it, error: ite } = await sb.rpc("get_order_items", { p_order_id: order.id });
ite ? bad("get_order_items: " + ite.message) : ok(`get_order_items → ${it?.map((x) => x.quantity + "×" + x.name).join(", ")}`);
const { data: q, error: qe } = await sb.rpc("get_active_queue");
qe ? bad("get_active_queue: " + qe.message) : ok(`get_active_queue → ${q?.length} active order(s); ours present: ${q?.some((x) => x.id === order.id)}`);

console.log("③ SECURITY — anon must NOT advance status or read table …");
const { error: ue } = await sb.from("orders").update({ status: "cooking" }).eq("id", order.id);
ue ? ok("status update correctly blocked for anon") : bad("anon was able to change status!");
const { data: rows } = await sb.from("orders").select("id").limit(1);
(!rows || rows.length === 0) ? ok("direct table read returns nothing for anon (RLS enforced)") : bad("anon read the orders table!");

console.log("\nORDER_ID=" + order.id);
