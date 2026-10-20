// Task checkboxes in markdown ("- [ ] …"), for ticking them from a rendered module in Use mode.
// Obsidian's renderer doesn't say which source line a checkbox came from, so checkboxes are matched
// to task lines by order: the n-th rendered checkbox is the n-th task line here.

/** A list item with a task box: optional quote markers (callouts), indent, bullet or number, "[x]". */
const TASK = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[)([^\]\n])\](?=[ \t]|$)/;
const FENCE = /^(?:[ \t]*>)*[ \t]*(`{3,}|~{3,})/;

/** Offsets of each task's status character ("x" in "- [x]"), in document order; fenced code is skipped. */
export function taskMarks(markdown: string): number[] {
	const marks: number[] = [];
	let fence: string | null = null;
	let at = 0;
	for (const line of markdown.split('\n')) {
		const f = FENCE.exec(line)?.[1];
		if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) fence = fence ? null : f;
		else if (!fence) {
			const m = TASK.exec(line);
			if (m) marks.push(at + m[1]!.length);
		}
		at += line.length + 1;
	}
	return marks;
}

/** Tick or untick the task whose status character is at `offset`: open ("[ ]") becomes done ("[x]"), anything else open. */
export function toggleTaskAt(markdown: string, offset: number): string {
	const next = markdown[offset] === ' ' ? 'x' : ' ';
	return markdown.slice(0, offset) + next + markdown.slice(offset + 1);
}
