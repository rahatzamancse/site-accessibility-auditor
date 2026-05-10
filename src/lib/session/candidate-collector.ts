import { evalInPage, type EvalOptions } from '../shared/devtools-eval.ts';
import type { CandidateKind, InteractionCandidate } from './types.ts';

interface RawCandidate {
	kind: CandidateKind;
	selector: string;
	label: string;
	key: string;
	rect: { x: number; y: number; width: number; height: number };
	likelyNavigates: boolean;
}

export interface CollectOptions extends EvalOptions {
	max?: number;
	/**
	 * Drop candidates whose activation is likely to navigate or open a modal
	 * we cannot reliably close (`button`, `dialog-opener`, anchors that look
	 * navigation-y). Used by the panel "safe mode" toggle for production sites.
	 */
	safeMode?: boolean;
}

export interface CollectResult {
	candidates: InteractionCandidate[];
	skippedShadow: number;
	skippedIframe: number;
	skippedDisabled: number;
	skippedNavigation: number;
}

const DESTRUCTIVE_LABEL = String.raw`delete|remove|destroy|clear|reset|cancel|discard|sign\s*out|log\s*out|logout|buy|purchase|submit|send|post|publish|pay|checkout|confirm|proceed|yes|ok|continue|leave|exit`;

/**
 * Walk the live DOM and collect a bounded list of safe interactions to try.
 * Pierces open shadow roots, skips disabled / hidden / cross-origin / target=_blank
 * candidates, and tags each picked element with `data-aud-id="<id>"` so the
 * explorer can re-resolve it at click time even after a re-render.
 */
