import { clampScroll } from '../model/style';
import { PX_PER_MM } from '../model/units';

/** Smallest scale "fit" will shrink a note to before it clips (SPEC 5.3). */
const MIN_FIT_SCALE = 0.5;
const FIT_STEPS = 7;

export type OverflowPolicy = 'clip' | 'fit' | 'grow';

/**
 * Apply a note module's overflow policy to its rendered markdown. Layout sizes (offsetHeight,
 * clientHeight) ignore the board's zoom transform, so this works at any zoom.
 * With `clip`, `scrollMm` moves the content up so a later part of it shows in a box too small for
 * all of it. Returns whether content is still cut off (shown as an indicator on screen, never in export).
 */
export function applyOverflow(moduleEl: HTMLElement, body: HTMLElement, policy: OverflowPolicy, scrollMm = 0): boolean {
	const content = body.querySelector<HTMLElement>(':scope > .pw-markdown');
	moduleEl.toggleClass('is-grow', policy === 'grow');
	if (!content) return false;
	content.removeClass('is-fit');
	content.setCssProps({ '--pw-scroll': '0mm' });
	if (policy === 'grow') {
		// The grown height is display-only; the stored `h` never changes (SPEC 5.3).
		moduleEl.setCssProps({ '--pw-grow-h': `${neededHeight(moduleEl, body, content)}mm` });
		return false;
	}
	const box = body.clientHeight;
	if (content.offsetHeight <= box + 1) return false;
	if (policy === 'clip') {
		content.setCssProps({ '--pw-scroll': `${clampScroll(scrollMm, content.offsetHeight / PX_PER_MM, box / PX_PER_MM)}mm` });
		return true;
	}
	return fit(content, box);
}

/** The box height (mm) that shows all of a module's text at full size, or null if it shows no text. */
export function fittedHeight(moduleEl: HTMLElement, body: HTMLElement): number | null {
	const content = body.querySelector<HTMLElement>(':scope > .pw-markdown');
	return content ? neededHeight(moduleEl, body, content) : null;
}

/** Elements whose bottom edge is a clean place to cut a box's text: nothing shows half-cut below them. */
const BLOCK_ENDS = ':scope > *, p, li, tr, h1, h2, h3, h4, h5, h6, pre, blockquote, .callout, table, hr';

/**
 * Box heights (mm) that end just under each block of a module's text (see model/geometry snapToTextEnd).
 * Measured on screen and scaled by the module's own height in mm, which is exact: layout sizes
 * (offsetHeight) are rounded to whole pixels, an error a snapped edge would show.
 */
export function blockEnds(moduleEl: HTMLElement, body: HTMLElement, heightMm: number): number[] {
	const content = body.querySelector<HTMLElement>(':scope > .pw-markdown');
	const box = moduleEl.getBoundingClientRect();
	if (!content || box.height <= 0 || heightMm <= 0) return [];
	const pxPerMm = box.height / heightMm;
	const top = body.getBoundingClientRect();
	// Border and padding, top and bottom: a box ending under a block keeps them around it.
	const chrome = (box.height - top.height) / pxPerMm;
	const ends = new Set<number>();
	for (const el of Array.from(content.querySelectorAll<HTMLElement>(BLOCK_ENDS))) {
		const bottom = (el.getBoundingClientRect().bottom - top.top) / pxPerMm;
		if (bottom > 0.3) ends.add(Math.round((bottom + chrome) * 100) / 100);
	}
	return [...ends].sort((a, b) => a - b);
}

function neededHeight(moduleEl: HTMLElement, body: HTMLElement, content: HTMLElement): number {
	// Border and padding sit around the body; the box keeps them around the content.
	const chrome = Math.max(0, moduleEl.offsetHeight - body.clientHeight);
	return Math.max((content.offsetHeight + chrome) / PX_PER_MM, 5);
}

/**
 * Binary-search the largest scale whose content fits. Text re-wraps at each scale (the content
 * is widened by 1/scale), so the height isn't proportional and can't be computed in one step.
 */
function fit(content: HTMLElement, box: number): boolean {
	content.addClass('is-fit');
	const fitsAt = (s: number) => {
		content.setCssProps({ '--pw-fit': String(s) });
		return content.offsetHeight * s <= box + 1;
	};
	if (!fitsAt(MIN_FIT_SCALE)) return true;
	let lo = MIN_FIT_SCALE, hi = 1;
	for (let i = 0; i < FIT_STEPS; i++) {
		const mid = (lo + hi) / 2;
		if (fitsAt(mid)) lo = mid;
		else hi = mid;
	}
	fitsAt(lo);
	return false;
}
