// End-to-end check of the context bar and the properties popover: the right controls for each kind of
// selection, their effects on the model, the popover's tabs and editing, dismissal, key isolation and
// placement. Page-level actions only (no pointer input), so a hidden window is fine.
import { connect } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const V = `const L = app.workspace.getLeavesOfType('patchwork-board').find((l) => l.view.file?.path.startsWith('_e2e/')); const v = L.view; const s = v.surface; const mod = (id) => v.store.file.pages[0].modules.find((m) => m.id === id);`;
const ev = (body) => cdp.evaluate(`${V} ${body}`);
const wait = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;
const expand = `document.querySelector('.pw-context-pill')?.click();`;
const select = (id) => ev(`s.select(${id ? `{ pageId: 'a', moduleId: '${id}' }` : `{ pageId: 'a' }`}); ${wait(450)} ${expand} ${wait(150)}`);
const barText = () => ev(`const b = document.querySelector('.pw-context-bar'); return !b || b.classList.contains('is-hidden') ? 'hidden' : [...b.querySelectorAll('.pw-cb-btn, .pw-cb-label')].map((e) => e.textContent).join('|');`);
const clickBar = (tip) => ev(`document.querySelector('.pw-context-bar [aria-label^="${tip}"]').click(); ${wait(250)}`);
const pick = (title) =>
	ev(`const it = [...document.querySelectorAll('.menu .menu-item')].find((e) => e.querySelector('.menu-item-title')?.textContent.trim() === '${title}'); if (!it) return 'missing ${title}'; it.dispatchEvent(new MouseEvent('click', { bubbles: true })); ${wait(300)} return 'ok';`);
const tabs = () => ev(`const p = document.querySelector('.pw-popover'); return !p || p.classList.contains('is-hidden') ? 'closed' : [...p.querySelectorAll('.pw-tabs .pw-tab')].map((t) => t.textContent).join('|');`);
const rows = () => ev(`return [...document.querySelectorAll('.pw-popover .pw-prop-section:not(.is-hidden) .setting-item:not(.setting-item-heading) .setting-item-name')].map((e) => e.textContent).join('|');`);
const openMore = () => clickBar('More settings');
/** Poll until `fn` is true (timers are throttled in a hidden window). */
const until = async (fn, ms = 20000) => {
	const t = Date.now();
	while (Date.now() - t < ms) {
		if (await fn()) return true;
		await new Promise((r) => setTimeout(r, 300));
	}
	return false;
};
const tab = (name) => ev(`[...document.querySelectorAll('.pw-popover .pw-tab')].find((t) => t.textContent === '${name}').click(); ${wait(250)}`);

