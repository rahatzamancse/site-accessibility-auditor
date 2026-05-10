import type { DiffKind, DiffPair, ReadingEntry, ReadingOrderDiff } from './types.ts';

function canonicalRole(tag: string, explicitRole: string | null): string {
	if (explicitRole) return explicitRole;
	const map: Record<string, string> = {
		h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
		nav: 'navigation', main: 'main', aside: 'complementary', section: 'region',
		header: 'banner', footer: 'contentinfo', article: 'article', img: 'img',
		figure: 'figure', table: 'table', button: 'button', a: 'link', input: 'textbox',
		select: 'combobox', textarea: 'textbox', summary: 'button'
	};
	return map[tag] ?? tag;
}

function classifyKind(entry: ReadingEntry): DiffKind {
	// Positive tabindex is reported as an authoring smell separately from
	// drift, even when it happens to coincide with visual order.
	if (entry.tab?.tabindex !== null && (entry.tab?.tabindex ?? 0) > 0) {
		return 'positive-tabindex';
	}
	// Visually present & interactive but not keyboard reachable.
	if (entry.visual?.isInteractive && entry.tabIndex === null) {
		return 'tab-unreachable';
	}
	// Entry exists visually/interactive but AX skipped it.
	if (entry.axIndex === null && entry.visual && (entry.visual.isInteractive || entry.visual.isSemantic)) {
		return 'missing-in-ax';
	}
	// Extra-in-ax: AX surfaces something with no interactive/semantic
	// visual footprint (rare with our current walker; used for generic
	// aria-only nodes).
	if (entry.axIndex !== null && entry.visual === null) {
		return 'extra-in-ax';
	}
	if (entry.axIndex !== null && entry.ax) {
		const canonical = canonicalRole(entry.tag, entry.visual?.explicitRole ?? null);
		if (entry.visual && canonical !== entry.ax.role) return 'role-mismatch';
		if (entry.ax.name.length === 0) return 'name-missing';
	}
	return 'match';
}

/**
 * Reclassify a bug-tier kind into an info-tier kind when layout signals
 * show the finding is actually intentional. Precedence (highest first):
 * inert-subtree > modal-context > skip-link > sticky-pinned >
 * roving-group > decorative-hidden. Anything not matched is returned
 * unchanged.
 */
function reclassify(entry: ReadingEntry, kind: DiffKind, hasActiveModal: boolean): DiffKind {
	const L = entry.layout;
	if (L.inertAncestor) return 'inert-subtree';
	if (hasActiveModal && L.dialogContext !== 'modal') return 'modal-context';
	if (L.skipLinkCandidate && (kind === 'tab-break' || kind === 'order-drift' || kind === 'match')) {
		return 'skip-link';
	}
	if ((L.position === 'sticky' || L.position === 'fixed') &&
		(kind === 'order-drift' || kind === 'tab-break')) {
		return 'sticky-pinned';
	}
	if (L.rovingGroupRole && kind === 'tab-unreachable') {
		return 'roving-group';
	}
	if (L.decorativeCandidate && kind === 'missing-in-ax') {
		return 'decorative-hidden';
	}
	return kind;
}

/**
 * An entry is excluded from rank/mismatch math when it is inert, or
 * outside an active modal. Those entries still appear in the diff with
 * their info-tier kind, but their rank disagreements are not counted as
 * "drift" because the page deliberately silences them.
 */
function isExcluded(entry: ReadingEntry, hasActiveModal: boolean): boolean {
	if (entry.layout.inertAncestor) return true;
	if (hasActiveModal && entry.layout.dialogContext !== 'modal') return true;
	return false;
}

function countMismatches(a: Map<string, number>, b: Map<string, number>): number {
	let c = 0;
	a.forEach((ai, key) => {
		const bi = b.get(key);
		if (bi !== undefined && bi !== ai) c++;
	});
	return c;
}

