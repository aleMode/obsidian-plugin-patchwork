// End-to-end check of the floating outline and views panel: View menu entry, the list of pages and
// modules, selecting from it, live updates, saved views, close and the remembered on/off choice.
import { connect } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const V = `const L = app.workspace.getLeavesOfType('patchwork-board').find((l) => l.view.file?.path.startsWith('_e2e/')); const v = L.view; const s = v.surface;`;
const ev = (body) => cdp.evaluate(`${V} ${body}`);
const wait = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;
const until = async (fn, ms = 30000) => {
	const t = Date.now();
	while (Date.now() - t < ms) {
		if (await fn()) return true;
		await new Promise((r) => setTimeout(r, 300));
	}
	return false;
};
const open = () => ev(`return !document.querySelector('.pw-outline-panel').classList.contains('is-hidden')`);
const rows = () => ev(`return [...document.querySelectorAll('.pw-outline-panel .pw-outline-row span:not(.pw-outline-icon):not(.pw-outline-lock):not(.clickable-icon)')].map((e) => e.textContent).join('|')`);

try {
	await cdp.evaluate(`
		const vv = app.vault;
		const pl = app.plugins.plugins.patchwork;
		pl.settings.outlineOpen = false; pl.settings.outlinePos = null; await pl.saveSettings();
		for (const l of app.workspace.getLeavesOfType('patchwork-board')) l.detach();
		await new Promise((r) => setTimeout(r, 400));
		if (vv.getAbstractFileByPath('_e2e')) await vv.delete(vv.getAbstractFileByPath('_e2e'), true);
		await vv.createFolder('_e2e');
		await app.plugins.plugins.patchwork.createBoard(vv.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 800));
		${V} app.workspace.setActiveLeaf(L, { focus: true });
		v.store.update((f) => ({ ...f, pages: [
			{ ...f.pages[0], id: 'a', name: 'Front', modules: [
				{ id: 't', type: 'text', markdown: 'hello world', x: 10, y: 10, w: 80, h: 30 },
				{ id: 'tr', type: 'tracker', kind: 'counter', label: 'HP', value: 3, x: 10, y: 50, w: 50, h: 25 }] },
			{ id: 'b', name: 'Back', x: 260, y: 0, w: 210, h: 297, modules: [] }] }));
		s.zoomToFit(); await new Promise((r) => setTimeout(r, 1000));`);

	check('the panel starts closed', !(await open()));
	await ev(`document.querySelector('.pw-toolbar [aria-label^="Outline and views"]').click(); ${wait(300)}`);
	const view = await ev(`const t = [...document.querySelectorAll('.menu .menu-item-title')].map((e) => e.textContent); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return t`);
	check('the View menu offers the panel and the sidebar dock', view.includes('Outline and views') && view.includes('Inspector and outline in the sidebar') && view.includes('Minimap'), view);
	await ev(`s.toggleOutline(); ${wait(400)}`);
	check('toggling opens it', await open());
	const list = await rows();
	const sections = await ev(`return [...document.querySelectorAll('.pw-outline-panel .pw-outline-section')].map((e) => e.textContent).join('|')`);
	check('it lists the views section, the pages and their modules', sections.includes('Views') && sections.includes('Pages') && list.includes('1. Front') && list.includes('2. Back') && list.includes('hello world') && list.includes('HP'), list);
	check('it sits below the toolbar and inside the board', await ev(`const p = document.querySelector('.pw-outline-panel').getBoundingClientRect(); const h = document.querySelector('.pw-surface-host').getBoundingClientRect(); const t = document.querySelector('.pw-toolbar').getBoundingClientRect(); return p.top >= t.bottom && p.left >= h.left && p.bottom <= h.bottom`));
	check('the choice is remembered in the plugin settings', (await ev(`return app.plugins.plugins.patchwork.settings.outlineOpen`)) === true);
	check('and written to the plugin data file in the vault, not just to browser storage', await until(async () => JSON.parse(await cdp.evaluate(`return await app.vault.adapter.read('.obsidian/plugins/patchwork/data.json')`)).outlineOpen === true));

	// selecting from it
	await ev(`[...document.querySelectorAll('.pw-outline-panel .pw-outline-module')].find((r) => r.textContent.includes('HP')).click(); ${wait(400)}`);
	check('clicking a module row selects it', (await ev(`return JSON.stringify(s.selected)`)) === '{"pageId":"a","moduleId":"tr"}', await ev(`return JSON.stringify(s.selected)`));
	check('and the row shows it as selected', await until(() => ev(`return !!document.querySelector('.pw-outline-panel .pw-outline-module.is-selected')`)));
	await ev(`[...document.querySelectorAll('.pw-outline-panel .pw-outline-page')].find((r) => r.textContent.includes('Back')).click(); ${wait(400)}`);
	check('clicking a page row selects the page', (await ev(`return JSON.stringify(s.selected)`)) === '{"pageId":"b"}');
	await ev(`document.querySelector('.pw-outline-panel').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); ${wait(200)}`);
	check('pressing inside the panel does not clear the selection', (await ev(`return JSON.stringify(s.selected)`)) === '{"pageId":"b"}');

	// size and spacing: as big as its content, with room between the text and the edge
	const geo = JSON.parse(await ev(`const p = document.querySelector('.pw-outline-panel'); const h = document.querySelector('.pw-surface-host').getBoundingClientRect(); const row = p.querySelector('.pw-outline-page'); const icon = row.querySelector('.pw-outline-icon').getBoundingClientRect(); const pr = p.getBoundingClientRect(); return JSON.stringify({ ph: pr.height, hh: h.height, pw: pr.width, hw: h.width, pad: icon.left - pr.left });`));
	check('the panel is only as tall as its content needs', geo.ph < geo.hh * 0.7, geo);
	check('and not wider than needed', geo.pw <= 330 && geo.pw <= geo.hw * 0.6 + 1, geo);
	check('text keeps a margin from the panel edge', geo.pad >= 12, geo);

	// dragging by the title
	const head = JSON.parse(await ev(`const r = document.querySelector('.pw-outline-panel-head span').getBoundingClientRect(); const p = document.querySelector('.pw-outline-panel').getBoundingClientRect(); return JSON.stringify({ x: r.x + 10, y: r.y + r.height / 2, px: p.left, py: p.top })`));
	await cdp.drag({ x: head.x, y: head.y }, { x: head.x + 60, y: head.y + 90 });
	await ev(`${wait(300)}`);
	const moved = JSON.parse(await ev(`const p = document.querySelector('.pw-outline-panel').getBoundingClientRect(); return JSON.stringify({ px: p.left, py: p.top })`));
	check('dragging the title moves the panel', Math.abs(moved.px - head.px - 60) <= 3 && Math.abs(moved.py - head.py - 90) <= 3, { head, moved });
	check('and the position is remembered', (await ev(`const p = app.plugins.plugins.patchwork.settings.outlinePos; return !!p && Number.isFinite(p.x) && Number.isFinite(p.y)`)));
	await ev(`const h = document.querySelector('.pw-outline-panel-head'); h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); ${wait(300)}`);
	const reset = JSON.parse(await ev(`const p = document.querySelector('.pw-outline-panel').getBoundingClientRect(); return JSON.stringify({ px: p.left, py: p.top })`));
	// (the toolbar may have settled since the first measurement, so the height gets a little room)
	check('double-clicking the title puts it back', Math.abs(reset.px - head.px) <= 3 && Math.abs(reset.py - head.py) <= 14 && (await ev(`return app.plugins.plugins.patchwork.settings.outlinePos === null`)), { reset, head });

	// revealing from the outline: not re-centred when comfortable, brought out from under the panel
	await ev(`s.zoomToFit(); ${wait(500)}`);
	await ev(`s.select({ pageId: 'a', moduleId: 'tr' }); const m = v.store.file.pages[0].modules.find((x) => x.id === 'tr'); const p = v.store.file.pages[0]; const k = (96 / 25.4) * s.camera.zoom; const vp = { w: s.root.clientWidth, h: s.root.clientHeight }; s.setCamera({ ...s.camera, tx: vp.w / 2 - (p.x + m.x + m.w / 2) * k, ty: vp.h / 2 - (p.y + m.y + m.h / 2) * k }); ${wait(700)}`);
	await ev(`window.__cam = JSON.stringify(s.camera); [...document.querySelectorAll('.pw-outline-panel .pw-outline-module')].find((r) => r.textContent.includes('HP')).click(); ${wait(600)}`);
	check('an item already in the comfortable middle does not move the view', (await ev(`return JSON.stringify(s.camera)`)) === (await ev(`return window.__cam`)));
	await ev(`s.setCamera({ ...s.camera, tx: s.camera.tx - 5000 }); ${wait(600)}`);
	await ev(`[...document.querySelectorAll('.pw-outline-panel .pw-outline-module')].find((r) => r.textContent.includes('HP')).click(); ${wait(700)}`);
	const place = JSON.parse(await ev(`const r = s.selectionScreenRect(); const p = document.querySelector('.pw-outline-panel').getBoundingClientRect(); const h = document.querySelector('.pw-surface-host').getBoundingClientRect(); const pr = { x: p.left - h.left, y: p.top - h.top, w: p.width, h: p.height }; const hit = r.x < pr.x + pr.w && pr.x < r.x + r.w && r.y < pr.y + pr.h && pr.y < r.y + r.h; return JSON.stringify({ r, pr, hit, hw: h.width, hh: h.height })`));
	check('an item far off screen is brought into view, clear of the panel', !place.hit && place.r.x >= 0 && place.r.x + place.r.w <= place.hw && place.r.y >= 0 && place.r.y + place.r.h <= place.hh, place);

	// live updates
	await ev(`v.store.update((f) => ({ ...f, pages: f.pages.map((p) => (p.id === 'b' ? { ...p, name: 'Cover' } : p)) }));`);
	check('renaming a page updates the list', await until(async () => (await rows()).includes('2. Cover')), await rows());
	await ev(`v.store.update((f) => ({ ...f, pages: f.pages.map((p) => (p.id === 'a' ? { ...p, modules: [...p.modules, { id: 'x', type: 'text', markdown: 'late arrival', x: 10, y: 90, w: 60, h: 20 }] } : p)) }));`);
	check('adding a module updates the list', await until(async () => (await rows()).includes('late arrival')), await rows());

	// saved views
	await ev(`s.saveView('Overview'); ${wait(300)}`);
	check('a saved view is listed under Views', await until(async () => (await rows()).includes('Overview')), await rows());
	await ev(`s.zoomToSelection(); ${wait(500)} const before = JSON.stringify(s.camera); window.__before = before; [...document.querySelectorAll('.pw-outline-panel .pw-outline-view')].find((r) => r.textContent.includes('Overview')).click(); ${wait(600)}`);
	check('clicking the view goes back to it', await until(async () => (await ev(`return JSON.stringify(s.camera)`)) !== (await ev(`return window.__before`))));

	// close and remember
	await ev(`document.querySelector('.pw-outline-panel [aria-label^="Close"]').click(); ${wait(300)}`);
	check('the close button hides it', !(await open()));
	check('and the choice is remembered', (await ev(`return app.plugins.plugins.patchwork.settings.outlineOpen`)) === false);
	await ev(`document.querySelector('.pw-toolbar [aria-label^="Outline and views"]').click(); ${wait(300)}`);
	await ev(`const it = [...document.querySelectorAll('.menu .menu-item')].find((e) => e.querySelector('.menu-item-title')?.textContent === 'Outline and views'); it.dispatchEvent(new MouseEvent('click', { bubbles: true })); ${wait(400)}`);
	check('the View menu entry opens it again', await open());
} catch (e) {
	check('no exception', false, String(e.stack ?? e));
} finally {
	await cdp
		.evaluate(`const pl = app.plugins.plugins.patchwork; pl.settings.outlineOpen = false; pl.settings.outlinePos = null; await pl.saveSettings();
			for (let k = 0; k < 10 && (document.querySelector('.menu') || document.querySelector('.modal-container')); k++) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 80)); }
			for (const l of app.workspace.getLeavesOfType('patchwork-board')) if (l.view.file?.path.startsWith('_e2e/')) l.detach();
			await new Promise((r) => setTimeout(r, 500));
			const d = app.vault.getAbstractFileByPath('_e2e'); if (d) await app.vault.delete(d, true);`)
		.catch(() => {});
	cdp.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;
