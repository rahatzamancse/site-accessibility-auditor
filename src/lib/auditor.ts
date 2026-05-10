import type { AuditIssue, AuditResult, AuditStatus, AuditSummary, WcagSC } from './types.ts';
import { ALL_CRITERIA, CRITERION_META, emptySummary, summarize } from './types.ts';
import { chromeStorageSession, type HelpSignature, type SessionStore } from './session-store.ts';
import type { RawFinding } from './audit-checks/shared.ts';
import {
	buildTargetSizeCheck,
	classifyTargetBatch,
	type TargetSizePageResult
} from './audit-checks/target-size.ts';
import {
	buildFocusOcclusionCheck,
	classifyOcclusion,
	type FocusOcclusionPageResult
} from './audit-checks/focus-occlusion.ts';
import {
	buildDragAlternativeCheck,
	classifyDrag,
	type DragPageResult
} from './audit-checks/drag-alternative.ts';
import {
	buildRedundantEntryCheck,
	classifyRedundantEntry,
	type RedundantEntryPageResult
} from './audit-checks/redundant-entry.ts';
import {
	buildAccessibleAuthCheck,
	classifyAuth,
	type AccessibleAuthPageResult
} from './audit-checks/accessible-auth.ts';
import {
	buildConsistentHelpCheck,
	classifyConsistentHelp,
	type ConsistentHelpPageResult
} from './audit-checks/consistent-help.ts';
import {
	buildFocusVisibleCheck,
	classifyFocusVisible,
	type FocusVisiblePageResult
} from './audit-checks/focus-visible.ts';
import { evalInPage, getPageInfo } from './shared/devtools-eval.ts';
import { capturePage, cropToThumb, getPageBounds } from './shared/page-capture.ts';

interface PageInfo {
	origin: string;
	url: string;
	__error?: string;
}

function checkPageError<T extends { __error?: string }>(result: T, label: string): T {
	if (result?.__error) {
		throw new Error(`${label}: ${result.__error}`);
	}
	return result;
}

const OVERLAY_CSS = `
[data-audit-status="fail"] {
  outline: 2.5px solid rgba(239, 68, 68, 0.9) !important;
  outline-offset: 1px !important;
}
[data-audit-status="warning"] {
  outline: 2.5px solid rgba(245, 158, 11, 0.9) !important;
  outline-offset: 1px !important;
}
[data-audit-status="pass"] {
  outline: 2px solid rgba(34, 197, 94, 0.75) !important;
  outline-offset: 1px !important;
}
[data-audit-status="exempt"] {
  outline: 2px dashed rgba(148, 163, 184, 0.8) !important;
  outline-offset: 1px !important;
}
[data-audit-id] { cursor: pointer !important; }
[data-audit-hover="1"] {
  outline-width: 3px !important;
  outline-offset: 2px !important;
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.25) !important;
}
.audit-active-highlight {
  outline-width: 4px !important;
  outline-offset: 3px !important;
  z-index: 99999 !important;
  position: relative !important;
  animation: audit-pulse 0.5s ease-in-out 3 !important;
}
@keyframes audit-pulse {
  0%, 100% { outline-offset: 1px; }
  50% { outline-offset: 5px; }
}
`;

function buildInjectOverlayExpression(): string {
	return `(function() {
  if (document.getElementById('audit-overlay-css')) return;
  var style = document.createElement('style');
  style.id = 'audit-overlay-css';
  style.textContent = ${JSON.stringify(OVERLAY_CSS)};
  document.head.appendChild(style);
})()`;
}

function buildRemoveOverlayExpression(): string {
	return `(function() {
  var style = document.getElementById('audit-overlay-css');
  if (style) style.remove();
  document.querySelectorAll('[data-audit-id]').forEach(function(el) {
    el.removeAttribute('data-audit-id');
    el.removeAttribute('data-audit-status');
    el.removeAttribute('data-audit-wcag');
    el.removeAttribute('data-audit-hover');
  });
  document.querySelectorAll('.audit-active-highlight').forEach(function(el) {
    el.classList.remove('audit-active-highlight');
  });
  if (window.__auditHoverPoll) {
    document.removeEventListener('pointermove', window.__auditHoverPoll);
    delete window.__auditHoverPoll;
  }
  delete window.__auditHoveredId;
})()`;
}

function buildHoverIssueExpression(id: number | null): string {
	return `(function(){
  document.querySelectorAll('[data-audit-hover="1"]').forEach(function(el){
    el.removeAttribute('data-audit-hover');
  });
  ${
		id !== null
			? `var t = document.querySelector('[data-audit-id="${id}"]');
  if (t) t.setAttribute('data-audit-hover', '1');`
			: ''
	}
})()`;
}

