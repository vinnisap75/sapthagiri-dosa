// Sapthagiri menu — taken from the printed menu, with these exclusions:
// rava dosas, pav bhaji dosa, pesarattu upma, upma, chole bhatura.
// Cook times in MINUTES are used to estimate kitchen wait time.

export type MenuCategory = "dosa" | "uttapam";

export interface MenuItem {
  id: string;            // stable slug used as PK in Supabase order_items.menu_item_id
  no: number | null;     // printed menu number (null for items we added like uttapams)
  name: string;
  description: string;
  price: number;         // USD
  cookMinutes: number;   // single-item cook time on a free slot
  category: MenuCategory;
  vegOption?: "V" | "V*" | null;
  /** Has a masala (mashed-potato) filling that can be swapped to Jain-style
   *  no-onion-no-garlic on customer request. */
  hasMasalaFilling?: boolean;
  /** Build-your-own — customer picks toppings from ADDONS list. */
  isCustomizable?: boolean;
}

export interface AddonDef {
  id: string;
  label: string;
  /** Which categories of items can take this addon. */
  availableFor: ("dosa" | "uttapam")[];
  /** Optional extra time added when this addon is selected (minutes). */
  extraMinutes?: number;
  /** Internal pricing (never shown to customer). */
  extraPrice?: number;
}

/** Full canonical list. Uttapam-only toppings exclude mysore chutney, cheese,
 *  and aloo masala per the kitchen — they don't pair with the thicker batter. */
export const ADDONS: AddonDef[] = [
  { id: "paneer",         label: "Paneer",         availableFor: ["dosa"],            extraMinutes: 0.5, extraPrice: 2.00 },
  { id: "onion",          label: "Onion",          availableFor: ["dosa", "uttapam"], extraMinutes: 0,   extraPrice: 0.50 },
  { id: "aloo-masala",    label: "Masala (Aloo)",  availableFor: ["dosa"],            extraMinutes: 0,   extraPrice: 1.00 },
  { id: "mysore-chutney", label: "Mysore chutney", availableFor: ["dosa"],            extraMinutes: 0,   extraPrice: 1.50 },
  { id: "chilli",         label: "Chilli",         availableFor: ["dosa", "uttapam"], extraMinutes: 0,   extraPrice: 1.00 },
  { id: "tomato",         label: "Tomato",         availableFor: ["dosa", "uttapam"], extraMinutes: 0,   extraPrice: 0.50 },
  { id: "cheese",         label: "Cheese",         availableFor: ["dosa"],            extraMinutes: 0,   extraPrice: 1.50 },
  { id: "cilantro",       label: "Cilantro",       availableFor: ["dosa", "uttapam"], extraMinutes: 0,   extraPrice: 0.25 },
  { id: "podi",           label: "Podi",           availableFor: ["dosa"],            extraMinutes: 0,   extraPrice: 0.50 },
];

export const ADDONS_BY_ID: Record<string, AddonDef> = Object.fromEntries(
  ADDONS.map((a) => [a.id, a])
);

/** Filter the global addon list down to what makes sense for the given category. */
export function addonsForCategory(cat: MenuCategory): AddonDef[] {
  return ADDONS.filter((a) => a.availableFor.includes(cat));
}

// Average cook times:
//   dosa: 5–7 min  → 6 min
//   uttapam: 8–9 min → 8.5 min
const DOSA_COOK = 6;
const UTTAPAM_COOK = 8.5;

