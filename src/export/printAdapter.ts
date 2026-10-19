/**
 * The one place Patchwork touches Electron (hard rule 6).
 *
 * Why: Chromium's printToPDF is the only way to turn Obsidian-rendered notes into a vector PDF at
 * custom page sizes (spike S1). Obsidian's plugin API doesn't expose it; `@electron/remote` does,
 * and other plugins rely on it too. If it ever disappears, the fallback is window.print() with the
 * system dialog (SPEC 9.1), which loses exact page sizes and stage 2.
 */

interface WebContents {
	printToPDF(options: Record<string, unknown>): Promise<Uint8Array>;
}

interface ElectronRemote {
	getCurrentWebContents(): WebContents;
}

function remote(): ElectronRemote | null {
	try {
		const req = (window as unknown as { require?: (id: string) => unknown }).require;
		const r = req?.('@electron/remote') as ElectronRemote | undefined;
		return typeof r?.getCurrentWebContents === 'function' ? r : null;
	} catch {
		return null;
	}
}

export function canPrintToPdf(): boolean {
	return remote() !== null;
}

/** Print the current window (only `.print` content is visible in print media) to PDF bytes. */
export async function printWindowToPdf(): Promise<Uint8Array> {
	const r = remote();
	if (!r) throw new Error('Printing to PDF is not available in this version of Obsidian.');
	const bytes = await r.getCurrentWebContents().printToPDF({
		printBackground: true,
		// Page sizes come from CSS @page rules (named pages per sheet, spike S5).
		preferCSSPageSize: true,
		margins: { top: 0, bottom: 0, left: 0, right: 0 },
		generateTaggedPDF: false,
	});
	return new Uint8Array(bytes);
}
