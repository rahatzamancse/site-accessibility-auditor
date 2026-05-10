import { evalInPage } from '../shared/devtools-eval.ts';
import type {
	OverlayMode,
	ReadingEntry,
	ReadingOrderResult,
	ReadingOrderSummary,
	ViewportInfo
} from './types.ts';

/**
 * Single in-page walk that produces every field ReadingEntry needs:
 * visibility-filtered DOM preorder, AX role/name/aria, visual semantic
 * classification, keyboard tabbability, and bounding rects. The four
 * orderings are assigned afterwards in TypeScript so the in-page script
 * stays small and pure-compute.
 */
function buildScanExpression(): string {
	return `(function() {
	var IMPLICIT_ROLES = {
		'a': 'link', 'article': 'article', 'aside': 'complementary',
		'button': 'button', 'datalist': 'listbox', 'details': 'group',
		'dialog': 'dialog', 'dt': 'term', 'fieldset': 'group',
		'figure': 'figure', 'footer': 'contentinfo', 'form': 'form',
		'h1': 'heading', 'h2': 'heading', 'h3': 'heading', 'h4': 'heading', 'h5': 'heading', 'h6': 'heading',
		'header': 'banner', 'hr': 'separator', 'img': 'img', 'input': 'textbox',
		'li': 'listitem', 'main': 'main', 'nav': 'navigation', 'ol': 'list',
		'option': 'option', 'output': 'status', 'progress': 'progressbar',
		'section': 'region', 'select': 'combobox', 'summary': 'button',
		'table': 'table', 'textarea': 'textbox', 'thead': 'rowgroup',
		'tbody': 'rowgroup', 'tfoot': 'rowgroup', 'tr': 'row', 'td': 'cell', 'th': 'columnheader',
		'ul': 'list'
	};

	var NATURAL_SELECTORS = [
		'a[href]', 'button:not([disabled])', 'input:not([disabled])',
		'select:not([disabled])', 'textarea:not([disabled])', 'summary',
		'[contenteditable="true"]', '[contenteditable=""]',
		'audio[controls]', 'video[controls]', 'details'
	].join(', ');

	var SEMANTIC_TAGS = {
		h1:1,h2:1,h3:1,h4:1,h5:1,h6:1,nav:1,main:1,aside:1,section:1,
		header:1,footer:1,article:1,img:1,figure:1,table:1,dialog:1,form:1
	};

	function visible(el) {
		var s = window.getComputedStyle(el);
		if (s.display === 'none' || s.visibility === 'hidden') return false;
		if (el.hasAttribute('aria-hidden') && el.getAttribute('aria-hidden') === 'true') return false;
		var r = el.getBoundingClientRect();
		if (r.width <= 0 || r.height <= 0) return false;
		return true;
	}

	// Anything injected by this extension's own overlay (badge spans,
	// recalc buttons, connector SVG) must be invisible to the scan, or
	// repeated scans accumulate the recalc button into the tab order on
	// every pass.
	function isOverlayEl(el) {
		if (!el || !el.closest) return false;
		if (el.id === 'reading-order-overlay-container') return true;
		if (el.id === 'reading-order-connectors') return true;
		return !!el.closest('#reading-order-overlay-container');
	}

	// ---- Layout signal helpers ---------------------------------------
	// All caches live on WeakMaps so repeated ancestor lookups stay O(1)
	// amortised across the whole walk.
	var ROVING_ROLES = { toolbar:1, menu:1, menubar:1, tablist:1, radiogroup:1, listbox:1, tree:1, grid:1 };
	var rovingCache = new WeakMap();
	function findRovingAncestor(el) {
		if (!el) return null;
		if (rovingCache.has(el)) return rovingCache.get(el);
		var p = el.parentElement;
		var r = null;
		if (p) {
			var pr = p.getAttribute && p.getAttribute('role');
			if (pr && ROVING_ROLES[pr]) r = pr;
			else r = findRovingAncestor(p);
		}
		rovingCache.set(el, r);
		return r;
	}

	var inertCache = new WeakMap();
	function findInertAncestor(el) {
		if (!el) return false;
		if (inertCache.has(el)) return inertCache.get(el);
		var hit = false;
		if (el.inert === true || (el.hasAttribute && el.hasAttribute('inert'))) hit = true;
		else {
			var p = el.parentElement;
			hit = p ? findInertAncestor(p) : false;
		}
		inertCache.set(el, hit);
		return hit;
	}

	var ariaHiddenCache = new WeakMap();
	function findAriaHiddenAncestor(el) {
		if (!el) return false;
		if (ariaHiddenCache.has(el)) return ariaHiddenCache.get(el);
		var hit = false;
		if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') hit = true;
		else {
			var p = el.parentElement;
			hit = p ? findAriaHiddenAncestor(p) : false;
		}
		ariaHiddenCache.set(el, hit);
		return hit;
	}

	// Multi-column ancestor: returns the ancestor element + column metrics
	// (or null). Used both for layout.multiColumnAncestor flag and the
	// column-major visual sort buckets.
	var multiColCache = new WeakMap();
	var multiColInfoCache = new WeakMap();
	var multiColCounter = 0;
	function multiColInfo(ancestor) {
		if (multiColInfoCache.has(ancestor)) return multiColInfoCache.get(ancestor);
		var s = window.getComputedStyle(ancestor);
		var count = 1;
		var cc = parseInt(s.columnCount, 10);
		if (!isNaN(cc) && cc > 1) count = cc;
		else if ((s.display === 'grid' || s.display === 'inline-grid') && s.gridTemplateColumns) {
			var tracks = s.gridTemplateColumns.split(/\\s+/).filter(function(t){ return t && t !== 'none'; });
			if (tracks.length >= 2) count = tracks.length;
		}
		var rect = ancestor.getBoundingClientRect();
		var info = count > 1
			? { id: 'mc' + (++multiColCounter), colWidth: rect.width / count, count: count, originX: rect.x }
			: null;
		multiColInfoCache.set(ancestor, info);
		return info;
	}
	function findMultiColAncestor(el) {
		if (!el) return null;
		if (multiColCache.has(el)) return multiColCache.get(el);
		var p = el.parentElement;
		var hit = null;
		if (p) {
			var info = multiColInfo(p);
			if (info) hit = { ancestor: p, info: info };
			else hit = findMultiColAncestor(p);
		}
		multiColCache.set(el, hit);
		return hit;
	}

	function isOffscreen(el, style) {
		var r = el.getBoundingClientRect();
		if (r.width <= 1 && r.height <= 1) return true;
		if (style.position === 'absolute' || style.position === 'fixed') {
			var l = parseFloat(style.left);
			var t = parseFloat(style.top);
			if (!isNaN(l) && l <= -9999) return true;
			if (!isNaN(t) && t <= -9999) return true;
		}
		var cp = style.clipPath || '';
		if (cp.indexOf('inset(50%)') !== -1 || cp.indexOf('inset(100%)') !== -1) return true;
		var clip = style.clip || '';
		if (/rect\\(\\s*0(?:px)?[\\s,]+0(?:px)?[\\s,]+0(?:px)?[\\s,]+0(?:px)?\\s*\\)/.test(clip)) return true;
		var cls = (el.className && typeof el.className === 'string') ? el.className : '';
		if (/\\bsr-only\\b|\\bvisually-hidden\\b|\\bvisuallyhidden\\b|\\bscreen-reader-only\\b/.test(cls)) return true;
		return false;
	}

	function isSkipLink(el, offscreen) {
		if (el.tagName.toLowerCase() !== 'a') return false;
		var href = el.getAttribute('href');
		if (!href || href.charAt(0) !== '#') return false;
		if (offscreen) return true;
		var cls = (el.className && typeof el.className === 'string') ? el.className : '';
		return /\\bskip-link\\b|\\bskip-to-content\\b|\\bskipnav\\b/.test(cls);
	}

	function isDecorative(el, name, isInteractive) {
		if (name) return false;
		if (isInteractive) return false;
		var tag = el.tagName.toLowerCase();
		if (!/^(svg|img|i|span|use|path)$/.test(tag)) return false;
		var r = el.getBoundingClientRect();
		if (r.width > 32 || r.height > 32) return false;
		var p = el.parentElement;
		if (!p) return false;
		var pTag = p.tagName.toLowerCase();
		var pRole = p.getAttribute('role');
		if (/^(button|a|summary)$/.test(pTag)) return true;
		if (pRole === 'button' || pRole === 'link' || pRole === 'menuitem' || pRole === 'tab') return true;
		return false;
	}

	// Locate the active modal once per scan. <dialog>:modal is the canonical
	// signal; we fall back to the last open <dialog> and finally any visible
	// [role="dialog"][aria-modal="true"] element.
	function findActiveModal() {
		var nativeOpen = document.querySelectorAll('dialog[open]');
		for (var i = 0; i < nativeOpen.length; i++) {
			try { if (nativeOpen[i].matches(':modal')) return nativeOpen[i]; } catch (e) {}
		}
		if (nativeOpen.length > 0) return nativeOpen[nativeOpen.length - 1];
		var ariaModals = document.querySelectorAll('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]');
		for (var j = ariaModals.length - 1; j >= 0; j--) {
			var m = ariaModals[j];
			var s = window.getComputedStyle(m);
			if (s.display !== 'none' && s.visibility !== 'hidden') return m;
		}
		return null;
	}
	var ACTIVE_MODAL = findActiveModal();
	function dialogContextOf(el) {
		if (ACTIVE_MODAL && (el === ACTIVE_MODAL || ACTIVE_MODAL.contains(el))) return 'modal';
		var anyDialog = el.closest && el.closest('dialog[open], [role="dialog"], [role="alertdialog"]');
		return anyDialog ? 'open' : null;
	}

	function collectLayout(el, name, isInteractive) {
		var s = window.getComputedStyle(el);
		var pos = s.position || 'static';
		var off = isOffscreen(el, s);
		var mca = findMultiColAncestor(el);
		return {
			position: pos,
			offscreen: off,
			inertAncestor: findInertAncestor(el),
			ariaHiddenSelf: findAriaHiddenAncestor(el),
			dialogContext: dialogContextOf(el),
			rovingGroupRole: findRovingAncestor(el),
			multiColumnAncestor: !!mca,
			skipLinkCandidate: isSkipLink(el, off),
			decorativeCandidate: isDecorative(el, name, isInteractive),
			_mca: mca // internal: passed to raw for column-major sort, dropped before serialization
		};
	}

	function roleOf(el) {
		var explicit = el.getAttribute('role');
		if (explicit) return explicit;
		var tag = el.tagName.toLowerCase();
		if (tag === 'input') {
			var type = (el.getAttribute('type') || 'text').toLowerCase();
			if (type === 'button' || type === 'submit' || type === 'reset' || type === 'image') return 'button';
			if (type === 'checkbox') return 'checkbox';
			if (type === 'radio') return 'radio';
			if (type === 'range') return 'slider';
			if (type === 'search') return 'searchbox';
			return 'textbox';
		}
		return IMPLICIT_ROLES[tag] || 'generic';
	}

	function accessibleName(el) {
		var labelledBy = el.getAttribute('aria-labelledby');
		if (labelledBy) {
			var parts = [];
			var ids = labelledBy.split(/\\s+/);
			for (var i = 0; i < ids.length; i++) {
				var ref = document.getElementById(ids[i]);
				if (ref) parts.push((ref.textContent || '').trim());
			}
			var n = parts.join(' ').trim();
			if (n) return n.slice(0, 120);
		}
		var aria = el.getAttribute('aria-label');
		if (aria && aria.trim()) return aria.trim().slice(0, 120);

		if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
			if (el.id) {
				var label = document.querySelector('label[for=' + CSS.escape(el.id) + ']');
				if (label) return (label.textContent || '').trim().slice(0, 120);
			}
			var parentLabel = el.closest('label');
			if (parentLabel) return (parentLabel.textContent || '').trim().slice(0, 120);
			var ph = el.getAttribute('placeholder');
			if (ph) return ph.slice(0, 120);
		}

		if (el.tagName === 'IMG' || el.tagName === 'AREA' || el.tagName === 'INPUT' && el.getAttribute('type') === 'image') {
			var alt = el.getAttribute('alt');
			if (alt !== null) return alt.trim().slice(0, 120);
		}

		if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'SUMMARY') {
			var text = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
			if (text) return text.slice(0, 120);
		}

		if (el.tagName === 'H1' || el.tagName === 'H2' || el.tagName === 'H3' || el.tagName === 'H4' || el.tagName === 'H5' || el.tagName === 'H6') {
			return (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
		}

		var title = el.getAttribute('title');
		if (title) return title.slice(0, 120);

		return '';
	}

	function pathOf(el) {
		var parts = [];
		var c = el;
		while (c && c !== document.body && parts.length < 10) {
			var tag = c.tagName.toLowerCase();
			var nth = 1, sib = c;
			while ((sib = sib.previousElementSibling)) { if (sib.tagName === c.tagName) nth++; }
			parts.unshift(tag + ':nth-of-type(' + nth + ')');
			c = c.parentElement;
		}
		return parts.join(' > ');
	}

	document.querySelectorAll('[data-reading-order-key]').forEach(function(el) {
		el.removeAttribute('data-reading-order-key');
	});

	var raws = [];
	var domCounter = 0;
	var rawByElement = new WeakMap();

	function pushRaw(el, level, path, rect, role, explicitRole, name, ariaProps, isSemantic, shouldInAx, focusable, focusTabindex) {
		var tag = el.tagName.toLowerCase();
		var isInteractive = focusable !== 'none' || /^(button|a|input|select|textarea|summary)$/.test(tag);
		var label = '';
		if (name) label = name;
		else if (ariaProps['aria-label']) label = ariaProps['aria-label'];
		else {
			var t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
			if (t) label = t.slice(0, 80);
			else if (el.getAttribute('placeholder')) label = el.getAttribute('placeholder');
			else if (el.getAttribute('name')) label = el.getAttribute('name');
			else if (el.id) label = '#' + el.id;
			else label = '<' + tag + '>';
		}
		var domIdx = domCounter++;
		// domIdx suffix keeps keys unique even when the path truncation
		// (max 10 ancestors) would otherwise collide on deep pages.
		var entryKey = (path || '__body__') + '#' + domIdx;
		var layout = collectLayout(el, name, isInteractive);
		// Compute column bin for column-major visual sort within multi-column
		// containers. Stored as raw fields, dropped from layout before return.
		var visualGroup = null;
		var visualBin = null;
		if (layout._mca) {
			visualGroup = layout._mca.info.id;
			var relX = rect.x - layout._mca.info.originX;
			visualBin = Math.max(0, Math.min(layout._mca.info.count - 1, Math.floor(relX / Math.max(1, layout._mca.info.colWidth))));
		}
		delete layout._mca;
		var raw = {
			key: entryKey,
			path: path,
			tag: tag,
			domIndex: domIdx,
			rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
			shouldInAx: shouldInAx,
			level: shouldInAx ? level : -1,
			role: role,
			name: name,
			explicitRole: explicitRole,
			ariaProps: ariaProps,
			isInteractive: isInteractive,
			isSemantic: isSemantic,
			focusable: focusable,
			tabindex: focusTabindex,
			label: label,
			attrId: el.id || null,
			attrClass: el.className && typeof el.className === 'string' ? el.className : null,
			attrType: el.getAttribute('type'),
			attrHref: el.getAttribute('href'),
			attrAriaLabel: el.getAttribute('aria-label'),
			attrName: el.getAttribute('name'),
			attrPlaceholder: el.getAttribute('placeholder'),
			layout: layout,
			visualGroup: visualGroup,
			visualBin: visualBin
		};
		raws.push(raw);
		rawByElement.set(el, raw);
		try { el.setAttribute('data-reading-order-key', entryKey); } catch (e) {}
		return raw;
	}

	function ariaPropsOf(el) {
		var out = {};
		for (var j = 0; j < el.attributes.length; j++) {
			var attr = el.attributes[j];
			if (attr.name.indexOf('aria-') === 0 || attr.name === 'role') {
				out[attr.name] = attr.value;
			}
		}
		return out;
	}

	function focusableOf(el) {
		var ti = el.getAttribute('tabindex');
		var tabindex = ti !== null ? parseInt(ti, 10) : null;
		if (tabindex !== null && isNaN(tabindex)) tabindex = null;
		var naturallyFocusable = el.matches(NATURAL_SELECTORS);
		var focusable = 'none';
		var focusTabindex = null;
		if (tabindex !== null && tabindex < 0) {
			focusable = 'none';
		} else if (tabindex !== null && tabindex > 0) {
			focusable = 'natural';
			focusTabindex = tabindex;
		} else if (tabindex === 0) {
			focusable = naturallyFocusable ? 'natural' : 'programmatic';
			focusTabindex = 0;
		} else if (naturallyFocusable) {
			focusable = 'natural';
			focusTabindex = null;
		}
		return { focusable: focusable, focusTabindex: focusTabindex, rawTabindex: tabindex, naturallyFocusable: naturallyFocusable };
	}

	function walk(el, level, parentInAx) {
		if (isOverlayEl(el)) return;
		if (!visible(el)) return;
		var tag = el.tagName.toLowerCase();
		var role = roleOf(el);
		var explicitRole = el.getAttribute('role');
		var name = accessibleName(el);
		var ariaProps = ariaPropsOf(el);
		var r = el.getBoundingClientRect();
		var path = pathOf(el);
		var f = focusableOf(el);
		var isInteractive = f.focusable !== 'none' || /^(button|a|input|select|textarea|summary)$/.test(tag);
		var isSemantic = SEMANTIC_TAGS[tag] === 1;
		var shouldInAx = role !== 'generic' || name.length > 0;
		var isTracked = shouldInAx || isInteractive || isSemantic || !!explicitRole;

		if (isTracked) {
			pushRaw(el, level, path, r, role, explicitRole, name, ariaProps, isSemantic, shouldInAx, f.focusable, f.focusTabindex);
		}

		for (var i = 0; i < el.children.length; i++) {
			walk(el.children[i], level + (shouldInAx ? 1 : 0), shouldInAx ? el : parentInAx);
		}
	}

	walk(document.body, 0, null);

	// Authoritative tab-order pass — flat querySelectorAll('*') traversal
	// matching the previous tab-order extractor exactly. Positive tabindex
	// first (stable-sorted by value), then tabindex=0 and naturally
	// focusable elements in document order, dropping anything with a zero
	// rect. Elements that the recursive walk skipped (e.g. inside
	// visibility:hidden or aria-hidden subtrees) are added here so they
	// still appear in the tab sequence the browser would use.
	var tabSeen = new Set();
	var positiveTabs = [];
	var zeroTabs = [];
	var allForTab = document.querySelectorAll('*');
	for (var ti = 0; ti < allForTab.length; ti++) {
		var tEl = allForTab[ti];
		if (tabSeen.has(tEl)) continue;
		if (isOverlayEl(tEl)) { tabSeen.add(tEl); continue; }
		var tf = focusableOf(tEl);
		if (tf.focusable === 'none') continue;
		if (tf.rawTabindex !== null && tf.rawTabindex > 0) {
			positiveTabs.push({ el: tEl, tabindex: tf.rawTabindex, focusable: tf.focusable, focusTabindex: tf.focusTabindex });
		} else {
			zeroTabs.push({ el: tEl, tabindex: tf.rawTabindex !== null ? tf.rawTabindex : 0, focusable: tf.focusable, focusTabindex: tf.focusTabindex });
		}
		tabSeen.add(tEl);
	}
	positiveTabs.sort(function(a, b) { return a.tabindex - b.tabindex; });
	var orderedTabs = positiveTabs.concat(zeroTabs);
	var tabKeys = [];
	for (var tj = 0; tj < orderedTabs.length; tj++) {
		var item = orderedTabs[tj];
		var tEl2 = item.el;
		var tRect = tEl2.getBoundingClientRect();
		if (tRect.width <= 0 || tRect.height <= 0) continue;
		var raw = rawByElement.get(tEl2);
		if (!raw) {
			// Walk skipped this element (aria-hidden/visibility:hidden
			// ancestor). Push a minimal entry so the tab sequence stays
			// faithful to what the browser actually reaches.
			var tTag = tEl2.tagName.toLowerCase();
			var tRole = roleOf(tEl2);
			var tExplicit = tEl2.getAttribute('role');
			var tName = accessibleName(tEl2);
			var tAria = ariaPropsOf(tEl2);
			raw = pushRaw(tEl2, 0, pathOf(tEl2), tRect, tRole, tExplicit, tName, tAria, SEMANTIC_TAGS[tTag] === 1, false, item.focusable, item.focusTabindex);
		} else {
			// Ensure focusable state reflects the flat pass (walk may have
			// down-classified it).
			raw.focusable = item.focusable;
			raw.tabindex = item.focusTabindex;
			raw.isInteractive = true;
		}
		tabKeys.push(raw.key);
	}

	var de = document.documentElement;
	var viewport = {
		width: window.innerWidth,
		height: window.innerHeight,
		scrollX: window.scrollX || window.pageXOffset || 0,
		scrollY: window.scrollY || window.pageYOffset || 0,
		documentWidth: Math.max(de.scrollWidth, de.clientWidth, document.body ? document.body.scrollWidth : 0),
		documentHeight: Math.max(de.scrollHeight, de.clientHeight, document.body ? document.body.scrollHeight : 0)
	};

	return { raws: raws, tabKeys: tabKeys, viewport: viewport, hasActiveModal: !!ACTIVE_MODAL };
})()`;
}

