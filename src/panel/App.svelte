<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		runAudit,
		highlightIssue,
		hoverIssue,
		pollHoveredAuditId,
		clearAudit,
		resetSession,
		type AuditProgress
	} from '../lib/auditor.ts';
	import IssuesPanel from '../lib/components/issues-panel.svelte';
	import AuditMinimap from '../lib/components/audit/audit-minimap.svelte';
	import AuditInspector from '../lib/components/audit/audit-inspector.svelte';
	import AuditSummaryBar from '../lib/components/audit/audit-summary-bar.svelte';
	import type { AuditResult, WcagSC } from '../lib/types.ts';
	import { ALL_CRITERIA, CRITERION_META } from '../lib/types.ts';
	import { getRuns, saveRun, deleteRun, type AuditRunRecord } from '../lib/shared/audit-history.ts';
	import { diffAudits } from '../lib/shared/audit-diff.ts';
	import { captureTab, downscaleDataUrl } from '../lib/shared/devtools-eval.ts';
	import { ensurePageAccess } from '../lib/shared/page-access.ts';
	import PanelShell from '../lib/components/ui/panel-shell.svelte';
	import ToolbarButton from '../lib/components/ui/toolbar-button.svelte';
	import EmptyState from '../lib/components/ui/empty-state.svelte';
	import SplitPane3 from '../lib/components/ui/split-pane-3.svelte';
	import RunList from '../lib/components/history/run-list.svelte';
	import DiffView from '../lib/components/history/diff-view.svelte';

	type Tab = 'current' | 'history';
	type StatusFilter = 'all' | 'fail' | 'warning' | 'pass' | 'exempt';
	type CategoryFilter = 'all' | 'Targets' | 'Focus' | 'Drag' | 'Forms' | 'Help';

	let loading = $state(false);
	let progress = $state<AuditProgress | null>(null);
	let error = $state<string | null>(null);
	let result = $state<AuditResult | null>(null);
	let selectedId = $state<number | null>(null);
	let hoveredId = $state<number | null>(null);
	let statusFilter = $state<StatusFilter>('all');
	let categoryFilter = $state<CategoryFilter>('all');
	let query = $state('');
	let enabled = $state<Record<WcagSC, boolean>>(
		Object.fromEntries(ALL_CRITERIA.map((c) => [c, true])) as Record<WcagSC, boolean>
	);
	let showSettings = $state(false);
	let tab = $state<Tab>('current');
	let runs = $state<AuditRunRecord[]>([]);
	let baselineId = $state<string | null>(null);
	let currentId = $state<string | null>(null);
	let hoverPollTimer: ReturnType<typeof setInterval> | null = null;
	let panelHovering = false;

	const origin = $derived(result?.origin ?? null);
	const baseline = $derived(baselineId ? (runs.find((r) => r.id === baselineId) ?? null) : null);
	const current = $derived(currentId ? (runs.find((r) => r.id === currentId) ?? null) : null);
	const diff = $derived(current ? diffAudits(baseline?.result ?? null, current.result) : null);
	const selectedIssue = $derived(
		result && selectedId !== null ? (result.issues.find((i) => i.id === selectedId) ?? null) : null
	);

	const progressPct = $derived(
		progress ? Math.round((progress.completed / Math.max(1, progress.total)) * 100) : 0
	);

	async function refreshRuns(forOrigin?: string) {
		if (!forOrigin) return;
		runs = await getRuns(forOrigin);
		if (!currentId && runs.length > 0) currentId = runs[0].id;
		if (!baselineId && runs.length > 1) baselineId = runs[1].id;
	}

	async function handleAudit() {
		loading = true;
		error = null;
		selectedId = null;
		hoveredId = null;
		progress = null;
		stopHoverPoll();
		try {
			const criteria = ALL_CRITERIA.filter((c) => enabled[c]);
			const canCapture = await ensurePageAccess();
			const auditResult = await runAudit({
				criteria,
				skipCapture: !canCapture,
				onProgress: (p) => (progress = p)
			});
			result = auditResult;
			let thumbnail: string | null = null;
			if (canCapture) {
				try {
					const raw = await captureTab();
					if (raw) thumbnail = await downscaleDataUrl(raw, 320);
				} catch {
					thumbnail = null;
				}
			}
			const record = await saveRun(auditResult, thumbnail);
			runs = await getRuns(auditResult.origin);
			baselineId = currentId ?? baselineId;
			currentId = record.id;
			startHoverPoll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Audit failed';
			result = null;
		} finally {
			loading = false;
			progress = null;
		}
	}

	async function handleSelect(id: number) {
		selectedId = selectedId === id ? null : id;
		await highlightIssue(selectedId);
	}

	async function handleHover(id: number | null) {
		panelHovering = id !== null;
		hoveredId = id;
		await hoverIssue(id);
	}

	async function handleClear() {
		stopHoverPoll();
		await clearAudit();
		result = null;
		selectedId = null;
		hoveredId = null;
		error = null;
	}

	async function handleResetSession() {
		if (result) await resetSession(result.origin);
		else await resetSession();
	}

	async function handleSelectRun(id: string, role: 'baseline' | 'current') {
		if (role === 'baseline') baselineId = id;
		else currentId = id;
	}

	async function handleDeleteRun(id: string) {
		if (!origin) return;
		await deleteRun(origin, id);
		if (baselineId === id) baselineId = null;
		if (currentId === id) currentId = null;
		runs = await getRuns(origin);
	}

	function startHoverPoll() {
		stopHoverPoll();
		hoverPollTimer = setInterval(async () => {
			if (panelHovering || !result || tab !== 'current') return;
			const id = await pollHoveredAuditId();
			hoveredId = id;
		}, 140);
	}

	function stopHoverPoll() {
		if (hoverPollTimer !== null) {
			clearInterval(hoverPollTimer);
			hoverPollTimer = null;
		}
	}

	onDestroy(stopHoverPoll);

	$effect(() => {
		if (tab === 'history' && origin) {
			refreshRuns(origin);
		}
	});
