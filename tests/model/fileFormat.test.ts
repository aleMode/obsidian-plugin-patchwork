import { describe, expect, it } from 'vitest';
import { newBoardFile, newPage, nextPagePosition } from '../../src/model/defaults';
import { newId } from '../../src/model/ids';
import { migrate } from '../../src/model/migrate';
import { SCHEMA_VERSION } from '../../src/model/schema';
import { serializeBoard } from '../../src/model/serialize';
import { parseBoard } from '../../src/model/validate';

/** A v1 board using every known field, plus unknown keys at every level. */
const FULL = {
	futureTopLevel: { anything: [1, 2, 3] },
	version: 1,
	unit: 'mm',
	meta: { title: 'Spells', created: '2026-10-19', metaExtra: true },
	board: {
		grid: { size: 5, snap: true, visible: true, gridExtra: 'x' },
		displayUnit: 'cm',
		order: 'manual',
		pageOrder: ['p2', 'p1'],
		numbering: { enabled: true, start: 3, format: 'roman', position: 'top-right', skipFirst: true },
		defaultSafeArea: { top: 10, right: 10, bottom: 10, left: 10 },
		header: '{title}',
		footer: '{page}/{pages}',
		useAppTheme: false,
		fontFamily: 'Georgia',
		mode: 'use',
		export: { format: 'pdf', sheet: { w: 100, h: 150 }, orientation: 'auto', tileOverlap: 5, cropMarks: false, dpi: 300, quality: 'small' },
		boardExtra: 42,
	},
	pages: [
		{
			id: 'p1', name: 'Front', x: 0, y: 0, w: 210, h: 297, numberLabel: false, pageExtra: null,
			modules: [
				{ id: 'm1', type: 'pdf', x: 10, y: 10, w: 90, h: 80, file: 'PDFs/Book.pdf', page: 40, crop: [0.1, 0.2, 0.5, 0.6], fit: 'cover', rotation: 90, render: 'vector', moduleExtra: 'keep' },
				{ id: 'm2', type: 'note', x: 110, y: 10, w: 90, h: 200, file: 'Rules/Combat.md', subpath: '#Prone', lines: [1, 4], includeHeading: false, overflow: 'fit', scale: 0.8, style: { padding: 2, border: { width: 0.5, color: '#333', borderExtra: 1 }, tint: '4', styleExtra: 'y' } },
				{ id: 'm3', type: 'text', x: 10, y: 100, w: 50, h: 20, markdown: '**hi**' },
				{ id: 'm4', type: 'image', x: 10, y: 130, w: 50, h: 40, file: 'Images/Map.png', fit: 'stretch', z: 2, locked: true, label: 'map' },
				{ type: 'hologram', id: 'm5', x: 1, y: 1, w: 1, h: 1, beam: { colour: 'blue' } },
			],
		},
		{ id: 'p2', x: 230, y: 0, w: 297, h: 210, safeArea: { top: 5, right: 5, bottom: 5, left: 5 }, isMaster: true, modules: [] },
		{ id: 'p3', x: 0, y: 400, w: 297, h: 210, master: 'p2', modules: [] },
	],
};

const parse = (v: unknown) => {
	const r = parseBoard(typeof v === 'string' ? v : JSON.stringify(v));
	if (!r.ok) throw new Error(r.errors.join('\n'));
	return r;
};

