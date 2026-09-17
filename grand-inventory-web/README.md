# The Grand - inventory console

A second front end for the same API, built for the people who run the stock
rather than for a demo. `beautech-master-web-app` is untouched and still runs on
4200; this one runs on 4300, so both can be open side by side.

```bash
cd grand-inventory-web
npm install
npm start          # http://localhost:4300, proxies /api and /uploads to :3000
```

The API must be running on 3000 (`cd api && npm run dev`).

## What is different

**It is not a template.** The first build grafted the inventory screens into a
purchased CRM shell: a tab strip, a theme configurator, a menu-accent registry,
a design-system gallery, and a `layout/` folder none of the screens used. None
of that is here. The shell is 3 files - a rail, a top bar, and a menu table.

**Administration is a place, not a leftover.** Setup was five unrelated screens
you had to already know about. They are now one group in the rail with an
overview at the top of it that answers the question the owner actually asks:
*is this ready to go live?*

**The menu is grouped by where the work happens** - Today, Floor, Store, Buying,
Control, Administration - not by feature area. A storekeeper's day runs down the
Store group; the owner's runs down Control.

## Admin overview

`/admin`, admin only. Two panels over live data, no separate readiness table to
drift out of date:

- **Before go-live** - outlets and sections, categories, the product master, a
  purchase pack on every product, suppliers, a login per person, and the
  opening balance per section. Each line says what breaks if it is skipped.
- **Needs attention** - things already set up that are wrong: products with no
  pack (cannot be ordered at all), locked-out logins, logins with no outlet,
  sections still on zero, products with no reorder point (they never reach a
  suggested order), empty categories.

Opening balances are management and storekeeper only at the API, so an admin
gets that one line marked as somebody else's and it is left out of the tally
rather than failing the page.

## Layout of the code

```
src/app/
  core/        API client, session, guards, interceptor, types   (shared with 4200)
  layout/      console.layout.ts, nav.ts, theme.store.ts         (new)
  pages/       one component per screen
  theme.ts     PrimeNG's palette, pointed at the console's own
  styles.scss  tokens, the ledger table, panels, chips, notices
```

`core/` is deliberately the same code as the first build. The request shapes,
the idempotency keys and the single-flight token refresh were already right, and
re-typing them against the same API would only invent new bugs.

## The look

The system is an append-only ledger - entries stack downward, nothing is edited,
a correction is a reversal that stays on the record. So the interface is ruled
rather than carded: hairlines, a 3px margin rule marking the open screen, the
row that needs a decision, and the notice that matters.

Archivo for labels and headings, IBM Plex Mono for every quantity, price, code
and document id, so a column of figures aligns by digit the way it would on a
counting sheet. Colour is cold store plus brass - steel greys with one accent,
used only where the eye has to go.

Light and dark both ship; the choice is remembered per device, because the
tablet by the walk-in and the office machine are read in different light by the
same person.