</script>

<PanelShell title="Interaction Audits" subtitle="WCAG 2.2 · history · diff">
	{#snippet toolbar()}
		<div
			class="flex items-center rounded-md border p-0.5 text-[11px]"
			style="border-color: var(--panel-border);"
		>
			<button
				onclick={() => (tab = 'current')}
				class="rounded-md px-2 py-0.5 transition-colors"
				style:background-color={tab === 'current' ? 'var(--panel-filter-active-bg)' : 'transparent'}
				style:color={tab === 'current'
					? 'var(--panel-filter-active-text)'
					: 'var(--panel-text-muted)'}
			>
				Current
			</button>
			<button
				onclick={() => (tab = 'history')}
				class="rounded-md px-2 py-0.5 transition-colors"
				style:background-color={tab === 'history' ? 'var(--panel-filter-active-bg)' : 'transparent'}
				style:color={tab === 'history'
					? 'var(--panel-filter-active-text)'
					: 'var(--panel-text-muted)'}
			>
				History / Diff
			</button>
		</div>
		<ToolbarButton onclick={() => (showSettings = !showSettings)}>Criteria</ToolbarButton>
		<ToolbarButton
			onclick={handleResetSession}
			title="Clear stored help signatures and known field tokens for this origin"
		>
			Reset Session
		</ToolbarButton>
		{#if result}
			<ToolbarButton onclick={handleClear}>Clear</ToolbarButton>
		{/if}
		<ToolbarButton variant="primary" onclick={handleAudit} disabled={loading} {loading}>
			{loading ? 'Auditing…' : 'Audit Page'}
		</ToolbarButton>
	{/snippet}

	{#if showSettings}
		<div
			class="shrink-0 border-b px-4 py-3"
			style="border-color: var(--panel-border); background-color: var(--panel-summary-bg);"
		>
			<h2 class="mb-2 text-xs font-semibold text-[var(--panel-text)]">WCAG 2.2 criteria</h2>
			<div class="grid grid-cols-2 gap-x-4 gap-y-1.5">
				{#each ALL_CRITERIA as c (c)}
					<label class="flex items-center gap-2 text-xs text-[var(--panel-text-muted)]">
						<input
							type="checkbox"
							checked={enabled[c]}
							onchange={(e) => (enabled[c] = e.currentTarget.checked)}
							class="rounded"
						/>
						<span class="font-mono text-[var(--panel-text)]">{c}</span>
						<span>{CRITERION_META[c].title}</span>
					</label>
				{/each}
			</div>
		</div>
	{/if}

	{#if loading && progress}
		<div class="shrink-0 border-b px-3 py-2" style:border-color="var(--panel-border)">
			<div class="flex items-center justify-between text-[11px]">
				<span class="font-semibold capitalize" style:color="var(--panel-text)">
					{progress.phase}
				</span>
				<span class="font-mono" style:color="var(--panel-text-muted)">
					{progress.completed} / {progress.total} · {progressPct}%
				</span>
			</div>
			<div
				class="mt-1.5 h-1.5 overflow-hidden rounded-full"
				style:background-color="var(--panel-hover)"
				role="progressbar"
				aria-valuenow={progressPct}
				aria-valuemin="0"
				aria-valuemax="100"
			>
				<span
					class="block h-full transition-all"
					style:background-color="var(--panel-primary)"
					style:width="{progressPct}%"
				></span>
			</div>
			{#if progress.message}
				<div class="mt-1 text-[10px]" style:color="var(--panel-text-muted)">
					{progress.message}
				</div>
			{/if}
		</div>
	{/if}

	{#if error}
		<div
			class="m-3 rounded-lg border px-4 py-3 text-xs"
			style="border-color: var(--panel-error-border); background-color: var(--panel-error-bg); color: var(--panel-error-text);"
		>
			{error}
		</div>
	{/if}

	{#if tab === 'current'}
		{#if result}
			{@const r = result}
			<div class="flex h-full min-h-0 flex-col gap-2 px-3 py-3">
				<div class="shrink-0">
					<AuditSummaryBar
						result={r}
						{statusFilter}
						{categoryFilter}
						{query}
						onstatuschange={(s) => (statusFilter = s)}
						oncategorychange={(c) => (categoryFilter = c)}
						onquerychange={(q) => (query = q)}
					/>
				</div>
				<div class="min-h-0 flex-1">
					<SplitPane3 initialRatios={[0.34, 0.4, 0.26]}>
						{#snippet left()}
							<IssuesPanel
								result={r}
								{selectedId}
								{hoveredId}
								{statusFilter}
								{categoryFilter}
								{query}
								onselect={handleSelect}
								onhover={handleHover}
							/>
						{/snippet}
						{#snippet middle()}
							<AuditMinimap
								result={r}
								{selectedId}
								{hoveredId}
								{statusFilter}
								{query}
								onselect={handleSelect}
								onhover={handleHover}
							/>
						{/snippet}
						{#snippet right()}
							<AuditInspector issue={selectedIssue} />
						{/snippet}
					</SplitPane3>
				</div>
			</div>
		{:else if !loading && !error}
			<EmptyState
				title="Interaction Audits"
				description="Deterministic in-page checks for nine WCAG 2.2 interaction-oriented success criteria. Runs are saved with per-issue thumbnails, a page minimap, and rich evidence cards for diffing against future audits."
				action="Click <strong>Audit Page</strong> to scan the current page."
			>
				<ul
					class="mt-2 grid max-w-md grid-cols-1 gap-1 text-left text-[11px]"
					style:color="var(--panel-text-muted)"
				>
					{#each ALL_CRITERIA as c (c)}
						<li class="flex items-baseline gap-2">
							<span class="font-mono" style:color="var(--panel-text)">{c}</span>
							<span>{CRITERION_META[c].title}</span>
						</li>
					{/each}
				</ul>
			</EmptyState>
		{/if}
	{:else}
		<div class="flex flex-col gap-3 px-3 py-3">
			<div
				class="rounded-md border px-3 py-2 text-[11px]"
				style="border-color: var(--panel-border); background-color: var(--panel-summary-bg);"
			>
				Pick any two runs from this origin to diff. The most recent run is chosen as <em>current</em
				>
				and the one before it as <em>baseline</em> by default.
			</div>

			<RunList
				{runs}
				{baselineId}
				{currentId}
				onselect={handleSelectRun}
				ondelete={handleDeleteRun}
			/>

			{#if diff}
				<DiffView {diff} />
			{:else if runs.length > 0}
				<div
					class="rounded-md border px-3 py-4 text-center text-[11px]"
					style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated); color: var(--panel-text-muted);"
				>
					Select a run as "current" to compute a diff.
				</div>
			{/if}
		</div>
	{/if}
</PanelShell>
