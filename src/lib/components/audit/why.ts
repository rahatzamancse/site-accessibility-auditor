/**
 * Per-category translators that turn AuditIssue.evidence into:
 *   - a short "why" sentence for the hover card,
 *   - a list of typed chips that the hover card / inspector render as
 *     comparison rows, contrast bars, swatches etc.
 *
 * Keeps the hover card dumb. Switching on issue.category here means the
 * hover card never reaches into evidence directly, so adding a new audit
 * check is one extra branch in this file.
 */

import type { AuditIssue, AuditCategory } from '../../types.ts';

export type Chip =
	| { kind: 'compare'; label: string; actual: string; target: string; bad?: boolean }
	| { kind: 'contrast'; label: string; ratio: number; threshold: number; fg?: string; bg?: string }
	| { kind: 'fact'; label: string; value: string }
	| { kind: 'list'; label: string; items: string[] }
	| { kind: 'rect'; label: string; width: number; height: number; tag?: string };

interface Why {
	headline: string;
	chips: Chip[];
}

function num(v: unknown, fallback = 0): number {
	return typeof v === 'number' ? v : fallback;
}

function str(v: unknown): string | null {
	return typeof v === 'string' ? v : null;
}

function arr<T>(v: unknown): T[] {
	return Array.isArray(v) ? (v as T[]) : [];
}

function targetSize(issue: AuditIssue): Why {
	const ev = issue.evidence;
	const w = num(ev.width);
	const h = num(ev.height);
	const threshold = num(ev.threshold, 24);
	const nearest = num(ev.nearestNeighborDistance, NaN);
	const exemption = str(ev.exemption);
	const spacing = ev.spacingException === true;

	const chips: Chip[] = [
		{
			kind: 'compare',
			label: 'Size',
			actual: `${w}×${h} px`,
			target: `${threshold}×${threshold} px`,
			bad: issue.status === 'fail' || issue.status === 'warning'
		}
	];
	if (Number.isFinite(nearest)) {
		chips.push({
			kind: 'fact',
			label: 'Nearest neighbour',
			value: `${Math.round(nearest)} px`
		});
	}
	if (exemption) {
		chips.push({ kind: 'fact', label: 'Exemption', value: exemption });
	}

	let headline: string;
	if (exemption) {
		headline = `Marked exempt (${exemption}); WCAG 2.5.8 exception claimed.`;
	} else if (spacing) {
		headline = `Below ${threshold} px but passes via spacing exception.`;
	} else if (issue.status === 'pass') {
		headline = `Meets the recommended ${threshold} px target.`;
	} else if (issue.status === 'warning') {
		headline = `Meets minimum ${threshold} px but falls short of the recommended size.`;
	} else {
		headline = `Target is ${w}×${h} px — below the WCAG 2.5.8 minimum of ${threshold}×${threshold} px.`;
	}
	return { headline, chips };
}

interface Obstruction {
	selector?: string | null;
	tag?: string;
	rect?: { width: number; height: number };
	coversCorners?: number;
	overlapArea?: number;
	position?: string;
}

function focusOcclusion(issue: AuditIssue): Why {
	const ev = issue.evidence;
	const verdict = str(ev.verdict) ?? 'partial';
	const worst = (ev.worstObstruction ?? null) as Obstruction | null;
	const obstructions = arr<Obstruction>(ev.obstructions);

	const chips: Chip[] = [{ kind: 'fact', label: 'Verdict', value: verdict }];
	if (worst) {
		chips.push({
			kind: 'fact',
			label: 'Occluder',
			value: worst.selector ?? worst.tag ?? 'fixed/sticky overlay'
		});
		if (worst.position) {
			chips.push({ kind: 'fact', label: 'Position', value: worst.position });
		}
		if (typeof worst.coversCorners === 'number') {
			chips.push({
				kind: 'compare',
				label: 'Corners covered',
				actual: `${worst.coversCorners} / 4`,
				target: '0 / 4',
				bad: worst.coversCorners > 0
			});
		}
	}
	if (obstructions.length > 1) {
		chips.push({
			kind: 'fact',
			label: 'Other overlays',
			value: `${obstructions.length - 1}`
		});
	}

	const headline =
		verdict === 'full'
			? 'Focus indicator is fully covered by a fixed/sticky overlay.'
			: 'Focus indicator is partially covered by an overlay (passes 2.4.11, fails 2.4.12).';
	return { headline, chips };
}

