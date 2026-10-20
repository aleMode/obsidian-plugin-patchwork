// End-to-end check of text-box formatting: the bar's alignment, colour and size controls, the Style tab's
// extra rows, the formatting toolbar while editing (selection wrapping, list and heading markers, undo),
// and that parity with notes holds (reading-view class, note cssclasses). Mostly page-level actions; the
// undo check sends real key events.
import { connect } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const V = `const L = app.workspace.getLeavesOfType('patchwork-board').find((l) => l.view.file?.path.startsWith('_e2e/')); const v = L.view; const s = v.surface; const mod = (id) => v.store.file.pages[0].modules.find((m) => m.id === id);`;
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
const TEXT = '# Title\n\nplain words here\nsecond line';
const NOTE = '---\ncssclasses: [fancy]\n---\n# Heading\n\nbody\n';
const expand = `document.querySelector('.pw-context-pill')?.click();`;
const select = (id) => ev(`s.select({ pageId: 'a', moduleId: '${id}' }); ${wait(450)} ${expand} ${wait(150)}`);
const clickBar = (tip) => ev(`document.querySelector('.pw-context-bar [aria-label^="${tip}"]').click(); ${wait(250)}`);
const pick = (title) =>
	ev(`const it = [...document.querySelectorAll('.menu .menu-item')].find((e) => e.querySelector('.menu-item-title')?.textContent.trim() === '${title}'); if (!it) return 'missing ${title}'; it.dispatchEvent(new MouseEvent('click', { bubbles: true })); ${wait(300)} return 'ok';`);
const css = (selector, prop) => ev(`return getComputedStyle(document.querySelector('${selector}')).${prop}`);
const value = () => ev(`return document.querySelector('.pw-inline-editor').value`);
const editing = () => ev(`return !!document.querySelector('.pw-inline-editor')`);
const selectText = (a, b) => ev(`const ta = document.querySelector('.pw-inline-editor'); ta.focus(); ta.setSelectionRange(${a}, ${b});`);
const fmt = (tip) => ev(`document.querySelector('.pw-format-bar [aria-label="${tip}"]').click(); ${wait(250)}`);

