import {
	evalInPage,
	captureTab,
	getPageInfo,
	navigateInspectedTab,
	waitForReady,
	EvalTimeoutError,
	EvalAbortedError
} from '../shared/devtools-eval.ts';
import { runAudit } from '../auditor.ts';
import type { AuditResult } from '../types.ts';
import {
	collectCandidates,
	clearCandidateTags,
	type CollectResult
} from './candidate-collector.ts';
import { computeStateSignature } from './state-signature.ts';
import type {
	CandidateAttempt,
	CandidateKind,
	ExploreOutcome,
	ExplorerProgress,
	InteractionCandidate,
	InteractionState,
	StateGraph,
	StateTransition
} from './types.ts';

const STEP_EVAL_TIMEOUT_MS = 4_000;
const ADAPTIVE_WAIT_MAX_MS = 2_000;
const ADAPTIVE_WAIT_QUIET_MS = 250;
const REPLAY_WAIT_MAX_MS = 3_000;

interface PreClickSnapshot {
	url: string;
	origin: string;
	pathnameHash: string;
	selectedTabSelector: string | null;
	openModalsBefore: string[];
}

interface ClickResult {
	clicked: boolean;
	reason?: string;
}

interface FrontierEntry {
	stateId: string;
	pathKeys: string[];
	depth: number;
}

function isStop(err: unknown): boolean {
	return err instanceof EvalAbortedError;
}

async function installGuards(signal?: AbortSignal): Promise<void> {
	const expr = `(function(){
		var W = window;
		if (W.__sa_guards_installed__) return true;
		W.__sa_guards_installed__ = true;
		W.__sa_guards_orig__ = {
			confirm: W.confirm,
			alert: W.alert,
			prompt: W.prompt,
			open: W.open
		};
		W.confirm = function(){ return false; };
		W.alert = function(){};
		W.prompt = function(){ return null; };
		W.open = function(){ return null; };
		W.__sa_beforeunload__ = function(e){ e.stopImmediatePropagation(); delete e.returnValue; };
		W.addEventListener('beforeunload', W.__sa_beforeunload__, true);

		var st = { lastMutation: Date.now() };
		W.__sa_mut_state__ = st;
		var obs = new MutationObserver(function(){ st.lastMutation = Date.now(); });
		try { obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: false }); } catch (e) {}
		W.__sa_mut_obs__ = obs;
		return true;
	})()`;
	await evalInPage<boolean>(expr, { signal });
}

async function uninstallGuards(signal?: AbortSignal): Promise<void> {
	const expr = `(function(){
		var W = window;
		if (!W.__sa_guards_installed__) return true;
		try {
			if (W.__sa_guards_orig__) {
				W.confirm = W.__sa_guards_orig__.confirm;
				W.alert = W.__sa_guards_orig__.alert;
				W.prompt = W.__sa_guards_orig__.prompt;
				W.open = W.__sa_guards_orig__.open;
			}
			if (W.__sa_beforeunload__) W.removeEventListener('beforeunload', W.__sa_beforeunload__, true);
			if (W.__sa_mut_obs__) W.__sa_mut_obs__.disconnect();
		} catch (e) {}
		delete W.__sa_guards_installed__;
		delete W.__sa_guards_orig__;
		delete W.__sa_beforeunload__;
		delete W.__sa_mut_state__;
		delete W.__sa_mut_obs__;
		return true;
	})()`;
	try {
		await evalInPage<boolean>(expr, { signal });
	} catch {
		// best-effort cleanup
	}
}

async function adaptiveWait(maxMs: number, signal?: AbortSignal): Promise<void> {
	const start = Date.now();
	const peek = `(function(){
		var st = window.__sa_mut_state__;
		var since = st ? (Date.now() - st.lastMutation) : ${ADAPTIVE_WAIT_QUIET_MS + 1};
		var busy = !!document.querySelector('[aria-busy="true"]');
		return { since: since, busy: busy };
	})()`;
	while (Date.now() - start < maxMs) {
		if (signal?.aborted) return;
		try {
			const res = await evalInPage<{ since: number; busy: boolean }>(peek, {
				signal,
				timeoutMs: STEP_EVAL_TIMEOUT_MS
			});
			if (res.since >= ADAPTIVE_WAIT_QUIET_MS && !res.busy) return;
		} catch {
			return;
		}
		await new Promise((r) => setTimeout(r, 100));
	}
}

