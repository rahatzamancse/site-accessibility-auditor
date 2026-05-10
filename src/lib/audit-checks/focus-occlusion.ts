import { FOCUSABLE_SELECTORS } from '../constants.ts';
import type { ElementRect } from '../types.ts';
import { wrapPageScript, type RawFinding } from './shared.ts';

export interface FocusObserverObstruction {
	selector: string | null;
	tag: string;
	position: 'fixed' | 'sticky';
	rect: ElementRect;
	coversCorners: number; // 0..4
	overlapArea: number;
}

export interface FocusOcclusionRaw {
	index: number;
	tag: string;
	text: string;
	rect: ElementRect;
	selector: string | null;
	domPath: string | null;
	attributes: Record<string, string | null>;
	obstructions: FocusObserverObstruction[];
}

export type OcclusionVerdict = 'clear' | 'partial' | 'full';

export function verdict(raw: FocusOcclusionRaw): OcclusionVerdict {
	if (raw.obstructions.length === 0) return 'clear';
	const worst = raw.obstructions.reduce((m, o) => Math.max(m, o.coversCorners), 0);
	if (worst >= 4) return 'full';
	return 'partial';
}

export function classifyOcclusion(raw: FocusOcclusionRaw): RawFinding[] {
	const v = verdict(raw);
	if (v === 'clear') return [];
	const findings: RawFinding[] = [];
	const worstObstruction =
		raw.obstructions.slice().sort((a, b) => b.overlapArea - a.overlapArea)[0] ?? null;

	// 2.4.11 (Minimum): fails only when fully obscured.
	findings.push({
		wcag: '2.4.11',
		status: v === 'full' ? 'fail' : 'pass',
		tag: raw.tag,
		text: raw.text,
		rect: raw.rect,
		selector: raw.selector,
		domPath: raw.domPath,
		attributes: raw.attributes,
		evidence: {
			verdict: v,
			obstructions: raw.obstructions,
			worstObstruction
		},
		suggestion:
			v === 'full'
				? `Focus indicator for ${raw.tag} is fully covered by ${worstObstruction?.selector ?? 'a fixed/sticky overlay'} when this element receives focus. Adjust scroll anchoring or add scroll-margin so focused elements stay visible.`
				: `Focus indicator is partially covered by ${worstObstruction?.selector ?? 'a fixed/sticky overlay'} — passes 2.4.11 but fails 2.4.12.`
	});

	// 2.4.12 (Enhanced): any obstruction fails.
	findings.push({
		wcag: '2.4.12',
		status: 'fail',
		tag: raw.tag,
		text: raw.text,
		rect: raw.rect,
		selector: raw.selector,
		domPath: raw.domPath,
		attributes: raw.attributes,
		evidence: {
			verdict: v,
			obstructions: raw.obstructions,
			worstObstruction
		},
		suggestion: `Focus indicator must remain entirely visible for WCAG 2.4.12. Element overlaps with ${worstObstruction?.selector ?? 'a fixed/sticky overlay'}.`
	});

	return findings;
}

export function buildFocusOcclusionCheck(): string {
	const body = `
var SELECTOR = ${JSON.stringify(FOCUSABLE_SELECTORS)};
var els = Array.prototype.slice.call(document.querySelectorAll(SELECTOR));

var stickyOverlays = [];
var all = document.querySelectorAll('*');
for (var i = 0; i < all.length; i++) {
  var el = all[i];
  var cs = window.getComputedStyle(el);
  if ((cs.position === 'fixed' || cs.position === 'sticky') && cs.visibility !== 'hidden' && cs.display !== 'none') {
    var r = __audit_rect(el);
    if (r.width > 0 && r.height > 0) {
      stickyOverlays.push({
        el: el,
        rect: r,
        position: cs.position,
        pointerEvents: cs.pointerEvents,
        zIndex: parseInt(cs.zIndex, 10) || 0
      });
    }
  }
}

var savedActive = document.activeElement;
var savedX = window.scrollX;
var savedY = window.scrollY;

function rectsOverlapArea(a, b) {
  var x = Math.max(a.x, b.x);
  var y = Math.max(a.y, b.y);
  var x2 = Math.min(a.x + a.width, b.x + b.width);
  var y2 = Math.min(a.y + a.height, b.y + b.height);
  var w = x2 - x; var h = y2 - y;
  return (w > 0 && h > 0) ? w * h : 0;
}

function cornersCovered(focusRect, overRect) {
  var corners = [
    { x: focusRect.x, y: focusRect.y },
    { x: focusRect.x + focusRect.width, y: focusRect.y },
    { x: focusRect.x, y: focusRect.y + focusRect.height },
    { x: focusRect.x + focusRect.width, y: focusRect.y + focusRect.height }
  ];
  var covered = 0;
  for (var i = 0; i < corners.length; i++) {
    var c = corners[i];
    if (c.x >= overRect.x && c.x <= overRect.x + overRect.width &&
        c.y >= overRect.y && c.y <= overRect.y + overRect.height) {
      covered++;
    }
  }
  return covered;
}

var raws = [];
for (var i = 0; i < els.length && i < 300; i++) {
  var el = els[i];
  if (!__audit_visible(el)) continue;
  try {
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
  } catch (e) {}
  var focusRect = __audit_rect(el);
  // Expand by 2px for focus ring.
  var fr = { x: focusRect.x - 2, y: focusRect.y - 2, width: focusRect.width + 4, height: focusRect.height + 4 };

  var obstructions = [];
  for (var j = 0; j < stickyOverlays.length; j++) {
    var o = stickyOverlays[j];
    if (o.el === el || o.el.contains(el)) continue;
    if (o.pointerEvents === 'none') continue;
    var area = rectsOverlapArea(fr, o.rect);
    if (area <= 0) continue;
    var corners = cornersCovered(fr, o.rect);
    obstructions.push({
      selector: __audit_getSelector(o.el),
      tag: o.el.tagName.toLowerCase(),
      position: o.position,
      rect: o.rect,
      coversCorners: corners,
      overlapArea: area
    });
  }

  raws.push({
    index: i,
    tag: el.tagName.toLowerCase(),
    text: __audit_text(el),
    rect: focusRect,
    selector: __audit_getSelector(el),
    domPath: __audit_getPath(el),
    attributes: __audit_attrMap(el),
    obstructions: obstructions
  });
}

try {
  if (savedActive && typeof savedActive.focus === 'function') savedActive.focus({ preventScroll: true });
  else if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
} catch (e) {}
window.scrollTo(savedX, savedY);

return { raws: raws };
`;
	return wrapPageScript(body);
}

export interface FocusOcclusionPageResult {
	raws: FocusOcclusionRaw[];
	__error?: string;
}
