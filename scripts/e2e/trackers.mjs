// End-to-end check of interactive trackers (M5) with real clicks: counters, boxes, checklists,
// undo, saving, and how they export.
import { connect } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inView = (body) => cdp.evaluate(`const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file?.path.startsWith('_e2e/')); ${body}`);
const centre = (selector) => cdp.evaluate(`const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`);
const click = async (selector) => {
	const p = await centre(selector);
	await cdp.mouse('mouseMoved', p.x, p.y, { button: 'none' });
	await cdp.mouse('mousePressed', p.x, p.y);
	await cdp.mouse('mouseReleased', p.x, p.y);
	await sleep(250);
};
try {
	await cdp.evaluate(`
		const vault = app.vault;
		const d = vault.getAbstractFileByPath('_e2e');
		if (d) await vault.delete(d, true);
		await vault.createFolder('_e2e');
		const file = await app.plugins.plugins.patchwork.createBoard(vault.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 300));
		const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
		view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: [
			{ id: 'hp', type: 'tracker', kind: 'counter', label: 'HP', value: 10, min: 0, max: 11, x: 10, y: 10, w: 60, h: 30 },
			{ id: 'slots', type: 'tracker', kind: 'boxes', label: 'Slots', max: 4, value: 1, x: 10, y: 50, w: 80, h: 20 },
			{ id: 'quests', type: 'tracker', kind: 'checklist', label: 'Quests', items: [{ text: 'QUEST-ONE' }, { text: 'QUEST-TWO' }], x: 10, y: 80, w: 80, h: 30, printBlank: true },
		] }] }));
		view.surface.zoomToFit();
		await new Promise((r) => setTimeout(r, 500));
		return true;`);
	const state = () => inView('return view.store.file.pages[0].modules.map((m) => m.value ?? m.items?.map((i) => !!i.done));');
	const hp = '.pw-module[data-module-id="hp"]';
	await click(`${hp} .pw-tracker-step:last-child`);
	await click(`${hp} .pw-tracker-step:last-child`);
	let s = await state();
	check('+ steps the counter, capped at its maximum', s[0] === 11, s);
	await click(`${hp} .pw-tracker-step:first-child`);
	s = await state();
	check('− steps it down', s[0] === 10, s);
	check('the counter shows its value', (await cdp.evaluate(`return document.querySelector('${hp} .pw-tracker-value').innerText`)) === '10');

	await click('.pw-module[data-module-id="slots"] .pw-tracker-box:nth-child(3)');
	s = await state();
	check('clicking a box fills up to it', s[1] === 3, s);
	await click('.pw-module[data-module-id="slots"] .pw-tracker-box:nth-child(3)');
	s = await state();
	check('clicking the last filled box empties it', s[1] === 2, s);

	await click('.pw-module[data-module-id="quests"] .pw-tracker-item:nth-child(2) .pw-tracker-box');
	s = await state();
	check('ticking a checklist item', JSON.stringify(s[2]) === '[true,false]', s);
	check('clicks on controls don’t select or move the module', await inView('const m = view.store.file.pages[0].modules[0]; return view.surface.selectedItems.length === 0 && m.x === 10 && m.y === 10;'));

	await inView('view.store.undo(); return true;');
	s = await state();
	check('each click is one undo step', JSON.stringify(s[2]) === '[false,false]' && s[1] === 2, s);

	// An empty corner of the module, away from its controls.
	const corner = await cdp.evaluate(`const r = document.querySelector('${hp}').getBoundingClientRect(); return { x: r.right - 6, y: r.bottom - 6 };`);
	await cdp.mouse('mouseMoved', corner.x, corner.y, { button: 'none' });
	await cdp.mouse('mousePressed', corner.x, corner.y);
	await cdp.mouse('mouseReleased', corner.x, corner.y);
	await sleep(250);
	check('clicking elsewhere on the module still selects it', await inView("return view.surface.selectedItems[0]?.moduleId === 'hp';"));

	const out = await inView(`
		await view.surface.runExport({ format: 'pdf', pages: 'all', range: '', sheet: 'native', orientation: 'auto', overlap: 0, fitSmallPages: false, tileLabels: false, inkSaver: false, layout: 'single', bleed: 0, cropMarks: false, quality: 'best', dpi: 150, open: false, base: '_e2e/out' });
		const plugin = app.plugins.plugins.patchwork;
		const doc = await plugin.pdfDocs.acquire('_e2e/out.pdf');
		const text = (await (await doc.getPage(1)).getTextContent()).items.map((t) => t.str).join(' ');
		plugin.pdfDocs.release('_e2e/out.pdf');
		plugin.pdfDocs.invalidate('_e2e/out.pdf');
		await new Promise((r) => setTimeout(r, 1500));
		const saved = JSON.parse(await app.vault.read(view.file)).pages[0].modules;
		return { text, saved: saved.map((m) => m.value ?? m.items) };`);
	check('export prints the state, without − and +', out.text.includes('HP') && out.text.includes('10') && !out.text.includes('−'), out.text);
	check('checklists print their items', out.text.includes('QUEST-ONE') && out.text.includes('QUEST-TWO'), out.text);
	check('state is saved in the board', out.saved[0] === 10 && out.saved[1] === 2, out.saved);
} catch (e) {
	check('no exception', false, String(e.stack ?? e));
} finally {
	await cdp.evaluate(`
		document.querySelectorAll('.notice').forEach((n) => n.remove());
		app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
		await new Promise((r) => setTimeout(r, 400));
		const d = app.vault.getAbstractFileByPath('_e2e');
		if (d) await app.vault.delete(d, true);
		return true;`);
	cdp.close();
}
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) }));
