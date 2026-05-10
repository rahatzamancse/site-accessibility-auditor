import type { AuditIssue, AuditResult } from '../types.ts';

export type CandidateKind =
	| 'disclosure'
	| 'tab'
	| 'dialog-opener'
	| 'menu-opener'
	| 'summary'
	| 'in-page-link'
	| 'button';

/**
 * Outcome of a single candidate attempt. Surfaced in the panel so the user
 * can see WHY coverage is what it is instead of trusting silent best-effort
 * skips.
 */
export type ExploreOutcome =
	| 'new-state'
	| 'duplicate'
	| 'navigated'
	| 'navigated-cross-origin'
	| 'selector-stale'
	| 'click-failed'
	| 'timeout'
	| 'rolled-back'
	| 'error';

export interface InteractionCandidate {
	id: number;
	kind: CandidateKind;
	selector: string;
	label: string;
	/**
	 * Stable identity across re-collections used by the BFS to replay paths
	 * to non-base frontier states: `kind|label#nth-of-key`.
	 */
	key: string;
	rect: { x: number; y: number; width: number; height: number };
	/** Best-effort hint that activating this candidate will navigate. */
	likelyNavigates?: boolean;
}

export interface InteractionState {
	id: string;
	depth: number;
	parentId: string | null;
	/** Sequence of candidate keys (kind|label#nth) from base to reach this state. */
	pathKeys: string[];
	triggerCandidateId: number | null;
	triggerLabel: string;
	signature: string;
	screenshot: string | null;
	result: AuditResult;
	issuesByCategory: Record<string, number>;
	discoveredAt: string;
	outcome?: ExploreOutcome;
}

export interface StateTransition {
	from: string;
	to: string;
	candidateId: number;
	label: string;
	outcome: ExploreOutcome;
	note?: string;
}

export interface CandidateAttempt {
	candidateId: number;
	kind: CandidateKind;
	label: string;
	outcome: ExploreOutcome;
	note?: string;
}

export interface StateGraph {
	states: InteractionState[];
	transitions: StateTransition[];
	rootId: string;
	budget: {
		max: number;
		used: number;
	};
	timestamp: string;
	origin: string;
	url: string;
	attempts: CandidateAttempt[];
	skipped: {
		kind: CandidateKind | 'navigation' | 'iframe' | 'shadow';
		count: number;
		reason: string;
	}[];
}

export interface CategoryDebt {
	category: string;
	base: number;
	discovered: number;
	debt: number;
}

export interface StateDebtMetric {
	total: number;
	statesExplored: number;
	averagePerState: number;
	byCategory: CategoryDebt[];
	worstStates: { stateId: string; label: string; newIssues: number; severityWeighted: number }[];
}

export interface ExplorerProgress {
	phase: 'idle' | 'collecting' | 'base' | 'exploring' | 'recovering' | 'done' | 'error';
	message: string;
	statesFound: number;
	candidatesProcessed: number;
	candidatesTotal: number;
}

export type { AuditIssue };
