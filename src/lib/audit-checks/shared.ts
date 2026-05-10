import type { ElementRect } from '../types.ts';

export interface RawFinding {
	wcag: string;
	status: 'pass' | 'warning' | 'fail' | 'exempt';
	tag: string;
	text: string;
	rect: ElementRect | null;
	selector: string | null;
	domPath: string | null;
	attributes: Record<string, string | null>;
	evidence: Record<string, unknown>;
	suggestion: string;
}

/**
 * Source shared by all page-side IIFEs. Assigned as the first statement.
 * Exported so tests can also consume the same helpers.
 */
export const PAGE_HELPERS = `
function __audit_cssEscape(v) {
  if (window.CSS && window.CSS.escape) return window.CSS.escape(String(v));
  return String(v).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
}
function __audit_getPath(el) {
  var parts = [];
  var cur = el;
  while (cur && cur !== document.body && parts.length < 6) {
    var tag = cur.tagName ? cur.tagName.toLowerCase() : '';
    if (!tag) break;
    var nth = 1;
    var sib = cur;
    while ((sib = sib.previousElementSibling)) {
      if (sib.tagName === cur.tagName) nth++;
    }
    parts.unshift(tag + ':nth-of-type(' + nth + ')');
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}
function __audit_getSelector(el) {
  if (!el || !el.tagName) return null;
  if (el.id) return '#' + __audit_cssEscape(el.id);
  var aria = el.getAttribute && el.getAttribute('aria-label');
  if (aria) return el.tagName.toLowerCase() + '[aria-label="' + aria.replace(/"/g, '\\\\"') + '"]';
  var name = el.getAttribute && el.getAttribute('name');
  if (name) return el.tagName.toLowerCase() + '[name="' + name.replace(/"/g, '\\\\"') + '"]';
  return __audit_getPath(el);
}
function __audit_attrMap(el) {
  return {
    id: el.id || null,
    class: (el.className && typeof el.className === 'string') ? el.className : null,
    role: el.getAttribute ? el.getAttribute('role') : null,
    type: el.getAttribute ? el.getAttribute('type') : null,
    href: el.getAttribute ? el.getAttribute('href') : null,
    'aria-label': el.getAttribute ? el.getAttribute('aria-label') : null,
    name: el.getAttribute ? el.getAttribute('name') : null,
    placeholder: el.getAttribute ? el.getAttribute('placeholder') : null,
    autocomplete: el.getAttribute ? el.getAttribute('autocomplete') : null
  };
}
function __audit_text(el) {
  var t = (el.innerText || el.textContent || '');
  return t.trim().substring(0, 80);
}
function __audit_rect(el) {
  var r = el.getBoundingClientRect();
  // Page-coord rect: viewport rect + current scroll. Lets the panel crop a
  // stitched full-page screenshot and place the rect on the minimap without
  // re-querying the page after the user has scrolled.
  return {
    x: r.x + (window.scrollX || window.pageXOffset || 0),
    y: r.y + (window.scrollY || window.pageYOffset || 0),
    width: r.width,
    height: r.height
  };
}
function __audit_visible(el) {
  var r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  var s = window.getComputedStyle(el);
  if (s.visibility === 'hidden' || s.display === 'none') return false;
  if (parseFloat(s.opacity || '1') === 0) return false;
  return true;
}
`;

/**
 * Wrap IIFE body with shared helpers and return a string suitable for
 * `chrome.devtools.inspectedWindow.eval`.
 */
export function wrapPageScript(body: string): string {
	return `(function(){
${PAGE_HELPERS}
try {
${body}
} catch (e) {
  return { __error: (e && e.message) || String(e) };
}
})()`;
}

export function rectsOverlap(a: ElementRect, b: ElementRect): boolean {
	return !(
		a.x + a.width <= b.x ||
		b.x + b.width <= a.x ||
		a.y + a.height <= b.y ||
		b.y + b.height <= a.y
	);
}

export function rectCenter(r: ElementRect): { x: number; y: number } {
	return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Distance between nearest edges; 0 if overlapping. */
export function rectEdgeDistance(a: ElementRect, b: ElementRect): number {
	const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
	const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
	return Math.sqrt(dx * dx + dy * dy);
}