interface RawLayout {
	position: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
	offscreen: boolean;
	inertAncestor: boolean;
	ariaHiddenSelf: boolean;
	dialogContext: 'modal' | 'open' | null;
	rovingGroupRole: string | null;
	multiColumnAncestor: boolean;
	skipLinkCandidate: boolean;
	decorativeCandidate: boolean;
}

interface RawEntry {
	key: string;
	path: string;
	tag: string;
	domIndex: number;
	rect: { x: number; y: number; width: number; height: number };
	shouldInAx: boolean;
	level: number;
	role: string;
	name: string;
	explicitRole: string | null;
	ariaProps: Record<string, string>;
	isInteractive: boolean;
	isSemantic: boolean;
	focusable: 'natural' | 'programmatic' | 'none';
	tabindex: number | null;
	label: string;
	attrId: string | null;
	attrClass: string | null;
	attrType: string | null;
	attrHref: string | null;
	attrAriaLabel: string | null;
	attrName: string | null;
	attrPlaceholder: string | null;
	layout: RawLayout;
	visualGroup: string | null;
	visualBin: number | null;
}

function compareVisual(a: RawEntry, b: RawEntry): number {
	// Column-major within the same multi-column container (newspaper /
	// CSS columns / multi-column grid). Entries outside multi-column
	// containers use plain row-major reading order.
	if (a.visualGroup && a.visualGroup === b.visualGroup) {
		if (a.visualBin !== b.visualBin) {
			return (a.visualBin ?? 0) - (b.visualBin ?? 0);
		}
		return a.rect.y - b.rect.y;
	}
	const rowTol = 20;
	const aCy = a.rect.y + a.rect.height / 2;
	const bCy = b.rect.y + b.rect.height / 2;
	if (Math.abs(aCy - bCy) > rowTol) return aCy - bCy;
	return a.rect.x - b.rect.x;
}

