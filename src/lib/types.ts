export interface ElementRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type WcagSC =
	| '1.4.11'
	| '2.4.7'
	| '2.4.11'
	| '2.4.12'
	| '2.5.7'
	| '2.5.8'
	| '3.2.6'
	| '3.3.7'
	| '3.3.8';

export const ALL_CRITERIA: WcagSC[] = [
	'2.5.8',
	'2.4.11',
	'2.4.12',
	'2.4.7',
	'2.5.7',
	'3.3.7',
	'3.3.8',
	'3.2.6',
	'1.4.11'
];

export type AuditCategory =
	| 'target-size'
	| 'focus-occlusion'
	| 'focus-visible'
	| 'drag-alternative'
	| 'redundant-entry'
	| 'accessible-auth'
	| 'consistent-help'
	| 'non-text-contrast';

export type AuditStatus = 'pass' | 'warning' | 'fail' | 'exempt';

export const CRITERION_META: Record<
	WcagSC,
	{ title: string; category: AuditCategory; shortLabel: string }
> = {
	'2.5.8': { title: 'Target Size (Minimum)', category: 'target-size', shortLabel: 'Targets' },
	'2.4.11': {
		title: 'Focus Not Obscured (Minimum)',
		category: 'focus-occlusion',
		shortLabel: 'Focus'
	},
	'2.4.12': {
		title: 'Focus Not Obscured (Enhanced)',
		category: 'focus-occlusion',
		shortLabel: 'Focus'
	},
	'2.4.7': { title: 'Focus Visible', category: 'focus-visible', shortLabel: 'Focus' },
	'2.5.7': { title: 'Dragging Movements', category: 'drag-alternative', shortLabel: 'Drag' },
	'3.3.7': { title: 'Redundant Entry', category: 'redundant-entry', shortLabel: 'Forms' },
	'3.3.8': {
		title: 'Accessible Authentication (Minimum)',
		category: 'accessible-auth',
		shortLabel: 'Forms'
	},
	'3.2.6': { title: 'Consistent Help', category: 'consistent-help', shortLabel: 'Help' },
	'1.4.11': {
		title: 'Non-text Contrast (Focus)',
		category: 'non-text-contrast',
		shortLabel: 'Focus'
	}
};

export interface AuditIssue {
	id: number;
	wcag: WcagSC;
	category: AuditCategory;
	status: AuditStatus;
	tag: string;
	text: string;
	/** Element rect in page coordinates (scrollX/Y already added). */
	rect: ElementRect | null;
	selector?: string | null;
	domPath?: string | null;
	attributes: Record<string, string | null>;
	evidence: Record<string, unknown>;
	suggestion: string;
	/** Cropped element thumbnail as a JPEG data URL (max ~96 px on the long side). */
	thumb?: string | null;
}

export interface AuditSummary {
	total: number;
	pass: number;
	warning: number;
	fail: number;
	exempt: number;
}

export interface PageBounds {
	width: number;
	height: number;
}

export interface AuditResult {
	issues: AuditIssue[];
	summary: AuditSummary;
	perCriterion: Partial<Record<WcagSC, AuditSummary>>;
	timestamp: string;
	origin: string;
	url: string;
	/** Full document scroll bounds at scan time. Drives the minimap viewBox. */
	pageBounds: PageBounds;
}

export function emptySummary(): AuditSummary {
	return { total: 0, pass: 0, warning: 0, fail: 0, exempt: 0 };
}

export function summarize(issues: AuditIssue[]): AuditSummary {
	const s = emptySummary();
	for (const i of issues) {
		s.total++;
		s[i.status]++;
	}
	return s;
}
