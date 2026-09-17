/**
 * Drives the whole return chain against a running API and checks each step.
 *
 *   kitchen holds stock
 *     -> hands some back against the release that delivered it   (stock moves)
 *     -> storekeeper asks management: claim it, or bin it?       (no stock move)
 *     -> management answers, line by line                        (no stock move)
 *     -> storekeeper carries the answer out                      (stock moves)
 *     -> management records what the supplier allowed            (no stock move)
 *
 * The point of the script is the middle column. Two of those steps move stock
 * and the rest do not, and which ones is the thing people get wrong when they
 * describe this flow - including, at one point, the screens. So the quarantine
 * balance is read before and after every single step and compared against what
 * should have happened.
 *
 * It also checks the other half of the design: that each step refuses the
 * wrong role. A flow that works when everybody is an administrator is not the
 * flow that will be running in the store.
 *
 * Usage, with the API up on 3000 and demo data loaded:
 *
 *   node scripts/check-returns.mjs
 *   node scripts/check-returns.mjs --api http://localhost:3000 --pin 1234
 *
 * It writes real documents. Run it against demo or trial data, never against a
 * live ledger -- every row it creates is permanent, because that is the point
 * of the ledger it is checking.
 */

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const API = argOf('api', 'http://localhost:3000').replace(/\/$/, '');
const PIN = argOf('pin', '1234');
const V1 = `${API}/api/v1`;

let failures = 0;
let step = 0;

const round3 = (n) => Math.round(n * 1000) / 1000;

const money = (n) => `LKR ${Number(n).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`;

function ok(what, detail = '') {
    console.log(`  ✓ ${what}${detail ? ` — ${detail}` : ''}`);
}

function bad(what, detail = '') {
    failures++;
    console.log(`  ✗ ${what}${detail ? ` — ${detail}` : ''}`);
}

function check(condition, what, detail = '') {
    if (condition) ok(what, detail);
    else bad(what, detail);
    return condition;
}

function heading(text) {
    console.log(`\n${++step}. ${text}`);
}