const HOVER_POLL_SCRIPT = `(function(){
  if (window.__auditHoverPoll) return;
  window.__auditHoveredId = null;
  function onMove(e){
    var t = e.target;
    while (t && t !== document.body && t.nodeType === 1) {
      var id = t.getAttribute && t.getAttribute('data-audit-id');
      if (id !== null && id !== undefined) {
        window.__auditHoveredId = parseInt(id, 10);
        return;
      }
      t = t.parentElement;
    }
    window.__auditHoveredId = null;
  }
  window.__auditHoverPoll = onMove;
  document.addEventListener('pointermove', onMove, { passive: true });
})()`;

const HOVER_POLL_READ_SCRIPT = `(function(){
  return typeof window.__auditHoveredId === 'number' ? window.__auditHoveredId : null;
})()`;

function buildApplyTagsExpression(issues: AuditIssue[]): string {
	const tagPayload = issues
		.filter((i) => i.selector)
		.map((i) => ({
			id: i.id,
			selector: i.selector,
			status: i.status,
			wcag: i.wcag
		}));
	return `(function(){
  var tags = ${JSON.stringify(tagPayload)};
  document.querySelectorAll('[data-audit-id]').forEach(function(el){
    el.removeAttribute('data-audit-id');
    el.removeAttribute('data-audit-status');
    el.removeAttribute('data-audit-wcag');
  });
  for (var i = 0; i < tags.length; i++) {
    var t = tags[i];
    try {
      var target = document.querySelector(t.selector);
      if (target) {
        target.setAttribute('data-audit-id', String(t.id));
        target.setAttribute('data-audit-status', t.status);
        target.setAttribute('data-audit-wcag', t.wcag);
      }
    } catch (e) {}
  }
})()`;
}

function buildHighlightExpression(id: number | null): string {
	return `(function() {
  document.querySelectorAll('.audit-active-highlight').forEach(function(el) {
    el.classList.remove('audit-active-highlight');
  });
  ${
		id !== null
			? `var target = document.querySelector('[data-audit-id="${id}"]');
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('audit-active-highlight');
  }`
			: ''
	}
})()`;
}

function toIssues(findings: RawFinding[], startId = 0): AuditIssue[] {
	return findings.map((f, i) => ({
		id: startId + i,
		wcag: f.wcag as WcagSC,
		category: CRITERION_META[f.wcag as WcagSC]?.category ?? 'target-size',
		status: f.status as AuditStatus,
		tag: f.tag,
		text: f.text,
		rect: f.rect,
		selector: f.selector,
		domPath: f.domPath,
		attributes: f.attributes,
		evidence: f.evidence,
		suggestion: f.suggestion
	}));
}

function computePerCriterion(issues: AuditIssue[]): Partial<Record<WcagSC, AuditSummary>> {
	const out: Partial<Record<WcagSC, AuditSummary>> = {};
	for (const i of issues) {
		const bucket = out[i.wcag] ?? emptySummary();
		bucket.total++;
		bucket[i.status]++;
		out[i.wcag] = bucket;
	}
	return out;
}

export type AuditPhase = 'checks' | 'capture' | 'crop' | 'overlay';

export interface AuditProgress {
	phase: AuditPhase;
	completed: number;
	total: number;
	message?: string;
}

export interface RunAuditOptions {
	criteria?: WcagSC[];
	sessionStore?: SessionStore;
	signal?: AbortSignal;
	onProgress?: (p: AuditProgress) => void;
	/** Skip the full-page capture stage. Useful for tests. Defaults to false. */
	skipCapture?: boolean;
}

