/**
 * Grand inventory - demo data generator.
 *
 * Reads items.csv, emits seed.sql: master data plus 60 business days of
 * movements for the Gastrobar, with deliberately planted anomalies so the
 * variance reports have something real to detect.
 *
 *   node --experimental-strip-types seed/generate.ts > seed.sql
 *
 * Every row carries is_demo = true. To go live:
 *   delete from stock_ledger where is_demo;  -- see reset.sql
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DAYS = 60;

// Every demo user's PIN is 1234. A fixed salt keeps the generator deterministic
// -- bcrypt salts randomly by default, which would change seed.sql on every run
// and break the stable-screenshot guarantee. Demo data only; real PINs are set
// through the API with a random salt.
const DEMO_PIN = "1234";
const DEMO_PIN_HASH = bcrypt.hashSync(DEMO_PIN, "$2a$10$TheGrandDemoSalt123456");

// deterministic PRNG so every run produces identical data
let seed = 20260810;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const between = (a: number, b: number) => a + rnd() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

const q = (s: unknown) =>
  s === null || s === undefined || s === "" ? "null" : `'${String(s).replace(/'/g, "''")}'`;

type Item = {
  id: number; code: string; name: string; category: string; storage: string;
  stock_unit: string; pack_name: string; pack_qty: number; par: number;
  reorder: number; shelf: string; critical: boolean; cost: number;
};

// ---------------------------------------------------------------------------
// item master
// ---------------------------------------------------------------------------

const rows = readFileSync(join(HERE, "items.csv"), "utf8").trim().split("\n").slice(1);

// rough LKR cost per stock unit, by category - enough to make values realistic
const COST: Record<string, [number, number]> = {
  "Dry goods": [0.3, 3.5], Dairy: [0.6, 4], Meat: [1.4, 4.5], Seafood: [1.8, 6],
  Vegetables: [0.2, 1.2], Fruit: [0.4, 2.5], Beverages: [110, 190],
  "Bar spirits": [4, 12], "Bar beer": [380, 520], "Bar wine": [3, 8],
  Packaging: [4, 30], Cleaning: [0.6, 3], Gas: [4600, 4900],
};

const items: Item[] = rows.map((line, i) => {
  const c = line.split(",");
  const [lo, hi] = COST[c[2]] ?? [1, 3];
  return {
    id: i + 1, code: c[0], name: c[1], category: c[2], storage: c[3],
    stock_unit: c[4], pack_name: c[5], pack_qty: +c[6], par: +c[7],
    reorder: +c[8], shelf: c[9], critical: c[10] === "TRUE",
    cost: +between(lo, hi).toFixed(3),
  };
});

const byCode = new Map(items.map((i) => [i.code, i]));
const catItems = (cat: string) => items.filter((i) => i.category === cat);

// ---------------------------------------------------------------------------
// static master data
// ---------------------------------------------------------------------------

// One kitchen, not three rooms.
//
// The Gastrobar used to keep BAKERY and BAR as stock locations of their own.
// They are gone: everything a cook, a baker or a bar hand draws now sits in
// the KITCHEN section, which is the only kind of production room the system
// has. Ids 3 and 4 are deliberately left unused rather than renumbered -- the
// gap costs nothing and renumbering CLEAN and QUARANTINE would rewrite every
// document that names them.
//
// Section != role: a kitchen login draws from the KITCHEN section wherever
// they work.
const SECTIONS = [
  { id: 1, code: "STORE", name: "Main store", store: true },
  { id: 2, code: "KITCHEN", name: "Kitchen", store: false },
  { id: 5, code: "CLEAN", name: "Cleaning", store: false },
  // Where returned goods wait for the supplier. Nothing is ever issued out of
  // it -- requests come from the section marked `store` -- so faulty stock
  // cannot find its way back onto a shelf somebody asks from.
  { id: 6, code: "QUARANTINE", name: "Quarantine", store: false },
];

// Branches 2-5. Each gets a store, a kitchen and a cleaning section so the
// request flow works there on day one.
const OTHER_BRANCH_SECTIONS = [
  { code: "STORE", name: "Main store", store: true },
  { code: "KITCHEN", name: "Kitchen", store: false },
  { code: "CLEAN", name: "Cleaning", store: false },
  { code: "QUARANTINE", name: "Quarantine", store: false },
];

// Five roles. Ids are deliberately unchanged from the eight-role version: the
// 60 days of generated movements reference these numbers throughout, and
// renumbering to make the list read nicely would rewrite every document's
// author for no gain.
//
// Three kitchen logins at the Gastrobar - the old chef, baker and bar hands,
// all now working the one kitchen - which is the "a section can have more than
// one login" case working.
const USERS = [
  { id: 1, name: "Owner", role: "management", loc: "null" },
  { id: 2, name: "Nuwan Perera", role: "management", loc: "1" },
  { id: 3, name: "Sunil Fernando", role: "storekeeper", loc: "1" },
  { id: 4, name: "Chaminda Silva", role: "kitchen", loc: "1" },
  { id: 5, name: "Ruwan Dias", role: "kitchen", loc: "1" },
  { id: 6, name: "Tharindu Jay", role: "kitchen", loc: "1" },
  { id: 7, name: "Malani Kumari", role: "cleaning", loc: "1" },
  { id: 8, name: "System Admin", role: "admin", loc: "null" },
];

// Every supplier invoices. The fish market and the vegetable pola used to be
// cash buys settled on the spot, which is what the market-purchase document
// existed for; they now deliver against an invoice like everyone else, so
// seafood and vegetables still restock and anomalies D and E still have stock
// to work on.
const SUPPLIERS = [
  { id: 1, name: "Ceylon Provisions (Pvt) Ltd" },
  { id: 2, name: "Negombo Fish Supply" },
  { id: 3, name: "Kochchikade Vegetable Traders" },
  { id: 4, name: "Lanka Dairy Distributors" },
  { id: 5, name: "Prime Meats Negombo" },
  { id: 6, name: "Island Beverages Agency" },
  { id: 7, name: "Colombo Bar Supplies" },
  { id: 8, name: "CleanPro Chemicals" },
];

// What the kitchen declares it made each day - the Phase 2 depletion driver.
//
// `baked` is what the old BAKERY section used to mean: cakes and buns come off
// in tens, a la carte plates in dozens. The distinction is real and belongs to
// the product, so it survived the room being merged into the kitchen; the
// section does not decide how many of something gets made.
const PRODUCTS = [
  { id: 1, code: "CAKE-CHOC", name: "Chocolate fudge cake", sec: 2, baked: true, yield: 1,
    recipe: [["DRY-004", 450], ["DRY-005", 400], ["DAI-003", 250], ["DAI-008", 4],
             ["DRY-013", 90], ["DRY-014", 200], ["DAI-002", 200]] },
  { id: 2, code: "CAKE-BLUE", name: "Blueberry cake", sec: 2, baked: true, yield: 1,
    recipe: [["DRY-004", 420], ["DRY-005", 350], ["DAI-003", 220], ["DAI-008", 4],
             ["FRU-005", 250], ["DAI-002", 150]] },
  { id: 3, code: "BUN-FISH", name: "Fish bun", sec: 2, baked: true, yield: 20,
    recipe: [["DRY-004", 1200], ["DRY-015", 20], ["SEA-004", 600], ["VEG-001", 300],
             ["DRY-021", 80], ["DRY-018", 20]] },
  { id: 4, code: "PUFF-CHIC", name: "Chicken puff", sec: 2, baked: true, yield: 20,
    recipe: [["DRY-003", 1000], ["DAI-003", 400], ["MEA-002", 700], ["VEG-001", 250],
             ["DRY-017", 25]] },
  { id: 5, code: "SAND-CLUB", name: "Club sandwich", sec: 2, baked: false, yield: 1,
    recipe: [["DRY-004", 120], ["MEA-001", 120], ["MEA-007", 40], ["DAI-004", 30],
             ["VEG-009", 40], ["VEG-005", 50], ["DAI-008", 1]] },
  { id: 6, code: "PASTA-VEG", name: "Vegetable pasta", sec: 2, baked: false, yield: 1,
    recipe: [["DRY-009", 120], ["DAI-002", 80], ["VEG-005", 100], ["VEG-007", 60],
             ["DAI-004", 40], ["DRY-023", 20]] },
  // DRY-022 (sunflower oil) is the kitchen's bulk frying oil. It must appear in
  // a recipe or it is never issued, never falls below its reorder point, and is
  // therefore never purchased -- which would leave anomaly C (the day-35 price
  // rise) with no GRN to hide in and nothing for the report to detect.
  { id: 7, code: "RICE-SEAF", name: "Seafood fried rice", sec: 2, baked: false, yield: 1,
    recipe: [["DRY-001", 200], ["SEA-001", 90], ["SEA-002", 60], ["DAI-008", 1],
             ["VEG-006", 50], ["DRY-021", 30], ["DRY-022", 30]] },
  { id: 8, code: "CURRY-CHIC", name: "Chicken curry", sec: 2, baked: false, yield: 1,
    recipe: [["MEA-003", 250], ["VEG-001", 80], ["DRY-017", 15], ["DRY-021", 25],
             ["VEG-012", 5], ["DRY-022", 25]] },
];

// ---------------------------------------------------------------------------
// emit master data
// ---------------------------------------------------------------------------

const out: string[] = [];
const w = (s: string) => out.push(s);

w("begin;");
// All five branches are active. The Coffee Lounge runs 04:00-04:00 because it
// is a 24-hour site, so "today" there is not "today" anywhere else.
w(`insert into locations (id,code,name,day_start,is_active,is_demo) values
  (1,'GB','The Grand Gastrobar','06:00',true,true),
  (2,'ESP','Grand Espresso Bar','06:00',true,true),
  (3,'TCL','The Grand Coffee Lounge','04:00',true,true),
  (4,'KAT','The Grand Cafe Katuneriya','06:00',true,true),
  (5,'BANQ','Banquet hall','06:00',true,true);`);

// `kind` decides who may work in a section and `code` is only the label, so a
// branch can hold two kitchens. Every seeded section is one of a kind, so the
// two are the same string here -- which is also what migration 0005 backfilled
// for the sections that already existed.
w("insert into sections (id,location_id,code,name,kind,is_store,is_demo) values");
{
  const rows = SECTIONS.map(
    (s) => `  (${s.id},1,${q(s.code)},${q(s.name)},${q(s.code)},${s.store},true)`);
  // Branches 2-5 get their three sections too, so a kitchen login at the
  // Coffee Lounge has somewhere to draw stock from on day one.
  // Continue past the highest id the Gastrobar used, not past the count of
  // them: the pilot branch leaves 3 and 4 free where BAKERY and BAR used to
  // be, and counting rows instead of reading ids would hand those numbers out
  // twice.
  let sid = Math.max(...SECTIONS.map((s) => s.id));
  for (let loc = 2; loc <= 5; loc++) {
    for (const s of OTHER_BRANCH_SECTIONS) {
      rows.push(
        `  (${++sid},${loc},${q(s.code)},${q(s.name)},${q(s.code)},${s.store},true)`);
    }
  }
  w(rows.join(",\n") + ";");
}

w("insert into users (id,location_id,name,role,pin_hash,is_demo) values");
w(USERS.map((u) => `  (${u.id},${u.loc},${q(u.name)},'${u.role}',${q(DEMO_PIN_HASH)},true)`).join(",\n") + ";");

w("insert into suppliers (id,name,is_demo) values");
w(SUPPLIERS.map((s) => `  (${s.id},${q(s.name)},true)`).join(",\n") + ";");

// item_categories and reason_codes are reference data, not demo data: they have
// no is_demo column and reset.sql rightly leaves them alone. The seed therefore
// has to tolerate finding them already there, or a reset -> re-seed cycle dies
// on a duplicate key.
const cats = [...new Set(items.map((i) => i.category))];
w("insert into item_categories (id,name,storage) values");
w(cats.map((c, i) =>
  `  (${i + 1},${q(c)},'${items.find((x) => x.category === c)!.storage}')`).join(",\n") +
  "\non conflict (id) do nothing;");

w("insert into items (id,code,name,category_id,stock_unit,par_level,reorder_point,shelf_life_days,is_critical,is_demo) values");
w(items.map((i) =>
  `  (${i.id},${q(i.code)},${q(i.name)},${cats.indexOf(i.category) + 1},${q(i.stock_unit)},` +
  `${i.par},${i.reorder},${i.shelf || "null"},${i.critical},true)`).join(",\n") + ";");

w("insert into item_packs (id,item_id,pack_name,qty_in_stock_unit,is_default_purchase,is_demo) values");
w(items.map((i) =>
  `  (${i.id},${i.id},${q(i.pack_name)},${i.pack_qty},true,true)`).join(",\n") + ";");

w("insert into products (id,location_id,code,name,section_id,yield_qty,is_demo) values");
w(PRODUCTS.map((p) =>
  `  (${p.id},1,${q(p.code)},${q(p.name)},${p.sec},${p.yield},true)`).join(",\n") + ";");

let rlId = 0;
w("insert into recipe_lines (id,product_id,item_id,qty_base,is_demo) values");
w(PRODUCTS.flatMap((p) => p.recipe.map(([code, qty]) =>
  `  (${++rlId},${p.id},${byCode.get(code as string)!.id},${qty},true)`)).join(",\n") + ";");

// ---------------------------------------------------------------------------
// movement generation
// ---------------------------------------------------------------------------

type Led = { date: string; sec: number; item: number; qty: number; cost: number;
             doc: string; docId: number; reason: string | null; by: number };
const ledger: Led[] = [];
const stock = new Map<string, number>();          // `${sec}:${item}` -> ledger qty
const phantom = new Map<string, number>();        // unexplained physical loss
const key = (s: number, i: number) => `${s}:${i}`;
const get = (s: number, i: number) => stock.get(key(s, i)) ?? 0;

const move = (d: string, sec: number, it: Item, qty: number, doc: string,
              docId: number, by: number, reason: string | null = null) => {
  stock.set(key(sec, it.id), get(sec, it.id) + qty);
  ledger.push({ date: d, sec, item: it.id, qty, cost: it.cost, doc, docId, reason, by });
};

const dates: string[] = [];
const start = new Date("2026-06-10T00:00:00Z");
for (let d = 0; d < DAYS; d++)
  dates.push(new Date(start.getTime() + d * 864e5).toISOString().slice(0, 10));

// opening balance: store starts at par; the kitchen's drinks shelf also holds
// working stock, otherwise there is nothing to count there and shrinkage would
// be invisible.
for (const it of items) move(dates[0], 1, it, it.par, "opening", 0, 3);
for (const it of items.filter((i) => i.category.startsWith("Bar")))
  move(dates[0], 2, it, Math.round(it.par * 0.4), "opening", 0, 6);

const grn: string[] = [], grnL: string[] = [];
// Returns. Deliberately built from fixed days and fixed fractions rather than
// the PRNG: any random draw here would shift the whole downstream sequence and
// move the five planted anomalies with it.
const secRet: string[] = [], supRet: string[] = [], supRetL: string[] = [];
let secRetId = 0, supRetId = 0, supRetLineId = 0;
/** The most recent delivery line per item, so a return can point at one. */
const lastGrnLine = new Map<number, { grnId: number; supplierId: number; lineId: number; packPrice: number }>();
/**
 * The most recent release per section and item, so a return can point at one.
 *
 * A section return is measured against the release that delivered the goods, so
 * demo returns have to name one -- otherwise the seed describes a document the
 * application itself would refuse to create.
 */
