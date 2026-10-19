import { describe, expect, it } from 'vitest';
import { linkpathsFromDrop } from '../../src/sources/dropLinks';

describe('linkpathsFromDrop', () => {
	it('reads obsidian://open URIs from a file-explorer drag', () => {
		const uri = 'obsidian://open?vault=test-vault&file=Rules%2FCombat';
		expect(linkpathsFromDrop(uri, uri)).toEqual(['Rules/Combat']);
	});

	it('handles several files and spaces, and ignores other text', () => {
		const list = 'obsidian://open?vault=v&file=PDFs%2FSample%20rulebook.pdf\r\nobsidian://open?vault=v&file=Images%2FMap.png\n# comment';
		expect(linkpathsFromDrop(list, 'just text')).toEqual(['PDFs/Sample rulebook.pdf', 'Images/Map.png']);
		expect(linkpathsFromDrop('', 'https://example.com')).toEqual([]);
	});
});
