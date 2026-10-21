// End-to-end check of editing text boxes and notes in place: the text area, saving (one undo step for a
// text box; only the shown slice for a note), conflicts, renamed headings, frozen notes, unmounting
// mid-edit, and the double-click and Enter triggers. Page-level actions plus synthetic double-clicks.
import { connect } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const V = `const L = app.workspace.getLeavesOfType('patchwork-board').find((l) => l.view.file?.path.startsWith('_e2e/')); const v = L.view; const s = v.surface; const mod = (id) => v.store.file.pages[0].modules.find((m) => m.id === id);`;
const ev = (body) => cdp.evaluate(`${V} ${body}`);
const wait = (ms) => `await new Promise((r) => setTimeout(r, ${ms}));`;
const NOTE = '---\ntitle: scratch\n---\n\n# One\nalpha line\n\n## Two\nbeta line\ngamma line\n\n# Three\nomega\n';
const readNote = () => cdp.evaluate(`return await app.vault.read(app.vault.getAbstractFileByPath('_e2e/scratch.md'))`);
const editing = () => ev(`return !!document.querySelector('.pw-inline-editor')`);
/** Poll until `fn` is true: saves and re-parsing are timer-driven, and a hidden window throttles timers. */
const until = async (fn, ms = 60000) => {
	const t = Date.now();
	while (Date.now() - t < ms) {
		if (await fn()) return true;
		await new Promise((r) => setTimeout(r, 400));
	}
	return false;
};
const editorGone = () => until(async () => !(await editing()));
const type = (value) => ev(`const ta = document.querySelector('.pw-inline-editor'); ta.value = ${JSON.stringify(value)}; ta.dispatchEvent(new Event('input', { bubbles: true }));`);
const key = (k, extra = {}) => ev(`document.querySelector('.pw-inline-editor').dispatchEvent(new KeyboardEvent('keydown', { key: '${k}', bubbles: true, ...${JSON.stringify(extra)} })); ${wait(300)}`);
const open = async (id) => {
	await ev(`s.editInline('a', '${id}');`);
	return until(editing, 15000);
};
const dbl = (id) =>
	ev(`const r = document.querySelector('.pw-module[data-module-id="${id}"]').getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; const el = document.elementFromPoint(x, y); el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y })); ${wait(300)}`);
const text = (id) => ev(`return document.querySelector('.pw-module[data-module-id="${id}"]').innerText`);

