import { App, TFile } from 'obsidian';
import { rewritePaths } from '../model/links';
import { serializeBoard } from '../model/serialize';
import { parseBoard } from '../model/validate';
import { BOARD_EXTENSION, PatchworkView, VIEW_TYPE_BOARD } from '../view/PatchworkView';

/**
 * Keep board references valid when notes, PDFs or folders are renamed (SPEC 6). Open boards are
 * updated through their store (undoable, saved like any edit); closed boards through vault.process.
 * Deletions keep the reference, so the module shows a "not found" placeholder instead of vanishing.
 */
export async function onVaultRename(app: App, oldPath: string, newPath: string) {
	const open = new Map<string, PatchworkView>();
	for (const leaf of app.workspace.getLeavesOfType(VIEW_TYPE_BOARD)) {
		const view = leaf.view;
		if (view instanceof PatchworkView && view.file) open.set(view.file.path, view);
	}
	// JSON escapes some characters; search for the path as it appears inside a JSON string.
	const needle = JSON.stringify(oldPath).slice(1, -1);
	for (const board of app.vault.getFiles().filter((f) => f.extension === BOARD_EXTENSION)) {
		const view = open.get(board.path);
		if (view?.store) {
			if (!view.store.readOnly) view.store.update((f) => rewritePaths(f, oldPath, newPath));
			continue;
		}
		await rewriteClosedBoard(app, board, oldPath, newPath, needle);
	}
}

async function rewriteClosedBoard(app: App, board: TFile, oldPath: string, newPath: string, needle: string) {
	if (!(await app.vault.cachedRead(board)).includes(needle)) return;
	await app.vault.process(board, (text) => {
		const parsed = parseBoard(text);
		// Never rewrite a board we can't fully understand (hard rule 2) or a newer format.
		if (!parsed.ok || parsed.readOnly) return text;
		const next = rewritePaths(parsed.file, oldPath, newPath);
		return next === parsed.file ? text : serializeBoard(next);
	});
}
