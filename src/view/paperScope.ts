import type { Ink } from '../model/contrast';

/**
 * Light "paper" inside a dark app (SPEC 5.5, spike S1). Obsidian declares its derived colour
 * variables (--background-primary: var(--color-base-00), …) on `body`, where they resolve once
 * against the app theme, so a nested `.theme-light` alone changes nothing. Re-declaring those
 * variables on `.pw-paper` makes them resolve against the light base colours of the subtree.
 *
 * The rule has to be generated at runtime (it copies whatever the current theme and snippets
 * declare), so it can't live in styles.css. It is a constructable stylesheet, not a <style> element.
 */
// One sheet per window: a popout window has its own document, and a rule installed only in the main
// window left paper there unscoped (white text on white paper in a dark theme).
const sheets = new Map<Document, CSSStyleSheet>();
/** Windows whose rule found no variables (styles not loaded yet when it was built); tried again on ensure. */
const empty = new Set<Document>();

function collectBodyVariables(doc: Document, own: CSSStyleSheet | undefined): string[] {
	const decls: string[] = [];
	// That window's own class: rules in a popout window are not instances of the main window's CSSStyleRule.
	const StyleRule = doc.defaultView?.CSSStyleRule ?? CSSStyleRule;
	for (const sheet of Array.from(doc.styleSheets)) {
		if (sheet === own) continue;
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue; // cross-origin sheets can't be read; Obsidian's and themes' are same-origin
		}
		for (const rule of Array.from(rules)) {
			if (!(rule instanceof StyleRule) || rule.selectorText !== 'body') continue;
			for (const prop of Array.from(rule.style)) {
				if (prop.startsWith('--')) decls.push(`${prop}: ${rule.style.getPropertyValue(prop)};`);
			}
		}
	}
	return decls;
}

/** Install or refresh the scope rule in one window's document. */
export function refreshPaperScope(doc: Document = activeDocument): void {
	let sheet = sheets.get(doc);
	if (!sheet) {
		sheet = new (doc.defaultView ?? window).CSSStyleSheet();
		sheets.set(doc, sheet);
		doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
	}
	const decls = collectBodyVariables(doc, sheet);
	if (decls.length) empty.delete(doc);
	else empty.add(doc);
	const vars = decls.join(' ');
	// `.pw-rescope` re-themes a page or module whose background needs the other ink (see model/contrast): the
	// element also gets `theme-dark` or `theme-light` for the base colours, and the same re-declaration.
	sheet.replaceSync(`.pw-paper { ${vars} color: var(--text-normal); background-color: var(--background-primary); } .pw-rescope { ${vars} color: var(--text-normal); }`);
}

/** Ink of a page with no background: dark on paper, else the app theme's. */
export function themeInk(appTheme: boolean, doc: Document = activeDocument): Ink {
	return appTheme && doc.body.hasClass('theme-dark') ? 'light' : 'dark';
}

/**
 * Re-theme `el` for `ink` when it differs from the ink around it (`base`): light ink is the dark theme's
 * text colours, dark ink the light theme's. `paper` keeps the element's own light paper scope otherwise.
 */
export function applyInk(el: HTMLElement, ink: Ink, base: Ink, paper = false) {
	const flip = ink !== base;
	el.toggleClass('pw-rescope', flip);
	el.toggleClass('theme-dark', flip && ink === 'light');
	el.toggleClass('theme-light', flip ? ink === 'dark' : paper);
}

/** Make sure a window that is about to show paper has the rule (a board opened in a popout window). */
export function ensurePaperScope(doc: Document): void {
	if (!sheets.has(doc) || empty.has(doc)) refreshPaperScope(doc);
}

/** Theme or snippets changed: rebuild the rule in every window that has one. Closed windows are dropped. */
export function refreshAllPaperScopes(): void {
	for (const doc of [...sheets.keys()]) {
		if (doc.defaultView) refreshPaperScope(doc);
		else {
			sheets.delete(doc);
			empty.delete(doc);
		}
	}
}

export function removePaperScope(doc: Document = activeDocument): void {
	const sheet = sheets.get(doc);
	if (!sheet) return;
	doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
	sheets.delete(doc);
	empty.delete(doc);
}

export function removeAllPaperScopes(): void {
	for (const doc of [...sheets.keys()]) removePaperScope(doc);
}