describe('round trip', () => {
	it('load → save → load keeps everything, including unknown keys at every level', () => {
		const first = parse(FULL);
		expect(first.warnings).toEqual(['pages[0].modules[4]: unknown module type "hologram" kept as is']);
		const text = serializeBoard(first.file);
		const second = parse(text);
		expect(second.file).toEqual(first.file);
		expect(JSON.parse(text)).toEqual(FULL);
	});

	it('text formatting keys of a module style survive, in a stable order, next to unknown ones', () => {
		const withStyle = structuredClone(FULL) as { pages: { modules: { style?: Record<string, unknown> }[] }[] };
		withStyle.pages[0]!.modules[0]!.style = { futureKey: 1, fontFamily: 'Georgia, serif', align: 'center', color: '#aa0000', padding: 2 };
		const { file } = parse(JSON.stringify(withStyle));
		const style = JSON.parse(serializeBoard(file)).pages[0].modules[0].style;
		expect(Object.keys(style)).toEqual(['padding', 'color', 'align', 'fontFamily', 'futureKey']);
		expect(style).toMatchObject({ color: '#aa0000', align: 'center', fontFamily: 'Georgia, serif', futureKey: 1 });
	});

	it('save → load → save is byte-identical', () => {
		const text = serializeBoard(parse(FULL).file);
		expect(serializeBoard(parse(text).file)).toBe(text);
	});

	it('writes known keys in a stable order, unknown keys after them', () => {
		const text = serializeBoard(parse(FULL).file);
		const top = Object.keys(JSON.parse(text));
		expect(top).toEqual(['version', 'unit', 'meta', 'board', 'pages', 'futureTopLevel']);
		const mod = Object.keys(JSON.parse(text).pages[0].modules[0]);
		expect(mod).toEqual(['id', 'type', 'x', 'y', 'w', 'h', 'file', 'page', 'crop', 'fit', 'rotation', 'render', 'moduleExtra']);
	});

	it('writes modules of unknown type verbatim, key order included', () => {
		const text = serializeBoard(parse(FULL).file);
		expect(Object.keys(JSON.parse(text).pages[0].modules[4])).toEqual(['type', 'id', 'x', 'y', 'w', 'h', 'beam']);
	});

	it('uses 2-space indentation and a trailing newline', () => {
		const text = serializeBoard(newBoardFile());
		expect(text.startsWith('{\n  "version": 1,')).toBe(true);
		expect(text.endsWith('}\n')).toBe(true);
	});

	it('removes float noise from known numbers but not from unknown keys', () => {
		const file = parse(FULL).file;
		file.pages[0]!.x = 12.300000000000001;
		(file.pages[0] as Record<string, unknown>).pageExtra = 0.1 + 0.2;
		const out = JSON.parse(serializeBoard(file));
		expect(out.pages[0].x).toBe(12.3);
		expect(out.pages[0].pageExtra).toBe(0.1 + 0.2);
	});

	it('drops stale pageOrder IDs on save', () => {
		const file = parse(FULL).file;
		file.board.pageOrder = ['p2', 'deleted', 'p1'];
		expect(JSON.parse(serializeBoard(file)).board.pageOrder).toEqual(['p2', 'p1']);
	});
});

describe('parseBoard', () => {
	it('rejects invalid JSON with a readable error', () => {
		const r = parseBoard('{ "version": 1, ');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors[0]).toMatch(/Not valid JSON/);
	});

	it('starts a new board from an empty file', () => {
		const r = parseBoard('  \n');
		expect(r.ok && r.file.pages).toEqual([]);
	});

	it('fills missing board settings from defaults and keeps what is there', () => {
		const r = parse({ version: 1, board: { grid: { size: 10 } }, pages: [] });
		expect(r.file.board.grid).toEqual({ size: 10, snap: true, visible: true });
		expect(r.file.board.export.dpi).toBe(200);
		expect(r.file.unit).toBe('mm');
	});

	it('reports every wrong field with its path', () => {
		const r = parseBoard(JSON.stringify({
			version: 1,
			board: { displayUnit: 'furlong' },
			pages: [{ id: 'a', x: 0, y: 0, w: -1, h: 10, modules: [{ id: 'm', type: 'pdf', x: 0, y: 0, w: 1, h: 1, file: 'a.pdf', page: 0, crop: [0.5, 0, 0.2, 1] }] }],
		}));
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.errors).toEqual([
				expect.stringMatching(/^board\.displayUnit/),
				expect.stringMatching(/^pages\[0\]\.w/),
				expect.stringMatching(/^pages\[0\]\.modules\[0\]\.page/),
				expect.stringMatching(/^pages\[0\]\.modules\[0\]\.crop/),
			]);
		}
	});

	it('rejects a non-mm unit, since storage is always mm', () => {
		expect(parseBoard(JSON.stringify({ version: 1, unit: 'in', pages: [] })).ok).toBe(false);
	});

	it('replaces missing and duplicate IDs with a warning', () => {
		const r = parse({ version: 1, pages: [{ x: 0, y: 0, w: 1, h: 1 }, { id: 'a', x: 0, y: 0, w: 1, h: 1, modules: [{ id: 'a', type: 'text', x: 0, y: 0, w: 1, h: 1 }] }] });
		const ids = [r.file.pages[0]!.id, r.file.pages[1]!.id, r.file.pages[1]!.modules[0]!.id];
		expect(new Set(ids).size).toBe(3);
		expect(r.warnings).toHaveLength(2);
	});

	it('opens a newer format read-only without migrating', () => {
		const r = parse({ ...FULL, version: SCHEMA_VERSION + 1 });
		expect(r.readOnly).toBe(true);
		expect(r.warnings[0]).toMatch(/newer version/);
	});

	it('rejects a missing version', () => {
		expect(parseBoard(JSON.stringify({ pages: [] })).ok).toBe(false);
	});
});

