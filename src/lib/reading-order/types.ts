export type FocusableKind = 'natural' | 'programmatic' | 'none';

export interface ReadingEntryRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * Single on-page element carrying everything we need for the four
 * orderings (DOM preorder, visual reading order, accessibility-tree order,
 * keyboard tab order) plus the axillary data the inspector, overlays,
 * and differ all read from.
 */
export interface ReadingEntry {
	/** Stable key: canonical CSS path (used as selector for highlights). */
	key: string;
	/** CSS-like path; may be empty for <body> but key is always non-empty. */
	path: string;
	tag: string;

	/** Absolute DOM preorder index (every visible element walked). */
	domIndex: number;
	/** Row-major visual reading-order index among entries with a rect. */
	visualIndex: number;
	/**
	 * AX traversal index. Null for entries that are not surfaced to
	 * assistive tech (role === 'generic' with no accessible name).
	 */
	axIndex: number | null;
	/** Keyboard tab sequence index. Null for non-focusable entries. */
	tabIndex: number | null;

	/** AX facet (present iff axIndex !== null). */
	ax: {
		role: string;
		name: string;
		level: number;
		ariaProps: Record<string, string>;
	} | null;

	/** Visual facet (present iff entry is semantic/interactive/visible). */
	visual: {
		text: string;
		/** Explicit `role=` attribute if any (used for role-mismatch check). */
		explicitRole: string | null;
		isSemantic: boolean;
		isInteractive: boolean;
	} | null;

	/** Keyboard facet (present iff focusable). */
	tab: {
		tabindex: number | null;
		focusable: Exclude<FocusableKind, 'none'>;
		/** Label used by the overlay / list views. */
		label: string;
	} | null;

	rect: ReadingEntryRect;

	/**
	 * Layout / context signals used by the differ to recognise legitimate
	 * patterns (skip links, modals, sticky elements, roving-tabindex
	 * widgets, decorative icons, multi-column layouts, inert subtrees)
	 * and downgrade their drift findings to informational hints.
	 */
	layout: {
		position: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
		offscreen: boolean;
		inertAncestor: boolean;
		ariaHiddenSelf: boolean;
		dialogContext: 'modal' | 'open' | null;
		rovingGroupRole: string | null;
		multiColumnAncestor: boolean;
		skipLinkCandidate: boolean;
		decorativeCandidate: boolean;
	};

	/** Convenience flattened attributes used by labels and badges. */
	attributes: Record<string, string | null>;
}

export interface ViewportInfo {
	width: number;
	height: number;
	scrollX: number;
	scrollY: number;
	documentWidth: number;
	documentHeight: number;
}

export interface ReadingOrderSummary {
	totalEntries: number;
	axCount: number;
	tabCount: number;
	naturalTabs: number;
	programmaticTabs: number;
	hasPositiveTabindex: boolean;
	hasActiveModal: boolean;
}

export interface ReadingOrderResult {
	entries: ReadingEntry[];
	viewport: ViewportInfo;
	summary: ReadingOrderSummary;
	timestamp: string;
}

/**
 * Typed disagreements between orderings.
 *
 * The first block is the "bug" tier — genuine accessibility findings.
 * The second block is the "info" tier — recognised intentional patterns
 * that would otherwise show up as drift but are actually correct.
 */
export type DiffKind =
	| 'match'
	| 'missing-in-ax'
	| 'extra-in-ax'
	| 'role-mismatch'
	| 'name-missing'
	| 'order-drift'
	| 'tab-break'
	| 'tab-unreachable'
	| 'positive-tabindex'
	// Info tier — pattern recognised, no fix needed.
	| 'skip-link'
	| 'sticky-pinned'
	| 'roving-group'
	| 'modal-context'
	| 'inert-subtree'
	| 'decorative-hidden';

/** Set of info-tier kinds. Used by UI to render them with neutral styling. */
export const INFO_KINDS = new Set<DiffKind>([
	'skip-link',
	'sticky-pinned',
	'roving-group',
	'modal-context',
	'inert-subtree',
	'decorative-hidden'
]);

export interface DiffPair {
	kind: DiffKind;
	entry: ReadingEntry;
	/** For pairs produced from a single entry these are filled from that entry. */
	axIndex: number | null;
	visualIndex: number | null;
	tabIndex: number | null;
	domIndex: number;
}

export interface ReadingOrderDiff {
	pairs: DiffPair[];
	pairsByKey: Map<string, DiffPair>;
	summary: Record<DiffKind, number>;
	mismatches: {
		domVsVisual: number;
		domVsTab: number;
		visualVsTab: number;
		axVsVisual: number;
	};
}

export interface TreeNode {
	key: string;
	pair: DiffPair;
	depth: number;
	children: TreeNode[];
	/** Signed position delta of this sibling under visual order (null when none). */
	readingOrderDelta: number | null;
	/** Entry exists only visually (not in AX) but was placed inside the tree. */
	isGhost: boolean;
}

export interface TreeBuildResult {
	forest: TreeNode[];
	nodesByKey: Map<string, TreeNode>;
}

/** Overlay mode shown on the live page. */
export type OverlayMode = 'none' | 'tab' | 'ax' | 'visual';
