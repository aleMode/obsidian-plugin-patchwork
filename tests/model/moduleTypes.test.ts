import { describe, expect, it } from 'vitest';
import { newBoardFile } from '../../src/model/defaults';
import { isKnownModule, MODULE_TYPES } from '../../src/model/schema';
import { serializeBoard } from '../../src/model/serialize';
import { parseBoard } from '../../src/model/validate';

// Every module type is known to the file format; tables and switches elsewhere are checked by the
// compiler (Record<ModuleType, …>, exhaustive switches). Review B13 was a type missing from one table.

const minimal: Record<string, Record<string, unknown>> = {
	pdf: { file: 'a.pdf', page: 1 },
	note: { file: 'a.md' },
	text: { markdown: 'x' },
	image: { file: 'a.png' },
	toc: {},
	frame: { from: 'm0' },
	tracker: { kind: 'counter' },
	shape: { shape: 'rect' },
};

describe('module types', () => {
	it('each type loads without warnings and saves with its keys after the common ones', () => {
		expect(Object.keys(minimal).sort()).toEqual([...MODULE_TYPES].sort());
		const file = newBoardFile();
		file.pages = [{ id: 'p', x: 0, y: 0, w: 210, h: 297, modules: [{ id: 'm0', type: 'text', markdown: 'head', x: 0, y: 0, w: 10, h: 10 }] }];
		const modules = MODULE_TYPES.map((type, i) => ({ ...minimal[type], h: 10, w: 10, y: 0, x: 0, type, id: `m${i + 1}`, zExtra: true }));
		file.pages[0]!.modules.push(...(modules as never[]));
		const parsed = parseBoard(serializeBoard(file));
		expect(parsed.ok && parsed.warnings).toEqual([]);
		const saved = (JSON.parse(serializeBoard(file)) as { pages: { modules: Record<string, unknown>[] }[] }).pages[0]!.modules.slice(1);
		for (const m of saved) {
			const keys = Object.keys(m);
			expect(keys.slice(0, 6)).toEqual(['id', 'type', 'x', 'y', 'w', 'h']);
			expect(keys[keys.length - 1]).toBe('zExtra');
		}
	});

	it('a type from a newer version is kept, not treated as known', () => {
		expect(isKnownModule({ id: 'x', type: 'hologram', x: 0, y: 0, w: 1, h: 1 })).toBe(false);
		expect(isKnownModule({ id: 'x', type: 'toString', x: 0, y: 0, w: 1, h: 1 })).toBe(false);
	});
});
