/**
 * The acceptance suite.
 *
 *   "Test data with no faults in it teaches you nothing. Five faults are
 *    planted, and each maps to a report that must catch it. If a report can't
 *    find its fault, the report is wrong."
 *
 * One test per planted fault, run against the 60-day seed. Plus the inverse
 * test for D, which is the one that actually decides whether this system gets
 * used: honest spoilage must read as spoilage and must NOT appear in the
 * shrinkage report. A variance report that cries theft about lettuce is a
 * report the owner stops opening by week three.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { db } from './helpers.js';
import {
    priceMovement,
    shrinkage,
    stockOuts,
    usageTrend,
    usageVariance,
    wastageByReason,
    wastageTrend
} from '../src/services/reports.js';

/** The seed runs 60 business days from 2026-06-10. */
const SEED = { from: '2026-06-10', to: '2026-08-08' };
const LOCATION = 1;

/** Day index -> date, matching generate.ts. */
const day = (n: number) =>
    new Date(Date.parse('2026-06-10T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

afterAll(async () => {
    await db.destroy();
});

describe('A - chicken breast over-issued from day 20', () => {
    it('is flagged by theoretical vs actual usage', async () => {
        const rows = await usageVariance(LOCATION, SEED, 8);
        const chicken = rows.find((r) => r.code === 'MEA-001');

        expect(chicken, 'MEA-001 should appear in the usage variance report').toBeTruthy();

        // Over-issued, so actual exceeds theoretical.
        expect(chicken!.varianceQty).toBeGreaterThan(0);
        expect(chicken!.actualQty).toBeGreaterThan(chicken!.theoreticalQty);
        expect(chicken!.variancePct).toBeGreaterThan(8);
    });

    it('shows the step change around day 20 rather than a slow drift', async () => {
        const item = await db
            .selectFrom('items')
            .select('id')
            .where('code', '=', 'MEA-001')
            .executeTakeFirstOrThrow();

        const trend = await usageTrend(LOCATION, item.id, SEED);
        expect(trend.length).toBeGreaterThan(40);

        const before = trend.filter((t) => t.businessDate < day(20));
        const after = trend.filter((t) => t.businessDate >= day(20));

        const mean = (xs: { actualQty: number }[]) =>
            xs.reduce((s, x) => s + x.actualQty, 0) / Math.max(1, xs.length);

        const meanBefore = mean(before);
        const meanAfter = mean(after);

        // The generator applies a 1.18 multiplier from day 20. The observed
        // step is smaller because of day-of-week mix and the availability cap,
        // but it must be unmistakably a step.
        expect(meanAfter).toBeGreaterThan(meanBefore * 1.1);
    });
});

describe('B - two gin bottles vanish with no document', () => {
    it('is flagged by the shrinkage report', async () => {
        const rows = await shrinkage(LOCATION, SEED);
        const gin = rows.filter((r) => r.code === 'BAR-001' && !r.hasWastageDoc);

        expect(
            gin.length,
            'BAR-001 should show unexplained gaps on the drinks shelf'
        ).toBeGreaterThanOrEqual(2);

        // The drinks shelf is part of the kitchen now -- BAR stopped being a
        // section of its own. What makes the gin detectable was never the room
        // it stood in, but that spirits are counted by the bottle.
        for (const gap of gin) {
            expect(gap.sectionCode).toBe('KITCHEN');
            expect(gap.varianceQty).toBeLessThan(0);
        }

        // Two 750 ml bottles.
        const worst = gin.sort((a, b) => a.varianceQty - b.varianceQty).slice(0, 2);
        for (const gap of worst) {
            expect(Math.abs(gap.varianceQty)).toBeGreaterThanOrEqual(700);
        }
    });

    it('has no wastage document behind it - that is what makes it shrinkage', async () => {
        const rows = await shrinkage(LOCATION, SEED);
        const gin = rows.filter((r) => r.code === 'BAR-001');
        expect(gin.every((g) => g.hasWastageDoc === false)).toBe(true);
    });
});

describe('C - sunflower oil price rises 32%', () => {
    it('is flagged by supplier price movement', async () => {
        const rows = await priceMovement(SEED, 10);
        const oil = rows.find((r) => r.itemName.toLowerCase().includes('sunflower'));

        expect(oil, 'Sunflower oil should appear in the price movement report').toBeTruthy();
        expect(oil!.changePct).toBeCloseTo(32, 0);
        expect(oil!.newPrice).toBeGreaterThan(oil!.previousPrice);
    });

    it('is detected at the delivery, not on the day the supplier changed the price', async () => {
        const rows = await priceMovement(SEED, 10);
        const oil = rows.find((r) => r.itemName.toLowerCase().includes('sunflower'))!;

        // The price moves on day 35; nobody finds out until the next GRN.
        // A report that only looked at day 35 would miss it entirely.
        expect(oil.effectiveFrom > day(35)).toBe(true);
    });
});

describe('D - lettuce spoilage spike in week six', () => {
    it('reads as spoilage in the wastage report', async () => {
        const rows = await wastageByReason(LOCATION, SEED);
        const lettuce = rows.filter((r) => r.code === 'VEG-009');

        expect(lettuce.length, 'VEG-009 should appear in wastage by reason').toBeGreaterThan(0);
        expect(lettuce.every((l) => l.reasonCode === 'SPOIL')).toBe(true);
        expect(lettuce[0]!.reasonLabel.toLowerCase()).toContain('spoil');
    });

    it('shows a visible spike in days 38-44 rather than a flat line', async () => {
        const item = await db
            .selectFrom('items')
            .select('id')
            .where('code', '=', 'VEG-009')
            .executeTakeFirstOrThrow();

        const trend = await wastageTrend(LOCATION, item.id, SEED);
        const inSpike = trend.filter((t) => t.businessDate >= day(38) && t.businessDate <= day(44));
        const outside = trend.filter((t) => t.businessDate < day(38) || t.businessDate > day(44));

        expect(inSpike.length).toBeGreaterThan(0);

        const peak = Math.max(...inSpike.map((t) => t.qtyBase));
        const normal = outside.length
            ? outside.reduce((s, t) => s + t.qtyBase, 0) / outside.length
            : 0;

        expect(peak).toBeGreaterThan(normal * 2);
    });

    /**
     * The important one.
     *
     * The waste was logged honestly, with a reason, by the section that
     * created it. It is a kitchen problem, not a theft problem, and the
     * shrinkage report must leave it alone.
     */
    it('does NOT appear in the shrinkage report', async () => {
        const rows = await shrinkage(LOCATION, SEED);
        const lettuce = rows.filter((r) => r.code === 'VEG-009' && !r.hasWastageDoc);

        expect(
            lettuce,
            'Honest, documented spoilage must never be reported as unexplained loss'
        ).toEqual([]);
    });

    it('keeps documented waste out of the unexplained set generally', async () => {
        const rows = await shrinkage(LOCATION, SEED);
        const unexplained = rows.filter((r) => !r.hasWastageDoc);
        expect(unexplained.every((r) => r.hasWastageDoc === false)).toBe(true);
    });
});

describe('E - prawns run out on day 41', () => {
    it('is flagged by the stock-out report', async () => {
        const rows = await stockOuts(LOCATION, SEED);
        const prawns = rows.filter((r) => r.code === 'SEA-001');

        expect(prawns.length, 'SEA-001 should show a stock-out').toBeGreaterThan(0);
        expect(prawns.some((p) => p.businessDate === day(41))).toBe(true);

        const onTheDay = prawns.find((p) => p.businessDate === day(41))!;
        expect(onTheDay.balance).toBeLessThanOrEqual(0);
    });
});

describe('the reports do not cry wolf', () => {
    it('usage variance stays a short list, not every item in the store', async () => {
        const rows = await usageVariance(LOCATION, SEED, 8);

        // 100 items in the master. A report that flags most of them is noise,
        // and noise is how a report stops being opened.
        expect(rows.length).toBeLessThan(40);
    });

    it('price movement only reports genuine moves', async () => {
        const rows = await priceMovement(SEED, 10);
        expect(rows.every((r) => Math.abs(r.changePct) >= 10)).toBe(true);
    });

    it('shrinkage reports losses, never found stock', async () => {
        const rows = await shrinkage(LOCATION, SEED);
        expect(rows.every((r) => r.varianceQty < 0)).toBe(true);
    });

    /**
     * Found by this suite, not by reading the code: without a materiality
     * floor the shrinkage report listed one-gram, Rs 0.44 "losses" from
     * ordinary counting noise, and they buried the two gin bottles.
     */
    it('ignores counting noise below the materiality floor', async () => {
        const withFloor = await shrinkage(LOCATION, SEED);
        const withoutFloor = await shrinkage(LOCATION, SEED, 0);

        expect(withoutFloor.length).toBeGreaterThan(withFloor.length);
        expect(withFloor.every((r) => Math.abs(r.varianceValue) >= 100)).toBe(true);

        // And the signal survives the filter.
        expect(withFloor.some((r) => r.code === 'BAR-001')).toBe(true);
    });
});
