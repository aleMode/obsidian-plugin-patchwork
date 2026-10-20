import type { PageFurniture } from '../model/numbering';
import type { NumberPosition } from '../model/schema';

/**
 * Page number, header and footer on a page (SPEC 5.4). Shared by the board and the print host, so
 * what you see is what prints. Drawn above modules and never interactive.
 */
export function renderFurniture(paper: HTMLElement, f: PageFurniture | undefined, position: NumberPosition) {
	let layer = paper.querySelector<HTMLElement>(':scope > .pw-furniture');
	if (!f || (!f.number && !f.header && !f.footer)) {
		layer?.remove();
		return;
	}
	if (!layer) layer = paper.createDiv({ cls: 'pw-furniture' });
	layer.empty();
	if (f.header) layer.createDiv({ cls: 'pw-furniture-header', text: f.header });
	if (f.footer) layer.createDiv({ cls: 'pw-furniture-footer', text: f.footer });
	if (f.number) layer.createDiv({ cls: `pw-page-number pw-pos-${position}`, text: f.number });
}