const lastIssue = new Map<string, { issId: number; qty: number }>();
const iss: string[] = [], issL: string[] = [], wst: string[] = [];
const cnt: string[] = [], cntL: string[] = [], prod: string[] = [];
let grnId = 0, issId = 0, wstId = 0, cntId = 0, prodId = 0, lineId = 0;

// A5: supplier price history. Without this table populated, the price-movement
// report has to reverse-engineer history out of grn_lines. A row is written the
// first time a supplier quotes a pack and every time that price then changes --
// which is exactly what makes anomaly C (oil +32% on day 35) a first-class row.
const supPrice: string[] = [];
const lastPrice = new Map<string, number>();
let supPriceId = 0;
const recordPrice = (sup: number, packId: number, price: number, date: string) => {
  const k = `${sup}:${packId}`;
  if (lastPrice.get(k) === price) return;
  lastPrice.set(k, price);
  supPrice.push(`  (${++supPriceId},${sup},${packId},${price.toFixed(2)},'${date}',true)`);
};

// ---- planted anomalies -----------------------------------------------------
// A. chicken breast over-issued by ~18% from day 20  -> negative count variance
// B. two gin bottles vanish (day 28, day 44)         -> shrinkage, no wastage doc
// C. sunflower oil price +32% on day 35              -> price-increase alert
// D. lettuce spoilage spike in week 6                -> genuine waste, not theft
// E. prawns hit zero on day 41                       -> stock-out alert
// ---------------------------------------------------------------------------