export function diffReadingOrder(entries: ReadingEntry[]): ReadingOrderDiff {
	const pairs: DiffPair[] = [];
	const pairsByKey = new Map<string, DiffPair>();

	const hasActiveModal = entries.some((e) => e.layout?.dialogContext === 'modal');
	const inScope = (e: ReadingEntry) => !isExcluded(e, hasActiveModal);

	// Tab break detection: reorder tabbables (in-scope only) by visual
	// index; any position where the rank disagrees with its tabIndex is a
	// break. Skip links are exempted in reclassify; sticky/fixed are
	// downgraded to sticky-pinned there too.
	const tabEntries = entries.filter((e) => e.tabIndex !== null && inScope(e));
	const visualRank = tabEntries
		.slice()
		.sort((a, b) => a.visualIndex - b.visualIndex)
		.reduce((acc, e, i) => acc.set(e.key, i), new Map<string, number>());
	const tabbableScopeRank = tabEntries
		.slice()
		.sort((a, b) => (a.tabIndex ?? 0) - (b.tabIndex ?? 0))
		.reduce((acc, e, i) => acc.set(e.key, i), new Map<string, number>());
	const tabBreaks = new Set<string>();
	for (const e of tabEntries) {
		const vr = visualRank.get(e.key);
		const tr = tabbableScopeRank.get(e.key);
		if (vr !== undefined && tr !== undefined && vr !== tr) tabBreaks.add(e.key);
	}

	// Order drift: visual-vs-AX drift on AX-visible entries (in-scope).
	const axByKey = entries.filter((e) => e.axIndex !== null && inScope(e));
	const visualOfAx = axByKey
		.slice()
		.sort((a, b) => a.visualIndex - b.visualIndex)
		.reduce((acc, e, i) => acc.set(e.key, i), new Map<string, number>());
	const axRankInScope = axByKey
		.slice()
		.sort((a, b) => (a.axIndex ?? 0) - (b.axIndex ?? 0))
		.reduce((acc, e, i) => acc.set(e.key, i), new Map<string, number>());
	const orderDrift = new Set<string>();
	for (const e of axByKey) {
		const expected = visualOfAx.get(e.key);
		const got = axRankInScope.get(e.key);
		if (expected !== undefined && got !== undefined && expected !== got) orderDrift.add(e.key);
	}

	for (const entry of entries) {
		let kind = classifyKind(entry);
		// Overlay keyboard / drift findings on top of the identity check.
		if (kind === 'match' || kind === 'name-missing') {
			if (tabBreaks.has(entry.key)) kind = 'tab-break';
			else if (orderDrift.has(entry.key)) kind = 'order-drift';
		}
		// Layout-aware downgrade.
		kind = reclassify(entry, kind, hasActiveModal);
		const pair: DiffPair = {
			kind,
			entry,
			axIndex: entry.axIndex,
			visualIndex: entry.visualIndex,
			tabIndex: entry.tabIndex,
			domIndex: entry.domIndex
		};
		pairs.push(pair);
		pairsByKey.set(entry.key, pair);
	}

	const summary: Record<DiffKind, number> = {
		match: 0,
		'missing-in-ax': 0,
		'extra-in-ax': 0,
		'role-mismatch': 0,
		'name-missing': 0,
		'order-drift': 0,
		'tab-break': 0,
		'tab-unreachable': 0,
		'positive-tabindex': 0,
		'skip-link': 0,
		'sticky-pinned': 0,
		'roving-group': 0,
		'modal-context': 0,
		'inert-subtree': 0,
		'decorative-hidden': 0
	};
	for (const p of pairs) summary[p.kind]++;

	// Pairwise mismatch counters operate on in-scope entries only so that
	// inert subtrees and modal-suppressed regions do not inflate drift.
	const scoped = entries.filter(inScope);

	const domVsVisualRanked = (() => {
		const dRank = new Map<string, number>();
		const vRank = new Map<string, number>();
		scoped.slice().sort((a, b) => a.domIndex - b.domIndex).forEach((e, i) => dRank.set(e.key, i));
		scoped.slice().sort((a, b) => a.visualIndex - b.visualIndex).forEach((e, i) => vRank.set(e.key, i));
		return countMismatches(dRank, vRank);
	})();

	const axVsVisualRanked = (() => {
		const axOnly = scoped.filter((e) => e.axIndex !== null);
		const aRank = new Map<string, number>();
		const vRank = new Map<string, number>();
		axOnly.slice().sort((a, b) => (a.axIndex ?? 0) - (b.axIndex ?? 0)).forEach((e, i) => aRank.set(e.key, i));
		axOnly.slice().sort((a, b) => a.visualIndex - b.visualIndex).forEach((e, i) => vRank.set(e.key, i));
		return countMismatches(aRank, vRank);
	})();

	const tabVsDomRanked = (() => {
		const tabOnly = scoped.filter((e) => e.tabIndex !== null);
		const tRank = new Map<string, number>();
		const dRank = new Map<string, number>();
		tabOnly.slice().sort((a, b) => (a.tabIndex ?? 0) - (b.tabIndex ?? 0)).forEach((e, i) => tRank.set(e.key, i));
		tabOnly.slice().sort((a, b) => a.domIndex - b.domIndex).forEach((e, i) => dRank.set(e.key, i));
		return countMismatches(tRank, dRank);
	})();

	const tabVsVisualRanked = (() => {
		const tabOnly = scoped.filter((e) => e.tabIndex !== null);
		const tRank = new Map<string, number>();
		const vRank = new Map<string, number>();
		tabOnly.slice().sort((a, b) => (a.tabIndex ?? 0) - (b.tabIndex ?? 0)).forEach((e, i) => tRank.set(e.key, i));
		tabOnly.slice().sort((a, b) => a.visualIndex - b.visualIndex).forEach((e, i) => vRank.set(e.key, i));
		return countMismatches(tRank, vRank);
	})();

	return {
		pairs,
		pairsByKey,
		summary,
		mismatches: {
			domVsVisual: domVsVisualRanked,
			domVsTab: tabVsDomRanked,
			visualVsTab: tabVsVisualRanked,
			axVsVisual: axVsVisualRanked
		}
	};
}
