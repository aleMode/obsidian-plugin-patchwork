// End-to-end check of the crop editor's contents (PDF outline) and search-to-region (SPEC 4 M3).
import { connect } from '../cdpClient.mjs';

// Any large PDF you keep locally; override with E2E_LARGE_PDF / E2E_LARGE_PDF_QUERY (a word it contains).
const LARGE_PDF = process.env.E2E_LARGE_PDF ?? 'PDFs/Large rulebook.pdf';
const LARGE_PDF_QUERY = process.env.E2E_LARGE_PDF_QUERY ?? 'the';
const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inView = (body) =>
	cdp.evaluate(`const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file?.path.startsWith('_e2e/')); const s = view.surface; ${body}`);
const modal = (body) => cdp.evaluate(`const m = document.querySelector('.pw-crop-modal'); ${body}`);
async function search(term) {
	await modal(`const i = m.querySelector('.pw-crop-search'); i.value = ${JSON.stringify(term)}; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
	for (let i = 0; i < 100; i++) {
		const status = await modal("return m.querySelector('.pw-crop-status')?.innerText ?? ''");
		if (/matches|No matches/.test(status)) return status;
		await sleep(100);
	}
	return 'timeout';
}

try {
	await cdp.evaluate(`
		const v = app.vault;
		if (v.getAbstractFileByPath('_e2e')) await v.delete(v.getAbstractFileByPath('_e2e'), true);
		await v.createFolder('_e2e');
		await app.plugins.plugins.patchwork.createBoard(v.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 400));`);
	await inView(`view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: [{ id: 'pdf', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, x: 10, y: 10, w: 100, h: 140 }] }] }));
		s.editCrop(view.store.file.pages[0].id, 'pdf'); await new Promise((r) => setTimeout(r, 1500));`);
	const options = await modal("return [...m.querySelectorAll('.pw-crop-contents option')].map((o) => o.text.trim());");
	check('contents list the PDF bookmarks with pages', options.includes('Chapter 2: Spells (p. 2)') && options.some((o) => o.endsWith('Fireball (p. 2)')), options);
	await modal("const sel = m.querySelector('.pw-crop-contents'); sel.value = '3'; sel.dispatchEvent(new Event('change'));");
	await sleep(800);
	check('choosing a bookmark jumps to its page', (await modal("return m.querySelector('.pw-crop-page-input').value;")) === '3');

	const status = await search('Goblin Skirmisher');
	check('search finds the term', status.startsWith('1 matches') || status.startsWith('1'), status);
	await modal("m.querySelector('.pw-crop-hit').click();");
	await sleep(1000);
	check('clicking a hit goes to its page', (await modal("return m.querySelector('.pw-crop-page-input').value;")) === '1');
	await modal("Array.from(m.querySelectorAll('button')).find((b) => b.innerText === 'Apply').click();");
	await sleep(300);
	const crop = await inView('return view.store.file.pages[0].modules[0].crop;');
	// "Goblin Skirmisher" heading sits at x 24 mm, baseline 158 mm on an A4 page.
	const inside = crop && crop[0] < 24 / 210 && crop[2] > 60 / 210 && crop[1] < 152 / 297 && crop[3] > 160 / 297;
	check('proposed crop contains the hit', inside, crop);

	// Optional: a large real PDF kept locally (test-vault/PDFs/*.pdf is gitignored) to time search on a long document.
	const hasRulebook = await cdp.evaluate(`return !!app.vault.getAbstractFileByPath(${JSON.stringify(LARGE_PDF)});`);
	if (hasRulebook) {
		await inView(`view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: [{ id: 'big', type: 'pdf', file: ${JSON.stringify(LARGE_PDF)}, page: 1, x: 10, y: 10, w: 100, h: 140 }] }] }));
			s.editCrop(view.store.file.pages[0].id, 'big'); await new Promise((r) => setTimeout(r, 2000));`);
		const t0 = Date.now();
		const st = await search(LARGE_PDF_QUERY);
		check('searching a large PDF finds matches', /^\d+\+? matches/.test(st), st);
		check('…in reasonable time (< 10 s)', Date.now() - t0 < 10000, Date.now() - t0);
		await cdp.evaluate("for (let k = 0; k < 20 && document.querySelector('.modal-container'); k++) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 50)); }");
	}
} catch (e) {
	check('no exception', false, String(e.stack ?? e));
} finally {
	await cdp
		.evaluate(`for (let k = 0; k < 20 && document.querySelector('.modal-container'); k++) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 50)); } app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
		await new Promise((r) => setTimeout(r, 400));
		const d = app.vault.getAbstractFileByPath('_e2e'); if (d) await app.vault.delete(d, true);`)
		.catch(() => {});
	cdp.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;
