import { describe, expect, it } from 'vitest';
import { insertLink, plainText, type Replace, toggleLines, toggleWrap } from '../../src/model/mdFormat';

const apply = (text: string, r: Replace) => text.slice(0, r.from) + r.insert + text.slice(r.to);

describe('toggleWrap', () => {
	it('wraps the selection and keeps it selected', () => {
		const r = toggleWrap('make bold please', 5, 9, '**');
		expect(apply('make bold please', r)).toBe('make **bold** please');
		expect('make **bold** please'.slice(r.selStart, r.selEnd)).toBe('bold');
	});
	it('wraps nothing selected by putting the caret between the marks', () => {
		const r = toggleWrap('ab', 1, 1, '*');
		expect(apply('ab', r)).toBe('a**b');
		expect(r.selStart).toBe(2);
		expect(r.selEnd).toBe(2);
	});
	it('takes off marks around the selection', () => {
		const t = 'make **bold** please';
		const r = toggleWrap(t, 7, 11, '**');
		expect(apply(t, r)).toBe('make bold please');
		expect(apply(t, r).slice(r.selStart, r.selEnd)).toBe('bold');
	});
	it('takes off marks inside the selection', () => {
		const t = 'make **bold** please';
		expect(apply(t, toggleWrap(t, 5, 13, '**'))).toBe('make bold please');
	});
	it('works at the very start and end of the text', () => {
		expect(apply('x', toggleWrap('x', 0, 1, '`'))).toBe('`x`');
		expect(apply('`x`', toggleWrap('`x`', 1, 2, '`'))).toBe('x');
	});
});

describe('toggleLines', () => {
	it('adds a heading to the line with the caret', () => {
		expect(apply('one\ntwo\nthree', toggleLines('one\ntwo\nthree', 5, 5, 'h2'))).toBe('one\n## two\nthree');
	});
	it('adds a bullet to every selected line and skips blank ones', () => {
		const t = 'a\n\nb\nc';
		expect(apply(t, toggleLines(t, 0, t.length, 'bullet'))).toBe('- a\n\n- b\n- c');
	});
	it('numbers an ordered list from 1', () => {
		const t = 'a\nb\nc';
		expect(apply(t, toggleLines(t, 0, t.length, 'ordered'))).toBe('1. a\n2. b\n3. c');
	});
	it('removes the marker when every line already has it', () => {
		const t = '- a\n- b';
		expect(apply(t, toggleLines(t, 0, t.length, 'bullet'))).toBe('a\nb');
		expect(apply('# T', toggleLines('# T', 0, 0, 'h1'))).toBe('T');
	});
	it('switches between styles instead of stacking markers', () => {
		expect(apply('# T', toggleLines('# T', 0, 0, 'h2'))).toBe('## T');
		expect(apply('- a', toggleLines('- a', 0, 0, 'ordered'))).toBe('1. a');
		expect(apply('1. a', toggleLines('1. a', 0, 0, 'quote'))).toBe('> a');
	});
	it('a selection ending at a line break does not touch the next line', () => {
		const t = 'a\nb';
		expect(apply(t, toggleLines(t, 0, 2, 'bullet'))).toBe('- a\nb');
	});
	it('works on the last line without a trailing newline', () => {
		expect(apply('a\nb', toggleLines('a\nb', 3, 3, 'quote'))).toBe('a\n> b');
	});
});

describe('insertLink', () => {
	it('wraps the selection and selects the url', () => {
		const r = insertLink('see docs here', 4, 8);
		const out = apply('see docs here', r);
		expect(out).toBe('see [docs](url) here');
		expect(out.slice(r.selStart, r.selEnd)).toBe('url');
	});
	it('uses a placeholder label when nothing is selected', () => {
		expect(apply('', insertLink('', 0, 0))).toBe('[link](url)');
	});
});

describe('plainText', () => {
	it('drops marks, link targets and table pipes', () => {
		expect(plainText('Plain, **bold**, *italic*, [link](https://x.y), `code`\n\n- bullet one')).toBe('Plain, bold, italic, link, code bullet one');
		expect(plainText('# Title\n> quote [[Note|alias]] [[Other]]')).toBe('Title quote alias Other');
		expect(plainText('| A | B |')).toBe('A B');
	});
});