function toEntries(raws: RawEntry[], tabKeys: string[]): ReadingEntry[] {
	// Keys are domIndex-suffixed so they are unique by construction; this
	// dedupe is a defensive pass only.
	const uniqueRaws: RawEntry[] = [];
	const seenKeys = new Set<string>();
	for (const r of raws) {
		if (seenKeys.has(r.key)) continue;
		seenKeys.add(r.key);
		uniqueRaws.push(r);
	}

	const visualSorted = uniqueRaws.slice().sort(compareVisual);
	const visualIndexByKey = new Map<string, number>();
	visualSorted.forEach((r, i) => visualIndexByKey.set(r.key, i));

	let axCursor = 0;
	const axIndexByKey = new Map<string, number>();
	for (const r of uniqueRaws) {
		if (r.shouldInAx) {
			axIndexByKey.set(r.key, axCursor++);
		}
	}

	// Tab order comes from the in-page flat pass (authoritative — same
	// algorithm the standalone tab-order panel used).
	const tabIndexByKey = new Map<string, number>();
	tabKeys.forEach((key, i) => tabIndexByKey.set(key, i));

	return uniqueRaws.map((r) => {
		const visualIndex = visualIndexByKey.get(r.key) ?? 0;
		const axIndex = r.shouldInAx ? axIndexByKey.get(r.key) ?? null : null;
		const tabIndex = tabIndexByKey.has(r.key) ? (tabIndexByKey.get(r.key) as number) : null;
		const entry: ReadingEntry = {
			key: r.key,
			path: r.path,
			tag: r.tag,
			domIndex: r.domIndex,
			visualIndex,
			axIndex,
			tabIndex,
			ax: r.shouldInAx
				? {
						role: r.role,
						name: r.name,
						level: Math.max(0, r.level),
						ariaProps: r.ariaProps
					}
				: null,
			visual: {
				text: r.label,
				explicitRole: r.explicitRole,
				isSemantic: r.isSemantic,
				isInteractive: r.isInteractive
			},
			tab:
				tabIndex !== null
					? {
							tabindex: r.tabindex,
							focusable: r.focusable === 'none' ? 'natural' : r.focusable,
							label: r.label
						}
					: null,
			rect: r.rect,
			layout: r.layout,
			attributes: {
				id: r.attrId,
				class: r.attrClass,
				role: r.explicitRole,
				type: r.attrType,
				href: r.attrHref,
				'aria-label': r.attrAriaLabel,
				name: r.attrName,
				placeholder: r.attrPlaceholder
			}
		};
		return entry;
	});
}