for (let d = 0; d < DAYS; d++) {
  const date = dates[d];
  const dow = new Date(date).getUTCDay();
  const busy = dow === 0 || dow === 5 || dow === 6 ? 1.45 : 1;

  // --- C: price change
  if (d === 35) byCode.get("DRY-022")!.cost *= 1.32;

  // --- deliveries: restock anything below reorder point
  const low = items.filter((i) => get(1, i.id) < i.reorder);
  const bySupplier = new Map<number, Item[]>();
  for (const it of low) {
    const s = it.category === "Dairy" ? 4 : it.category === "Meat" ? 5
      : it.category === "Seafood" ? 2 : it.category === "Vegetables" ? 3
      : it.category === "Fruit" ? 3 : it.category === "Beverages" ? 6
      : it.category.startsWith("Bar") ? 7 : it.category === "Cleaning" ? 8 : 1;
    (bySupplier.get(s) ?? bySupplier.set(s, []).get(s)!).push(it);
  }
  for (const [sup, list] of bySupplier) {
    grnId++;
    grn.push(`  (${grnId},1,${sup},'INV-${1000 + grnId}','${date}','${date} 08:00+05:30',3,true)`);
    for (const it of list) {
      const packs = Math.ceil((it.par - get(1, it.id)) / it.pack_qty);
      const packPrice = it.pack_qty * it.cost;
      grnL.push(`  (${++lineId},${grnId},${it.id},${packs},${packPrice.toFixed(2)},true)`);
      lastGrnLine.set(it.id, { grnId, supplierId: sup, lineId, packPrice });
      recordPrice(sup, it.id, packPrice, date);
      move(date, 1, it, packs * it.pack_qty, "grn", grnId, 3);
    }
  }

  // --- production declared by the kitchen
  const madeToday = new Map<number, number>();
  for (const p of PRODUCTS) {
    const base = p.baked ? between(6, 14) : between(18, 40);
    const made = Math.round(base * busy);
    madeToday.set(p.id, made);
    // Ruwan still logs the baking and Chaminda the plates. Both are kitchen
    // logins standing in the same room; who declared it is a person, not a
    // section.
    prod.push(`  (${++prodId},1,${p.sec},'${date}',${p.id},${made},${p.baked ? 5 : 4},true)`);
  }

  // --- issues from store to sections, driven by production + a fudge factor
  const need = new Map<number, { it: Item; qty: number; sec: number }>();
  for (const p of PRODUCTS) {
    const made = madeToday.get(p.id)!;
    for (const [code, qty] of p.recipe) {
      const it = byCode.get(code as string)!;
      let q2 = ((qty as number) * made) / p.yield;
      q2 *= between(1.02, 1.09);                               // normal trim loss
      if (code === "MEA-001" && d >= 20) q2 *= 1.18;           // A: over-issue
      const k = p.sec * 1e6 + it.id;
      const cur = need.get(k);
      if (cur) cur.qty += q2; else need.set(k, { it, qty: q2, sec: p.sec });
    }
  }
  const grouped = new Map<number, { it: Item; qty: number }[]>();
  for (const n of need.values())
    (grouped.get(n.sec) ?? grouped.set(n.sec, []).get(n.sec)!).push({ it: n.it, qty: n.qty });

  for (const [sec, lines] of grouped) {
    issId++;
    const asker = 4;
    iss.push(`  (${issId},1,${sec},${asker},3,'${date} 06:30+05:30','${date} 06:45+05:30','received',${asker},'${date} 07:00+05:30',true)`);
    for (const l of lines) {
      const qty = Math.min(Math.round(l.qty), get(1, l.it.id));
      if (qty <= 0) continue;
      issL.push(`  (${++lineId},${issId},${l.it.id},${qty},${qty},true)`);
      lastIssue.set(`${sec}:${l.it.id}`, { issId, qty });
      move(date, 1, l.it, -qty, "issue", issId, 3);
      move(date, sec, l.it, qty, "issue", issId, 3);
      move(date, sec, l.it, -Math.round(qty * between(0.9, 0.99)), "production", prodId, 4);
    }
  }

  // --- drinks drawn by the kitchen
  //
  // Tharindu works the drinks shelf. It is a shelf in the kitchen now rather
  // than a room of its own, so the stock moves store -> kitchen like any other
  // issue; what makes spirits special is that they are countable by the
  // bottle, which is the whole reason anomaly B is detectable at all.
  for (const it of catItems("Bar spirits").concat(catItems("Bar beer"), catItems("Bar wine"))) {
    const used = Math.round(between(0.04, 0.11) * it.par * busy);
    if (get(1, it.id) >= used) {
      issId++;
      iss.push(`  (${issId},1,2,6,3,'${date} 16:00+05:30','${date} 16:10+05:30','received',6,'${date} 16:20+05:30',true)`);
      issL.push(`  (${++lineId},${issId},${it.id},${used},${used},true)`);
      lastIssue.set(`2:${it.id}`, { issId, qty: used });
      move(date, 1, it, -used, "issue", issId, 3);
      move(date, 2, it, used, "issue", issId, 6);
      move(date, 2, it, -used, "production", 0, 6);
    }
  }
  // B: gin shrinkage - physical stock leaves the drinks shelf with no document
  // at all. The ledger still believes it is there; only the count reveals the
  // gap, and only at the next weekly count, which is days later.
  if (d === 28 || d === 44) {
    const gin = byCode.get("BAR-001")!;
    phantom.set(key(2, gin.id), (phantom.get(key(2, gin.id)) ?? 0) + 750);
  }

  // --- cleaning: a weekly top-up, drawn down through the week
  //
  // This used to consume the whole top-up on the day it arrived, which left
  // the cleaning store reading exactly zero on all sixty days. A section that
  // is always empty cannot be counted, and a count that finds nothing proves
  // nothing -- which is how the cleaning role went that long without anybody
  // noticing it could not open one. It now holds a working balance like every
  // other room.
  if (dow === 1) {
    issId++;
    iss.push(`  (${issId},1,5,7,3,'${date} 09:00+05:30','${date} 09:15+05:30','received',7,'${date} 09:30+05:30',true)`);
    for (const it of catItems("Cleaning")) {
      const topUp = Math.round(between(0.12, 0.3) * it.par);
      if (topUp <= 0 || get(1, it.id) < topUp) continue;
      issL.push(`  (${++lineId},${issId},${it.id},${topUp},${topUp},true)`);
      lastIssue.set(`5:${it.id}`, { issId, qty: topUp });
      move(date, 1, it, -topUp, "issue", issId, 3);
      move(date, 5, it, topUp, "issue", issId, 7);
    }
  }
  // Daily use out of the cleaning store. Deliberately less than the weekly
  // top-up, so the shelf carries stock rather than emptying every Monday.
  for (const it of catItems("Cleaning")) {
    const used = Math.round(between(0.01, 0.025) * it.par);
    if (used <= 0 || get(5, it.id) < used) continue;
    move(date, 5, it, -used, "production", 0, 7);
  }

  // --- wastage
  const wasteCandidates = catItems("Vegetables").concat(catItems("Fruit"), catItems("Dairy"));
  const nWaste = rnd() < 0.6 ? 1 : rnd() < 0.85 ? 2 : 0;
  for (let n = 0; n < nWaste; n++) {
    const it = pick(wasteCandidates);
    const qty = Math.round(between(0.01, 0.05) * it.par);
    if (get(2, it.id) < qty || qty <= 0) continue;
    wst.push(`  (${++wstId},1,2,${it.id},${qty},'SPOIL',4,'${date} 21:00+05:30',2,true)`);
    move(date, 2, it, -qty, "wastage", wstId, 4, "SPOIL");
  }
  // D: lettuce spoilage spike, week 6
  if (d >= 38 && d <= 44) {
    const let_ = byCode.get("VEG-009")!;
    const qty = Math.round(between(0.15, 0.28) * let_.par);
    if (get(2, let_.id) >= qty) {
      wst.push(`  (${++wstId},1,2,${let_.id},${qty},'SPOIL',4,'${date} 21:00+05:30',2,true)`);
      move(date, 2, let_, -qty, "wastage", wstId, 4, "SPOIL");
    }
  }
  // E: prawns run out on day 41
  if (d === 41) {
    const pr = byCode.get("SEA-001")!;
    const left = get(1, pr.id);
    if (left > 0) {
      issId++;
      iss.push(`  (${issId},1,2,4,3,'${date} 18:00+05:30','${date} 18:05+05:30','received',4,'${date} 18:15+05:30',true)`);
      issL.push(`  (${++lineId},${issId},${pr.id},${left},${left},true)`);
      lastIssue.set(`2:${pr.id}`, { issId, qty: left });
      move(date, 1, pr, -left, "issue", issId, 3);
      move(date, 2, pr, left, "issue", issId, 4);
      move(date, 2, pr, -left, "production", 0, 4);
    }
  }

  // --- returns: kitchen hands stock back, the store sends it to the vendor
  //
  // Three stories, on fixed days, so the report has something to show and the
  // three states a supplier return can be in are all present:
  //
  //   day 12  beef below the quality agreed -> returned, credited
  //   day 26  tomatoes damaged in transit   -> returned, still waiting
  //   day 47  fish below quality            -> raised and approved, not yet gone
  //
  // No random draws in here on purpose. See the note by the accumulators.
  // Days and items chosen because the kitchen demonstrably holds them then --
  // a return of stock a section never received produces nothing, silently.
  const RETURNS: { day: number; code: string; sec: number; by: number;
                   reason: string; frac: number; note: string;
                   supplier: null | 'credited' | 'sent' | 'approved' }[] = [
    { day: 26, code: "VEG-001", sec: 2, by: 5, reason: "RET_DAMAGED", frac: 0.25,
      note: "Bottom of the sack soft and weeping", supplier: 'credited' },
    { day: 35, code: "VEG-001", sec: 2, by: 4, reason: "RET_QUALITY", frac: 0.18,
      note: "Undersized, not the grade agreed", supplier: 'sent' },
    { day: 47, code: "SEA-002", sec: 2, by: 4, reason: "RET_QUALITY", frac: 0.35,
      note: "Off smell on opening, whole box refused", supplier: 'approved' },
  ];

  for (const r of RETURNS.filter((r) => r.day === d)) {
    const it = byCode.get(r.code);
    if (!it) continue;
    // Against the release that delivered it, and never more than that release
    // put there -- the same cap the service applies.
    const source = lastIssue.get(`${r.sec}:${it.id}`);
    if (!source) continue;
    const held = get(r.sec, it.id);
    const qty = Math.min(Math.round(held * r.frac), Math.round(source.qty), held);
    if (qty <= 0) continue;

    // The section hands it back. Both legs, immediately, as the service does.
    secRetId++;
    secRet.push(
      `  (${secRetId},1,${r.sec},6,${it.id},${qty},${q(r.reason)},${q(r.note)},${source.issId},${r.by},` +
      `'${date} 15:00+05:30',2,'${date} 17:00+05:30',true)`);
    move(date, r.sec, it, -qty, "return", secRetId, r.by, r.reason);
    move(date, 6, it, qty, "return", secRetId, r.by, r.reason);

    // ...and the store sends it back to whoever delivered it.
    const src = lastGrnLine.get(it.id);
    if (!src || r.supplier === null) continue;

    const packs = Math.round((qty / it.pack_qty) * 100) / 100;
    if (packs <= 0) continue;
    const credit = packs * src.packPrice;

    supRetId++;
    const sent = r.supplier === 'credited' || r.supplier === 'sent';
    const settled = r.supplier === 'credited';
    const status = settled ? 'settled' : sent ? 'sent' : 'approved';

    supRet.push(
      `  (${supRetId},1,${src.supplierId},${src.grnId},${q(status)},` +
      `${q(r.reason)},${q(r.note)},3,'${date} 16:00+05:30',` +
      `2,'${date} 18:00+05:30',null,` +
      (sent ? `3,'${date} 18:30+05:30',` : `null,null,`) +
      (settled
        ? `'credit',${q("CN-" + (5000 + supRetId))},${credit.toFixed(2)},2,'${dates[Math.min(d + 9, DAYS - 1)]} 12:00+05:30',null,true)`
        : `null,null,null,null,null,null,true)`));

    supRetL.push(
      `  (${++supRetLineId},${supRetId},${src.lineId},${it.id},${packs},${qty},` +
      `${src.packPrice.toFixed(2)},${credit.toFixed(2)},${secRetId},true)`);

    // Stock leaves quarantine only when the goods physically go.
    if (sent) move(date, 6, it, -qty, "return", supRetId, 3, r.reason);
  }

  // --- counts: critical items daily, full store weekly (Sunday)
  const daily = items.filter((i) => i.critical);
  cntId++;
  cnt.push(`  (${cntId},1,1,'daily_critical','${date}',3,2,'${date} 22:00+05:30',true)`);
  for (const it of daily) {
    const expected = get(1, it.id);
    // small honest counting noise; shrinkage shows up as a real gap
    const counted = Math.max(0, Math.round(expected * between(0.995, 1.002)));
    const diff = counted - expected;
    cntL.push(`  (${++lineId},${cntId},${it.id},${expected.toFixed(3)},${counted},${(diff * it.cost).toFixed(2)},true)`);
    if (diff !== 0) move(date, 1, it, diff, "count", cntId, 3, "COUNTADJ");
  }
  // Sunday: the drinks shelf is counted bottle by bottle. It is a count of the
  // kitchen, because that is where the shelf is, and it covers the spirits,
  // beer and wine rather than everything the kitchen holds -- a cook does not
  // weigh every open sack on a Sunday night, and pretending otherwise would
  // fill the shrinkage report with counting noise.
  if (dow === 0) {
    cntId++;
    cnt.push(`  (${cntId},1,2,'weekly_full','${date}',6,2,'${date} 23:30+05:30',true)`);
    for (const it of catItems("Bar spirits").concat(catItems("Bar beer"), catItems("Bar wine"))) {
      const expected = get(2, it.id);
      const lost = phantom.get(key(2, it.id)) ?? 0;
      phantom.delete(key(2, it.id));
      const counted = Math.max(0, Math.round(expected - lost));
      const diff = counted - expected;
      cntL.push(`  (${++lineId},${cntId},${it.id},${expected.toFixed(3)},${counted},${(diff * it.cost).toFixed(2)},true)`);
      if (diff !== 0) move(date, 2, it, diff, "count", cntId, 6, "COUNTADJ");
    }
  }
}

