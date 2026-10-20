import type { AnyModule } from '../model/schema';
import { textScale } from '../model/style';

/**
 * Apply a module's `style` (SPEC 5.3) to its element. Used on the board and in the print host, so
 * both look the same. Values go through CSS custom properties; styles.css does the drawing.
 */
export function applyModuleStyle(el: HTMLElement, m: AnyModule) {
	const s = m.style ?? {};
	el.toggleClass('has-border', !!s.border && s.border.width > 0);
	el.toggleClass('has-background', !!s.background);
	el.setCssProps({
		'--pw-pad': `${Math.max(0, s.padding ?? 0)}mm`,
		'--pw-border-w': `${Math.max(0, s.border?.width ?? 0)}mm`,
		'--pw-border-c': s.border?.color ?? 'currentColor',
		'--pw-radius': `${Math.max(0, s.border?.radius ?? 0)}mm`,
		'--pw-bg': s.background ?? 'transparent',
		'--pw-opacity': String(typeof s.opacity === 'number' ? Math.min(1, Math.max(0, s.opacity)) : 1),
		'--pw-text-scale': String(textScale(m)),
	});
	// A user CSS class (for snippets). Remember it so a change removes the old one.
	const prev = el.dataset.pwClass;
	if (prev && prev !== s.cssClass) el.removeClass(prev);
	if (s.cssClass && /^[A-Za-z_-][\w-]*$/.test(s.cssClass)) {
		el.addClass(s.cssClass);
		el.dataset.pwClass = s.cssClass;
	} else delete el.dataset.pwClass;
}
