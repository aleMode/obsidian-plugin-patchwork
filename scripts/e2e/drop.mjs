// End-to-end check of dropping files from the file explorer onto a page (real drag events).
import { connect } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inView = (body) =>
	cdp.evaluate(`const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file?.path.startsWith('_e2e/')); const s = view.surface; ${body}`);
// The same data Obsidian's file explorer puts on a drag (captured with Input.setInterceptDrags).
const uri = (path) => `obsidian://open?vault=test-vault&file=${encodeURIComponent(path)}`;
async function drop(paths, at) {
	const data = { items: [{ mimeType: 'text/uri-list', data: paths.map(uri).join('\r\n') }, { mimeType: 'text/plain', data: paths.map(uri).join('\n') }], dragOperationsMask: 1 };
	for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: at.x, y: at.y, data });
	await sleep(400);
}

try {
	await cdp.evaluate(`
		const v = app.vault;
		if (v.getAbstractFileByPath('_e2e')) await v.delete(v.getAbstractFileByPath('_e2e'), true);
		await v.createFolder('_e2e');
		await app.plugins.plugins.patchwork.createBoard(v.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 400));`);
	await inView('s.zoomToFit(); await new Promise((r) => setTimeout(r, 300));');
	const page = await inView("const r = view.contentEl.querySelector('.pw-page-paper').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };");
	const at = (fx, fy) => ({ x: page.x + page.w * fx, y: page.y + page.h * fy });

	await drop(['Rules/Combat'], at(0.2, 0.2));
	let mods = await inView('return view.store.file.pages[0].modules;');
	check('dropping a note adds a note module', mods.length === 1 && mods[0].type === 'note' && mods[0].file === 'Rules/Combat.md', mods);
	check('placed at the drop point', mods[0] && Math.abs(mods[0].x - 42) < 2 && Math.abs(mods[0].y - 59.4) < 2, mods[0]);

	await drop(['Images/Map.png'], at(0.6, 0.6));
	mods = await inView('return view.store.file.pages[0].modules;');
	const img = mods.find((m) => m.type === 'image');
	check('dropping an image keeps its aspect ratio', img && Math.abs(img.w / img.h - 400 / 300) < 0.01, img);

	await drop(['PDFs/Sample rulebook.pdf'], at(0.1, 0.7));
	const modal = await cdp.evaluate("return !!document.querySelector('.pw-crop-modal');");
	check('dropping a PDF opens the crop editor', modal);
	await sleep(800);
	await cdp.evaluate("Array.from(document.querySelectorAll('.pw-crop-modal button')).find((b) => b.innerText === 'Apply')?.click();");
	await sleep(300);
	mods = await inView('return view.store.file.pages[0].modules;');
	check('…and applying adds the PDF module', mods.some((m) => m.type === 'pdf' && m.file === 'PDFs/Sample rulebook.pdf' && m.page === 1), mods.map((m) => m.type));

	await drop(['Spells/Fireball', 'Monsters/Goblin'], at(0.5, 0.1));
	mods = await inView('return view.store.file.pages[0].modules;');
	check('dropping two notes adds both, cascaded', mods.filter((m) => m.type === 'note').length === 3);
} catch (e) {
	check('no exception', false, String(e.stack ?? e));
} finally {
	await cdp
		.evaluate(`document.querySelectorAll('.modal-close-button').forEach((b) => b.click()); app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
		const d = app.vault.getAbstractFileByPath('_e2e'); if (d) await app.vault.delete(d, true);`)
		.catch(() => {});
	cdp.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;
