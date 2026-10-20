import { describe, expect, it } from 'vitest';
import { newBoardFile } from '../../src/model/defaults';
import type { AnyModule } from '../../src/model/schema';
import { removeModule, removePage } from '../../src/store/pageOps';

describe('removeModule and linked frames', () => {
	const mod = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, x: 0, y: 0, w: 10, h: 10, ...extra }) as AnyModule;
	const board = () => {
		const f = newBoardFile();
		f.pages = [
			{ id: 'p', x: 0, y: 0, w: 100, h: 100, modules: [mod('t', 'text', { markdown: '' }), mod('f1', 'frame', { from: 't' })] },
			{ id: 'q', x: 200, y: 0, w: 100, h: 100, modules: [mod('f2', 'frame', { from: 'f1' })] },
		];
		return f;
	};

	it('deleting a middle frame links the next one to the previous', () => {
		const f = removeModule(board(), 'p', 'f1');
		expect(f.pages[1]!.modules[0]!.from).toBe('t');
	});

	it('deleting the head leaves the frames as they are (they show a placeholder)', () => {
		const f = removeModule(board(), 'p', 't');
		expect(f.pages[0]!.modules[0]!.from).toBe('t');
	});

	it('deleting the page of a middle frame closes the chain too', () => {
		const f = removePage(board(), 'p');
		expect(f.pages.map((p) => p.id)).toEqual(['q']);
		expect(f.pages[0]!.modules[0]!.from).toBe('t');
	});

	it('deleting a page with consecutive frames joins what is left', () => {
		const f = board();
		f.pages[0]!.modules.push(mod('f1b', 'frame', { from: 'f1' }));
		f.pages[1]!.modules[0]!.from = 'f1b';
		const next = removePage(f, 'p');
		expect(next.pages[0]!.modules[0]!.from).toBe('t');
	});
});
