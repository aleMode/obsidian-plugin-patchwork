import type { AnyModule } from '../model/schema';
import { type InkContext, moduleInk } from '../model/contrast';
import { applyInk } from '../view/paperScope';
import { effectivePadding, moduleOpacity, textScale } from '../model/style';
import { tintColor } from '../model/tint';

/**
 * Apply a module's `style` (SPEC 5.3) to its element. Used on the board and in the print host, so
 * both look the same. Values go through CSS custom properties; styles.css does the drawing.
 */
export function applyModuleStyle(el: HTMLElement, m: AnyModule, page?: InkContext) {
	const s = m.style ?? {};
	// Text with no colour of its own follows the module's background (model/contrast).
	if (page) applyInk(el, moduleInk(m, page).ink, page.ink);
	el.toggleClass('has-border', !!s.border && s.border.width > 0);
	el.toggleClass('has-background', !!s.background);
	el.toggleClass('has-text-color', !!s.color);
	el.toggleClass('has-align', !!s.align);
	el.toggleClass('has-font-family', !!s.fontFamily);
	const tint = tintColor(s.tint);
	el.toggleClass('has-tint', !!tint);
	el.setCssProps({
		'--pw-pad': `${effectivePadding(m)}mm`,
		'--pw-border-w': `${Math.max(0, s.border?.width ?? 0)}mm`,
		'--pw-border-c': s.border?.color ?? 'currentColor',
		'--pw-radius': `${Math.max(0, s.border?.radius ?? 0)}mm`,
		'--pw-bg': s.background ?? 'transparent',
		'--pw-opacity': String(moduleOpacity(m)),
		'--pw-text-scale': String(textScale(m)),
		'--pw-color': s.color ?? '',
		'--pw-align': s.align ?? '',
		'--pw-justify': s.align === 'center' ? 'center' : s.align === 'right' ? 'flex-end' : 'flex-start',
		'--pw-font-family': s.fontFamily ?? '',
		'--pw-tint': tint ?? '',
	});
	// A user CSS class (for snippets). Remember it so a change removes the old one.
	const prev = el.dataset.pwClass;
	if (prev && prev !== s.cssClass) el.removeClass(prev);
	if (s.cssClass && /^[A-Za-z_-][\w-]*$/.test(s.cssClass)) {
		el.addClass(s.cssClass);
		el.dataset.pwClass = s.cssClass;
	} else delete el.dataset.pwClass;
}
