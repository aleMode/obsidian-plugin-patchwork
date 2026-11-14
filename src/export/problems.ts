/** Something that would print wrongly, reported after the export; `at` lets the user jump to the item. */
export interface ExportProblem {
	text: string;
	at?: { pageId: string; moduleId?: string };
}

/** The same problem found twice (e.g. in two passes) is reported once. */
export function uniqueProblems(list: readonly ExportProblem[]): ExportProblem[] {
	const seen = new Set<string>();
	return list.filter((p) => !seen.has(p.text) && !!seen.add(p.text));
}
