import { TFile } from 'obsidian';
import { sleep, Spike } from './context';

const PX_PER_MM = 3.78;
const px = (mm: number) => Math.round(mm * PX_PER_MM);

/** S7: does native Canvas open our generated .canvas, honouring note subpaths and PDF #page=N? */
export const s7Canvas: Spike = async (ctx, opts) => {
	const { app } = ctx;
	const path = 'Spike export.canvas';
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing) await app.vault.delete(existing);

	const col = (i: number) => px(10 + i * 100);
	const canvas = {
		nodes: [
			{ id: 'page1', type: 'group', x: 0, y: 0, width: px(420), height: px(297), label: 'Page 1 (A3 landscape)' },
			{ id: 'heading', type: 'file', file: 'Rules/Combat.md', subpath: '#Prone', x: col(0), y: px(10), width: px(90), height: px(120) },
			{ id: 'block', type: 'file', file: 'Rules/Combat.md', subpath: '#^opportunity', x: col(1), y: px(10), width: px(90), height: px(60) },
			{ id: 'pdf', type: 'file', file: 'PDFs/Sample rulebook.pdf', subpath: '#page=2', x: col(2), y: px(10), width: px(110), height: px(150) },
			{ id: 'text', type: 'text', text: '**Text module** with *markdown*', x: col(1), y: px(80), width: px(90), height: px(40) },
			{ id: 'image', type: 'file', file: 'Images/Map.png', x: col(0), y: px(140), width: px(90), height: px(68) },
			{ id: 'nested', type: 'file', file: 'Rules/Combat.md', subpath: '#Conditions#Prone', x: col(1), y: px(140), width: px(90), height: px(100) },
		],
		edges: [],
	};
	const file = await app.vault.create(path, JSON.stringify(canvas, null, '\t'));
	const leaf = app.workspace.getLeaf(true);
	await leaf.openFile(file as TFile);
	await sleep(3000);

	const nodes = Array.from(leaf.view.containerEl.querySelectorAll('.canvas-node'));
	const report = nodes.map((n) => {
		const el = n as HTMLElement;
		return {
			classes: el.className,
			text: el.innerText.replace(/\s+/g, ' ').slice(0, 160),
			hasPdf: !!el.querySelector('.pdf-container, .pdf-viewer, .pdfViewer'),
			pdfPageInput: (el.querySelector('input.pdf-page-input, .pdf-toolbar input[type="number"]') as HTMLInputElement | null)?.value ?? null,
			pdfVisiblePages: Array.from(el.querySelectorAll('.page[data-page-number]'))
				.filter((p) => (p as HTMLElement).getBoundingClientRect().height > 0 && (p as HTMLElement).querySelector('canvas'))
				.map((p) => (p as HTMLElement).dataset.pageNumber),
		};
	});
	const out = { viewType: leaf.view.getViewType(), nodeCount: nodes.length, nodes: report };
	if (!opts?.keep) {
		leaf.detach();
		await app.vault.delete(file);
	}
	return out;
};
