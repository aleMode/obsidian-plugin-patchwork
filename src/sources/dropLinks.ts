/**
 * Vault paths (or link paths) from a drag out of Obsidian's file explorer. Obsidian puts
 * `obsidian://open?vault=…&file=…` URIs in the drag data (markdown files without `.md`), one per
 * line in text/uri-list. Pure; the caller resolves link paths to files.
 */
export function linkpathsFromDrop(uriList: string, plain: string): string[] {
	const lines = `${uriList}\n${plain}`.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
	const out: string[] = [];
	for (const line of lines) {
		if (!line.startsWith('obsidian://open?')) continue;
		const file = new URLSearchParams(line.slice('obsidian://open?'.length)).get('file');
		if (file && !out.includes(file)) out.push(file);
	}
	return out;
}
