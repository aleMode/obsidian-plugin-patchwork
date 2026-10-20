import type { FrozenNote, PdfModule } from './schema';

// Stale-source checks (SPEC 4 M4). Pure.

/** The PDF behind a crop was replaced since the crop was made (or last marked as checked). */
export function pdfChanged(m: Pick<PdfModule, 'sourceId'>, current: string | undefined): boolean {
	return !!m.sourceId && !!current && m.sourceId !== current;
}

/** Whitespace at line ends and around the text doesn't count as a change. */
const normalize = (s: string) => s.replace(/[ \t]+$/gm, '').trim();

/** The live note differs from a frozen snapshot. `live` is null when the source can't be read. */
export function snapshotChanged(frozen: FrozenNote, live: string | null): boolean {
	return live !== null && normalize(frozen.markdown) !== normalize(live);
}
