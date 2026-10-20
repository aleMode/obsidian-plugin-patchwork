import { App, TFile } from 'obsidian';
import { renamedLinkTarget, type Retarget, rewritePaths } from '../model/links';
import { serializeBoard } from '../model/serialize';
import { parseBoard } from '../model/validate';
import type { BoardStore } from '../store/BoardStore';
import { BOARD_EXTENSION, PatchworkView, VIEW_TYPE_BOARD } from '../view/PatchworkView';

/**
 * Keep board references valid when notes, PDFs or folders are renamed (SPEC 6). Open boards are
 * updated through their store (undoable, saved like any edit); closed boards through vault.process.
 * Deletions keep the reference, so the module shows a "not found" placeholder instead of vanishing.
 */
export async function onVaultRename(app: App, oldPath: string, newPath: string) {
	const open = openBoards(app);
	// Links in text name the file or a trailing part of its path, so the last segment (without its
	// extension) is in every board that refers to it. JSON escapes some characters, hence stringify.
	const lastSegment = oldPath.replace(/^.*\//, '').replace(/\.[^.]*$/, '');
	const needle = JSON.stringify(lastSegment).slice(1, -1);
	const moved = app.vault.getFiles().filter((f) => f.path === newPath || f.path.startsWith(`${newPath}/`)).map((f) => f.path);
	for (const board of app.vault.getFiles().filter((f) => f.extension === BOARD_EXTENSION)) {
		const target = open.get(board);
		if (!target) {
			await rewriteClosedBoard(app, board, oldPath, newPath, needle, linkRetarget(app, board.path, oldPath, newPath, moved));
			continue;
		}
		const { view, store } = target;
		if (store.readOnly) continue;
		const before = store.file;
		store.update((f) => rewritePaths(f, oldPath, newPath, linkRetarget(app, board.path, oldPath, newPath, moved)));
		// Other panes on this board reload from disk once it is written; until then they would show the old path as missing.
		if (store.file !== before) await view.save();
	}
}

/**
 * One loaded view per open board, keyed by file object rather than path: while a folder move is under
 * way an open board's path can still be the old one, and taking it for a closed board would rewrite it
 * on disk behind the view (a conflict copy on its next save). With the board in several panes, the rewrite goes through one of
 * them only (each pane has its own store, and two panes with unsaved edits end in a conflict copy):
 * the one holding unsaved edits, if any, so those are kept.
 */
function openBoards(app: App): Map<TFile, { view: PatchworkView; store: BoardStore }> {
	const open = new Map<TFile, { view: PatchworkView; store: BoardStore }>();
	for (const leaf of app.workspace.getLeavesOfType(VIEW_TYPE_BOARD)) {
		const view = leaf.view;
		// Views not loaded yet (background tabs restored at startup) and error views read the disk later.
		if (!(view instanceof PatchworkView) || !view.file || !view.store) continue;
		const seen = open.get(view.file);
		if (!seen || (!seen.view.hasUnsavedEdits && view.hasUnsavedEdits)) open.set(view.file, { view, store: view.store });
	}
	return open;
}

/**
 * Links in a board's text that pointed into the renamed file or folder get the target's new link text.
 * Links that still resolve are left alone (a name that now finds another file is the user's to fix).
 */
function linkRetarget(app: App, boardPath: string, oldPath: string, newPath: string, moved: readonly string[]): Retarget {
	return (linkpath) => {
		if (app.metadataCache.getFirstLinkpathDest(linkpath, boardPath)) return null;
		const target = renamedLinkTarget(linkpath, oldPath, newPath, moved);
		const file = target === null ? null : app.vault.getAbstractFileByPath(target);
		return file instanceof TFile ? app.metadataCache.fileToLinktext(file, boardPath, true) : null;
	};
}

async function rewriteClosedBoard(app: App, board: TFile, oldPath: string, newPath: string, needle: string, retarget: Retarget) {
	if (!(await app.vault.cachedRead(board)).includes(needle)) return;
	await app.vault.process(board, (text) => {
		const parsed = parseBoard(text);
		// Never rewrite a board we can't fully understand (hard rule 2) or a newer format.
		if (!parsed.ok || parsed.readOnly) return text;
		const next = rewritePaths(parsed.file, oldPath, newPath, retarget);
		return next === parsed.file ? text : serializeBoard(next);
	});
}