export async function scanReadingOrder(): Promise<ReadingOrderResult> {
	const raw = await evalInPage<{
		raws: RawEntry[];
		tabKeys: string[];
		viewport: ViewportInfo;
		hasActiveModal: boolean;
	}>(buildScanExpression());
	const entries = toEntries(raw.raws, raw.tabKeys);

	const summary: ReadingOrderSummary = {
		totalEntries: entries.length,
		axCount: entries.filter((e) => e.axIndex !== null).length,
		tabCount: entries.filter((e) => e.tabIndex !== null).length,
		naturalTabs: entries.filter((e) => e.tab?.focusable === 'natural').length,
		programmaticTabs: entries.filter((e) => e.tab?.focusable === 'programmatic').length,
		hasPositiveTabindex: entries.some(
			(e) => e.tab?.tabindex !== null && (e.tab?.tabindex ?? 0) > 0
		),
		hasActiveModal: raw.hasActiveModal
	};

	return {
		entries,
		viewport: raw.viewport,
		summary,
		timestamp: new Date().toISOString()
	};
}

// ------------------------------------------------------------------
// Page overlay: 4-mode renderer (none | tab | ax | visual)
// ------------------------------------------------------------------

const DYNAMIC_CONTAINER_SELECTORS = [
	'canvas',
	'.leaflet-container',
	'.mapboxgl-map',
	'.maplibregl-map',
	'.ol-viewport',
	'[class*="gm-style"]',
	'.plotly',
	'.js-plotly-plot',
	'.highcharts-container',
	'.echarts',
	'[class*="echarts"]',
	'[data-highcharts-chart]',
	'.vis-network',
	'.sigma-container',
	'.cytoscape-container'
].join(', ');