async function preClickSnapshot(signal?: AbortSignal): Promise<PreClickSnapshot> {
	const expr = `(function(){
		var sel = null;
		var t = document.querySelector('[role="tab"][aria-selected="true"]');
		if (t) {
			var id = t.getAttribute('id');
			if (id && /^[a-zA-Z][\\w-]*$/.test(id)) sel = '#' + id;
			else {
				var aud = t.getAttribute('data-aud-id');
				sel = aud != null ? '[data-aud-id="' + aud + '"]' : null;
			}
		}
		var openModals = Array.from(document.querySelectorAll('dialog[open], [role="dialog"]:not([aria-hidden="true"])')).map(function(d){
			return d.id ? '#' + d.id : (d.tagName.toLowerCase() + (d.className ? '.' + (''+d.className).split(/\\s+/).join('.') : ''));
		});
		return {
			url: location.href,
			origin: location.origin,
			pathnameHash: location.pathname + location.hash,
			selectedTabSelector: sel,
			openModalsBefore: openModals
		};
	})()`;
	return evalInPage<PreClickSnapshot>(expr, { signal, timeoutMs: STEP_EVAL_TIMEOUT_MS });
}

async function clickByAudId(audId: number, signal?: AbortSignal): Promise<ClickResult> {
	const expr = `(function(){
		try {
			var el = document.querySelector('[data-aud-id="${audId}"]');
			if (!el) return { clicked: false, reason: 'selector-stale' };
			var r = el.getBoundingClientRect();
			if (r.width <= 0 || r.height <= 0) return { clicked: false, reason: 'invisible' };
			var s = window.getComputedStyle(el);
			if (s.display === 'none' || s.visibility === 'hidden') return { clicked: false, reason: 'invisible' };
			el.scrollIntoView({ block: 'center', inline: 'center' });
			el.click();
			return { clicked: true };
		} catch (e) { return { clicked: false, reason: 'error' }; }
	})()`;
	return evalInPage<ClickResult>(expr, { signal, timeoutMs: STEP_EVAL_TIMEOUT_MS });
}

async function recoverToBase(baseUrl: string, signal?: AbortSignal): Promise<void> {
	try {
		await evalInPage(
			`(function(){ try { location.replace(${JSON.stringify(baseUrl)}); } catch (e) {} return true; })()`,
			{ signal, timeoutMs: STEP_EVAL_TIMEOUT_MS }
		);
	} catch {
		await navigateInspectedTab(baseUrl);
	}
	await waitForReady(REPLAY_WAIT_MAX_MS, { signal });
}

function issuesByCategory(result: AuditResult): Record<string, number> {
	const out: Record<string, number> = {};
	for (const issue of result.issues) {
		out[issue.category] = (out[issue.category] ?? 0) + 1;
	}
	return out;
}

function pushSkipped(skipped: StateGraph['skipped'], collected: CollectResult): void {
	const merge = (kind: StateGraph['skipped'][number]['kind'], count: number, reason: string) => {
		if (count <= 0) return;
		const existing = skipped.find((s) => s.kind === kind && s.reason === reason);
		if (existing) existing.count += count;
		else skipped.push({ kind, count, reason });
	};
	merge('shadow', collected.skippedShadow, 'pierced shadow root');
	merge('iframe', collected.skippedIframe, 'iframe content not reachable from devtools eval');
	merge('button', collected.skippedDisabled, 'disabled or aria-disabled');
	merge(
		'navigation',
		collected.skippedNavigation,
		'looks like navigation; turn safe mode off to attempt'
	);
}

export interface ExploreOptions {
	budget?: number;
	maxDepth?: number;
	branchPerState?: number;
	onProgress?: (p: ExplorerProgress) => void;
	signal?: AbortSignal;
	safeMode?: boolean;
}

