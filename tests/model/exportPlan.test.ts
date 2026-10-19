import { describe, expect, it } from 'vitest';
import { batches, drawOrder, oversizedPages, vectorModules, vectorTarget } from '../../src/model/exportPlan';
import type { AnyModule, Page, PdfModule } from '../../src/model/schema';
import { mmToPt } from '../../src/model/units';

const pdf = (id: string, x: number, extra: Partial<PdfModule> = {}): PdfModule => ({ id, type: 'pdf', file: 'a.pdf', page: 1, x, y: 0, w: 50, h: 50, ...extra });
const text = (id: string, x: number, extra: Partial<AnyModule> = {}): AnyModule => ({ id, type: 'text', markdown: '', x, y: 0, w: 50, h: 50, ...extra });
const page = (modules: AnyModule[]): Page => ({ id: 'p', x: 0, y: 0, w: 210, h: 297, modules });

describe('drawOrder', () => {
	it('sorts by z, then array order', () => {
		expect(drawOrder([text('a', 0, { z: 2 }), text('b', 0), text('c', 0, { z: -1 }), text('d', 0)]).map((m) => m.id)).toEqual(['c', 'b', 'd', 'a']);
	});
});

describe('vectorModules', () => {
	it('auto: vector unless something is stacked above', () => {
		const p = page([pdf('under', 0), text('note', 20), pdf('top', 100), pdf('alone', 150, { y: 100 })]);
		expect([...vectorModules(p, 'best')].sort()).toEqual(['alone', 'top']);
	});

	it('something below does not matter', () => {
		expect([...vectorModules(page([text('note', 0), pdf('over', 20)]), 'best')]).toEqual(['over']);
	});

	it('respects z when deciding what is above', () => {
		expect([...vectorModules(page([pdf('raised', 0, { z: 5 }), text('note', 20)]), 'best')]).toEqual(['raised']);
	});

	it('explicit modes win; "small" forces raster', () => {
		const p = page([pdf('forced', 0, { render: 'vector' }), text('note', 20), pdf('r', 150, { y: 150, render: 'raster' })]);
		expect([...vectorModules(p, 'best')]).toEqual(['forced']);
		expect(vectorModules(p, 'small').size).toBe(0);
	});
});

describe('oversizedPages', () => {
	it('flags pages beyond 5080 mm per side', () => {
		const big = { ...page([]), id: 'big', w: 6000 };
		expect(oversizedPages([page([]), big]).map((p) => p.id)).toEqual(['big']);
	});
});

describe('vectorTarget', () => {
	it('contain-fits the crop in the module and flips to PDF coordinates', () => {
		// Full A4 source page into a 100 x 100 mm module at (10, 20) on a printed A4 page.
		const m = pdf('m', 10, { y: 20, w: 100, h: 100 });
		const H = mmToPt(297);
		const { content, clip } = vectorTarget(m, { w: mmToPt(210), h: mmToPt(297), rotate: 0 }, H);
		const w = 100 * (210 / 297);
		expect(content.w).toBeCloseTo(mmToPt(w), 3);
		expect(content.h).toBeCloseTo(mmToPt(100), 3);
		expect(content.x).toBeCloseTo(mmToPt(10 + (100 - w) / 2), 3);
		expect(content.y).toBeCloseTo(H - mmToPt(120), 3);
		expect(clip).toEqual({ x: mmToPt(10), y: H - mmToPt(120), w: mmToPt(100), h: mmToPt(100) });
	});

	it('uses the displayed aspect after both rotations', () => {
		const m = pdf('m', 0, { w: 100, h: 100, rotation: 90 });
		// Landscape source page shown rotated 90°: portrait aspect → height-limited.
		const { content } = vectorTarget(m, { w: 842, h: 595, rotate: 0 }, 1000);
		expect(content.h).toBeCloseTo(mmToPt(100), 3);
		expect(content.w).toBeLessThan(content.h);
	});
});

describe('batches', () => {
	it('splits into fixed-size groups', () => {
		expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
		expect(batches([], 3)).toEqual([]);
	});
});
