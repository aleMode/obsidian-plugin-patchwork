export type SaveAction = 'none' | 'write' | 'reload' | 'conflict';

/**
 * Decide what a save should do, given the text we last read from or wrote to disk, what is on disk
 * now, whether we have unsaved edits, and our serialized board. Obsidian's TextFileView would just
 * overwrite (spike S6), losing changes from Sync, git or another editor.
 *
 * `dirty` is tracked separately rather than comparing `ours` with `lastDisk`: a hand-formatted file
 * re-serializes differently even with no edits, and must not count as a local change.
 */
export function decideSave(lastDisk: string, onDisk: string, dirty: boolean, ours: string): SaveAction {
	const changedOnDisk = onDisk !== lastDisk;
	if (!dirty) return changedOnDisk ? 'reload' : 'none';
	if (!changedOnDisk) return ours === onDisk ? 'none' : 'write';
	return ours === onDisk ? 'none' : 'conflict';
}

/**
 * "Board (conflict 2026-10-19 2315).patchwork" next to the original; `n` > 1 numbers further copies made
 * in the same minute ("… 2315 2)"), which would otherwise collide with the first.
 */
export function conflictCopyName(basename: string, extension: string, now: Date, n = 1): string {
	const pad = (v: number) => String(v).padStart(2, '0');
	const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}`;
	return `${basename} (conflict ${stamp}${n > 1 ? ` ${n}` : ''}).${extension}`;
}
