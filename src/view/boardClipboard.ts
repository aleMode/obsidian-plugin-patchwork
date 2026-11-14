import { Notice } from 'obsidian';
import { allIds } from '../model/defaults';
import { flowChains, isLinked, NO_FRAMES_ON_MASTERS } from '../model/flow';
import { newId } from '../model/ids';
import { plainText } from '../model/mdFormat';
import type { AnyModule, ImageModule, TextModule } from '../model/schema';
import { addModule, defaultModuleRect, findModule, pasteModules } from '../store/pageOps';
import type { BoardViewport } from './BoardViewport';
import { moduleTitle } from './OutlineRenderer';

// Copy, cut and paste of modules (review F5): within a page, across pages and across patchworks.
// The clipboard gets our own format (the modules as JSON) and plain text for anywhere else. Pasting
// plain text makes a text box; pasting an image saves it as an attachment and places it.

/** A web custom format: Chromium keeps it apart from the usual types, so other apps never see JSON. */
const FORMAT = 'web application/x-patchwork+json';

/** What was last copied here, for when the clipboard refuses our format (then only the text is there). */
let lastCopy: { text: string; modules: AnyModule[] } | null = null;

/** Copy the selected modules; false when nothing copyable is selected (the key is then left alone). */
export async function copySelection(board: BoardViewport, cut = false): Promise<boolean> {
	const file = board.boardStore.file;
	const modules = board.selectedItems.flatMap((it) => (it.moduleId ? [findModule(file, it.pageId, it.moduleId)] : [])).filter((m): m is AnyModule => !!m);
	if (modules.length === 0) return false;
	const text = modules.map(asText).filter(Boolean).join('\n\n') || modules.map(moduleTitle).join('\n');
	lastCopy = { text, modules: structuredClone(modules) };
	try {
		const json = JSON.stringify({ patchwork: 1, modules });
		await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), [FORMAT]: new Blob([json], { type: FORMAT }) })]);
	} catch {
		await navigator.clipboard.writeText(text).catch(() => undefined);
	}
	if (cut && !board.boardStore.readOnly) board.deleteSelection();
	return true;
}

/** What other apps get: a text box's markdown, else nothing (a title list is the fallback). */
function asText(m: AnyModule): string {
	return m.type === 'text' ? plainText((m as TextModule).markdown) : '';
}

/** Paste onto the selected page (or the page of the selected item), else the page new items go to. */
export async function paste(board: BoardViewport): Promise<void> {
	if (board.boardStore.readOnly) return;
	const pageId = board.selectedItems[0]?.pageId ?? board.pageForNewItems()?.id;
	if (!pageId) return void new Notice('Add a page first.');
	const items = await navigator.clipboard.read().catch(() => null);
	const ours = items?.find((it) => it.types.includes(FORMAT));
	if (ours) return pasteOurs(board, pageId, await readModules(ours));
	const image = items?.find((it) => it.types.some((t) => t.startsWith('image/')));
	if (image) return pasteImage(board, pageId, image);
	const text = await navigator.clipboard.readText().catch(() => '');
	if (lastCopy && text === lastCopy.text) return pasteOurs(board, pageId, lastCopy.modules);
	if (text.trim()) pasteText(board, pageId, text);
}

async function readModules(item: ClipboardItem): Promise<AnyModule[]> {
	try {
		const data = JSON.parse(await (await item.getType(FORMAT)).text()) as { modules?: unknown };
		return Array.isArray(data.modules) ? (data.modules as AnyModule[]).filter((m) => m && typeof m.id === 'string' && typeof m.type === 'string') : [];
	} catch {
		return [];
	}
}

function pasteOurs(board: BoardViewport, pageId: string, modules: AnyModule[]) {
	const store = board.boardStore;
	const page = store.file.pages.find((p) => p.id === pageId);
	if (!page || modules.length === 0) return;
	const chains = flowChains({ pages: [{ ...page, modules }] });
	if (page.isMaster && modules.some((m) => isLinked(chains, m))) return void new Notice(NO_FRAMES_ON_MASTERS);
	let pasted: string[] = [];
	store.update((f) => {
		const r = pasteModules(f, pageId, modules, () => newId(allIds(f)));
		pasted = r.pasted;
		return r.file;
	});
	board.setItems(pasted.map((moduleId) => ({ pageId, moduleId })));
}

function pasteText(board: BoardViewport, pageId: string, text: string) {
	const store = board.boardStore;
	const page = store.file.pages.find((p) => p.id === pageId);
	if (!page) return;
	const id = newId(allIds(store.file));
	const box: TextModule = { id, type: 'text', ...defaultModuleRect(page, { w: 80, h: 30 }), markdown: text.trim(), style: { padding: 1 } };
	store.update((f) => addModule(f, pageId, box));
	board.select({ pageId, moduleId: id });
	void board.fitBoxToText(pageId, id);
}

/** Saved where Obsidian puts attachments for this patchwork (the user's setting), then placed. */
async function pasteImage(board: BoardViewport, pageId: string, item: ClipboardItem) {
	const type = item.types.find((t) => t.startsWith('image/'))!;
	const ext = type === 'image/jpeg' ? 'jpg' : type.slice(6).replace(/\+.*$/, '');
	const app = board.app;
	const blob = await item.getType(type);
	const path = await app.fileManager.getAvailablePathForAttachment(`Pasted image ${stamp()}.${ext}`, board.view.file?.path);
	const file = await app.vault.createBinary(path, await blob.arrayBuffer());
	const aspect = await blobAspect(blob);
	const store = board.boardStore;
	const page = store.file.pages.find((p) => p.id === pageId);
	if (!page) return;
	const id = newId(allIds(store.file));
	const r = defaultModuleRect(page, { w: 80, h: 60 });
	const image: ImageModule = { id, type: 'image', ...r, h: Math.max(5, Math.min(page.h - r.y, r.w / aspect)), file: file.path };
	store.update((f) => addModule(f, pageId, image));
	board.select({ pageId, moduleId: id });
}

async function blobAspect(blob: Blob): Promise<number> {
	try {
		const bmp = await createImageBitmap(blob);
		const aspect = bmp.width / Math.max(1, bmp.height);
		bmp.close();
		return aspect || 4 / 3;
	} catch {
		return 4 / 3;
	}
}

function stamp(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
