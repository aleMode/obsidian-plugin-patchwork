/**
 * Light "paper" inside a dark app (SPEC 5.5, spike S1). Obsidian declares its derived colour
 * variables (--background-primary: var(--color-base-00), …) on `body`, where they resolve once
 * against the app theme, so a nested `.theme-light` alone changes nothing. Re-declaring those
 * variables on `.pw-paper` makes them resolve against the light base colours of the subtree.
 *
 * The rule has to be generated at runtime (it copies whatever the current theme and snippets
 * declare), so it can't live in styles.css. It is a constructable stylesheet, not a <style> element.
 */
const sheets = new WeakMap<Document, CSSStyleSheet>();

function collectBodyVariables(doc: Document, own: CSSStyleSheet | undefined): string[] {
	const decls: string[] = [];
	for (const sheet of Array.from(doc.styleSheets)) {
		if (sheet === own) continue;
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue; // cross-origin sheets can't be read; Obsidian's and themes' are same-origin
		}
		for (const rule of Array.from(rules)) {
			if (!(rule instanceof CSSStyleRule) || rule.selectorText !== 'body') continue;
			for (const prop of Array.from(rule.style)) {
				if (prop.startsWith('--')) decls.push(`${prop}: ${rule.style.getPropertyValue(prop)};`);
			}
		}
	}
	return decls;
}

/** Install or refresh the scope rule. Call on load and on the workspace `css-change` event. */
export function refreshPaperScope(doc: Document = activeDocument): void {
	let sheet = sheets.get(doc);
	if (!sheet) {
		sheet = new (doc.defaultView ?? window).CSSStyleSheet();
		sheets.set(doc, sheet);
		doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
	}
	sheet.replaceSync(`.pw-paper { ${collectBodyVariables(doc, sheet).join(' ')} color: var(--text-normal); background-color: var(--background-primary); }`);
}

export function removePaperScope(doc: Document = activeDocument): void {
	const sheet = sheets.get(doc);
	if (!sheet) return;
	doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
	sheets.delete(doc);
}