try {
	await cdp.evaluate(`
		const vv = app.vault;
		for (const l of app.workspace.getLeavesOfType('patchwork-board')) l.detach();
		await new Promise((r) => setTimeout(r, 400));
		if (vv.getAbstractFileByPath('_e2e')) await vv.delete(vv.getAbstractFileByPath('_e2e'), true);
		await vv.createFolder('_e2e');
		await app.plugins.plugins.patchwork.createBoard(vv.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 800));
		${V} app.workspace.setActiveLeaf(L, { focus: true });
		v.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], id: 'a', name: 'Front', modules: [
			{ id: 'n', type: 'note', file: 'Spells/Spell index.md', subpath: '#Spell index', x: 10, y: 10, w: 90, h: 40 },
			{ id: 'p', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, x: 10, y: 60, w: 90, h: 80 },
			{ id: 't', type: 'text', markdown: 'hello', x: 110, y: 10, w: 80, h: 30 },
			{ id: 'tr', type: 'tracker', kind: 'counter', label: 'HP', value: 5, x: 110, y: 50, w: 60, h: 25 },
			{ id: 'im', type: 'image', file: 'Images/Map.png', x: 110, y: 90, w: 60, h: 50 },
			{ id: 'toc', type: 'toc', x: 10, y: 150, w: 80, h: 40 }] }] }));
		s.zoomToFit(); await new Promise((r) => setTimeout(r, 1000));`);

	// A new selection opens the bar; it folds into a small pill when the pointer leaves, and opens again on hover
	await ev(`s.select({ pageId: 'a', moduleId: 'n' }); ${wait(500)}`);
	const state = () => ev(`const pill = document.querySelector('.pw-context-pill'); const bar = document.querySelector('.pw-context-bar'); return JSON.stringify({ pill: !pill.classList.contains('is-hidden'), bar: !bar.classList.contains('is-hidden') })`);
	check('a new selection opens the bar', (await state()) === '{"pill":false,"bar":true}', await state());
	await ev(`const b = document.querySelector('.pw-context-bar').getBoundingClientRect(); document.dispatchEvent(new PointerEvent('pointermove', { clientX: b.left + 5, clientY: b.top + 5 }));`);
	check('it stays open while the pointer is on it', await until(async () => (await state()) === '{"pill":false,"bar":true}', 1500));
	await ev(`document.dispatchEvent(new PointerEvent('pointermove', { clientX: 2, clientY: 2 }));`);
	check('and folds into the pill when the pointer moves away', await until(async () => (await state()) === '{"pill":true,"bar":false}', 30000), await state());
	await ev(`document.querySelector('.pw-context-pill').dispatchEvent(new PointerEvent('pointerenter')); ${wait(300)}`);
	check('hovering the pill opens the bar again', (await state()) === '{"pill":false,"bar":true}', await state());
	await ev(`document.dispatchEvent(new PointerEvent('pointermove', { clientX: 2, clientY: 2 }));`);
	await until(async () => (await state()) === '{"pill":true,"bar":false}', 30000);
	await ev(`document.querySelector('.pw-context-pill').click(); ${wait(300)}`);
	await clickBar('More settings');
	await ev(`document.dispatchEvent(new PointerEvent('pointermove', { clientX: 2, clientY: 2 })); ${wait(1500)}`);
	check('it stays open while the popover is open', (await state()) === '{"pill":false,"bar":true}', await state());
	await ev(`document.querySelector('.pw-board').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); ${wait(400)}`);
	check('Escape closes the popover even with the focus on the board', (await tabs()) === 'closed', await tabs());

	// What each kind of selection gets
	await select(null);
	check('page: name, size, orientation, background, more', (await barText()).startsWith('A4') && (await ev(`return !!document.querySelector('.pw-cb-name') && !!document.querySelector('.pw-cb-color')`)));
	await select('n');
	check('note: section, overflow, freeze, edit, fit, open', (await barText()).startsWith('Spell index▾|Clip▾|Freeze text|Edit|Fit|Open'), await barText());
	await select('p');
	check('pdf: crop, page stepper, fit, invert', (await barText()).startsWith('Crop|') && (await barText()).includes('p. 1') && (await barText()).includes('Contain'), await barText());
	await select('t');
	check('text: edit', (await barText()).startsWith('Edit'), await barText());
	await select('tr');
	check('tracker: kind, edit', (await barText()).startsWith('Counter'), await barText());
	await select('im');
	check('image: change, fit', (await barText()).startsWith('Change'), await barText());
	await select('toc');
	check('table of contents: heading', (await barText()).startsWith('Heading'), await barText());
	await ev(`s.select(null); ${wait(400)}`);
	check('no selection: no bar', (await barText()) === 'hidden');

	// Effects on the model
	await select('n');
	await clickBar('When the text');
	await pick('Shrink to fit');
	check('note overflow set from the bar', (await ev(`return mod('n').overflow`)) === 'fit');
	await clickBar('Keep showing');
	check('freeze from the bar', await ev(`${wait(400)} return !!mod('n').frozen`));
	await clickBar('Show the live');
	check('unfreeze from the bar', await ev(`return !mod('n').frozen`));

	await select('p');
	for (let i = 0; i < 6; i++) await clickBar('Next PDF page');
	check('pdf stepper stops at the last page (4)', (await ev(`${wait(300)} return mod('p').page`)) === 4);
	await clickBar('Previous PDF page');
	check('pdf stepper goes back', (await ev(`return mod('p').page`)) === 3);
	await clickBar('Invert');
	check('invert toggles on', (await ev(`return mod('p').invert`)) === true);
	await clickBar('Invert');
	check('invert off removes the key', (await ev(`return 'invert' in mod('p')`)) === false);

	await select('tr');
	await clickBar('What kind');
	await pick('Boxes');
	check('tracker kind from the bar', (await ev(`return mod('tr').kind`)) === 'boxes');

	await select(null);
	await clickBar('Page size');
	await pick('A5');
	check('page size from the bar', JSON.stringify(await ev(`const p = v.store.file.pages[0]; return [p.w, p.h]`)) === '[148,210]');
	await clickBar('Make landscape');
	check('orientation from the bar', JSON.stringify(await ev(`const p = v.store.file.pages[0]; return [p.w, p.h]`)) === '[210,148]');
	await ev(`const i = document.querySelector('.pw-cb-name'); i.value = 'Cover'; i.dispatchEvent(new Event('change', { bubbles: true })); ${wait(250)}`);
	check('page name from the bar', (await ev(`return v.store.file.pages[0].name`)) === 'Cover');
	await ev(`v.store.undo(); v.store.undo(); v.store.undo(); ${wait(300)}`);

	// Properties popover
	await select('n');
	await openMore();
	check('popover opens with four tabs for a module', (await tabs()) === 'Content|Layout|Style|Advanced', await tabs());
	const content = await rows();
	check('Content tab: file, section, overflow, freeze', ['File', 'Section', 'Overflow', 'Freeze'].every((n) => content.includes(n)), content);
	await tab('Layout');
	check('Layout tab: position, size, lock', (await rows()).startsWith('X|Y|Width|Height|Locked'), await rows());
	await ev(`const row = [...document.querySelectorAll('.pw-popover .setting-item')].find((e) => e.querySelector('.setting-item-name')?.textContent === 'Width'); const i = row.querySelector('input'); i.value = '120'; i.dispatchEvent(new Event('input', { bubbles: true })); ${wait(300)}`);
	check('editing in the popover changes the model and keeps it open', (await ev(`return mod('n').w`)) === 120 && (await tabs()) !== 'closed');
	await tab('Advanced');
	check('Advanced tab: label, lines, scale, CSS class', (await rows()).includes('Label') && (await rows()).includes('From line') && (await rows()).includes('CSS class'), await rows());

	const before = await ev(`return JSON.stringify([v.store.file.pages[0].modules.length, mod('n').x, mod('n').y])`);
	await ev(`const i = document.querySelector('.pw-popover input'); i.focus(); for (const key of ['Delete', 'Backspace', 'ArrowRight', 'ArrowDown']) i.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); ${wait(200)}`);
	check('Delete and arrow keys typed in the popover do not reach the board', before === (await ev(`return JSON.stringify([v.store.file.pages[0].modules.length, mod('n').x, mod('n').y])`)));

	await ev(`document.querySelector('.pw-popover input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); ${wait(200)}`);
	check('Escape closes the popover', (await tabs()) === 'closed');
	await openMore();
	await ev(`document.querySelector('.pw-board').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 300 })); ${wait(250)}`);
	check('a click on the board closes it', (await tabs()) === 'closed');

	await select('p');
	await openMore();
	await tab('Advanced');
	await select('t');
	check('selecting another item: the popover follows', (await rows()).includes('Label') && !(await rows()).includes('Rotation'), await rows());
	await select(null);
	await openMore();
	check('a page gets Page, Layout, Header & footer tabs', (await tabs()) === 'Page|Layout|Header & footer', await tabs());
	await ev(`document.querySelector('.pw-popover .pw-tab').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);

	// Placement: never over the selected item or over the bar, always inside the board
	await ev(`s.zoomToFit(); ${wait(800)}`);
	let placement = [];
	for (const id of ['n', 'p', 't', 'tr', 'im', 'toc']) {
		await select(id);
		await openMore();
		placement.push(
			await ev(`const host = document.querySelector('.pw-surface-host').getBoundingClientRect(); const sel = s.selectionScreenRect(); const pr = document.querySelector('.pw-popover').getBoundingClientRect(); const br = document.querySelector('.pw-context-bar').getBoundingClientRect();
				const a = { x: pr.left - host.left, y: pr.top - host.top, w: pr.width, h: pr.height }; const b = { x: br.left - host.left, y: br.top - host.top, w: br.width, h: br.height };
				const hit = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
				document.querySelector('.pw-popover').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
				return { id: '${id}', overItem: hit(a, sel), overBar: hit(a, b), inside: a.x >= 0 && a.y >= 0 && a.x + a.w <= host.width && a.y + a.h <= host.height };`),
		);
	}
	check('popover never covers the item or the bar and stays inside the board', placement.every((p) => !p.overItem && !p.overBar && p.inside), placement);

	// Several items
	await ev(`s.setItems([{ pageId: 'a', moduleId: 'n' }, { pageId: 'a', moduleId: 't' }, { pageId: 'a', moduleId: 'tr' }]); ${wait(500)} ${expand} ${wait(150)}`);
	check('several modules: align, distribute, lock, delete', (await barText()).startsWith('Align▾|Distribute▾|Lock'), await barText());
	await clickBar('Align');
	check('align menu has the six alignments', (await ev(`return document.querySelectorAll('.menu .menu-item').length`)) >= 6);
} catch (e) {
	check('no exception', false, String(e.stack ?? e));
} finally {
	await cdp
		.evaluate(`for (let k = 0; k < 10 && document.querySelector('.menu'); k++) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 80)); }
			for (const l of app.workspace.getLeavesOfType('patchwork-board')) if (l.view.file?.path.startsWith('_e2e/')) l.detach();
			await new Promise((r) => setTimeout(r, 500));
			const d = app.vault.getAbstractFileByPath('_e2e'); if (d) await app.vault.delete(d, true);`)
		.catch(() => {});
	cdp.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;
