// End-to-end check of linked text frames (M5): text flows block by block across frames and pages.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const vault = app.vault;
const plugin = app.plugins.plugins.patchwork;
const DIR = '_e2e';
const EXPORT = { format: 'pdf', pages: 'all', range: '', sheet: 'native', orientation: 'auto', overlap: 0, fitSmallPages: false, tileLabels: false, inkSaver: false, layout: 'single', bleed: 0, cropMarks: false, quality: 'best', dpi: 150, open: false };
const until = async (fn, ms = 5000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (fn()) return true;
		await sleep(100);
	}
	return false;
};
const para = (i) => `PARA-${String(i).padStart(2, '0')} lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`;
const text = (n, heading) => Array.from({ length: n }, (_, i) => (i + 1 === heading ? `## HEADING-${i + 1}\n\n${para(i + 1)}` : para(i + 1))).join('\n\n');
const d = vault.getAbstractFileByPath(DIR);
if (d) await vault.delete(d, true);
await vault.createFolder(DIR);
try {
	const file = await plugin.createBoard(vault.getAbstractFileByPath(DIR));
	await sleep(300);
	const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file === file);
	const page1 = view.store.file.pages[0].id;
	view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], w: 148, h: 210, modules: [{ id: 'head', type: 'text', x: 10, y: 10, w: 100, h: 60, markdown: text(14, 6) }] }] }));
	view.surface.zoomToFit();
	await sleep(300);
	view.surface.continueInFrame(page1, 'head');
	await sleep(200);
	const pages = view.store.file.pages;
	const frame = pages[0].modules[1];
	check('continuing adds a frame linked to the text, on the same page', pages.length === 1 && frame?.type === 'frame' && frame.from === 'head' && frame.w === 100 && frame.h === 60, [pages.length, frame]);
	const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
	check('the new frame sits in free space, inside the page', !overlaps(frame, pages[0].modules[0]) && frame.y + frame.h <= pages[0].h && frame.x + frame.w <= pages[0].w, frame);
	view.surface.zoomToFit();

	const mod = (id) => view.contentEl.querySelector(`.pw-module[data-module-id="${id}"]`);
	const paras = (id) => (mod(id)?.innerText.match(/PARA-\d\d/g) ?? []).map((s) => Number(s.slice(5)));
	const settled = () => paras('head').length > 0 && paras(frame.id).length > 0;
	await until(settled);
	const a = paras('head');
	const b = paras(frame.id);
	check('text splits between the frames in order, nothing repeated', a.length > 0 && b.length > 0 && b[0] === a[a.length - 1] + 1 && a[0] === 1, [a, b]);
	const leftover = b[b.length - 1] < 14;
	check('last frame marked when text is left over', mod(frame.id).hasClass('is-overflowing') === leftover, [b, mod(frame.id).className]);
	const lastHead = [...mod('head').querySelectorAll('.pw-flow-block')].pop()?.innerText ?? '';
	check('a heading is never the last block in a frame', !lastHead.startsWith('HEADING'), lastHead);
	const inside = (id) => {
		const m = mod(id).getBoundingClientRect();
		return [...mod(id).querySelectorAll('.pw-flow-block')].every((blk) => blk.getBoundingClientRect().bottom <= m.bottom + 1);
	};
	check('every block shown fits inside its frame', inside('head') && inside(frame.id));

	// Taller head: more text in it, the frame starts later.
	view.store.update((f) => ({ ...f, pages: f.pages.map((p) => ({ ...p, modules: p.modules.map((m) => (m.id === 'head' ? { ...m, h: 120 } : m)) })) }));
	check('resizing re-flows the chain', await until(() => paras('head').length > a.length && paras(frame.id)[0] === paras('head').slice(-1)[0] + 1), [paras('head'), paras(frame.id)]);

	// A third frame, then delete the middle one: the chain closes up.
	view.surface.continueInFrame(page1, frame.id);
	await sleep(200);
	const third = view.store.file.pages[0].modules[2];
	check('a frame can be continued again, still on the one page', view.store.file.pages.length === 1 && third.type === 'frame' && third.from === frame.id, third);
	view.surface.select({ pageId: page1, moduleId: frame.id });
	view.surface.deleteSelection();
	await sleep(200);
	check('deleting a middle frame links its neighbours', view.store.file.pages[0].modules.find((m) => m.id === third.id).from === 'head');
	view.store.undo();
	await sleep(200);

	// Editing the text re-flows it.
	view.store.update((f) => ({ ...f, pages: f.pages.map((p) => ({ ...p, modules: p.modules.map((m) => (m.id === 'head' ? { ...m, h: 60, markdown: text(4) } : m)) })) }));
	check('editing the text re-flows; spare frames stay empty', await until(() => paras(frame.id).length + paras('head').length === 4 && paras(third.id).length === 0), [paras('head'), paras(frame.id), paras(third.id)]);

	// A note as the head, and export.
	const note = await vault.create(`${DIR}/Long.md`, text(14, 6));
	view.store.update((f) => ({ ...f, pages: f.pages.map((p) => ({ ...p, modules: p.modules.map((m) => (m.id === 'head' ? { id: 'head', type: 'note', file: note.path, x: 10, y: 10, w: 100, h: 60 } : m)) })) }));
	await until(() => paras('head').length > 0 && paras(frame.id).length > 0);
	const shown = [...paras('head'), ...paras(frame.id), ...paras(third.id)];
	check('a note can head a chain', shown[0] === 1 && shown.every((n, i) => n === i + 1), shown);

	await view.surface.runExport({ ...EXPORT, base: `${DIR}/out` });
	const out = vault.getAbstractFileByPath(`${DIR}/out.pdf`);
	const doc = await plugin.pdfDocs.acquire(out.path);
	const printed = [];
	for (let i = 1; i <= doc.numPages; i++) printed.push(((await (await doc.getPage(i)).getTextContent()).items.map((t) => t.str).join(' ').match(/PARA-\d\d/g) ?? []).map((s) => Number(s.slice(5))));
	plugin.pdfDocs.release(out.path);
	plugin.pdfDocs.invalidate(out.path);
	check('export prints each frame’s share, as on screen', JSON.stringify(printed.flat().sort()) === JSON.stringify([...paras('head'), ...paras(frame.id), ...paras(third.id)].sort()) && printed.length === 1, [printed, paras('head'), paras(frame.id), paras(third.id)]);

	await vault.modify(note, text(3));
	check('editing the note re-flows the chain', await until(() => [...paras('head'), ...paras(frame.id)].length === 3), [paras('head'), paras(frame.id)]);

	// Cuts inside blocks: a paragraph of single-newline lines, an ordered list and a table move line by line.
	const n2 = (i) => String(i).padStart(2, '0');
	const lines = Array.from({ length: 12 }, (_, i) => `LN-${n2(i + 1)} a short line`).join('\n');
	const items = Array.from({ length: 8 }, (_, i) => `${i + 1}. IT-${n2(i + 1)} item`).join('\n');
	const rows = Array.from({ length: 10 }, (_, i) => `| RW-${n2(i + 1)} | x |`).join('\n');
	const md = `## TOP\n${lines}\n\n${items}\n\n| COLA | COLB |\n|---|---|\n${rows}`;
	const box = (id, from, y, h) => ({ id, ...(from ? { type: 'frame', from } : { type: 'text', markdown: md }), x: 10, y, w: 100, h });
	const fine = [box('head', null, 10, 40), box('f2', 'head', 55, 60), box('f3', 'f2', 120, 85)];
	view.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: fine }, { ...f.pages[0], id: 'p2', modules: [box('f4', 'f3', 10, 150)] }] }));
	await sleep(200);
	view.surface.zoomToFit();
	const tokens = (id) => mod(id)?.innerText.match(/(LN|IT|RW)-\d\d/g) ?? [];
	const fineIds = ['head', 'f2', 'f3', 'f4'];
	const all = () => fineIds.flatMap(tokens);
	const want = [...lines.match(/LN-\d\d/g), ...items.match(/IT-\d\d/g), ...rows.match(/RW-\d\d/g)];
	await until(() => JSON.stringify(all()) === JSON.stringify(want));
	check('lines, items and rows each show once, in order, across the frames', JSON.stringify(all()) === JSON.stringify(want), fineIds.map(tokens));
	const headLast = tokens('head').pop();
	check('the head frame stops inside the paragraph', headLast?.startsWith('LN-') && headLast !== 'LN-12', tokens('head'));
	const numbered = fineIds.every((id) => [...mod(id).querySelectorAll('ol')].every((ol) => Number(/IT-(\d\d)/.exec(ol.innerText)?.[1]) === ol.start));
	check('a list carried into the next frame keeps its numbering', numbered, fineIds.map((id) => [...mod(id).querySelectorAll('ol')].map((ol) => ol.start)));
	check('the list and the table are each cut between two frames', ['IT-', 'RW-'].every((t) => fineIds.filter((id) => tokens(id).some((x) => x.startsWith(t))).length >= 2), fineIds.map(tokens));
	const headers = fineIds.every((id) => !/RW-/.test(mod(id).innerText) || mod(id).querySelector('th')?.innerText.includes('COLA'));
	check('a table carried into the next frame repeats its header', headers, fineIds.map((id) => mod(id).querySelector('th')?.innerText));
	check('every block shown fits inside its frame (fine cuts)', fineIds.every(inside));
	const before = tokens('head').length;
	view.store.update((f) => ({ ...f, pages: f.pages.map((p) => ({ ...p, modules: p.modules.map((m) => (m.id === 'head' ? { ...m, h: 34 } : m)) })) }));
	await until(() => tokens('head').length !== before);
	const after = tokens('head').length;
	check('shrinking a frame a little moves a line or two, not the whole paragraph', after >= 1 && after < before && before - after <= 2 && JSON.stringify(all()) === JSON.stringify(want), [before, after, tokens('head')]);
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	document.querySelectorAll('.notice').forEach((n) => n.remove());
	app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
	await new Promise((r) => setTimeout(r, 400)); // let pending saves finish before deleting their files
	const dir = vault.getAbstractFileByPath(DIR);
	if (dir) await vault.delete(dir, true);
}
return { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