function buildOverlayCSS(color: string): string {
	return `
#reading-order-overlay-container {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 0 !important;
  height: 0 !important;
  overflow: visible !important;
  pointer-events: none !important;
  z-index: 100000 !important;
}
.reading-order-badge {
  position: absolute !important;
  z-index: 100000 !important;
  min-width: 22px !important;
  height: 22px !important;
  padding: 0 5px !important;
  border-radius: 11px !important;
  background: ${color} !important;
  color: #fff !important;
  font: bold 11px/22px system-ui, sans-serif !important;
  text-align: center !important;
  pointer-events: none !important;
  box-shadow: 0 1px 4px rgba(0,0,0,0.3) !important;
  box-sizing: border-box !important;
}
.reading-order-badge.reading-order-badge-ghost {
  background: transparent !important;
  color: ${color} !important;
  border: 1px dashed ${color} !important;
  box-shadow: none !important;
}
#reading-order-connectors {
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  pointer-events: none !important;
  z-index: 99999 !important;
  overflow: visible !important;
}
/* Highlights deliberately omit z-index so the underlying page element
   stays in its natural stacking order. Promoting the element here pushed
   it above the overlay container (badges, connector lines, recalc
   button), making the highlighted element pop out over the overlay. */
.reading-order-hover-highlight {
  outline: 2px solid ${color} !important;
  outline-offset: 2px !important;
}
.reading-order-active-highlight {
  outline: 3px solid ${color} !important;
  outline-offset: 3px !important;
  animation: reading-order-pulse 0.5s ease-in-out 3 !important;
}
@keyframes reading-order-pulse {
  0%, 100% { outline-offset: 2px; }
  50% { outline-offset: 6px; }
}
.reading-order-recalc-btn {
  position: absolute !important;
  z-index: 100002 !important;
  display: flex !important;
  align-items: center !important;
  gap: 4px !important;
  padding: 4px 10px !important;
  border: none !important;
  border-radius: 6px !important;
  background: ${color} !important;
  color: #fff !important;
  font: 600 11px/1 system-ui, sans-serif !important;
  cursor: pointer !important;
  pointer-events: auto !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25) !important;
  box-sizing: border-box !important;
  transition: opacity 0.15s, transform 0.15s !important;
  opacity: 0.85 !important;
  white-space: nowrap !important;
}
.reading-order-recalc-btn:hover { opacity: 1 !important; transform: scale(1.05) !important; }
.reading-order-recalc-btn:active { transform: scale(0.95) !important; }
.reading-order-recalc-btn svg {
  width: 12px !important; height: 12px !important;
  fill: none !important; stroke: currentColor !important;
  stroke-width: 2.5 !important; stroke-linecap: round !important; stroke-linejoin: round !important;
}
@keyframes reading-order-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
`;
}

