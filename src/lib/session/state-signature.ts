import { evalInPage, type EvalOptions } from '../shared/devtools-eval.ts';

function djb2(str: string): string {
	let h = 5381;
	for (let i = 0; i < str.length; i++) {
		h = ((h << 5) + h + str.charCodeAt(i)) | 0;
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}

export interface SignatureSnapshot {
	openMarkers: string;
	focusedPath: string;
	roleSummary: string;
	pathnameHash: string;
	viewport: string;
}

/**
 * Stable per-state fingerprint. Deliberately omits scroll position and
 * unconditional focus path: clicking a candidate scrolls it into view and
 * shifts document.activeElement, which would otherwise mark every click as
 * a "new" state. URL pathname + hash is included so SPA route changes that
 * preserve layout are still distinguishable.
 */
export async function computeStateSignature(options: EvalOptions = {}): Promise<string> {
	const raw = await captureSignatureSnapshot(options);
	return djb2(JSON.stringify(raw));
}

export async function captureSignatureSnapshot(
	options: EvalOptions = {}
): Promise<SignatureSnapshot> {
	const expr = `(function() {
		var openEls = Array.from(document.querySelectorAll('[aria-expanded="true"], dialog[open], [role="dialog"]:not([aria-hidden="true"]), [role="menu"]:not([hidden])'));
		var openMarkers = openEls.map(function(el) {
			var cls = (el.className || '').toString().slice(0, 40);
			var id = el.id || '';
			return el.tagName.toLowerCase() + '#' + id + '.' + cls;
		}).join('|');

		var hasOverlay = openEls.length > 0;
		var focusedPath = '';
		if (hasOverlay) {
			var f = document.activeElement;
			if (f && f !== document.body) {
				var parts = [];
				var c = f;
				while (c && c !== document.body && parts.length < 6) {
					var tag = c.tagName.toLowerCase();
					var nth = 1, sib = c;
					while ((sib = sib.previousElementSibling)) { if (sib.tagName === c.tagName) nth++; }
					parts.unshift(tag + ':nth-of-type(' + nth + ')');
					c = c.parentElement;
				}
				focusedPath = parts.join('>');
			}
		}

		var roleParts = [];
		var nodes = document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],main,[role="main"],nav,[role="navigation"],[role="tablist"],[role="tab"],[role="dialog"],form,table,button,a[href],[role="button"]');
		var limit = Math.min(nodes.length, 80);
		for (var i = 0; i < limit; i++) {
			var n = nodes[i];
			var s = window.getComputedStyle(n);
			if (s.display === 'none' || s.visibility === 'hidden') continue;
			var role = n.getAttribute('role') || n.tagName.toLowerCase();
			var name = (n.getAttribute('aria-label') || n.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 24);
			roleParts.push(role + ':' + name);
		}
		var roleSummary = roleParts.join('|');

		return {
			openMarkers: openMarkers,
			focusedPath: focusedPath,
			roleSummary: roleSummary,
			pathnameHash: location.pathname + location.hash,
			viewport: window.innerWidth + 'x' + window.innerHeight
		};
	})()`;
	return evalInPage<SignatureSnapshot>(expr, options);
}