export async function collectCandidates(options: CollectOptions = {}): Promise<CollectResult> {
	const max = options.max ?? 24;
	const safeMode = options.safeMode === true;
	const expr = `(function() {
		var MAX = ${max};
		var SAFE = ${safeMode ? 'true' : 'false'};
		var DESTRUCTIVE = new RegExp('${DESTRUCTIVE_LABEL}', 'i');
		var seen = new WeakSet();
		var out = [];
		var keyCounts = Object.create(null);
		var skipped = { shadow: 0, iframe: 0, disabled: 0, navigation: 0 };

		// Clean previous tags so re-runs don't accumulate stale attributes.
		document.querySelectorAll('[data-aud-id]').forEach(function(n){ n.removeAttribute('data-aud-id'); });

		function visibleRect(el) {
			var r = el.getBoundingClientRect();
			if (r.width <= 0 || r.height <= 0) return null;
			var s = window.getComputedStyle(el);
			if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity || '1') === 0) return null;
			return r;
		}

		function label(el) {
			var t = (el.getAttribute('aria-label') || el.getAttribute('title') || (el.innerText || '') || '').trim();
			if (!t && el.querySelector) {
				var i = el.querySelector('svg title, img[alt]');
				if (i) t = (i.getAttribute('alt') || i.textContent || '').trim();
			}
			return t.replace(/\\s+/g, ' ').slice(0, 80);
		}

		function isDisabled(el) {
			if (el.disabled === true) return true;
			if (el.getAttribute('aria-disabled') === 'true') return true;
			return false;
		}

		function isInIframe(el) {
			return el.ownerDocument !== document;
		}

		function looksNavigation(el) {
			if (el.tagName === 'A') {
				var href = el.getAttribute('href') || '';
				if (el.target === '_blank' || el.getAttribute('target') === '_blank') return true;
				if (!href || href === '#') return true;
				if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return true;
				if (el.hasAttribute('download')) return true;
				if (href.indexOf('://') !== -1) {
					try {
						var u = new URL(href, location.href);
						if (u.origin !== location.origin) return true;
					} catch (e) { return true; }
				}
				if (!href.startsWith('#')) {
					// Same-origin path/route: SPA may swap the document; treat as nav.
					return true;
				}
				return false;
			}
			return false;
		}

		function consider(el, kind) {
			if (out.length >= MAX) return;
			if (seen.has(el)) return;
			seen.add(el);
			if (isInIframe(el)) { skipped.iframe++; return; }
			if (isDisabled(el)) { skipped.disabled++; return; }
			var r = visibleRect(el);
			if (!r) return;
			if (el.tagName === 'BUTTON' || el.tagName === 'INPUT') {
				var type = (el.getAttribute('type') || '').toLowerCase();
				if (type === 'submit' || type === 'reset') return;
			}
			var nav = looksNavigation(el);
			if (nav) {
				if (kind === 'in-page-link') {
					// in-page-link only collects href^="#" — nav check there means
					// empty/javascript/external href (still skip).
					skipped.navigation++;
					return;
				}
				if (SAFE) { skipped.navigation++; return; }
			}
			if (kind === 'button') {
				if (SAFE) { skipped.navigation++; return; }
				var lbl = (el.innerText || '').toLowerCase();
				if (DESTRUCTIVE.test(lbl)) return;
			}
			if (SAFE && kind === 'dialog-opener') {
				skipped.navigation++;
				return;
			}
			var lblText = label(el);
			if (!lblText) lblText = '(' + kind + ')';
			var id = out.length;
			el.setAttribute('data-aud-id', String(id));
			var sel = '[data-aud-id="' + id + '"]';
			var keyBase = kind + '|' + lblText;
			var nth = keyCounts[keyBase] || 0;
			keyCounts[keyBase] = nth + 1;
			var stableKey = keyBase + '#' + nth;
			out.push({ kind: kind, selector: sel, label: lblText, key: stableKey, rect: { x: r.x, y: r.y, width: r.width, height: r.height }, likelyNavigates: !!nav });
		}

		// Walk DOM + open shadow roots.
		function walk(root) {
			var stack = [root];
			while (stack.length) {
				if (out.length >= MAX) return;
				var node = stack.pop();
				if (!node) continue;
				if (node.shadowRoot) {
					stack.push(node.shadowRoot);
					skipped.shadow++; // count piercing — informational
				}
				var children = node.children;
				if (children) {
					for (var i = children.length - 1; i >= 0; i--) stack.push(children[i]);
				}
				// classify by attribute / role
				if (node.nodeType !== 1) continue;
				var tag = node.tagName;
				var role = node.getAttribute && node.getAttribute('role');
				var ariaExpanded = node.getAttribute && node.getAttribute('aria-expanded');
				var hasPopup = node.getAttribute && node.getAttribute('aria-haspopup');
				if (tag === 'SUMMARY' && node.parentElement && node.parentElement.tagName === 'DETAILS' && !node.parentElement.open) {
					consider(node, 'summary');
					continue;
				}
				if (role === 'tab' && node.getAttribute('aria-selected') === 'false') {
					consider(node, 'tab');
					continue;
				}
				if (hasPopup === 'dialog' || (node.dataset && (node.dataset.toggle === 'modal' || 'dialog' in node.dataset))) {
					consider(node, 'dialog-opener');
					continue;
				}
				if (hasPopup === 'menu' || (hasPopup === 'true' && ariaExpanded === 'false')) {
					consider(node, 'menu-opener');
					continue;
				}
				if (ariaExpanded === 'false') {
					consider(node, 'disclosure');
					continue;
				}
				if (tag === 'A') {
					var href = node.getAttribute('href') || '';
					if (href.startsWith('#') && href.length > 1) {
						consider(node, 'in-page-link');
						continue;
					}
				}
			}
		}
		walk(document.body || document.documentElement);

		// Buttons as a fallback only if we haven't filled half the budget yet.
		if (out.length < Math.ceil(MAX / 2)) {
			var btns = document.querySelectorAll('button:not([type="submit"]):not([type="reset"])');
			for (var b = 0; b < btns.length && out.length < MAX; b++) consider(btns[b], 'button');
		}

		return { items: out.slice(0, MAX), skipped: skipped };
	})()`;
	const raw = await evalInPage<{
		items: RawCandidate[];
		skipped: { shadow: number; iframe: number; disabled: number; navigation: number };
	}>(expr, { signal: options.signal, timeoutMs: options.timeoutMs });
	return {
		candidates: raw.items.map((c, i) => ({ id: i, ...c })),
		skippedShadow: raw.skipped.shadow,
		skippedIframe: raw.skipped.iframe,
		skippedDisabled: raw.skipped.disabled,
		skippedNavigation: raw.skipped.navigation
	};
}

export async function clearCandidateTags(options: EvalOptions = {}): Promise<void> {
	try {
		await evalInPage(
			`(function(){ document.querySelectorAll('[data-aud-id]').forEach(function(n){ n.removeAttribute('data-aud-id'); }); return true; })()`,
			options
		);
	} catch {
		// best-effort cleanup
	}
}
