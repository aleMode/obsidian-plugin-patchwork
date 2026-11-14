import type { App, TFile as RealTFile } from 'obsidian';
import { TFile } from './obsidian';

/**
 * An in-memory vault with the calls the code under test makes. `writes` counts modify/create/process
 * writes per path, so tests can check what was (not) written.
 */
export function fakeApp(initial: Record<string, string> = {}) {
	const files = new Map<string, string>(Object.entries(initial));
	const objects = new Map<string, TFile>();
	const fileAt = (path: string) => {
		if (!objects.has(path)) objects.set(path, new TFile(path));
		return objects.get(path)!;
	};
	const writes: string[] = [];
	const leaves: { view: unknown }[] = [];
	const vault = {
		files,
		writes,
		getFiles: () => [...files.keys()].map(fileAt),
		getAbstractFileByPath: (path: string) => (files.has(path) ? fileAt(path) : null),
		read: async (f: TFile) => files.get(f.path) ?? '',
		cachedRead: async (f: TFile) => files.get(f.path) ?? '',
		modify: async (f: TFile, text: string) => {
			files.set(f.path, text);
			writes.push(f.path);
		},
		create: async (path: string, text: string) => {
			if (files.has(path)) throw new Error('File already exists.');
			files.set(path, text);
			writes.push(path);
			return fileAt(path);
		},
		process: async (f: TFile, fn: (text: string) => string) => {
			const before = files.get(f.path) ?? '';
			const after = fn(before);
			if (after !== before) {
				files.set(f.path, after);
				writes.push(f.path);
			}
			return after;
		},
	};
	const app = {
		vault,
		workspace: { getLeavesOfType: () => leaves },
		metadataCache: {
			getFirstLinkpathDest: (link: string) => [...files.keys()].map(fileAt).find((f) => f.path === link || f.path === `${link}.md` || f.basename === link) ?? null,
			fileToLinktext: (f: TFile) => f.basename,
		},
		fileManager: { trashFile: async (f: TFile) => void files.delete(f.path) },
		scope: {},
	};
	// Typed as Obsidian's own, so tests can hand them to the code under test.
	return { app: app as unknown as App, vault, leaves, fileAt: (path: string) => fileAt(path) as unknown as RealTFile };
}
