// End-to-end check of the crop editor with real mouse input.
import { connect } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inView = (body) =>
	cdp.evaluate(`const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file?.path.startsWith('_e2e/')); const s = view.surface; ${body}`);

try {
	await cdp.evaluate(`
		const v = app.vault;
		if (v.getAbstractFileByPath('_e2e')) await v.delete(v.getAbstractFileByPath('_e2e'), true);
		await v.createFolder('_e2e');
		await app.plugins.plugins.patchwork.createBoard(v.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 400));`);
	await inView(`view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: [{ id: 'pdf', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, x: 10, y: 10, w: 100, h: 140 }] }] }));
		s.zoomToFit(); await new Promise((r) => setTimeout(r, 300)); s.editCrop(view.store.file.pages[0].id, 'pdf'); await new Promise((r) => setTimeout(r, 1500));`);
	const stage = await cdp.evaluate("const r = document.querySelector('.pw-crop-stage').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };");
	check('crop editor shows the page', stage.w > 100 && (await cdp.evaluate("return document.querySelector('.pw-crop-canvas')?.width > 0")));
	// Draw the stat block region: x 20-110 mm, y 150-230 mm of an A4 page.
	const at = (mmX, mmY) => ({ x: stage.x + (mmX / 210) * stage.w, y: stage.y + (mmY / 297) * stage.h });
	await cdp.drag(at(20, 150), at(110, 230));
	await sleep(100);
	await cdp.evaluate("Array.from(document.querySelectorAll('.pw-crop-modal button')).find((b) => b.innerText === 'Apply').click();");
	await sleep(300);
	const m = await inView("return view.store.file.pages[0].modules[0];");
	const near = (a, b) => Math.abs(a - b) < 0.01;
	check('crop applied from the drawn rectangle', m.crop && near(m.crop[0], 20 / 210) && near(m.crop[1], 150 / 297) && near(m.crop[2], 110 / 210) && near(m.crop[3], 230 / 297), m.crop);
	check('module resized to the crop shape', Math.abs(m.h - 100 * (80 / 90)) < 1.5, m.h);
	check('crop is one undo step', (await inView('view.store.undo(); return view.store.file.pages[0].modules[0].crop === undefined;')));
} catch (e) {
	check('no exception', false, String(e.stack ?? e));
} finally {
	await cdp
		.evaluate(`document.querySelectorAll('.modal-close-button').forEach((b) => b.click()); app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	await new Promise((r) => setTimeout(r, 400)); // let pending saves finish before deleting their files
		const d = app.vault.getAbstractFileByPath('_e2e'); if (d) await app.vault.delete(d, true);`)
		.catch(() => {});
	cdp.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;