try {
	await cdp.evaluate(`
		const vv = app.vault;
		for (const l of app.workspace.getLeavesOfType('patchwork-board')) l.detach();
		await new Promise((r) => setTimeout(r, 400));
		if (vv.getAbstractFileByPath('_e2e')) await vv.delete(vv.getAbstractFileByPath('_e2e'), true);
		await vv.createFolder('_e2e');
		await vv.create('_e2e/n.md', ${JSON.stringify(NOTE)});
		await app.plugins.plugins.patchwork.createBoard(vv.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 800));
		${V} app.workspace.setActiveLeaf(L, { focus: true });
		v.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], id: 'a', modules: [
			{ id: 't', type: 'text', markdown: ${JSON.stringify(TEXT)}, x: 10, y: 10, w: 90, h: 50 },
			{ id: 'n', type: 'note', file: '_e2e/n.md', x: 110, y: 10, w: 80, h: 50 }] }] }));
		s.zoomToFit(); await new Promise((r) => setTimeout(r, 1500));`);

	// ---- parity with notes
	const wrapperClasses = await ev(`return document.querySelector('.pw-module[data-module-id="t"] .pw-markdown').className`);
	check('a text box has the same reading-view classes a note has', wrapperClasses.includes('markdown-rendered') && wrapperClasses.includes('markdown-preview-view'), wrapperClasses);
	check("a note's cssclasses frontmatter is applied to its module", await until(() => ev(`return !!document.querySelector('.pw-module[data-module-id="n"] .pw-markdown.fancy')`)));
	check('the reading-view padding and scrolling do not leak into the module', (await css('.pw-module[data-module-id="t"] .pw-markdown', 'paddingTop')) === '0px' && (await css('.pw-module[data-module-id="t"] .pw-markdown', 'overflow')) === 'visible');

	// ---- context bar controls
	await select('t');
	const bar = await ev(`return [...document.querySelectorAll('.pw-context-bar .pw-cb-btn')].map((b) => b.getAttribute('aria-label')).join('|')`);
	check('text box bar: edit, alignment, colour, smaller, larger', bar.startsWith('Edit') && bar.includes('Alignment') && bar.includes('Smaller text') && bar.includes('Larger text'), bar);
	await clickBar('Alignment');
	await pick('Centre');
	check('alignment is stored in the style', (await ev(`return mod('t').style?.align`)) === 'center');
	check('and the text is centred', await until(async () => (await css('.pw-module[data-module-id="t"] .pw-module-body', 'textAlign')) === 'center'));
	await ev(`const i = document.querySelector('.pw-context-bar .pw-cb-color'); i.value = '#aa0000'; i.dispatchEvent(new Event('change', { bubbles: true })); ${wait(400)}`);
	check('text colour is stored', (await ev(`return mod('t').style?.color`)) === '#aa0000');
	check('and reaches the heading as well as the body', await until(async () => (await css('.pw-module[data-module-id="t"] h1', 'color')) === 'rgb(170, 0, 0)' && (await css('.pw-module[data-module-id="t"] p', 'color')) === 'rgb(170, 0, 0)'));
	await clickBar('Larger text');
	await clickBar('Larger text');
	check('Larger text steps the scale', Math.abs((await ev(`return mod('t').style?.fontScale`)) - 1.2) < 0.001);
	await clickBar('Smaller text');
	await clickBar('Smaller text');
	check('and back to the default removes the key', (await ev(`return 'fontScale' in (mod('t').style ?? {})`)) === false);
	await clickBar('Alignment');
	await pick('Default');
	check('Default alignment removes the key', (await ev(`return 'align' in (mod('t').style ?? {})`)) === false);

	// ---- Style tab
	await clickBar('More settings');
	await ev(`[...document.querySelectorAll('.pw-popover .pw-tab')].find((t) => t.textContent === 'Style').click(); ${wait(250)}`);
	const rows = await ev(`return [...document.querySelectorAll('.pw-popover .pw-prop-section:not(.is-hidden) .setting-item:not(.setting-item-heading) .setting-item-name')].map((e) => e.textContent).join('|')`);
	check('Style tab has text colour, alignment and font', ['Text colour', 'Alignment', 'Font'].every((n) => rows.includes(n)), rows);
	await ev(`const row = [...document.querySelectorAll('.pw-popover .setting-item')].find((e) => e.querySelector('.setting-item-name')?.textContent === 'Font'); const i = row.querySelector('input'); i.value = 'Georgia, serif'; i.dispatchEvent(new Event('input', { bubbles: true })); ${wait(400)}`);
	check('a font family is applied to the module', await until(async () => (await css('.pw-module[data-module-id="t"] .pw-module-body', 'fontFamily')).includes('Georgia')));
	await ev(`document.querySelector('.pw-board').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); ${wait(300)}`);

	// ---- formatting toolbar while editing
	await ev(`s.editInline('a', 't');`);
	check('editing shows the formatting toolbar', (await until(editing, 15000)) && (await ev(`return !!document.querySelector('.pw-format-bar')`)));
	check('with bold, italic, headings, lists, quote and link', await ev(`const tips = [...document.querySelectorAll('.pw-format-bar button')].map((b) => b.getAttribute('aria-label')); return ['Bold', 'Italic', 'Strikethrough', 'Code', 'Heading 1', 'Heading 2', 'Heading 3', 'Bulleted list', 'Numbered list', 'Quote', 'Link'].every((t) => tips.includes(t))`));
	// The bar is placed on camera moves, not every frame: panning must still carry it along.
	const barX = () => ev(`return document.querySelector('.pw-format-bar').getBoundingClientRect().left`);
	const before = await barX();
	await ev(`s.setCamera({ ...s.camera, tx: s.camera.tx - 40 }); ${wait(150)}`);
	check('the toolbar follows the module when the view pans', Math.abs((await barX()) - (before - 40)) < 2, [before, await barX()]);
	await ev(`s.setCamera({ ...s.camera, tx: s.camera.tx + 40 }); ${wait(150)}`);
	const text = await value();
	const at = text.indexOf('plain');
	await selectText(at, at + 5);
	await fmt('Bold');
	check('Bold wraps the selection', (await value()) === TEXT.replace('plain', '**plain**'), await value());
	check('clicking the toolbar does not end the edit', await editing());
	await cdp.key('z', 'KeyZ', 2);
	check('Ctrl+Z undoes the formatting (the text area keeps its history)', await until(async () => (await value()) === TEXT, 8000), await value());
	const last = TEXT.indexOf('second');
	await selectText(last, last + 6);
	await fmt('Bulleted list');
	check('a list button marks the line', (await value()).endsWith('\n- second line'), await value());
	await selectText(0, 0);
	await fmt('Heading 2');
	check('a heading button replaces the heading level', (await value()).startsWith('## Title'), await value());
	await selectText(0, 0);
	await ev(`document.querySelector('.pw-inline-editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
	check('Escape saves the formatted text', await until(async () => (await ev(`return mod('t').markdown`)).startsWith('## Title') && !(await editing())));
	check('and it is rendered as formatted', await until(() => ev(`return !!document.querySelector('.pw-module[data-module-id="t"] h2')`)));
} catch (e) {
	check('no exception', false, String(e.stack ?? e));
} finally {
	await cdp
		.evaluate(`for (let k = 0; k < 10 && (document.querySelector('.menu') || document.querySelector('.modal-container')); k++) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 80)); }
			for (const l of app.workspace.getLeavesOfType('patchwork-board')) if (l.view.file?.path.startsWith('_e2e/')) l.detach();
			await new Promise((r) => setTimeout(r, 500));
			const d = app.vault.getAbstractFileByPath('_e2e'); if (d) await app.vault.delete(d, true);`)
		.catch(() => {});
	cdp.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;
