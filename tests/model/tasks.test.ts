import { describe, expect, it } from 'vitest';
import { taskMarks, toggleTaskAt } from '../../src/model/tasks';

const at = (md: string) => taskMarks(md).map((i) => md[i]);

describe('taskMarks', () => {
	it('finds open and done tasks with any bullet, numbered or indented', () => {
		const md = '- [ ] a\n* [x] b\n+ [X] c\n1. [ ] d\n2) [/] e\n    - [ ] nested';
		expect(at(md)).toEqual([' ', 'x', 'X', ' ', '/', ' ']);
	});

	it('finds tasks in callouts and quotes', () => {
		expect(at('> [!note]\n> - [ ] inside\n> > - [x] deeper')).toEqual([' ', 'x']);
	});

	it('skips fenced code, plain lists and brackets that are not task boxes', () => {
		const md = '```\n- [ ] code\n```\n~~~md\n- [ ] tilde\n~~~\n- plain\n- [link](x)\n-[ ] no space\n- [ ]tight\nText [ ] mid\n- [ ] real';
		expect(taskMarks(md)).toEqual([md.lastIndexOf('[ ]') + 1]);
	});

	it('keeps code open until a matching fence closes it', () => {
		expect(taskMarks('````\n```\n- [ ] still code\n````\n- [ ] after')).toHaveLength(1);
	});

	it('accepts an empty task at the end of a line', () => {
		expect(taskMarks('- [ ]')).toEqual([3]);
	});
});

describe('toggleTaskAt', () => {
	it('ticks an open task and reopens any other status', () => {
		const md = '- [ ] a\n- [x] b\n- [/] c';
		const [a, b, c] = taskMarks(md);
		expect(toggleTaskAt(md, a!)).toBe('- [x] a\n- [x] b\n- [/] c');
		expect(toggleTaskAt(md, b!)).toBe('- [ ] a\n- [ ] b\n- [/] c');
		expect(toggleTaskAt(md, c!)).toBe('- [ ] a\n- [x] b\n- [ ] c');
	});
});
