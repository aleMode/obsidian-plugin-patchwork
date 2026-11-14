import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// `obsidian` ships types only; tests of code that talks to the vault get a thin fake.
	resolve: { alias: { obsidian: fileURLToPath(new URL('./tests/fakes/obsidian.ts', import.meta.url)) } },
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		passWithNoTests: true,
	},
});
