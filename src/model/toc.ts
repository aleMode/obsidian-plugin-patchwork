import { outputPages } from './masters';
import { pageFurniture } from './numbering';
import type { PatchworkFile } from './schema';

// Table of contents (SPEC 4 M4): named pages in output order with their numbers. Pure.

export interface TocEntry {
	pageId: string;
	title: string;
	/** The page's number as printed ({page}), e.g. "iii" or a custom label. */
	number: string;
}

export const DEFAULT_TOC_HEADING = 'Contents';

/** Named pages, except the page holding the table itself. */
export function tocEntries(file: PatchworkFile, ownPageId?: string): TocEntry[] {
	const furniture = pageFurniture(file, { title: '', date: '' });
	return outputPages(file).flatMap((p) => (p.name && p.id !== ownPageId ? [{ pageId: p.id, title: p.name, number: furniture.get(p.id)?.pageToken ?? '' }] : []));
}