try {
	await cdp.evaluate(`
		const vv = app.vault;
		for (const l of app.workspace.getLeavesOfType('patchwork-board')) l.detach();
		await new Promise((r) => setTimeout(r, 400));
		if (vv.getAbstractFileByPath('_e2e')) await vv.delete(vv.getAbstractFileByPath('_e2e'), true);
		await vv.createFolder('_e2e');
		await vv.create('_e2e/scratch.md', ${JSON.stringify(NOTE)});
		await app.plugins.plugins.patchwork.createBoard(vv.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 800));
		${V} app.workspace.setActiveLeaf(L, { focus: true });
		v.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], id: 'a', modules: [
			{ id: 't', type: 'text', markdown: 'hello', x: 10, y: 10, w: 90, h: 30 },
			{ id: 'n', type: 'note', file: '_e2e/scratch.md', subpath: '#Two', includeHeading: false, x: 10, y: 50, w: 90, h: 40 },
			{ id: 'h', type: 'note', file: '_e2e/scratch.md', subpath: '#One', x: 110, y: 10, w: 80, h: 40 },
			{ id: 'z', type: 'note', file: '_e2e/scratch.md', x: 110, y: 60, w: 80, h: 40, frozen: { at: '2026-01-01', markdown: 'old' } },
			{ id: 'pdf', type: 'pdf', file: 'PDFs/Sample rulebook.pdf', page: 1, x: 10, y: 100, w: 60, h: 80 }] }] }));
		s.zoomToFit(); await new Promise((r) => setTimeout(r, 1500));`);

	// ---- text box
	check('text box: a text area opens over it', await open('t'));
	check('the rendered text is hidden and the area holds the markdown', await ev(`return document.querySelector('.pw-module[data-module-id="t"]').classList.contains('is-editing') && document.querySelector('.pw-inline-editor').value === 'hello'`));
	check('the text area keeps a little room from the module border', await ev(`const c = getComputedStyle(document.querySelector('.pw-inline-editor')); return [c.paddingTop, c.paddingRight, c.paddingBottom, c.paddingLeft].every((p) => parseFloat(p) >= 1 && parseFloat(p) <= 3)`));
	check('the context bar steps aside while editing', await ev(`const b = document.querySelector('.pw-context-bar'); return getComputedStyle(b).display === 'none' || b.classList.contains('is-hidden')`));
	const before = await ev(`return JSON.stringify([v.store.file.pages[0].modules.length, mod('t').x, mod('t').y])`);
	await ev(`const ta = document.querySelector('.pw-inline-editor'); for (const k of ['Delete', 'Backspace', 'ArrowRight']) ta.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); ${wait(200)}`);
	check('Delete, Backspace and arrows typed in it do not reach the board', before === (await ev(`return JSON.stringify([v.store.file.pages[0].modules.length, mod('t').x, mod('t').y])`)) && (await editing()));
	await type('**changed** text');
	await key('Escape');
	check('Escape saves into the patchwork', (await editorGone()) && (await ev(`return mod('t').markdown`)) === '**changed** text');
	check('and the module shows the rendered result', await until(async () => (await text('t')).includes('changed')));
	await ev(`v.store.undo();`);
	check('the edit is one undo step', await until(async () => (await ev(`return mod('t').markdown`)) === 'hello'));

	// ---- real clicks: inside places the caret, outside ends the edit
	await ev(`s.editInline('a', 't');`);
	await until(editing, 15000);
	await type('first line\nsecond line\nthird line');
	const box = JSON.parse(await ev(`const ta = document.querySelector('.pw-inline-editor'); const r = ta.getBoundingClientRect(); ta.setSelectionRange(ta.value.length, ta.value.length); return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height, caret: getComputedStyle(ta).caretColor, color: getComputedStyle(ta).color, pe: getComputedStyle(ta).pointerEvents })`));
	check('the text area takes the pointer and its caret follows the text colour', box.pe === 'auto' && box.caret === box.color, box);
	await cdp.mouse('mouseMoved', box.x + 6, box.y + 6, { button: 'none' });
	await cdp.mouse('mousePressed', box.x + 6, box.y + 6);
	await cdp.mouse('mouseReleased', box.x + 6, box.y + 6);
	await ev(`${wait(400)}`);
	check('clicking inside keeps editing and moves the caret', (await editing()) && (await ev(`const ta = document.querySelector('.pw-inline-editor'); return ta.selectionStart < ta.value.length && document.activeElement === ta`)));
	await cdp.mouse('mouseMoved', box.x + box.w + 70, box.y + box.h + 70, { button: 'none' });
	await cdp.mouse('mousePressed', box.x + box.w + 70, box.y + box.h + 70);
	await cdp.mouse('mouseReleased', box.x + box.w + 70, box.y + box.h + 70);
	check('clicking outside ends editing', await editorGone());
	await until(async () => (await ev(`return mod('t').markdown`)) === 'first line\nsecond line\nthird line');
	await ev(`v.store.undo();`);
	await until(async () => (await ev(`return mod('t').markdown`)) === 'hello');

	// ---- note slice
	check('note section: a text area opens', await open('n'));
	check('it holds exactly the shown part', (await ev(`return document.querySelector('.pw-inline-editor').value`)) === 'beta line\ngamma line');
	await type('BETA\nGAMMA\nDELTA');
	await key('Escape');
	const expected = NOTE.replace('beta line\ngamma line', 'BETA\nGAMMA\nDELTA');
	check('only that section was rewritten in the file', await until(async () => (await readNote()) === expected), await readNote());
	await editorGone();
	check('the module renders the new text', await until(async () => (await text('n')).includes('DELTA')));

	// ---- heading renamed: the module keeps following its section
	check('note with its heading: a text area opens', await open('h'));
	const heading = await ev(`return document.querySelector('.pw-inline-editor').value`);
	check('it starts with the heading', heading.startsWith('# One'), heading);
	await type(heading.replace('# One', '# Uno'));
	await key('Escape');
	check('a retyped heading updates the module link and the file', await until(async () => (await ev(`return mod('h').subpath`)) === '#Uno' && (await readNote()).includes('# Uno\n')), await ev(`return mod('h').subpath`));
	await editorGone();
	check('and the module still shows its section', await until(async () => (await text('h')).includes('alpha')));

	// ---- changed underneath: nothing is overwritten
	check('opening again', await open('n'));
	await type('MINE');
	const external = (await readNote()).replace('DELTA', 'EXTERNAL');
	await cdp.evaluate(`await app.vault.modify(app.vault.getAbstractFileByPath('_e2e/scratch.md'), ${JSON.stringify(external)}); await new Promise((r) => setTimeout(r, 300));`);
	await key('Escape');
	await editorGone();
	check('a file changed under the editor is not overwritten', (await readNote()) === external, await readNote());

	// ---- linked frames: a frame edits only the part of the chain's text it shows
	const SRC = 'Alpha one\n\nBeta two\n\nGamma three\n\nDelta four';
	await cdp.evaluate(`await app.vault.create('_e2e/chain.md', ${JSON.stringify('Para one\n\nPara two\n\nPara three\n\nPara four\n')});`);
	await ev(`v.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: [...f.pages[0].modules,
		{ id: 'ch', type: 'text', markdown: ${JSON.stringify(SRC)}, x: 110, y: 110, w: 80, h: 10 },
		{ id: 'f1', type: 'frame', from: 'ch', x: 110, y: 125, w: 80, h: 40 },
		{ id: 'cn', type: 'note', file: '_e2e/chain.md', x: 110, y: 170, w: 80, h: 10 },
		{ id: 'f2', type: 'frame', from: 'cn', x: 110, y: 185, w: 80, h: 40 }] }] })); s.zoomToFit(); ${wait(1500)}`);
	const part = (id) => ev(`return JSON.stringify(await s.modules.flowPart('${id}'))`).then((p) => JSON.parse(p));
	check('a frame knows which stretch of the text it shows', await until(async () => !!(await part('f1')) && !!(await part('f2'))));
	const p1 = await part('f1');
	check('the head keeps the first blocks, the frame the rest', p1.from > 0 && p1.to > p1.from && p1.source === SRC, p1);

	check('frame: a text area opens', await open('f1'));
	check('it holds exactly the part the frame shows', (await ev(`return document.querySelector('.pw-inline-editor').value`)) === SRC.slice(p1.from, p1.to));
	await type(SRC.slice(p1.from, p1.to).toUpperCase());
	await key('Escape');
	await editorGone();
	check('only that part of the head text changed', await until(async () => (await ev(`return mod('ch').markdown`)) === SRC.slice(0, p1.from) + SRC.slice(p1.from, p1.to).toUpperCase() + SRC.slice(p1.to)), await ev(`return mod('ch').markdown`));
	check('and the frame shows the new text', await until(async () => (await text('f1')).includes(SRC.slice(p1.from, p1.to).toUpperCase().split('\n')[0])));
	await ev(`v.store.undo();`);
	check('the frame edit is one undo step', await until(async () => (await ev(`return mod('ch').markdown`)) === SRC));

	const p2 = await part('f2');
	const CHAIN = 'Para one\n\nPara two\n\nPara three\n\nPara four';
	check('note chain: the frame holds part of the note', p2.from > 0 && p2.source === CHAIN, p2);
	check('note chain: a text area opens in the frame', await open('f2'));
	const edited = CHAIN.slice(p2.from, p2.to).replace('Para', 'PARA');
	await type(edited);
	await key('Escape');
	await editorGone();
	const chainFile = () => cdp.evaluate(`return await app.vault.read(app.vault.getAbstractFileByPath('_e2e/chain.md'))`);
	check('only that part of the note file was rewritten', await until(async () => (await chainFile()) === CHAIN.slice(0, p2.from) + edited + CHAIN.slice(p2.to) + '\n'), await chainFile());

	await ev(`s.select({ pageId: 'a', moduleId: 'f1' }); s.focusBoard(); ${wait(300)} document.querySelector('.pw-board').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
	check('Enter on a selected frame edits it', await until(editing, 15000));
	await key('Escape');
	await editorGone();
	await dbl('f1');
	check('double-click on a frame edits it', await until(editing, 15000));
	await key('Escape');
	await editorGone();
	await ev(`v.store.update((f) => ({ ...f, pages: [{ ...f.pages[0], modules: f.pages[0].modules.filter((m) => !['ch', 'f1', 'cn', 'f2'].includes(m.id)) }] }));`);

	// ---- frozen and unmounting
	await ev(`s.editInline('a', 'z'); ${wait(800)}`);
	check('a frozen note cannot be edited', !(await editing()));
	check('a text box opens again', await open('t'));
	await type('typed then scrolled away');
	await ev(`s.setCamera({ ...s.camera, tx: s.camera.tx - 100000 });`);
	check('a module that unmounts mid-edit keeps what was typed', await until(async () => (await ev(`return mod('t').markdown`)) === 'typed then scrolled away'), await ev(`return mod('t').markdown`));
	await ev(`s.zoomToFit(); ${wait(1200)}`);
	await until(async () => !!(await ev(`return document.querySelector('.pw-module[data-module-id="t"]')`)));

	// ---- triggers
	await editorGone();
	await dbl('t');
	check('double-click on a text box edits it', await until(editing, 15000));
	await key('Escape');
	await editorGone();
	await dbl('n');
	check('double-click on a note edits it', await until(editing, 15000));
	await key('Escape');
	await editorGone();
	await dbl('pdf');
	check('double-click on a PDF still opens the crop editor', await until(() => ev(`return !!document.querySelector('.pw-crop-modal')`), 15000));
	await ev(`for (let k = 0; k < 10 && document.querySelector('.modal-container'); k++) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); ${wait(100)} }`);
	await ev(`s.select({ pageId: 'a', moduleId: 't' }); s.focusBoard(); ${wait(300)} document.querySelector('.pw-board').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
	check('Enter on a selected text box edits it', await until(editing, 15000));
	await key('Escape');
} catch (e) {
	check('no exception', false, String(e.stack ?? e));
} finally {
	await cdp
		.evaluate(`for (let k = 0; k < 10 && (document.querySelector('.modal-container') || document.querySelector('.menu')); k++) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise((r) => setTimeout(r, 80)); }
			for (const l of app.workspace.getLeavesOfType('patchwork-board')) if (l.view.file?.path.startsWith('_e2e/')) l.detach();
			await new Promise((r) => setTimeout(r, 500));
			const d = app.vault.getAbstractFileByPath('_e2e'); if (d) await app.vault.delete(d, true);`)
		.catch(() => {});
	cdp.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;
