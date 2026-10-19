import { Plugin, TextFileView, TFile, WorkspaceLeaf } from 'obsidian';
import { sleep, Spike, SpikeContext } from './context';

const VIEW_TYPE = 'patchwork-spike-view';
const EXT = 'patchwork';

class SpikeView extends TextFileView {
	data = '';
	calls: { clear: boolean; head: string }[] = [];

	getViewType() {
		return VIEW_TYPE;
	}
	getDisplayText() {
		return this.file?.basename ?? 'Spike';
	}
	getViewData() {
		return this.data;
	}
	setViewData(data: string, clear: boolean) {
		this.data = data;
		this.calls.push({ clear, head: data.slice(0, 40) });
		this.contentEl.setText(data.slice(0, 200));
	}
	clear() {
		this.data = '';
	}
}

export function registerS6View(plugin: Plugin) {
	plugin.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => new SpikeView(leaf));
	plugin.registerExtensions([EXT], VIEW_TYPE);
}

const read = (ctx: SpikeContext, path: string) => {
	const f = ctx.app.vault.getAbstractFileByPath(path);
	return f instanceof TFile ? ctx.app.vault.read(f) : Promise.resolve(null);
};

/** S6: does registerExtensions + TextFileView give a visible, creatable, safely-saving .patchwork file? */
export const s6FileView: Spike = async (ctx) => {
	const { app } = ctx;
	const path = 'Spike board.patchwork';
	const renamed = 'Spike board renamed.patchwork';
	for (const p of [path, renamed]) {
		const f = app.vault.getAbstractFileByPath(p);
		if (f) await app.vault.delete(f);
	}
	const out: Record<string, unknown> = {};
	const json = (v: number) => JSON.stringify({ version: 1, rev: v, unknownKey: { keep: true } }, null, 2);

	const file = await app.vault.create(path, json(0));
	await sleep(300);
	out.created = {
		inVaultFiles: app.vault.getFiles().some((f) => f.path === path),
		inFileExplorer: !!document.querySelector(`.nav-file-title[data-path="${path}"]`),
		explorerLabel: document.querySelector(`.nav-file-title[data-path="${path}"]`)?.textContent ?? null,
		viewTypeForExt: (app as unknown as { viewRegistry: { getTypeByExtension(e: string): string } }).viewRegistry?.getTypeByExtension(EXT) ?? 'n/a',
	};

	const leaf = app.workspace.getLeaf(true);
	await leaf.openFile(file);
	await sleep(300);
	const view = leaf.view as SpikeView;
	out.opened = { viewType: view.getViewType(), setViewDataCalls: [...view.calls] };

	// requestSave is debounced; check it lands and how long it takes.
	view.data = json(1);
	view.requestSave();
	const t0 = performance.now();
	let saved = false;
	while (performance.now() - t0 < 5000) {
		if ((await read(ctx, path))?.includes('"rev": 1')) {
			saved = true;
			break;
		}
		await sleep(100);
	}
	out.requestSave = { saved, afterMs: Math.round(performance.now() - t0) };

	// Rename while open.
	await app.fileManager.renameFile(file, renamed);
	await sleep(300);
	view.data = json(2);
	await view.save();
	out.rename = {
		viewFilePath: view.file?.path,
		newContentHasRev2: (await read(ctx, renamed))?.includes('"rev": 2') ?? false,
		oldPathRecreated: !!app.vault.getAbstractFileByPath(path),
	};

	// External modification while the view is clean.
	view.calls = [];
	await app.vault.modify(view.file!, json(3));
	await sleep(500);
	out.externalModifyClean = { setViewDataCalls: [...view.calls], viewHasRev3: view.data.includes('"rev": 3') };

	// External modification while a save is pending: who wins?
	view.calls = [];
	view.data = json(4);
	view.requestSave();
	await app.vault.modify(view.file!, json(5));
	await sleep(3000);
	out.externalModifyDirty = {
		setViewDataCalls: [...view.calls],
		viewRev: view.data.match(/"rev": (\d+)/)?.[1],
		fileRev: (await read(ctx, renamed))?.match(/"rev": (\d+)/)?.[1],
	};

	// Closing the leaf with a pending debounced save: is it flushed?
	view.data = json(6);
	view.requestSave();
	leaf.detach();
	await sleep(300);
	out.closeWithPendingSave = { fileRev: (await read(ctx, renamed))?.match(/"rev": (\d+)/)?.[1], expected: '6' };

	// Unparseable content: the view just receives the raw text, so the plugin controls safety.
	const bad = await read(ctx, renamed);
	await app.vault.modify(app.vault.getAbstractFileByPath(renamed) as TFile, '{ not json');
	const leaf2 = app.workspace.getLeaf(true);
	await leaf2.openFile(app.vault.getAbstractFileByPath(renamed) as TFile);
	await sleep(300);
	out.corrupt = { viewReceived: (leaf2.view as SpikeView).data, previousWasValid: !!bad };
	leaf2.detach();

	await app.vault.delete(app.vault.getAbstractFileByPath(renamed)!);
	return out;
};