/** Every call goes through here so a refusal is data rather than an exception. */
async function call(method, path, { token, locationId, body, idem } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    if (locationId) headers['x-location-id'] = String(locationId);
    if (idem) headers['idempotency-key'] = idem;

    const res = await fetch(`${V1}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await res.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { raw: text };
    }
    return { status: res.status, body: json };
}

async function signIn(role, locationId) {
    // The same unauthenticated roster the login screen reads: names and roles,
    // never a PIN hash.
    const list = await call('GET', '/auth/bootstrap');
    if (list.status !== 200) {
        throw new Error(`Cannot read the roster (${list.status}). Is the API up on ${API}?`);
    }
    const user = list.body.users.find(
        (u) => u.role === role && (u.locationId === locationId || u.locationId === null)
    );
    if (!user) throw new Error(`No active ${role} login at location ${locationId}`);

    const res = await call('POST', '/auth/login', {
        body: { userId: user.id, locationId, pin: PIN }
    });
    if (res.status !== 200) {
        throw new Error(
            `${user.name} (${role}) could not sign in with PIN ${PIN}: ${res.body?.message ?? res.status}`
        );
    }
    return {
        name: user.name,
        token: res.body.accessToken,
        locationId,
        // Sign-in already carries the sections this person may work with, so
        // there is no need for the admin-only setup endpoint to find
        // quarantine -- which is what this used to try, fail at silently, and
        // then skip every stock assertion in the file.
        sections: res.body.sections ?? []
    };
}

/** A release this section can still hand stock back against. */
async function findReturnable(who, locationId) {
    const mine = await call('GET', '/requests?status=released&limit=50', {
        token: who.token,
        locationId
    });
    return mine.body?.items?.find((r) => r.canReturn) ?? null;
}

/** Something the store has plenty of, so the release is not a short one. */
async function somethingTheStoreHas(who, locationId) {
    const sections = who.sections.filter((sec) => sec.isStore);
    if (sections.length === 0) throw new Error('This branch has no main store');

    const res = await call('GET', `/stock?sectionId=${sections[0].id}&limit=200`, {
        token: who.token,
        locationId
    });
    const row = res.body.items
        .filter((r) => r.qtyBase > 100)
        .sort((a, b) => b.qtyBase - a.qtyBase)[0];
    if (!row) throw new Error('The store holds nothing worth releasing');

    // Enough to be worth splitting three ways later, and far less than is
    // there, so the release is never short.
    return { itemId: row.itemId, name: row.name, stockUnit: row.stockUnit, qty: 90 };
}

/** One ask, read back off the list, so its line ids can be answered. */
async function findAsk(who, locationId, id) {
    const res = await call('GET', '/supplier-returns?limit=50', {
        token: who.token,
        locationId
    });
    const row = res.body?.items?.find((r) => r.id === String(id));
    if (!row) throw new Error(`Cannot find the ask ${id} that was just raised`);
    return row;
}

/** What a section holds of one item, straight off the ledger-derived view. */
async function held(who, sectionId, itemId) {
    const res = await call('GET', `/stock?sectionId=${sectionId}&limit=200`, {
        token: who.token,
        locationId: who.locationId
    });
    if (res.status !== 200) throw new Error(`Cannot read stock: ${res.status}`);
    const row = res.body.items.find((r) => r.itemId === itemId);
    return row ? Number(row.qtyBase) : 0;
}

async function main() {
    console.log(`The Grand - return chain check against ${API}\n${'='.repeat(60)}`);

    const locationId = Number(argOf('location', '1'));
    const store = await signIn('storekeeper', locationId);
    const boss = await signIn('management', locationId);
    const cook = await signIn('kitchen', locationId);
    console.log(
        `Signed in: ${store.name} (storekeeper), ${boss.name} (management), ${cook.name} (kitchen)`
    );

    const ctx = await call('GET', '/me/context', { token: cook.token, locationId });
    const kitchenId = ctx.body.homeSectionId;
    if (!kitchenId) throw new Error('The kitchen login has no section at this branch');

    const quarantine = store.sections.find((s) => s.kind === 'QUARANTINE' && s.isActive);
    if (!quarantine) {
        throw new Error(
            'This branch has no quarantine section, so nothing can be returned at all. ' +
                'An admin adds one under Branches and sections.'
        );
    }

    // ── 0. Something the kitchen actually holds ─────────────────────────────
    heading('Find stock the kitchen is holding, from a release inside the window');

    let returnable = await findReturnable(cook, locationId);

    if (!returnable) {
        // Nothing to hand back, which is the normal state of a freshly seeded
        // database: every demo release is dated inside the sixty demo days and
        // so is long past the seven-day return window. Rather than stopping
        // and telling somebody to go and do it by hand, the check does what it
        // is checking -- asks for stock and releases it -- through the same
        // two endpoints the screens use.
        ok('nothing is returnable yet', 'asking for stock and releasing it first');

        const item = await somethingTheStoreHas(store, locationId);
        const asked = await call('POST', '/requests', {
            token: cook.token,
            locationId,
            body: {
                sectionId: kitchenId,
                lines: [{ itemId: item.itemId, qtyRequested: item.qty }]
            }
        });
        if (asked.status !== 201) {
            throw new Error(`Could not raise a request: ${asked.body?.message ?? asked.status}`);
        }

        const released = await call('POST', `/requests/${asked.body.id}/release`, {
            token: store.token,
            locationId,
            idem: globalThis.crypto.randomUUID(),
            body: { lines: [] }
        });
        if (released.status !== 200) {
            throw new Error(
                `Could not release it: ${released.body?.message ?? released.status}`
            );
        }
        ok(`released ${item.name} to the kitchen`, `${item.qty} ${item.stockUnit}`);

        returnable = await findReturnable(cook, locationId);
        if (!returnable) {
            throw new Error(
                'Released stock to the kitchen and it still cannot be returned. ' +
                    'That is worth investigating - it should be returnable immediately.'
            );
        }
    }

    const detail = await call(`GET`, `/requests/${returnable.id}/returnable`, {
        token: cook.token,
        locationId
    });
    const line = detail.body.lines.find((l) => l.qtyReturnable > 0);
    if (!line) {
        console.log('  ! That release has nothing left to hand back. Try another.');
        process.exit(1);
    }

    // A third of what is returnable, so the same release stays usable.
    const qty = Math.max(1, Math.floor(line.qtyReturnable / 3));
    ok(
        `${line.name} on release ${returnable.id}`,
        `${line.qtyReturnable} ${line.stockUnit} returnable, handing back ${qty}`
    );

    const kitchenBefore = await held(store, kitchenId, line.itemId);
    const quarantineBefore = await held(store, quarantine.id, line.itemId);

    // ── 1. The section hands it back ────────────────────────────────────────
    heading('Kitchen hands it back against that release');

    const byBoss = await call('POST', '/returns', {
        token: boss.token,
        locationId,
        body: {
            sectionId: kitchenId,
            itemId: line.itemId,
            qtyBase: qty,
            reasonCode: 'RET_QUALITY',
            issueId: returnable.id
        }
    });
    check(
        byBoss.status === 403,
        'management cannot hand stock back for a section',
        `got ${byBoss.status}`
    );

    const handed = await call('POST', '/returns', {
        token: cook.token,
        locationId,
        body: {
            sectionId: kitchenId,
            itemId: line.itemId,
            qtyBase: qty,
            reasonCode: 'RET_QUALITY',
            note: 'Checked by scripts/check-returns.mjs',
            issueId: returnable.id
        }
    });
    if (!check(handed.status === 201, 'kitchen hands it back', `got ${handed.status}`)) {
        console.log(`    ${handed.body?.message ?? ''}`);
        process.exit(1);
    }

    const kitchenAfter = await held(store, kitchenId, line.itemId);
    const quarantineAfter = await held(store, quarantine.id, line.itemId);

    check(
        kitchenBefore - kitchenAfter === qty,
        'the kitchen goes down by exactly what it handed back',
        `${kitchenBefore} -> ${kitchenAfter}`
    );
    check(
        quarantineAfter - quarantineBefore === qty,
        'quarantine goes up by the same amount, at once',
        `${quarantineBefore} -> ${quarantineAfter}`
    );

    // ── 2. The hand-back needs no approval of its own ───────────────────────────────────────────
    heading('The hand-back is not separately approved any more');

    const oldApproval = await call('POST', `/returns/${handed.body.id}/approve`, {
        token: boss.token,
        locationId
    });
    check(
        oldApproval.status === 404,
        'there is no hand-back approval to grant - the disposal decision is the approval',
        `got ${oldApproval.status}`
    );

    // ── 3. The storekeeper writes up the supplier return ────────────────────
    heading('Storekeeper asks management: claim it, or bin it?');

    const suggested = await call('GET', '/supplier-returns/suggested', {
        token: store.token,
        locationId
    });
    check(
        suggested.status === 200,
        'the store is offered a filled-in suggestion',
        `${suggested.body?.length ?? 0} delivery/deliveries suggested`
    );

    const mgmtSuggest = await call('GET', '/supplier-returns/suggested', {
        token: boss.token,
        locationId
    });
    check(
        mgmtSuggest.status === 403,
        'management is not offered the form they cannot submit',
        `got ${mgmtSuggest.status}`
    );

    const sug = suggested.body?.find((s) => s.lines.some((l) => l.itemId === line.itemId));
    if (!sug) {
        console.log(
            '  ! No delivery of that item still has returnable packs on it, so there is\n' +
                '    nothing to price the credit against. The chain stops here honestly:\n' +
                '    quarantine holds the goods and a supplier return needs an invoice.'
        );
        console.log(`\n${'='.repeat(60)}\n${failures === 0 ? 'No failures.' : `${failures} failure(s).`}`);
        process.exit(failures === 0 ? 0 : 1);
    }

    const sugLine = sug.lines.find((l) => l.itemId === line.itemId);
    const packs = Math.min(sugLine.suggestedPacks, sugLine.qtyPacksReturnable);

    const raisedByBoss = await call('POST', '/supplier-returns', {
        token: boss.token,
        locationId,
        body: {
            grnId: sug.grnId,
            reasonCode: sug.reasonCode ?? 'RET_QUALITY',
            lines: [{ grnLineId: sugLine.grnLineId, qtyPacks: packs }]
        }
    });
    check(
        raisedByBoss.status === 403,
        'management cannot raise it themselves',
        `got ${raisedByBoss.status}`
    );

    const raised = await call('POST', '/supplier-returns', {
        token: store.token,
        locationId,
        body: {
            grnId: sug.grnId,
            reasonCode: sug.reasonCode ?? 'RET_QUALITY',
            note: 'Checked by scripts/check-returns.mjs',
            lines: [{ grnLineId: sugLine.grnLineId, qtyPacks: packs }]
        }
    });
    if (!check(raised.status === 201, 'the storekeeper asks', `got ${raised.status}`)) {
        console.log(`    ${raised.body?.message ?? ''}`);
        process.exit(1);
    }
    ok('priced off the original invoice', money(raised.body.creditValue));

    const stillThere = await held(store, quarantine.id, line.itemId);
    check(
        stillThere === quarantineAfter,
        'raising moved no stock - the crate is still in the building',
        `${stillThere}`
    );

    // ── 4. Sending it before approval ───────────────────────────────────────
    heading('Nothing can happen to it before management answers');

    const early = await call('POST', `/supplier-returns/${raised.body.id}/send`, {
        token: store.token,
        locationId
    });
    check(early.status === 409, 'sending an undecided ask is refused', `got ${early.status}`);

    const earlyBin = await call('POST', `/supplier-returns/${raised.body.id}/bin`, {
        token: store.token,
        locationId
    });
    check(
        earlyBin.status === 409,
        'binning an undecided ask is refused too',
        `got ${earlyBin.status}`
    );

    // ── 5. Management decides ───────────────────────────────────────────────
    heading('Management answers the question, line by line');

    const askRow = await findAsk(store, locationId, raised.body.id);
    const answers = askRow.lines.map((l) => ({ lineId: l.id, decision: 'vendor' }));

    const bySelf = await call('POST', `/supplier-returns/${raised.body.id}/decide`, {
        token: store.token,
        locationId,
        body: { lines: answers }
    });
    check(
        bySelf.status === 403,
        'the storekeeper cannot answer their own ask',
        `got ${bySelf.status}`
    );

    const partial = await call('POST', `/supplier-returns/${raised.body.id}/decide`, {
        token: boss.token,
        locationId,
        body: { lines: [{ lineId: 'not-a-line', decision: 'vendor' }] }
    });
    check(
        partial.status === 400,
        'a half-answered ask is refused - every line has to go somewhere',
        `got ${partial.status}`
    );

    const decided = await call('POST', `/supplier-returns/${raised.body.id}/decide`, {
        token: boss.token,
        locationId,
        body: { lines: answers, note: 'Checked by scripts/check-returns.mjs' }
    });
    check(decided.status === 200, 'management answers it', `got ${decided.status}`);
    ok(
        'the answer is recorded line by line',
        `${decided.body?.toVendor} back to the supplier, ${decided.body?.toWaste} binned`
    );

    check(
        (await held(store, quarantine.id, line.itemId)) === stillThere,
        'answering still moves no stock',
        `${stillThere}`
    );

    // ── 6. The lorry takes it ───────────────────────────────────────────────
    heading('The store marks it gone - this is the step that moves stock');

    const sentByBoss = await call('POST', `/supplier-returns/${raised.body.id}/send`, {
        token: boss.token,
        locationId
    });
    check(
        sentByBoss.status === 403,
        'management does not mark it gone - they did not watch it leave',
        `got ${sentByBoss.status}`
    );

    const sent = await call('POST', `/supplier-returns/${raised.body.id}/send`, {
        token: store.token,
        locationId
    });
    check(sent.status === 200, 'the storekeeper marks it gone', `got ${sent.status}`);

    const afterSend = await held(store, quarantine.id, line.itemId);
    const expectedOut = round3(packs * sugLine.qtyInStockUnit);
    check(
        round3(stillThere - afterSend) === expectedOut,
        'quarantine goes down by exactly the packs that went',
        `${stillThere} -> ${afterSend} (${expectedOut} ${line.stockUnit} out)`
    );

    /*
     * A sliver can legitimately stay behind, and it is worth understanding
     * rather than chasing.
     *
     * A supplier return is counted in packs, because that is what a credit
     * note is written in. Quarantine is counted in stock units. Hand back 16 ml
     * of a 750 ml bottle and the return is 0.021 packs -- three decimal places,
     * which is 15.75 ml -- so 0.25 ml stays on the quarantine shelf.
     *
     * The alternative is claiming credit for a fraction of a pack no supplier
     * will honour, so the residue is the right side of the trade. It is
     * reported, not failed.
     */
    if (afterSend > 0 && afterSend < sugLine.qtyInStockUnit) {
        ok(
            'a part-pack remainder stays in quarantine',
            `${afterSend} ${line.stockUnit} - less than one pack, so no credit can be claimed for it`
        );
    }

    // ── 7. What the supplier did about it ───────────────────────────────────
    heading('Management records what came back');

    const noNumber = await call('POST', `/supplier-returns/${raised.body.id}/settle`, {
        token: boss.token,
        locationId,
        body: { outcome: 'credit' }
    });
    check(
        noNumber.status === 400,
        'a credit without its note number is refused',
        `got ${noNumber.status}`
    );

    const settled = await call('POST', `/supplier-returns/${raised.body.id}/settle`, {
        token: boss.token,
        locationId,
        body: {
            outcome: 'credit',
            creditNoteNo: `CN-CHECK-${Date.now().toString().slice(-6)}`,
            creditValue: raised.body.creditValue
        }
    });
    check(settled.status === 200, 'management records the credit note', `got ${settled.status}`);

    const finalRow = await call(`GET`, `/supplier-returns?limit=50`, {
        token: store.token,
        locationId
    });
    const row = finalRow.body.items?.find((r) => r.id === String(raised.body.id));
    check(row?.status === 'settled', 'the return ends up settled', row?.status ?? 'not found');

    console.log(`\n${'='.repeat(60)}`);
    console.log(
        failures === 0
            ? 'The whole chain behaved: two steps moved stock, the rest did not, and\n' +
                  'every step refused the wrong role.'
            : `${failures} check(s) failed. See the crosses above.`
    );
    process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error(`\nCould not finish: ${err.message}`);
    process.exit(1);
});
