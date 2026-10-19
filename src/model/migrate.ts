import { SCHEMA_VERSION } from './schema';

type Json = Record<string, unknown>;

/** STEPS[n] upgrades a raw file from version n to n + 1. Empty until the format first changes. */
export type MigrationSteps = Record<number, (raw: Json) => Json>;

const STEPS: MigrationSteps = {};

/**
 * Upgrade raw parsed JSON step by step to `target`. Works on raw objects, before validation,
 * so each step only needs to know the shape of its own two versions.
 */
export function migrate(raw: Json, steps: MigrationSteps = STEPS, target: number = SCHEMA_VERSION): Json {
	let current = raw;
	let v = current.version as number;
	while (v < target) {
		const step = steps[v];
		if (!step) throw new Error(`No migration from version ${v} to ${v + 1}`);
		current = { ...step(current), version: v + 1 };
		v++;
	}
	return current;
}