function focusVisible(issue: AuditIssue): Why {
	const ev = issue.evidence;
	const chips: Chip[] = [];

	if (issue.wcag === '2.4.7') {
		const replacement = ev.hasReplacementIndicator === true;
		chips.push({
			kind: 'fact',
			label: 'Outline',
			value: `${str(ev.outlineStyle) ?? 'none'} · ${num(ev.outlineWidth)} px`
		});
		chips.push({
			kind: 'fact',
			label: 'Replacement',
			value: replacement ? 'present' : 'missing'
		});
		return {
			headline: 'Focus indicator removed with no visible replacement (WCAG 2.4.7).',
			chips
		};
	}

	const ratio = num(ev.contrast);
	const threshold = num(ev.threshold, 3);
	const fg = str(ev.outlineColor) ?? undefined;
	const bg = str(ev.backgroundColor) ?? undefined;
	chips.push({
		kind: 'contrast',
		label: 'Ring contrast',
		ratio,
		threshold,
		fg,
		bg
	});
	return {
		headline: `Focus ring contrast ${ratio.toFixed(2)}:1 — below the ${threshold}:1 minimum (WCAG 1.4.11).`,
		chips
	};
}

function dragAlternative(issue: AuditIssue): Why {
	const ev = issue.evidence;
	const dragHints = arr<string>(ev.dragHints);
	const alternatives = arr<string>(ev.alternatives);
	const chips: Chip[] = [];
	if (dragHints.length) chips.push({ kind: 'list', label: 'Drag handlers', items: dragHints });
	if (alternatives.length) chips.push({ kind: 'list', label: 'Alternatives', items: alternatives });
	return {
		headline:
			alternatives.length === 0
				? 'Drag surface has no single-pointer alternative (WCAG 2.5.7).'
				: `Drag surface offers an alternative: ${alternatives.join(', ')}.`,
		chips
	};
}

function redundantEntry(issue: AuditIssue): Why {
	const ev = issue.evidence;
	const token = str(ev.token) ?? '';
	const scope = str(ev.scope) ?? 'in-page';
	const dupes = arr<string>(ev.duplicateFieldSelectors);
	const chips: Chip[] = [
		{ kind: 'fact', label: 'Token', value: token || '(unnamed)' },
		{ kind: 'fact', label: 'Scope', value: scope }
	];
	if (dupes.length) chips.push({ kind: 'list', label: 'Duplicate fields', items: dupes });
	return {
		headline:
			scope === 'session'
				? `Token "${token}" was already entered earlier this session and isn't pre-filled.`
				: `Field "${token}" appears in multiple forms on this page (WCAG 3.3.7).`,
		chips
	};
}

function accessibleAuth(issue: AuditIssue): Why {
	const ev = issue.evidence;
	const chips: Chip[] = [];
	if (ev.passwordBlocksPaste === true)
		chips.push({ kind: 'fact', label: 'Paste blocked', value: 'yes' });
	if (str(ev.passwordAutocomplete))
		chips.push({
			kind: 'fact',
			label: 'autocomplete (pw)',
			value: str(ev.passwordAutocomplete)!
		});
	if (str(ev.usernameAutocomplete))
		chips.push({
			kind: 'fact',
			label: 'autocomplete (user)',
			value: str(ev.usernameAutocomplete)!
		});
	if (ev.hasCaptchaImage === true)
		chips.push({
			kind: 'fact',
			label: 'CAPTCHA',
			value: ev.hasCaptchaAlternative === true ? 'has alternative' : 'no alternative'
		});
	return {
		headline:
			'Authentication flow imposes a cognitive function test without an accessible alternative (WCAG 3.3.8).',
		chips
	};
}

function consistentHelp(issue: AuditIssue): Why {
	const ev = issue.evidence;
	const diffs = arr<string>(ev.differences);
	const compared = str(ev.comparedTo) ?? 'previous page';
	const chips: Chip[] = [{ kind: 'fact', label: 'Compared to', value: compared }];
	if (diffs.length) chips.push({ kind: 'list', label: 'Differences', items: diffs });
	return {
		headline: `Help mechanisms moved between pages (${diffs.length} change${diffs.length === 1 ? '' : 's'}).`,
		chips
	};
}

const RESOLVERS: Record<AuditCategory, (i: AuditIssue) => Why> = {
	'target-size': targetSize,
	'focus-occlusion': focusOcclusion,
	'focus-visible': focusVisible,
	'non-text-contrast': focusVisible,
	'drag-alternative': dragAlternative,
	'redundant-entry': redundantEntry,
	'accessible-auth': accessibleAuth,
	'consistent-help': consistentHelp
};

export function explain(issue: AuditIssue): Why {
	const fn = RESOLVERS[issue.category] ?? (() => ({ headline: issue.suggestion, chips: [] }));
	return fn(issue);
}
