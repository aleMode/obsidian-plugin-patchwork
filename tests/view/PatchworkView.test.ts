import { beforeEach, describe, expect, it, vi } from 'vitest';
import { newBoardFile } from '../../src/model/defaults';
import { serializeBoard } from '../../src/model/serialize';
import { movePage } from '../../src/store/pageOps';
import { PatchworkView } from '../../src/view/PatchworkView';
import { FakeEl, Modal, Notice } from '../fakes/obsidian';
import { fakeApp } from '../fakes/vault';

// The save path and the conflict flow (SPEC 6, hard rule 2) against an in-memory vault.

const PATH = 'Boards/Plan.patchwork';
const board = (x = 0) => {
	const f = newBoardFile();
	f.pages = [{ id: 'p', x, y: 0, w: 210, h: 297, modules: [] }];
	return serializeBoard(f);
};

function open(text = board()) {
	const env = fakeApp({ [PATH]: text });
	const view = new PatchworkView({ app: env.app } as never, () => ({ destroy() {} }));
	view.file = env.fileAt(PATH);
	view.setViewData(text, true);
	env.vault.writes.length = 0;
	return { ...env, view };
}

const pageX = (view: PatchworkView) => view.store!.file.pages[0]!.x;
const conflictCopies = (files: Map<string, string>) => [...files.keys()].filter((p) => p.includes('(conflict'));

beforeEach(() => {
	Notice.shown = [];
	Modal.opened = [];
});

describe('PatchworkView save', () => {
	it('writes an edit when the disk still has what it last read', async () => {
		const { view, vault } = open();
		view.store!.update((f) => movePage(f, 'p', 50, 0));
		await view.save();
		expect(JSON.parse(vault.files.get(PATH)!).pages[0].x).toBe(50);
		expect(view.hasUnsavedEdits).toBe(false);
	});

	it('writes nothing without edits, and shows an outside change instead', async () => {
		const { view, vault } = open();
		vault.files.set(PATH, board(99));
		await view.save();
		expect(vault.writes).toEqual([]);
		expect(pageX(view)).toBe(99);
	});

	it('keeps both sides of a conflict: ours in a copy, written before the disk version is shown', async () => {
		const { view, vault } = open();
		view.store!.update((f) => movePage(f, 'p', 50, 0));
		vault.files.set(PATH, board(99));
		await view.save();
		const [copy] = conflictCopies(vault.files);
		expect(copy).toMatch(/^Boards\/Plan \(conflict .*\)\.patchwork$/);
		expect(JSON.parse(vault.files.get(copy!)!).pages[0].x).toBe(50);
		expect(JSON.parse(vault.files.get(PATH)!).pages[0].x).toBe(99);
		expect(pageX(view)).toBe(99);
		expect(Modal.opened).toHaveLength(1);
	});

	it('a second conflict in the same minute gets its own copy', async () => {
		const { view, vault } = open();
		for (const x of [50, 60]) {
			view.store!.update((f) => movePage(f, 'p', x, 0));
			vault.files.set(PATH, board(90 + x));
			await view.save();
		}
		expect(conflictCopies(vault.files)).toHaveLength(2);
	});

	it('when no copy can be written, the board keeps our version and offers it for the clipboard', async () => {
		const { view, vault } = open();
		view.store!.update((f) => movePage(f, 'p', 50, 0));
		vault.files.set(PATH, board(99));
		vault.create = async () => {
			throw new Error('disk full');
		};
		vi.stubGlobal('createFragment', (build: (f: FakeEl) => void) => {
			const f = new FakeEl();
			build(f);
			return f;
		});
		await view.save();
		expect(pageX(view)).toBe(50);
		expect(view.hasUnsavedEdits).toBe(true);
		expect(Notice.shown.join(' ')).toMatch(/could not be saved as a copy \(disk full\)/);
	});

	it('never writes over a file it could not parse (hard rule 2)', async () => {
		const { view, vault } = open('{ not json');
		expect(view.store).toBeNull();
		await view.save();
		expect(vault.writes).toEqual([]);
		expect(vault.files.get(PATH)).toBe('{ not json');
	});

	it('an outside reload with unsaved edits keeps ours in a conflict copy', async () => {
		const { view, vault } = open();
		view.store!.update((f) => movePage(f, 'p', 50, 0));
		view.setViewData(board(99), false);
		await vi.waitFor(() => expect(conflictCopies(vault.files)).toHaveLength(1));
		const [copy] = conflictCopies(vault.files);
		expect(JSON.parse(vault.files.get(copy!)!).pages[0].x).toBe(50);
		expect(pageX(view)).toBe(99);
	});
});