interface OverlayStep {
	key: string;
	step: number;
	x: number;
	y: number;
	width: number;
	height: number;
	ghost: boolean;
}

/**
 * Build the per-mode step list on the panel side so the in-page script
 * stays data-driven and identical across modes.
 */
function stepsForMode(entries: ReadingEntry[], mode: Exclude<OverlayMode, 'none'>): OverlayStep[] {
	let selected: { entry: ReadingEntry; index: number; ghost: boolean }[] = [];
	if (mode === 'tab') {
		selected = entries
			.filter((e) => e.tabIndex !== null)
			.map((e) => ({ entry: e, index: e.tabIndex as number, ghost: false }));
	} else if (mode === 'ax') {
		selected = entries
			.filter((e) => e.axIndex !== null)
			.map((e) => ({ entry: e, index: e.axIndex as number, ghost: false }));
		// Mark "skipped" visual-only entries as ghost badges so order gaps
		// are visible in screen-reader mode.
		const skipped = entries
			.filter((e) => e.axIndex === null && e.visual && (e.visual.isInteractive || e.visual.isSemantic))
			.map((e) => ({ entry: e, index: -1, ghost: true }));
		selected = selected.concat(skipped);
	} else {
		selected = entries.map((e) => ({ entry: e, index: e.visualIndex, ghost: false }));
	}
	selected.sort((a, b) => {
		if (a.ghost !== b.ghost) return a.ghost ? 1 : -1;
		return a.index - b.index;
	});
	return selected.map((s, i) => ({
		key: s.entry.key,
		step: s.ghost ? -1 : i + 1,
		x: s.entry.rect.x,
		y: s.entry.rect.y,
		width: s.entry.rect.width,
		height: s.entry.rect.height,
		ghost: s.ghost
	}));
}

