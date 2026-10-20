import { orderedPages } from './ordering';
import type { PatchworkFile } from './schema';

// One-way, lossy export to Obsidian's JSON Canvas (SPEC 9.3, spike S7).

/** Default scale: 96 dpi CSS pixels per mm, rounded as the spec says. */
export const CANVAS_PX_PER_MM = 3.78;

export interface CanvasNode {
	id: string;
	type: 'group' | 'file' | 'text';
	x: number;
	y: number;
	width: number;
	height: number;
	label?: string;
	file?: string;
	subpath?: string;
	text?: string;
}

export interface CanvasExport {
	canvas: { nodes: CanvasNode[]; edges: never[] };
	/** What the canvas can't represent, for the export notice. */
	dropped: string[];
}

export function toJsonCanvas(file: PatchworkFile, k = CANVAS_PX_PER_MM): CanvasExport {
	const px = (mm: number) => Math.round(mm * k);
	const nodes: CanvasNode[] = [];
	const dropped = new Set<string>();
	for (const page of orderedPages(file)) {
		// JSON Canvas groups contain whatever lies inside them, so pages come first.
		nodes.push({ id: `page-${page.id}`, type: 'group', x: px(page.x), y: px(page.y), width: px(page.w), height: px(page.h), label: page.name ?? 'Page' });
		for (const m of page.modules) {
			const base = { id: `module-${m.id}`, x: px(page.x + m.x), y: px(page.y + m.y), width: Math.max(1, px(m.w)), height: Math.max(1, px(m.h)) };
			if (m.style && Object.keys(m.style).length) dropped.add('module styles');
			switch (m.type) {
				case 'note': {
					const subpath = typeof m.subpath === 'string' ? m.subpath : undefined;
					nodes.push({ ...base, type: 'file', file: String(m.file), ...(subpath ? { subpath } : {}) });
					if (m.lines) dropped.add('note line ranges');
					if (m.overflow && m.overflow !== 'clip') dropped.add('note overflow settings');
					break;
				}
				case 'pdf':
					nodes.push({ ...base, type: 'file', file: String(m.file), subpath: `#page=${String(m.page)}` });
					if (m.crop) dropped.add('PDF crops');
					if (m.rotation) dropped.add('PDF rotation');
					break;
				case 'image':
					nodes.push({ ...base, type: 'file', file: String(m.file) });
					break;
				case 'text':
					nodes.push({ ...base, type: 'text', text: typeof m.markdown === 'string' ? m.markdown : '' });
					break;
				default:
					dropped.add(`modules of type "${m.type}"`);
			}
		}
	}
	if (file.board.numbering.enabled || file.board.header || file.board.footer) dropped.add('page numbers, headers and footers');
	return { canvas: { nodes, edges: [] }, dropped: [...dropped] };
}