export async function exploreStates(options: ExploreOptions = {}): Promise<StateGraph> {
	const budget = options.budget ?? 8;
	const maxDepth = Math.max(1, options.maxDepth ?? 2);
	const branchPerState = Math.max(1, options.branchPerState ?? Math.ceil(budget / 2));
	const signal = options.signal;
	const safeMode = options.safeMode === true;
	const report = (p: ExplorerProgress) => options.onProgress?.(p);

	report({
		phase: 'collecting',
		message: 'Installing guards and collecting base candidates…',
		statesFound: 0,
		candidatesProcessed: 0,
		candidatesTotal: 0
	});

	await installGuards(signal);

	const baseInfo = await getPageInfo({ signal });
	const baseUrl = baseInfo.url;
	const baseOrigin = baseInfo.origin;

	report({
		phase: 'base',
		message: 'Auditing base state…',
		statesFound: 0,
		candidatesProcessed: 0,
		candidatesTotal: 0
	});

	const baseResult = await runAudit();
	const baseSignature = await computeStateSignature({ signal });
	const baseShot = await captureTab();

	const baseState: InteractionState = {
		id: 'state-0',
		depth: 0,
		parentId: null,
		pathKeys: [],
		triggerCandidateId: null,
		triggerLabel: 'base',
		signature: baseSignature,
		screenshot: baseShot,
		result: baseResult,
		issuesByCategory: issuesByCategory(baseResult),
		discoveredAt: new Date().toISOString()
	};

	const states: InteractionState[] = [baseState];
	const transitions: StateTransition[] = [];
	const seenSignatures = new Map<string, string>([[baseSignature, baseState.id]]);
	const attempts: CandidateAttempt[] = [];
	const skippedSummary: StateGraph['skipped'] = [];
	const triedAtState = new Map<string, Set<string>>();
	triedAtState.set(baseState.id, new Set<string>());

	const frontier: FrontierEntry[] = [{ stateId: baseState.id, pathKeys: [], depth: 0 }];
	let processed = 0;
	let lastReachedStateId: string | null = baseState.id; // base is the current page

	try {
		while (frontier.length > 0 && processed < budget) {
			if (signal?.aborted) break;
			const entry = frontier.shift()!;
			if (entry.depth >= maxDepth) continue;

			report({
				phase: 'recovering',
				message:
					entry.stateId === baseState.id
						? 'Exploring from base…'
						: `Replaying ${entry.pathKeys.length}-step path to ${entry.stateId}…`,
				statesFound: states.length,
				candidatesProcessed: processed,
				candidatesTotal: budget
			});

			const reach = await reachState(
				entry,
				baseState.id,
				baseUrl,
				baseOrigin,
				lastReachedStateId,
				signal
			);
			if (!reach.ok) {
				attempts.push({
					candidateId: -1,
					kind: 'button',
					label: `replay path to ${entry.stateId}`,
					outcome: 'error',
					note: reach.note
				});
				lastReachedStateId = baseState.id; // we are back at base after failed replay
				continue;
			}
			lastReachedStateId = entry.stateId;

			let collected: CollectResult;
			try {
				collected = await collectCandidates({
					max: Math.max(branchPerState * 2, 12),
					safeMode,
					signal
				});
			} catch (err) {
				if (isStop(err)) break;
				continue;
			}
			pushSkipped(skippedSummary, collected);

			const triedHere = triedAtState.get(entry.stateId) ?? new Set<string>();
			triedAtState.set(entry.stateId, triedHere);

			let exploredAtThisState = 0;
			for (const candidate of collected.candidates) {
				if (signal?.aborted) break;
				if (processed >= budget) break;
				if (exploredAtThisState >= branchPerState) break;
				if (triedHere.has(candidate.key)) continue;
				triedHere.add(candidate.key);
				processed++;
				exploredAtThisState++;

				report({
					phase: 'exploring',
					message: `[d${entry.depth + 1}] Trying "${candidate.label.slice(0, 36)}"…`,
					statesFound: states.length,
					candidatesProcessed: processed,
					candidatesTotal: budget
				});

				const stepRes = await stepCandidate({
					candidate,
					parentEntry: entry,
					baseId: baseState.id,
					baseUrl,
					baseOrigin,
					baseSignature,
					states,
					transitions,
					seenSignatures,
					triedAtState,
					maxDepth,
					frontier,
					signal
				});
				attempts.push({
					candidateId: candidate.id,
					kind: candidate.kind,
					label: candidate.label,
					outcome: stepRes.outcome,
					note: stepRes.note
				});

				if (stepRes.recovered) {
					// Page was hard-recovered to base; we lost the parent context.
					lastReachedStateId = baseState.id;
					break;
				}
				// After every step, parent state's modal/disclosure may be in a slightly different state.
				// Rollback was already attempted inside stepCandidate, so we keep exploring here.
			}
		}
	} catch (err) {
		if (!isStop(err)) throw err;
	} finally {
		await clearCandidateTags({ signal });
		await uninstallGuards(signal);
	}

	report({
		phase: 'done',
		message: `Explored ${processed} candidate(s) across ${states.length - 1} discovered state(s) (max depth ${maxDepth}).`,
		statesFound: states.length,
		candidatesProcessed: processed,
		candidatesTotal: budget
	});

	return {
		states,
		transitions,
		rootId: baseState.id,
		budget: { max: budget, used: processed },
		timestamp: new Date().toISOString(),
		origin: baseOrigin,
		url: baseUrl,
		attempts,
		skipped: skippedSummary
	};
}

