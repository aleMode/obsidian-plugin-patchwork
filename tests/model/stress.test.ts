import { describe, expect, it } from 'vitest';
import { allIds } from '../../src/model/defaults';
import { vectorModules } from '../../src/model/exportPlan';
import { orderedPages } from '../../src/model/ordering';
import { serializeBoard } from '../../src/model/serialize';
import { generateStressBoard, seededRandom } from '../../src/model/stress';
import { tileGrid } from '../../src/model/tiling';
import { parseBoard } from '../../src/model/validate';

const SOURCES = {
	notes: ['Rules/Combat.md', 'Monsters/Goblin.md'],
	pdfs: [{ path: 'PDFs/Sample rulebook.pdf', pages: 4 }],
	images: ['Images/Map.png'],
};

describe('seededRandom', () => {
	it('is deterministic and in [0, 1)', () => {
		const a = seededRandom(42), b = seededRandom(42);
		const xs = Array.from({ length: 1000 }, () => a());
		expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
		expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
		expect(Math.max(...xs)).toBeLessThan(1);
	});
});

describe('generateStressBoard', () => {
	it('builds the requested pages and modules, valid and deterministic', () => {
		const board = generateStressBoard(SOURCES, { pages: 12, modulesPerPage: 3, columns: 5 });
		expect(board.pages).toHaveLength(12);
		expect(board.pages.every((p) => p.modules.length === 3)).toBe(true);
		expect(allIds(board).size).toBe(12 * 4);
		const r = parseBoard(serializeBoard(board));
		expect(r.ok && r.warnings).toEqual([]);
		expect(serializeBoard(generateStressBoard(SOURCES, { pages: 12, modulesPerPage: 3, columns: 5 }))).toBe(serializeBoard(board));
	});

	it('uses every kind of source', () => {
		const types = new Set(generateStressBoard(SOURCES, { pages: 20, modulesPerPage: 4 }).pages.flatMap((p) => p.modules.map((m) => m.type)));
		expect([...types].sort()).toEqual(['image', 'note', 'pdf', 'text']);
	});
});

/**
 * Model-level performance smoke test (SPEC 12): the pure layer must stay fast on big boards,
 * well beyond the 100 pages / 300 modules target. Generous limits, to catch accidental O(n²).
 */
describe('model performance smoke', () => {
	const time = (fn: () => void) => {
		const t0 = performance.now();
		fn();
		return performance.now() - t0;
	};

	it('1000 pages × 10 modules: generate, serialize, parse, order, plan export', () => {
		let board = generateStressBoard(SOURCES, { pages: 1000, modulesPerPage: 10 });
		let text = '';
		const t = {
			serialize: time(() => (text = serializeBoard(board))),
			parse: time(() => {
				const r = parseBoard(text);
				if (r.ok) board = r.file;
			}),
			order: time(() => orderedPages(board)),
			plan: time(() => board.pages.forEach((p) => vectorModules(p, 'best'))),
			tiling: time(() => tileGrid({ w: 5000, h: 5000 }, { w: 210, h: 297 })),
		};
		expect(board.pages).toHaveLength(1000);
		expect(t.serialize).toBeLessThan(1500);
		expect(t.parse).toBeLessThan(1500);
		expect(t.order).toBeLessThan(200);
		expect(t.plan).toBeLessThan(500);
		expect(t.tiling).toBeLessThan(50);
	});
});
