import { FileSystemAdapter, Plugin } from 'obsidian';
import * as path from 'path';
import { makeContext, Spike } from './context';
import { s1Print } from './s1Print';
import { s2Markdown } from './s2Markdown';
import { s3Pdf } from './s3Pdf';
import { s3Real } from './s3Real';
import { s4Canvas } from './s4Canvas';
import { s5MixedPages } from './s5MixedPages';
import { registerS6View, s6FileView } from './s6FileView';
import { s7Canvas } from './s7Canvas';
import { s8Hybrid } from './s8Hybrid';

const SPIKES: Record<string, Spike> = {
	s1: s1Print,
	s2: s2Markdown,
	s3: s3Pdf,
	s3real: s3Real,
	s4: s4Canvas,
	s5: s5MixedPages,
	s6: s6FileView,
	s7: s7Canvas,
	s8: s8Hybrid,
};

export default class SpikesPlugin extends Plugin {
	outDir = '';

	async onload() {
		const base = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
		// Artifacts go outside the vault so they don't trigger vault events or show up in the explorer.
		this.outDir = path.join(base, '..', '.dev', 'spike-output');
		registerS6View(this);
	}

	async run(id: string, opts?: Record<string, unknown>) {
		const spike = SPIKES[id];
		if (!spike) throw new Error(`Unknown spike ${id}`);
		const ctx = makeContext(this.app, this.outDir);
		const t0 = performance.now();
		let result: unknown;
		let error: string | undefined;
		try {
			result = await spike(ctx, opts);
		} catch (e) {
			error = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
		}
		const report = { id, ms: Math.round(performance.now() - t0), error, result, logs: ctx.logs };
		ctx.save(`${id}.json`, JSON.stringify(report, null, 2));
		return report;
	}
}