interface ReachResult {
	ok: boolean;
	note?: string;
}

/**
 * Walk the page from base to the target frontier entry by hard-reloading the
 * base URL and replaying each candidate key in order. Re-collects candidates
 * fresh at each hop and matches by stable `key` (kind|label#nth-of-key) so
 * data-aud-id reshuffles don't matter.
 */
async function reachState(
	entry: FrontierEntry,
	baseId: string,
	baseUrl: string,
	baseOrigin: string,
	currentReachedId: string | null,
	signal?: AbortSignal
): Promise<ReachResult> {
	if (entry.stateId === baseId) {
		// Only reload if we drifted away from base.
		if (currentReachedId !== baseId) {
			await recoverToBase(baseUrl, signal);
			await installGuards(signal);
		}
		return { ok: true };
	}

	await recoverToBase(baseUrl, signal);
	await installGuards(signal);

	for (let i = 0; i < entry.pathKeys.length; i++) {
		if (signal?.aborted) return { ok: false, note: 'aborted' };
		const stepKey = entry.pathKeys[i];
		let collected: CollectResult;
		try {
			collected = await collectCandidates({ max: 24, signal });
		} catch (err) {
			if (isStop(err)) return { ok: false, note: 'aborted' };
			return { ok: false, note: `collect failed at hop ${i}` };
		}
		const target = collected.candidates.find((c) => c.key === stepKey);
		if (!target) return { ok: false, note: `unreachable: ${stepKey} not found at hop ${i}` };
		try {
			const click = await clickByAudId(target.id, signal);
			if (!click.clicked) return { ok: false, note: `click failed at hop ${i}: ${click.reason}` };
		} catch (err) {
			if (isStop(err)) return { ok: false, note: 'aborted' };
			if (err instanceof EvalTimeoutError)
				return { ok: false, note: 'click timeout during replay' };
			return { ok: false, note: 'click error during replay' };
		}
		await adaptiveWait(ADAPTIVE_WAIT_MAX_MS, signal);
		try {
			const after = await getPageInfo({ signal, timeoutMs: STEP_EVAL_TIMEOUT_MS });
			if (after.origin !== baseOrigin) {
				await navigateInspectedTab(baseUrl);
				await waitForReady(REPLAY_WAIT_MAX_MS, { signal });
				await installGuards(signal);
				return { ok: false, note: `cross-origin nav during replay at hop ${i}` };
			}
		} catch {
			return { ok: false, note: `page info failed at hop ${i}` };
		}
	}
	return { ok: true };
}

interface StepArgs {
	candidate: InteractionCandidate;
	parentEntry: FrontierEntry;
	baseId: string;
	baseUrl: string;
	baseOrigin: string;
	baseSignature: string;
	states: InteractionState[];
	transitions: StateTransition[];
	seenSignatures: Map<string, string>;
	triedAtState: Map<string, Set<string>>;
	maxDepth: number;
	frontier: FrontierEntry[];
	signal?: AbortSignal;
}