// ---------------------------------------------------------------------------
// emit documents + ledger
// ---------------------------------------------------------------------------

const block = (sql: string, rows2: string[]) => { if (rows2.length) { w(sql); w(rows2.join(",\n") + ";"); } };

w(`insert into reason_codes (code,doc,label) values
  ('SPOIL','wastage','Spoiled / expired'),
  ('BURNT','wastage','Burnt or overcooked'),
  ('DROP','wastage','Dropped or damaged'),
  ('BREAK','wastage','Breakage'),
  ('RETURN','wastage','Customer returned'),
  ('COUNTADJ','count','Count adjustment')
on conflict (code) do nothing;`);

block("insert into grn (id,location_id,supplier_id,invoice_no,invoice_date,received_at,received_by,is_demo) values", grn);
block("insert into grn_lines (id,grn_id,item_pack_id,qty_packs,pack_price,is_demo) values", grnL);
block("insert into issues (id,location_id,to_section_id,requested_by,issued_by,requested_at,issued_at,status,received_by,received_at,is_demo) values", iss);
block("insert into issue_lines (id,issue_id,item_id,qty_requested,qty_issued,is_demo) values", issL);
block("insert into wastage (id,location_id,section_id,item_id,qty_base,reason_code,logged_by,logged_at,approved_by,is_demo) values", wst);
block("insert into section_returns (id,location_id,from_section_id,to_section_id,item_id,qty_base,reason_code,note,issue_id,returned_by,returned_at,approved_by,approved_at,is_demo) values", secRet);
block("insert into supplier_returns (id,location_id,supplier_id,grn_id,status,reason_code,note,raised_by,raised_at,decided_by,decided_at,decision_note,sent_by,sent_at,outcome,credit_note_no,credit_value,settled_by,settled_at,settle_note,is_demo) values", supRet);
block("insert into supplier_return_lines (id,return_id,grn_line_id,item_id,qty_packs,qty_base,pack_price,line_credit,section_return_id,is_demo) values", supRetL);
block("insert into stock_counts (id,location_id,section_id,count_type,business_date,counted_by,verified_by,closed_at,is_demo) values", cnt);
block("insert into stock_count_lines (id,count_id,item_id,qty_expected,qty_counted,variance_value,is_demo) values", cntL);
block("insert into production_log (id,location_id,section_id,business_date,product_id,qty_made,logged_by,is_demo) values", prod);
block("insert into supplier_prices (id,supplier_id,item_pack_id,price,effective_from,is_demo) values", supPrice);