describe('migrate', () => {
	it('applies steps in order up to the target', () => {
		const steps = {
			1: (r: Record<string, unknown>) => ({ ...r, a: 'from 1' }),
			2: (r: Record<string, unknown>) => ({ ...r, b: `${r.a as string} then 2` }),
		};
		expect(migrate({ version: 1 }, steps, 3)).toEqual({ version: 3, a: 'from 1', b: 'from 1 then 2' });
	});

	it('is a no-op at the current version', () => {
		const raw = { version: SCHEMA_VERSION, x: 1 };
		expect(migrate(raw)).toEqual(raw);
	});

	it('fails loudly on a gap', () => {
		expect(() => migrate({ version: 1 }, {}, 2)).toThrow(/No migration from version 1/);
	});
});

describe('defaults', () => {
	it('places new pages to the right of existing ones', () => {
		const file = newBoardFile({ firstPage: { w: 210, h: 297 } });
		expect(nextPagePosition(file.pages)).toEqual({ x: 230, y: 0 });
		const p = newPage(file, { w: 148, h: 210 });
		expect([p.x, p.y, p.id === file.pages[0]!.id]).toEqual([230, 0, false]);
		expect(nextPagePosition([])).toEqual({ x: 0, y: 0 });
	});

	it('generates 8-char IDs that avoid taken ones', () => {
		let n = 0;
		const seq = [0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
		const id = newId(new Set(['aaaaaaaa']), () => seq[n++ % seq.length]!);
		expect(id).toBe('ssssssss');
	});

	it('a new board serializes and parses back cleanly', () => {
		const file = newBoardFile({ title: 'T', created: '2026-10-19', firstPage: { w: 210, h: 297 } });
		expect(parse(serializeBoard(file)).file).toEqual(file);
	});
});

describe('saved views in the file', () => {
	it('round-trip with a stable key order; bad views are reported', () => {
		const file = newBoardFile();
		file.views = [{ zoom: 0.5, name: 'Spells', y: 2, x: 1, id: 'v1', extra: true }];
		const text = serializeBoard(file);
		expect(Object.keys(JSON.parse(text).views[0])).toEqual(['id', 'name', 'x', 'y', 'zoom', 'extra']);
		expect(parse(text).file.views).toEqual(file.views);
		const bad = parseBoard(JSON.stringify({ version: 1, pages: [], views: [{ name: 'x', x: 0, y: 0, zoom: 0 }] }));
		expect(bad.ok).toBe(false);
	});
});

describe('shapes and saved views in the file', () => {
	it('shape modules get a stable key order and lose float noise, like other modules', () => {
		const f = newBoardFile();
		f.pages = [{ id: 'p', x: 0, y: 0, w: 210, h: 297, modules: [{ id: 's', type: 'shape', shape: 'line', y: 1, x: 0.1 + 0.2, w: 10, h: 10, p1: [0.1 + 0.2, 0], stroke: { width: 0.1 + 0.2, color: '#222222' } } as never] }];
		const m = JSON.parse(serializeBoard(f)).pages[0].modules[0];
		expect(Object.keys(m)).toEqual(['id', 'type', 'x', 'y', 'w', 'h', 'shape', 'stroke', 'p1']);
		expect(m.x).toBe(0.3);
		expect(m.p1).toEqual([0.3, 0]);
		expect(m.stroke).toEqual({ color: '#222222', width: 0.3 });
		expect(Object.keys(m.stroke)).toEqual(['color', 'width']);
	});

	it('views with a missing or repeated id get a fresh, unique one', () => {
		const raw = JSON.parse(serializeBoard(newBoardFile()));
		raw.views = [{ name: 'a', x: 0, y: 0, zoom: 1 }, { id: 'view-0', name: 'b', x: 0, y: 0, zoom: 1 }, { id: 'view-0', name: 'c', x: 0, y: 0, zoom: 1 }];
		const r = parseBoard(JSON.stringify(raw));
		const ids = r.ok ? (r.file.views ?? []).map((v) => v.id) : [];
		expect(new Set(ids).size).toBe(3);
		expect(ids[1]).toBe('view-0');
	});
});
