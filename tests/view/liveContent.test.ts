import { describe, expect, it } from 'vitest';
import type { AnyModule } from '../../src/model/schema';
import { taskMarks, toggleTaskAt } from '../../src/model/tasks';
import { cannotTick } from '../../src/view/liveContent';

// Use mode checkboxes (SPEC 5.7): when a rendered checkbox may be written back, and to which line.

const md = '- [ ] one\n- [x] two\n\n```\n- [ ] in code\n```\n- [ ] three';
const text = (markdown: string): AnyModule => ({ id: 't', type: 'text', markdown, x: 0, y: 0, w: 10, h: 10 });
const note = (extra: Record<string, unknown> = {}): AnyModule => ({ id: 'n', type: 'note', file: 'a.md', x: 0, y: 0, w: 10, h: 10, ...extra });

describe('cannotTick', () => {
	it('allows a text box or note whose rendered boxes match its task lines', () => {
		expect(cannotTick(text(md), md, 3, false)).toBeNull();
		expect(cannotTick(note(), md, 3, false)).toBeNull();
	});

	it('refuses frames and master content (nothing shown to map), frozen notes and read-only text', () => {
		expect(cannotTick(undefined, md, 3, false)).toMatch(/frames and master pages/);
		expect(cannotTick(note({ frozen: md }), md, 3, false)).toMatch(/frozen/);
		expect(cannotTick(text(md), md, 3, true)).toMatch(/read-only/);
		expect(cannotTick(text(md), 'changed meanwhile', 3, false)).toMatch(/read-only/);
	});

	it('refuses when the rendered boxes and task lines differ in number, so a tick never lands on the wrong line', () => {
		expect(cannotTick(note(), md, 4, false)).toMatch(/match/);
	});
});

describe('checkbox to line', () => {
	it('the nth rendered box toggles the nth task line, skipping code blocks', () => {
		const marks = taskMarks(md);
		expect(toggleTaskAt(md, marks[2]!).split('\n').at(-1)).toBe('- [x] three');
		expect(toggleTaskAt(md, marks[1]!).split('\n')[1]).toBe('- [ ] two');
	});
});