export async function runAudit(opts: RunAuditOptions = {}): Promise<AuditResult> {
	const criteria = new Set<WcagSC>(opts.criteria ?? ALL_CRITERIA);
	const store = opts.sessionStore ?? chromeStorageSession;

	const info = await getPageInfo();
	const findings: RawFinding[] = [];

	if (criteria.has('2.5.8')) {
		const res = await evalInPage<TargetSizePageResult>(buildTargetSizeCheck());
		checkPageError(res, 'target-size');
		findings.push(...classifyTargetBatch(res.raws));
	}

	if (criteria.has('2.4.11') || criteria.has('2.4.12')) {
		const res = await evalInPage<FocusOcclusionPageResult>(buildFocusOcclusionCheck());
		checkPageError(res, 'focus-occlusion');
		for (const raw of res.raws) {
			const out = classifyOcclusion(raw);
			for (const f of out) {
				if (!criteria.has(f.wcag as WcagSC)) continue;
				findings.push(f);
			}
		}
	}

	if (criteria.has('2.5.7')) {
		const res = await evalInPage<DragPageResult>(buildDragAlternativeCheck());
		checkPageError(res, 'drag-alternative');
		for (const raw of res.raws) {
			findings.push(classifyDrag(raw));
		}
	}

	if (criteria.has('3.3.7')) {
		const res = await evalInPage<RedundantEntryPageResult>(buildRedundantEntryCheck());
		checkPageError(res, 'redundant-entry');
		const known = await store.getKnownFieldTokens(info.origin);
		const { findings: feFindings, emittedTokens } = classifyRedundantEntry({
			fields: res.fields,
			knownTokens: known
		});
		findings.push(...feFindings);
		if (emittedTokens.length > 0) {
			await store.recordFieldTokens(info.origin, emittedTokens);
		}
	}

	if (criteria.has('3.3.8')) {
		const res = await evalInPage<AccessibleAuthPageResult>(buildAccessibleAuthCheck());
		checkPageError(res, 'accessible-auth');
		for (const raw of res.raws) {
			findings.push(...classifyAuth(raw));
		}
	}

	if (criteria.has('3.2.6')) {
		const res = await evalInPage<ConsistentHelpPageResult>(buildConsistentHelpCheck());
		checkPageError(res, 'consistent-help');
		const current: HelpSignature = {
			url: res.url,
			timestamp: new Date().toISOString(),
			mechanisms: res.mechanisms
		};
		const prior = await store.getHelpSignatures(info.origin);
		const { findings: helpFindings, shouldRecord } = classifyConsistentHelp(current, prior);
		findings.push(...helpFindings);
		if (shouldRecord) await store.appendHelpSignature(info.origin, current);
	}

	if (criteria.has('2.4.7') || criteria.has('1.4.11')) {
		const res = await evalInPage<FocusVisiblePageResult>(buildFocusVisibleCheck());
		checkPageError(res, 'focus-visible');
		for (const raw of res.raws) {
			const out = classifyFocusVisible(raw);
			for (const f of out) {
				if (!criteria.has(f.wcag as WcagSC)) continue;
				findings.push(f);
			}
		}
	}

	const issues = toIssues(findings);
	const summary = summarize(issues);
	const perCriterion = computePerCriterion(issues);

	let pageBounds = { width: 1280, height: 800 };

	if (!opts.skipCapture) {
		opts.onProgress?.({
			phase: 'capture',
			completed: 0,
			total: 1,
			message: 'Capturing full-page screenshot…'
		});
		const stitched = await capturePage({
			signal: opts.signal,
			onProgress: (chunk, total) => {
				opts.onProgress?.({
					phase: 'capture',
					completed: chunk,
					total,
					message: `Capturing page ${chunk}/${total}…`
				});
			}
		});

		if (stitched) {
			pageBounds = {
				width: stitched.bounds.scrollWidth,
				height: stitched.bounds.scrollHeight
			};
			const issuesWithRect = issues.filter((i) => i.rect);
			for (let i = 0; i < issuesWithRect.length; i++) {
				const issue = issuesWithRect[i];
				if (!issue.rect) continue;
				issue.thumb = cropToThumb(stitched, issue.rect, 96);
				if (i % 8 === 0) {
					opts.onProgress?.({
						phase: 'crop',
						completed: i + 1,
						total: issuesWithRect.length,
						message: `Cropping thumbnails ${i + 1}/${issuesWithRect.length}…`
					});
				}
			}
		} else {
			// Capture failed but we still want a sensible viewBox for the minimap.
			try {
				const b = await getPageBounds();
				pageBounds = { width: b.scrollWidth, height: b.scrollHeight };
			} catch {
				// fall through to default 1280×800
			}
		}
	} else {
		try {
			const b = await getPageBounds();
			pageBounds = { width: b.scrollWidth, height: b.scrollHeight };
		} catch {
			// keep default bounds
		}
	}

	opts.onProgress?.({
		phase: 'overlay',
		completed: 1,
		total: 1,
		message: 'Tagging elements on the page…'
	});
	await evalInPage(buildInjectOverlayExpression());
	await evalInPage(buildApplyTagsExpression(issues));
	await evalInPage(HOVER_POLL_SCRIPT);

	return {
		issues,
		summary,
		perCriterion,
		timestamp: new Date().toISOString(),
		origin: info.origin,
		url: info.url,
		pageBounds
	};
}

export async function highlightIssue(id: number | null): Promise<void> {
	await evalInPage(buildHighlightExpression(id));
}

export async function hoverIssue(id: number | null): Promise<void> {
	await evalInPage(buildHoverIssueExpression(id));
}

export async function pollHoveredAuditId(): Promise<number | null> {
	try {
		return await evalInPage<number | null>(HOVER_POLL_READ_SCRIPT);
	} catch {
		return null;
	}
}

export async function clearAudit(): Promise<void> {
	await evalInPage(buildRemoveOverlayExpression());
}

export async function resetSession(origin?: string): Promise<void> {
	const info = origin ? { origin } : await getPageInfo();
	await chromeStorageSession.reset(info.origin);
}