function buildInjectOverlayExpression(
	color: string,
	steps: OverlayStep[],
	drawConnectors: boolean
): string {
	const css = buildOverlayCSS(color);
	return `(function() {
	var oldStyle = document.getElementById('reading-order-overlay-css');
	if (oldStyle) oldStyle.remove();
	var oldContainer = document.getElementById('reading-order-overlay-container');
	if (oldContainer) oldContainer.remove();

	var style = document.createElement('style');
	style.id = 'reading-order-overlay-css';
	style.textContent = ${JSON.stringify(css)};
	document.head.appendChild(style);

	var container = document.createElement('div');
	container.id = 'reading-order-overlay-container';
	document.body.appendChild(container);

	var sx = window.scrollX;
	var sy = window.scrollY;
	var STEPS = ${JSON.stringify(steps)};
	var DRAW = ${drawConnectors ? 'true' : 'false'};
	var centers = [];

	for (var i = 0; i < STEPS.length; i++) {
		var s = STEPS[i];
		var docX = s.x + sx;
		var docY = s.y + sy;
		var badge = document.createElement('span');
		badge.className = 'reading-order-badge' + (s.ghost ? ' reading-order-badge-ghost' : '');
		badge.textContent = s.ghost ? '\u2205' : String(s.step);
		badge.setAttribute('data-reading-order-badge', '');
		badge.setAttribute('data-entry-key', s.key);
		badge.style.left = (docX - 10) + 'px';
		badge.style.top = (docY - 10) + 'px';
		container.appendChild(badge);
		if (!s.ghost) {
			centers.push({ x: docX + s.width / 2, y: docY + s.height / 2, key: s.key });
		}
	}

	if (DRAW && centers.length > 1) {
		var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.id = 'reading-order-connectors';
		var docW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
		var docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
		svg.setAttribute('width', docW);
		svg.setAttribute('height', docH);

		for (var j = 0; j < centers.length - 1; j++) {
			var c1 = centers[j];
			var c2 = centers[j + 1];
			var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
			line.setAttribute('x1', c1.x);
			line.setAttribute('y1', c1.y);
			line.setAttribute('x2', c2.x);
			line.setAttribute('y2', c2.y);
			line.setAttribute('stroke', '${color}');
			line.setAttribute('stroke-width', '1.5');
			line.setAttribute('stroke-opacity', '0.3');
			line.setAttribute('stroke-dasharray', '6 4');
			line.setAttribute('data-line-idx', String(j));
			line.style.transition = 'stroke-width 0.15s ease, stroke-opacity 0.15s ease';
			svg.appendChild(line);
		}
		container.appendChild(svg);
	}

	// Hover sync via document-level delegation. Using per-element
	// mouseenter/mouseleave on nested tracked elements causes a flicker
	// between parent.leave and child.enter; delegation resolves the closest
	// tracked ancestor on pointermove and only flips the highlight class
	// when the target actually changes.
	window.__readingOrderHoveredKey = '';
	if (window.__readingOrderHoverCleanup) {
		try { window.__readingOrderHoverCleanup(); } catch (e) {}
	}
	var currentHoverEl = null;
	function onPointerMove(ev) {
		var target = ev.target && ev.target.closest ? ev.target.closest('[data-reading-order-key]') : null;
		if (target === currentHoverEl) return;
		if (currentHoverEl) currentHoverEl.classList.remove('reading-order-hover-highlight');
		currentHoverEl = target;
		if (target) {
			target.classList.add('reading-order-hover-highlight');
			window.__readingOrderHoveredKey = target.getAttribute('data-reading-order-key') || '';
		} else {
			window.__readingOrderHoveredKey = '';
		}
	}
	function onPointerLeave() {
		if (currentHoverEl) currentHoverEl.classList.remove('reading-order-hover-highlight');
		currentHoverEl = null;
		window.__readingOrderHoveredKey = '';
	}
	document.addEventListener('pointermove', onPointerMove, true);
	document.addEventListener('pointerleave', onPointerLeave, true);
	window.__readingOrderHoverCleanup = function() {
		document.removeEventListener('pointermove', onPointerMove, true);
		document.removeEventListener('pointerleave', onPointerLeave, true);
		if (currentHoverEl) currentHoverEl.classList.remove('reading-order-hover-highlight');
	};

	// Recalculate button on dynamic visual containers.
	window.__readingOrderRecalcRequested = false;
	var DYNAMIC_SEL = ${JSON.stringify(DYNAMIC_CONTAINER_SELECTORS)};
	var dynamics = document.querySelectorAll(DYNAMIC_SEL);
	var allSvgs = document.querySelectorAll('svg');
	var largeSvgs = [];
	for (var si = 0; si < allSvgs.length; si++) {
		var sr = allSvgs[si].getBoundingClientRect();
		if (sr.width > 150 && sr.height > 150) largeSvgs.push(allSvgs[si]);
	}
	var seen = new Set();
	var allDynamic = [];
	for (var d = 0; d < dynamics.length; d++) { if (!seen.has(dynamics[d])) { seen.add(dynamics[d]); allDynamic.push(dynamics[d]); } }
	for (var d2 = 0; d2 < largeSvgs.length; d2++) { if (!seen.has(largeSvgs[d2])) { seen.add(largeSvgs[d2]); allDynamic.push(largeSvgs[d2]); } }

	for (var di = 0; di < allDynamic.length; di++) {
		var dynEl = allDynamic[di];
		var dynRect = dynEl.getBoundingClientRect();
		var dynDocX = dynRect.x + sx + dynRect.width - 110;
		var dynDocY = dynRect.y + sy + 8;
		var btn = document.createElement('button');
		btn.className = 'reading-order-recalc-btn';
		btn.setAttribute('data-reading-order-recalc', '');
		btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg> Recalculate';
		btn.style.left = dynDocX + 'px';
		btn.style.top = dynDocY + 'px';
		btn.addEventListener('click', function(e) {
			e.preventDefault();
			e.stopPropagation();
			window.__readingOrderRecalcRequested = true;
			this.innerHTML = '<svg viewBox="0 0 24 24" style="animation: reading-order-spin .5s linear infinite"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg> Refreshing\u2026';
		});
		container.appendChild(btn);
	}
})()`;
}

