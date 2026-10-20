import { describe, expect, it } from 'vitest';
import { pdfChanged, snapshotChanged } from '../../src/model/freshness';

describe('freshness', () => {
	it('pdfChanged needs a recorded and a current ID that differ', () => {
		expect(pdfChanged({ sourceId: 'a' }, 'b')).toBe(true);
		expect(pdfChanged({ sourceId: 'a' }, 'a')).toBe(false);
		expect(pdfChanged({}, 'b')).toBe(false);
		expect(pdfChanged({ sourceId: 'a' }, undefined)).toBe(false);
	});

	it('snapshotChanged ignores trailing whitespace, not content', () => {
		const frozen = { at: '2026-10-20', markdown: '# Fireball\nDeals 8d6. \n' };
		expect(snapshotChanged(frozen, '# Fireball\nDeals 8d6.')).toBe(false);
		expect(snapshotChanged(frozen, '# Fireball\nDeals 9d6.')).toBe(true);
		expect(snapshotChanged(frozen, null)).toBe(false);
	});
});