w("insert into stock_ledger (business_date,location_id,section_id,item_id,qty_base,unit_cost,doc,doc_id,reason_code,created_by,is_demo) values");
w(ledger.map((l) =>
  `  ('${l.date}',1,${l.sec},${l.item},${l.qty.toFixed(3)},${l.cost},'${l.doc}',${l.docId},${l.reason ? q(l.reason) : "null"},${l.by},true)`
).join(",\n") + ";");

// A3: seed the weighted-average cost state so valuation is not zero on day one.
// The demo generator uses a flat per-item cost, so the average is that cost;
// the real receipt service recomputes it properly on every GRN.
w(`insert into item_cost_state (item_id,location_id,qty_on_hand,avg_cost)
select l.item_id, l.location_id, sum(l.qty_base), max(l.unit_cost)
from stock_ledger l
group by l.item_id, l.location_id
on conflict (item_id,location_id) do update
  set qty_on_hand = excluded.qty_on_hand, avg_cost = excluded.avg_cost;`);

// A2: every table above was inserted with explicit ids while its sequence sat
// at 1, so the first real insert after seeding would collide on the primary
// key. Advancing them is derived from the catalog rather than hand-listed, so
// a new table cannot be forgotten.
w(`do $$
declare r record;
begin
  for r in
    select seq.relname as seqname, tab.relname as tabname, col.attname as colname
    from pg_class seq
    join pg_depend d on d.objid = seq.oid
      and d.classid = 'pg_class'::regclass and d.deptype = 'a'
    join pg_class tab on tab.oid = d.refobjid
    join pg_attribute col on col.attrelid = tab.oid and col.attnum = d.refobjsubid
    join pg_namespace n on n.oid = seq.relnamespace
    where seq.relkind = 'S' and n.nspname = current_schema()
  loop
    execute format(
      'select setval(%L, coalesce((select max(%I) from %I), 0) + 1, false)',
      r.seqname, r.colname, r.tabname);
  end loop;
end $$;`);

w("commit;");

process.stdout.write(out.join("\n") + "\n");
process.stderr.write(
  `-- generated: ${items.length} items, ${ledger.length} ledger rows, ` +
  `${grnId} GRNs, ${issId} issues, ${wstId} wastage, ` +
  `${secRetId} section returns, ${supRetId} supplier returns, ` +
  `${cntId} counts, ${supPriceId} price points\n`
);
