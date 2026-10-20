// End-to-end check of the Patchwork settings dialog and the toolbar menus: one undo step for a whole
// round of edits across tabs, fixed unit label, tabs keep their values, and export reachable from menus.
import { connect } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const V = `const L = app.workspace.getLeavesOfType('patchwork-board').find((l) => l.view.file?.path.startsWith('_e2e/')); const v = L.view;`;
const tab = (name) => cdp.evaluate(`[...document.querySelectorAll('.pw-tab')].find((t) => t.textContent === '${name}').click(); await new Promise((r) => setTimeout(r, 150));`);
const setting = (label, fn) =>
	cdp.evaluate(`const row = [...document.querySelectorAll('.pw-tab-body .setting-item')].find((e) => e.querySelector('.setting-item-name')?.textContent === '${label}'); ${fn}; await new Promise((r) => setTimeout(r, 100));`);
const typeIn = (label, value) => setting(label, `const i = row.querySelector('input'); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true }))`);
const toggle = (label) => setting(label, `row.querySelector('.checkbox-container').click()`);
const pick = (label, value) => setting(label, `const s = row.querySelector('select'); s.value = '${value}'; s.dispatchEvent(new Event('change', { bubbles: true }))`);
const menuTitles = (label) =>
	cdp.evaluate(`document.querySelector('.pw-toolbar [aria-label^="${label}"]').click(); await new Promise((r) => setTimeout(r, 250)); const t = [...document.querySelectorAll('.menu .menu-item-title')].map((e) => e.textContent); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 150)); return t;`);

try {
	await cdp.evaluate(`
		const vault = app.vault;
		if (vault.getAbstractFileByPath('_e2e')) await vault.delete(vault.getAbstractFileByPath('_e2e'), true);
		await vault.createFolder('_e2e');
		await app.plugins.plugins.patchwork.createBoard(vault.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 700));
		${V} app.workspace.setActiveLeaf(L, { focus: true });`);

	await cdp.evaluate(`${V} v.surface.showSettings(); await new Promise((r) => setTimeout(r, 400));`);
	const tabs = await cdp.evaluate(`return [...document.querySelectorAll('.pw-tab')].map((t) => t.textContent)`);
	check('dialog has the four tabs', JSON.stringify(tabs) === JSON.stringify(['Layout', 'Numbering', 'Appearance', 'Document']), tabs);

	await pick('Display unit', 'cm');
	const suffix = await cdp.evaluate(`return document.querySelector('.pw-tab-body .pw-unit-suffix')?.textContent`);
	check('lengths show the unit as a fixed label', suffix === 'cm', suffix);
	await typeIn('Grid size', '1');
	await typeIn('Grid size', '2 mm'); // unit text is rejected: stays at 1 cm = 10 mm
	await toggle('Snap to grid');
	await tab('Numbering');
	await toggle('Show page numbers');
	await typeIn('Start at', '5');
	await pick('Format', 'roman');
	await typeIn('Header', '{title} - {page}');
	await tab('Appearance');
	await toggle('PDF regions in dark mode');
	await tab('Document');
	await typeIn('Title', 'My patchwork');
	await tab('Layout');
	const kept = await cdp.evaluate(`return [...document.querySelectorAll('.pw-tab-body .setting-item')].map((e) => e.querySelector('.setting-item-name').textContent + '=' + (e.querySelector('input')?.value ?? e.querySelector('select')?.value ?? '')).join('|')`);
	check('edits survive switching tabs', kept.includes('Display unit=cm') && kept.includes('Grid size=1'), kept);

	await cdp.evaluate(`[...document.querySelectorAll('.modal button')].find((b) => b.textContent === 'Apply').click(); await new Promise((r) => setTimeout(r, 400));`);
	const after = JSON.parse(await cdp.evaluate(`${V} const f = v.store.file; return JSON.stringify({ unit: f.board.displayUnit, grid: f.board.grid, num: f.board.numbering, header: f.board.header, dark: f.board.pdfDarkMode, title: f.meta?.title });`));
	check('everything applied', after.unit === 'cm' && after.grid.size === 10 && after.grid.snap === false && after.num.enabled && after.num.start === 5 && after.num.format === 'roman' && after.header === '{title} - {page}' && after.dark === true && after.title === 'My patchwork', after);
	check('typed unit text was rejected (grid stays 1 cm)', after.grid.size === 10, after.grid);

	await cdp.evaluate(`${V} v.store.undo()`);
	const undone = JSON.parse(await cdp.evaluate(`${V} const f = v.store.file; return JSON.stringify({ unit: f.board.displayUnit, num: f.board.numbering.enabled, title: f.meta?.title ?? null, header: f.board.header ?? null });`));
	check('one undo reverts the whole dialog', undone.unit === 'mm' && undone.num === false && undone.title === null && undone.header === null, undone);

	const more = await menuTitles('Add text');
	check('More menu: text, image, table of contents, trackers', ['Text box', 'Image', 'Table of contents', 'Counter', 'Boxes', 'Checklist'].every((t) => more.includes(t)), more);
	const exp = await menuTitles('Export');
	check('Export menu: PDF or PNG, and canvas', exp.some((t) => t.startsWith('Export as PDF or PNG')) && exp.includes('Export to canvas'), exp);
	const view = await menuTitles('Outline');
	check('View menu: panels and minimap', view.some((t) => t.startsWith('Inspector and outline')) && view.includes('Minimap'), view);

	await cdp.evaluate(`${V} v.surface.showExport(); await new Promise((r) => setTimeout(r, 400));`);
	const sections = await cdp.evaluate(`return [...document.querySelectorAll('.pw-export-section > summary')].map((s) => s.textContent + ':' + s.parentElement.open)`);
	check('export dialog: sheets and quality are collapsed by default', JSON.stringify(sections) === JSON.stringify(['Sheets and printing:false', 'Quality:false']), sections);
	await cdp.evaluate(`document.querySelector('.modal .pw-export-section').open = true; await new Promise((r) => setTimeout(r, 100));`);
	const names = await cdp.evaluate(`return [...document.querySelectorAll('.modal .pw-export-section')][0].querySelectorAll('.setting-item-name').length`);
	check('opening the section shows its settings', names >= 3, names);
} catch (e) {
	check('no exception', false, String(e.stack ?? e));
} finally {
	await cdp
		.evaluate(`for (let k = 0; k < 20 && document.querySelector('.modal-container'); k++) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 50)); }
			app.workspace.getLeavesOfType('patchwork-board').filter((l) => l.view.file?.path.startsWith('_e2e/')).forEach((l) => l.detach());
			await new Promise((r) => setTimeout(r, 500));
			const d = app.vault.getAbstractFileByPath('_e2e'); if (d) await app.vault.delete(d, true);`)
		.catch(() => {});
	cdp.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;
