// Module colours (SPEC 5.3, Use mode): Canvas's palette, so a patchwork reads like a canvas. The six
// presets are stored as "1"–"6" like Canvas does and follow the theme's colours; anything else is a
// custom #rrggbb colour.

export const TINT_PRESETS = [
	{ id: '1', name: 'Red', rgbVar: '--color-red-rgb' },
	{ id: '2', name: 'Orange', rgbVar: '--color-orange-rgb' },
	{ id: '3', name: 'Yellow', rgbVar: '--color-yellow-rgb' },
	{ id: '4', name: 'Green', rgbVar: '--color-green-rgb' },
	{ id: '5', name: 'Cyan', rgbVar: '--color-cyan-rgb' },
	{ id: '6', name: 'Purple', rgbVar: '--color-purple-rgb' },
] as const;

const HEX = /^#[0-9a-f]{6}$/i;

/** The CSS colour for a stored tint, or undefined for none or a value we don't understand. */
export function tintColor(tint: unknown): string | undefined {
	if (typeof tint !== 'string') return undefined;
	const preset = TINT_PRESETS.find((p) => p.id === tint);
	if (preset) return `rgb(var(${preset.rgbVar}))`;
	return HEX.test(tint) ? tint : undefined;
}