interface StepResult {
	outcome: ExploreOutcome;
	note?: string;
	recovered: boolean;
}

async function stepCandidate(args: StepArgs): Promise<StepResult> {
	const {
		candidate,
		parentEntry,
		baseId,
		baseUrl,
		baseOrigin,
		baseSignature,
		states,
		transitions,
		seenSignatures,
		triedAtState,
		maxDepth,
		frontier,
		signal
	} = args;

	let snapshot: PreClickSnapshot;
	try {
		snapshot = await preClickSnapshot(signal);
	} catch (err) {
		if (isStop(err)) throw err;
		return { outcome: 'error', note: 'pre-click snapshot failed', recovered: false };
	}

	let click: ClickResult;
	try {
		click = await clickByAudId(candidate.id, signal);
	} catch (err) {
		if (isStop(err)) throw err;
		if (err instanceof EvalTimeoutError) {
			await recoverToBase(baseUrl, signal);
			await installGuards(signal);
			return { outcome: 'timeout', note: 'click eval timed out', recovered: true };
		}
		return { outcome: 'error', note: (err as Error).message, recovered: false };
	}

	if (!click.clicked) {
		return {
			outcome: click.reason === 'selector-stale' ? 'selector-stale' : 'click-failed',
			note: click.reason,
			recovered: false
		};
	}

	await adaptiveWait(ADAPTIVE_WAIT_MAX_MS, signal);

	let after;
	try {
		after = await getPageInfo({ signal, timeoutMs: STEP_EVAL_TIMEOUT_MS });
	} catch {
		await recoverToBase(baseUrl, signal);
		await installGuards(signal);
		return { outcome: 'timeout', note: 'page info eval timed out', recovered: true };
	}

	if (after.origin !== baseOrigin) {
		transitions.push({
			from: parentEntry.stateId,
			to: parentEntry.stateId,
			candidateId: candidate.id,
			label: candidate.label,
			outcome: 'navigated-cross-origin',
			note: `from ${baseOrigin} to ${after.origin}`
		});
		await navigateInspectedTab(baseUrl);
		await waitForReady(REPLAY_WAIT_MAX_MS, { signal });
		await installGuards(signal);
		return { outcome: 'navigated-cross-origin', note: after.origin, recovered: true };
	}

	if (after.url !== baseUrl) {
		transitions.push({
			from: parentEntry.stateId,
			to: parentEntry.stateId,
			candidateId: candidate.id,
			label: candidate.label,
			outcome: 'navigated',
			note: after.url
		});
		await recoverToBase(baseUrl, signal);
		await installGuards(signal);
		return { outcome: 'navigated', note: after.url, recovered: true };
	}

	let sig: string;
	try {
		sig = await computeStateSignature({ signal });
	} catch (err) {
		if (isStop(err)) throw err;
		return { outcome: 'error', note: 'signature failed', recovered: false };
	}

	const existing = seenSignatures.get(sig);
	if (existing) {
		const outcome: ExploreOutcome = existing === parentEntry.stateId ? 'rolled-back' : 'duplicate';
		transitions.push({
			from: parentEntry.stateId,
			to: existing,
			candidateId: candidate.id,
			label: candidate.label,
			outcome
		});
		await rollbackByKind(candidate.kind, candidate.id, snapshot, signal);
		await adaptiveWait(ADAPTIVE_WAIT_MAX_MS, signal);
		const restored = await computeStateSignature({ signal });
		if (restored !== sigOfState(states, parentEntry.stateId)) {
			await recoverToBase(baseUrl, signal);
			await installGuards(signal);
			return { outcome, recovered: true };
		}
		return { outcome, recovered: false };
	}

	let newResult: AuditResult;
	try {
		newResult = await runAudit();
	} catch (err) {
		if (isStop(err)) throw err;
		await rollbackByKind(candidate.kind, candidate.id, snapshot, signal);
		return { outcome: 'error', note: 'audit failed', recovered: false };
	}
	const screenshot = await captureTab();
	const newId = `state-${states.length}`;
	const newDepth = parentEntry.depth + 1;
	const newPath = [...parentEntry.pathKeys, candidate.key];
	const newState: InteractionState = {
		id: newId,
		depth: newDepth,
		parentId: parentEntry.stateId,
		pathKeys: newPath,
		triggerCandidateId: candidate.id,
		triggerLabel: candidate.label || candidate.kind,
		signature: sig,
		screenshot,
		result: newResult,
		issuesByCategory: issuesByCategory(newResult),
		discoveredAt: new Date().toISOString(),
		outcome: 'new-state'
	};
	states.push(newState);
	transitions.push({
		from: parentEntry.stateId,
		to: newId,
		candidateId: candidate.id,
		label: candidate.label,
		outcome: 'new-state'
	});
	seenSignatures.set(sig, newId);
	triedAtState.set(newId, new Set<string>());

	if (newDepth < maxDepth) {
		frontier.push({ stateId: newId, pathKeys: newPath, depth: newDepth });
	}

	await rollbackByKind(candidate.kind, candidate.id, snapshot, signal);
	await adaptiveWait(ADAPTIVE_WAIT_MAX_MS, signal);
	const restored = await computeStateSignature({ signal });
	const parentSig = sigOfState(states, parentEntry.stateId);
	if (restored !== parentSig) {
		// Could not restore parent context. Mark as recovered so the outer
		// loop reloads base and we re-replay the path on the next iteration.
		await recoverToBase(baseUrl, signal);
		await installGuards(signal);
		return { outcome: 'new-state', recovered: true };
	}
	void baseSignature;
	return { outcome: 'new-state', recovered: false };
}