function buildRemoveOverlayExpression(): string {
	return `(function() {
	var style = document.getElementById('reading-order-overlay-css');
	if (style) style.remove();
	var container = document.getElementById('reading-order-overlay-container');
	if (container) container.remove();
	if (typeof window.__readingOrderHoverCleanup === 'function') {
		try { window.__readingOrderHoverCleanup(); } catch (e) {}
		window.__readingOrderHoverCleanup = null;
	}
	document.querySelectorAll('.reading-order-active-highlight, .reading-order-hover-highlight').forEach(function(el) {
		el.classList.remove('reading-order-active-highlight');
		el.classList.remove('reading-order-hover-highlight');
	});
	window.__readingOrderRecalcRequested = false;
	window.__readingOrderHoveredKey = '';
})()`;
}

function buildClearAllExpression(): string {
	return `(function() {
	var style = document.getElementById('reading-order-overlay-css');
	if (style) style.remove();
	var container = document.getElementById('reading-order-overlay-container');
	if (container) container.remove();
	if (typeof window.__readingOrderHoverCleanup === 'function') {
		try { window.__readingOrderHoverCleanup(); } catch (e) {}
		window.__readingOrderHoverCleanup = null;
	}
	document.querySelectorAll('[data-reading-order-key]').forEach(function(el) {
		el.removeAttribute('data-reading-order-key');
		el.classList.remove('reading-order-active-highlight');
		el.classList.remove('reading-order-hover-highlight');
	});
	window.__readingOrderRecalcRequested = false;
	window.__readingOrderHoveredKey = '';
})()`;
}

function selectorFromKey(key: string): string {
	return `[data-reading-order-key=${JSON.stringify(key)}]`;
}

function buildHighlightExpression(key: string | null): string {
	return `(function() {
	document.querySelectorAll('.reading-order-active-highlight').forEach(function(el) {
		el.classList.remove('reading-order-active-highlight');
	});
	${
		key !== null
			? `var target = document.querySelector(${JSON.stringify(selectorFromKey(key))});
	if (target) {
		target.scrollIntoView({ behavior: 'smooth', block: 'center' });
		target.classList.add('reading-order-active-highlight');
	}`
			: ''
	}
})()`;
}

function buildHoverExpression(key: string | null): string {
	return `(function() {
	document.querySelectorAll('.reading-order-hover-highlight').forEach(function(el) {
		el.classList.remove('reading-order-hover-highlight');
	});
	${
		key !== null
			? `var target = document.querySelector(${JSON.stringify(selectorFromKey(key))});
	if (target) target.classList.add('reading-order-hover-highlight');`
			: ''
	}
})()`;
}

/**
 * Paint the overlay for a given mode. Passes the precomputed step list so
 * the in-page script stays simple and doesn't duplicate ordering logic.
 */
export async function setOverlayMode(
	mode: OverlayMode,
	color: string,
	entries: ReadingEntry[]
): Promise<void> {
	if (mode === 'none') {
		await evalInPage(buildRemoveOverlayExpression());
		return;
	}
	const steps = stepsForMode(entries, mode);
	await evalInPage(buildInjectOverlayExpression(color, steps, true));
}

export async function updateAnnotationColor(
	color: string,
	mode: OverlayMode,
	entries: ReadingEntry[]
): Promise<void> {
	if (mode === 'none') return;
	await setOverlayMode(mode, color, entries);
}

export async function clearReadingOrder(): Promise<void> {
	await evalInPage(buildClearAllExpression());
}

export async function highlightEntry(key: string | null): Promise<void> {
	await evalInPage(buildHighlightExpression(key));
}

export async function hoverEntry(key: string | null): Promise<void> {
	await evalInPage(buildHoverExpression(key));
}

export async function pollHoveredKey(): Promise<string | null> {
	const result = await evalInPage<string>(`(function() {
	return typeof window.__readingOrderHoveredKey === 'string' ? window.__readingOrderHoveredKey : '';
})()`);
	return result && result.length > 0 ? result : null;
}

export async function checkRecalcRequested(): Promise<boolean> {
	const result = await evalInPage<boolean>(`(function() {
	if (window.__readingOrderRecalcRequested) {
		window.__readingOrderRecalcRequested = false;
		return true;
	}
	return false;
})()`);
	return !!result;
}