export const MENU: MenuItem[] = [
  // ───── DOSA (served with sambar and chutney) ─────
  { id: "sada-dosa",                no: 46, name: "Sada Dosa",                 description: "Thin rice crepe.",                                                       price: 7.99,  cookMinutes: DOSA_COOK, category: "dosa", vegOption: "V" },
  { id: "butter-sada-dosa",         no: 47, name: "Butter Sada Dosa",          description: "Thin crepe roasted with butter.",                                        price: 8.99,  cookMinutes: DOSA_COOK, category: "dosa" },
  { id: "masala-dosa",              no: 48, name: "Masala Dosa",               description: "Thin crepe filled with mashed potato, onion, green peas.",               price: 8.99,  cookMinutes: DOSA_COOK, category: "dosa", hasMasalaFilling: true },
  { id: "butter-masala-dosa",       no: 49, name: "Butter Masala Dosa",        description: "Thin crepe roasted with butter, filled with mashed potato.",             price: 9.99,  cookMinutes: DOSA_COOK, category: "dosa", hasMasalaFilling: true },
  { id: "paper-dosa",               no: 50, name: "Paper Dosa",                description: "Thin long crispy crepe.",                                                price: 12.99, cookMinutes: DOSA_COOK, category: "dosa" },
  { id: "paper-masala-dosa",        no: 51, name: "Paper Masala Dosa",         description: "Long crepe served with mashed potato, onion, green peas.",               price: 13.99, cookMinutes: DOSA_COOK, category: "dosa", hasMasalaFilling: true },
  { id: "butter-paper-masala-dosa", no: 52, name: "Butter Paper Masala Dosa",  description: "Long buttered crepe with mashed potato, onion, green peas.",             price: 13.99, cookMinutes: DOSA_COOK, category: "dosa", hasMasalaFilling: true },
  { id: "onion-dosa",               no: 53, name: "Onion Dosa",                description: "Crepe filled with onions.",                                              price: 9.99,  cookMinutes: DOSA_COOK, category: "dosa", vegOption: "V" },
  { id: "onion-masala-dosa",        no: 54, name: "Onion Masala Dosa",         description: "Thin crepe sprinkled with onion, filled with mashed potato.",            price: 10.99, cookMinutes: DOSA_COOK, category: "dosa", hasMasalaFilling: true },
  { id: "onion-chilly-masala-dosa", no: 55, name: "Onion Chilly Masala Dosa",  description: "Onion + chilly + mashed potato filling.",                                price: 10.99, cookMinutes: DOSA_COOK, category: "dosa", hasMasalaFilling: true },
  { id: "mysore-sada-dosa",         no: 56, name: "Mysore Sada Dosa",          description: "Rice crepe spread with spicy homemade sauce.",                           price: 11.99, cookMinutes: DOSA_COOK, category: "dosa", vegOption: "V" },
  { id: "mysore-masala-dosa",       no: 57, name: "Mysore Masala Dosa",        description: "Spicy sauce crepe filled with mashed potato + onion + green peas.",     price: 12.99, cookMinutes: DOSA_COOK, category: "dosa", hasMasalaFilling: true },
  { id: "banglore-masala-dosa",     no: 58, name: "Banglore Masala Dosa",      description: "Thick crepe spread with homemade sauce, mashed potato, onion, peas.",   price: 13.99, cookMinutes: DOSA_COOK, category: "dosa", hasMasalaFilling: true },
  { id: "pondi-cherry-masala-dosa", no: 59, name: "Pondi Cherry Masala Dosa",  description: "Thick crepe with homemade sauce sprinkled with onion, chilly, cilantro.", price: 13.99, cookMinutes: DOSA_COOK, category: "dosa", hasMasalaFilling: true },
  { id: "podi-dosa",                no: 60, name: "Podi Dosa",                 description: "Crepe sprinkled with homemade spicy powder and glazed with butter.",    price: 9.99,  cookMinutes: DOSA_COOK, category: "dosa", vegOption: "V" },
  { id: "ghee-roast-dosa",          no: null, name: "Ghee Roast Dosa",         description: "Thin crispy crepe roasted in Amul ghee.",                                price: 11.99, cookMinutes: DOSA_COOK, category: "dosa", vegOption: "V" },
  { id: "ghee-podi-dosa",           no: null, name: "Ghee Podi Dosa",          description: "Crepe glazed with homemade spicy podi powder and roasted in ghee.",      price: 10.99, cookMinutes: DOSA_COOK, category: "dosa", vegOption: "V" },
  { id: "paneer-masala-dosa",       no: 68, name: "Paneer Masala Dosa",        description: "Crepe sprinkled with grated cottage cheese.",                            price: 12.99, cookMinutes: DOSA_COOK, category: "dosa", hasMasalaFilling: true },
  { id: "paneer-mysore-masala-dosa",no: 69, name: "Paneer Mysore Masala Dosa", description: "Spicy sauce crepe with cottage cheese, mashed potato, peas.",            price: 13.99, cookMinutes: DOSA_COOK, category: "dosa", hasMasalaFilling: true },
  { id: "cheese-masala-dosa",       no: 70, name: "Cheese Masala Dosa",        description: "Crepe sprinkled with mozzarella cheese.",                                price: 11.99, cookMinutes: DOSA_COOK, category: "dosa", hasMasalaFilling: true },
  { id: "spring-dosa",              no: 71, name: "Spring Dosa",               description: "Crepe filled with mashed potato and freshly grated vegetables, rolled and cut.", price: 13.99, cookMinutes: DOSA_COOK, category: "dosa", hasMasalaFilling: true },

  // ───── BUILD YOUR OWN ─────
  { id: "custom-dosa",              no: null, name: "Build Your Own Dosa",     description: "Pick your toppings — paneer, onion, masala, mysore chutney, chilli, tomato, cheese, cilantro, podi, or any combination.", price: 9.99, cookMinutes: DOSA_COOK, category: "dosa", vegOption: "V", isCustomizable: true },

  // ───── UTTAPAM ─────
  { id: "plain-uttapam",            no: null, name: "Plain Uttapam",           description: "Thick rice & lentil pancake.",                                           price: 9.99,  cookMinutes: UTTAPAM_COOK, category: "uttapam", vegOption: "V" },
  { id: "onion-chilli-uttapam",     no: null, name: "Onion Chilli Uttapam",    description: "Uttapam topped with onion and green chilli.",                            price: 10.99, cookMinutes: UTTAPAM_COOK, category: "uttapam", vegOption: "V" },
  { id: "onion-peas-uttapam",       no: null, name: "Onion Peas Uttapam",      description: "Uttapam topped with onion and green peas.",                              price: 10.99, cookMinutes: UTTAPAM_COOK, category: "uttapam", vegOption: "V" },
  { id: "tomato-peas-uttapam",      no: null, name: "Tomato Peas Uttapam",     description: "Uttapam topped with tomato and green peas.",                             price: 10.99, cookMinutes: UTTAPAM_COOK, category: "uttapam", vegOption: "V" },
  { id: "vegetable-uttapam",        no: null, name: "Vegetable Uttapam",       description: "Uttapam topped with mixed vegetables.",                                  price: 11.99, cookMinutes: UTTAPAM_COOK, category: "uttapam", vegOption: "V" },
  { id: "coconut-uttapam",          no: null, name: "Coconut Uttapam",         description: "Uttapam topped with fresh grated coconut.",                              price: 10.99, cookMinutes: UTTAPAM_COOK, category: "uttapam", vegOption: "V" },

  // ───── BUILD YOUR OWN UTTAPAM ─────
  { id: "custom-uttapam",           no: null, name: "Build Your Own Uttapam",  description: "Pick your toppings — onion, chilli, tomato, cilantro, or any combination.", price: 11.99, cookMinutes: UTTAPAM_COOK, category: "uttapam", vegOption: "V", isCustomizable: true },
];

export const MENU_BY_ID: Record<string, MenuItem> = Object.fromEntries(
  MENU.map((item) => [item.id, item])
);

export function getItem(id: string): MenuItem | undefined {
  return MENU_BY_ID[id];
}
