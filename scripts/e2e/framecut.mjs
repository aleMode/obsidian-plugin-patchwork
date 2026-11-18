// End-to-end check, with real input, that cutting and pasting a linked frame, or dragging one to another
// page, never leaves two frames continuing the same text; and that a board which already has such a
// conflict offers to attach the extra frame to the end of the chain.
import { connect, MOD } from '../cdpClient.mjs';

const cdp = await connect();
const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, ...(ok ? {} : { detail }) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const inView = (body) =>
	cdp.evaluate(`const view = app.workspace.getLeavesOfType('patchwork-board').map((l) => l.view).find((v) => v.file?.path.startsWith('_e2e/')); const s = view.surface; ${body}`);
const rectOf = (sel) => inView(`const r = view.contentEl.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };`);
const paper = (i) => inView(`const r = view.contentEl.querySelectorAll('.pw-page-paper')[${i}].getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };`);
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const mod = (id) => `.pw-module[data-module-id="${id}"]`;
async function click(p, modifiers = 0) {
	await cdp.mouse('mouseMoved', p.x, p.y, { button: 'none', modifiers });
	await cdp.mouse('mousePressed', p.x, p.y, { modifiers });
	await cdp.mouse('mouseReleased', p.x, p.y, { modifiers });
	await sleep(80);
}
/** Frames by ID with what each continues, and which show the conflict message. */
const state = () =>
	inView(`
		const frames = view.store.file.pages.flatMap((p) => p.modules.filter((m) => m.type === 'frame').map((m) => [m.id, m.from, p.id]));
		const conflicts = [...view.contentEl.querySelectorAll('.pw-module')].filter((el) => el.innerText.includes('Another frame already continues')).map((el) => el.dataset.moduleId);
		return { frames, conflicts };`);
const shared = (frames) => frames.length !== new Set(frames.map((f) => f[1])).size;

try {
	await cdp.evaluate(`
		require('@electron/remote').getCurrentWindow().focus();
		const v = app.vault;
		if (v.getAbstractFileByPath('_e2e')) await v.delete(v.getAbstractFileByPath('_e2e'), true);
		await v.createFolder('_e2e');
		await app.plugins.plugins.patchwork.createBoard(v.getAbstractFileByPath('_e2e'));
		await new Promise((r) => setTimeout(r, 400));`);
	const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1} of the linked text.`).join('\n\n');
	await inView(`view.store.update((f) => {
		const p = f.pages[0];
		return { ...f, pages: [
			{ ...p, w: 148, h: 210, modules: [
				{ id: 't', type: 'text', markdown: ${JSON.stringify(text)}, x: 10, y: 10, w: 60, h: 40 },
				{ id: 'f1', type: 'frame', from: 't', x: 80, y: 10, w: 60, h: 40 },
				{ id: 'f2', type: 'frame', from: 'f1', x: 10, y: 60, w: 60, h: 40 },
			] },
			{ ...p, id: 'q', x: p.x + 168, w: 148, h: 210, modules: [] },
		] };
	}); s.zoomToFit(); await new Promise((r) => setTimeout(r, 600));`);

	// Cut f1 and paste it on the other page.
	await click(center(await rectOf(mod('f1'))));
	await cdp.key('x', 'KeyX', MOD.ctrl);
	await sleep(300);
	const page2 = await paper(1);
	await click({ x: page2.x + 20, y: page2.y + page2.h - 20 });
	await cdp.key('v', 'KeyV', MOD.ctrl);
	await sleep(800);
	let st = await state();
	const pasted = st.frames.find((f) => f[2] === 'q');
	check('a cut frame is pasted on the other page', !!pasted && !st.frames.some((f) => f[0] === 'f1'), st);
	check('the pasted frame joins the end of the chain, no two frames continue the same text', pasted?.[1] === 'f2' && !shared(st.frames) && st.conflicts.length === 0, st);

	// A conflict made by hand (as older boards may have): 'zz' continues the text like f2 does.
	await inView(`view.store.update((f) => ({ ...f, pages: f.pages.map((p) => (p.id === 'q' ? { ...p, modules: [...p.modules, { id: 'zz', type: 'frame', from: 'f2', x: 80, y: 60, w: 60, h: 40 }] } : p)) }));
		await new Promise((r) => setTimeout(r, 600));`);
	st = await state();
	const loser = st.conflicts[0];
	check('two frames on one text: one says so', st.conflicts.length === 1, st);
	// Drag the losing frame onto the first page and back: the same frame keeps the text.
	// Grab it near its corner: the middle holds the placeholder's button.
	const box = loser && (await rectOf(mod(loser)));
	const before = box && { x: box.x + 8, y: box.y + 8 };
	const firstPage = await paper(0);
	if (before) {
		await cdp.drag(before, { x: firstPage.x + firstPage.w * 0.4, y: firstPage.y + firstPage.h * 0.65 });
		await sleep(600);
	}
	const moved = await state();
	check('moving a frame to another page does not change which frame keeps the text', moved.conflicts.length === 1 && moved.conflicts[0] === loser && moved.frames.find((f) => f[0] === loser)?.[2] !== 'q', [st, moved]);

	const button = await rectOf(`${mod(loser)} .pw-placeholder-action`).catch(() => null);
	check('the extra frame offers to attach itself to the end of the chain', !!button, moved);
	if (button) {
		await click(center(button));
		await sleep(600);
	}
	st = await state();
	check('attaching it clears the conflict', st.conflicts.length === 0 && !shared(st.frames), st);
	await cdp.key('z', 'KeyZ', MOD.ctrl);
	await sleep(400);
	st = await state();
	check('attaching is one undo step', st.conflicts.length === 1, st);
} catch (e) {
	check('no exception', false, String(e?.stack ?? e));
} finally {
	await cdp.evaluate(`
		app.workspace.getLeavesOfType('patchwork-board').forEach((l) => l.detach());
		await new Promise((r) => setTimeout(r, 400));
		const d = app.vault.getAbstractFileByPath('_e2e');
		if (d) await app.vault.delete(d, true);`);
	cdp.close();
}
const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, failed }, null, 2));
process.exitCode = failed.length ? 1 : 0;