function sigOfState(states: InteractionState[], stateId: string): string | undefined {
	return states.find((s) => s.id === stateId)?.signature;
}

async function rollbackByKind(
	kind: CandidateKind,
	audId: number,
	snapshot: PreClickSnapshot,
	signal?: AbortSignal
): Promise<void> {
	const expr = `(function(){
		var KIND = ${JSON.stringify(kind)};
		var AUD = ${JSON.stringify(String(audId))};
		var SNAP = ${JSON.stringify(snapshot)};
		try {
			if (KIND === 'disclosure' || KIND === 'menu-opener') {
				var el = document.querySelector('[data-aud-id="' + AUD + '"]');
				if (el && el.getAttribute('aria-expanded') === 'true') el.click();
				document.body && document.body.click && document.body.click();
				return true;
			}
			if (KIND === 'summary') {
				var sEl = document.querySelector('[data-aud-id="' + AUD + '"]');
				if (sEl && sEl.parentElement && sEl.parentElement.tagName === 'DETAILS') {
					sEl.parentElement.open = false;
				}
				return true;
			}
			if (KIND === 'tab') {
				if (SNAP.selectedTabSelector) {
					var prev = document.querySelector(SNAP.selectedTabSelector);
					if (prev && prev.getAttribute('aria-selected') !== 'true') prev.click();
				}
				return true;
			}
			if (KIND === 'dialog-opener') {
				var dialogs = document.querySelectorAll('dialog[open], [role="dialog"]:not([aria-hidden="true"])');
				for (var i = 0; i < dialogs.length; i++) {
					var d = dialogs[i];
					if (d.tagName === 'DIALOG' && typeof d.close === 'function') { try { d.close(); } catch (e) {} continue; }
					var closer = d.querySelector('[data-bs-dismiss="modal"], [data-dismiss="modal"], [aria-label*="close" i], button.close');
					if (closer) closer.click();
				}
				return true;
			}
			if (KIND === 'in-page-link') {
				if (location.pathname + location.hash !== SNAP.pathnameHash) {
					history.replaceState(null, '', SNAP.url);
					try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) {}
				}
				return true;
			}
			return true;
		} catch (e) { return false; }
	})()`;
	try {
		await evalInPage<boolean>(expr, { signal, timeoutMs: STEP_EVAL_TIMEOUT_MS });
	} catch {
		// best-effort
	}
}
