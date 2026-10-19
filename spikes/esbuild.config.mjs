import esbuild from 'esbuild';
import { builtinModules } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';

const outdir = 'test-vault/.obsidian/plugins/patchwork-spikes';
mkdirSync(outdir, { recursive: true });
copyFileSync('spikes/manifest.json', `${outdir}/manifest.json`);

await esbuild.build({
	entryPoints: ['spikes/src/main.ts'],
	bundle: true,
	external: ['obsidian', 'electron', '@electron/remote', ...builtinModules],
	format: 'cjs',
	target: 'es2021',
	sourcemap: 'inline',
	outfile: `${outdir}/main.js`,
	logLevel: 'info',
});
