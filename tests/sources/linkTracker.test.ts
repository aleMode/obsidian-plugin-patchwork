import { describe, expect, it } from 'vitest';
import { newBoardFile } from '../../src/model/defaults';
import type { AnyModule } from '../../src/model/schema';
import { serializeBoard } from '../../src/model/serialize';
import { onVaultRename } from '../../src/sources/linkTracker';
import { movePage } from '../../src/store/pageOps';
import { PatchworkView } from '../../src/view/PatchworkView';
import { fakeApp } from '../fakes/vault';

// Renames followed in boards (SPEC 6): closed boards on disk, open boards through their store.

const note = (id: string, file: string): AnyModule => ({ id, type: 'note', file, x: 0, y: 0, w: 50, h: 50 });
const boardWith = (...modules: AnyModule[]) => {
	const f = newBoardFile();
	f.pages = [{ id: 'p', x: 0, y: 0, w: 210, h: 297, modules }];
	return serializeBoard(f);
};
const filesIn = (text: string) => (JSON.parse(text).pages[0].modules as { file?: string; markdown?: string }[]).map((m) => m.file ?? m.markdown);

function openView(env: ReturnType<typeof fakeApp>, path: string) {
	const view = new PatchworkView({ app: env.app } as never, () => ({ destroy() {} }));
	view.file = env.fileAt(path);
	view.setViewData(env.vault.files.get(path)!, true);
	env.leaves.push({ view });
	return view;
}

describe('onVaultRename', () => {
	it('rewrites closed boards that point at the file, and only those', async () => {
		const env = fakeApp({ 'Notes/B.md': '# B', 'one.patchwork': boardWith(note('a', 'Notes/A.md')), 'other.patchwork': boardWith(note('c', 'Notes/C.md')) });
		await onVaultRename(env.app, 'Notes/A.md', 'Notes/B.md');
		expect(filesIn(env.vault.files.get('one.patchwork')!)).toEqual(['Notes/B.md']);
		expect(env.vault.writes).toEqual(['one.patchwork']);
	});

	it('follows a folder move for every file under it', async () => {
		const env = fakeApp({ 'Lore/x.md': '', 'Lore/deep/y.pdf': '', 'b.patchwork': boardWith(note('a', 'Old/x.md'), { ...note('b', 'Old/deep/y.pdf'), type: 'pdf', page: 1 }, note('c', 'Older/x.md')) });
		await onVaultRename(env.app, 'Old', 'Lore');
		expect(filesIn(env.vault.files.get('b.patchwork')!)).toEqual(['Lore/x.md', 'Lore/deep/y.pdf', 'Older/x.md']);
	});

	it('never rewrites a closed board it cannot parse (hard rule 2)', async () => {
		const broken = '{ "pages": [ "Notes/A.md" ';
		const env = fakeApp({ 'Notes/B.md': '', 'bad.patchwork': broken });
		await onVaultRename(env.app, 'Notes/A.md', 'Notes/B.md');
		expect(env.vault.files.get('bad.patchwork')).toBe(broken);
	});

	it('rewrites an open board through its store, outside the undo history, and saves it', async () => {
		const env = fakeApp({ 'Notes/B.md': '', 'open.patchwork': boardWith(note('a', 'Notes/A.md')) });
		const view = openView(env, 'open.patchwork');
		await onVaultRename(env.app, 'Notes/A.md', 'Notes/B.md');
		expect((view.store!.file.pages[0]!.modules[0] as { file: string }).file).toBe('Notes/B.md');
		expect(view.store!.canUndo).toBe(false);
		expect(filesIn(env.vault.files.get('open.patchwork')!)).toEqual(['Notes/B.md']);
	});

	it('with a board open in two panes, rewrites the one holding unsaved edits, keeping them', async () => {
		const env = fakeApp({ 'Notes/B.md': '', 'two.patchwork': boardWith(note('a', 'Notes/A.md')) });
		const clean = openView(env, 'two.patchwork');
		const edited = openView(env, 'two.patchwork');
		edited.store!.update((f) => movePage(f, 'p', 40, 0));
		await onVaultRename(env.app, 'Notes/A.md', 'Notes/B.md');
		const disk = JSON.parse(env.vault.files.get('two.patchwork')!);
		expect(disk.pages[0].x).toBe(40);
		expect(disk.pages[0].modules[0].file).toBe('Notes/B.md');
		expect((clean.store!.file.pages[0]!.modules[0] as { file: string }).file).toBe('Notes/A.md');
	});

	it('repoints links in text boxes whose target moved, leaving links that still resolve', async () => {
		const text = (id: string, markdown: string) => ({ id, type: 'text', markdown, x: 0, y: 0, w: 50, h: 50 }) as AnyModule;
		const env = fakeApp({ 'Notes/Renamed.md': '', 'Notes/Kept.md': '', 'b.patchwork': boardWith(text('t', 'See [[Original]] and [[Kept]].')) });
		await onVaultRename(env.app, 'Notes/Original.md', 'Notes/Renamed.md');
		expect(filesIn(env.vault.files.get('b.patchwork')!)).toEqual(['See [[Renamed]] and [[Kept]].']);
	});
});
