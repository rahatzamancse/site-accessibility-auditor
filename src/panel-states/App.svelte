<script lang="ts">
	import { exploreStates } from '../lib/session/dynamic-explorer.ts';
	import { computeStateDebt } from '../lib/session/state-debt.ts';
	import type { ExplorerProgress, InteractionState, StateGraph } from '../lib/session/types.ts';
	import PanelShell from '../lib/components/ui/panel-shell.svelte';
	import ToolbarButton from '../lib/components/ui/toolbar-button.svelte';
	import EmptyState from '../lib/components/ui/empty-state.svelte';
	import StateGraphView from '../lib/components/states/state-graph.svelte';
	import StateIssueMatrix from '../lib/components/states/state-issue-matrix.svelte';
	import StateTimeline from '../lib/components/states/state-timeline.svelte';
	import StateDetail from '../lib/components/states/state-detail.svelte';
	import DebtCard from '../lib/components/states/debt-card.svelte';

	type ViewMode = 'graph' | 'matrix';

	let graph = $state<StateGraph | null>(null);
	let running = $state(false);
	let error = $state<string | null>(null);
	let budget = $state(8);
	let maxDepth = $state(2);
	let safeMode = $state(false);
	let selectedId = $state<string | null>(null);
	let progress = $state<ExplorerProgress | null>(null);
	let view = $state<ViewMode>('graph');
	let controller: AbortController | null = null;

	const outcomeCounts = $derived.by(() => {
		const counts: Record<string, number> = {};
		if (!graph) return counts;
		for (const a of graph.attempts) counts[a.outcome] = (counts[a.outcome] ?? 0) + 1;
		return counts;
	});

	const outcomeOrder = [
		'new-state',
		'duplicate',
		'rolled-back',
		'navigated',
		'navigated-cross-origin',
		'selector-stale',
		'click-failed',
		'timeout',
		'error'
	] as const;

	function outcomeColor(o: string): string {
		switch (o) {
			case 'new-state':
				return 'var(--viz-ok)';
			case 'duplicate':
			case 'rolled-back':
				return 'var(--viz-info)';
			case 'navigated':
			case 'navigated-cross-origin':
				return 'var(--viz-warn)';
			default:
				return 'var(--viz-bad)';
		}
	}

	const debt = $derived(graph ? computeStateDebt(graph) : null);

	const baseState = $derived.by<InteractionState | null>(() => {
		const g = graph;
		if (!g || g.states.length === 0) return null;
		return g.states.find((s) => s.id === g.rootId) ?? g.states[0];
	});

	const selectedState = $derived<InteractionState | null>(
		graph && selectedId ? (graph.states.find((s) => s.id === selectedId) ?? null) : null
	);

	const progressPct = $derived(
		progress
			? Math.round((progress.candidatesProcessed / Math.max(1, progress.candidatesTotal)) * 100)
			: 0
	);

	async function handleRun() {
		if (running) return;
		running = true;
		error = null;
		progress = null;
		controller = new AbortController();
		try {
			const result = await exploreStates({
				budget,
				maxDepth,
				safeMode,
				signal: controller.signal,
				onProgress: (p) => (progress = p)
			});
			graph = result;
			if (result.states.length > 0) selectedId = result.states[0].id;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Exploration failed';
			graph = null;
		} finally {
			running = false;
		}
	}

	function handleStop() {
		controller?.abort();
	}

	function handleClear() {
		graph = null;
		selectedId = null;
		error = null;
		progress = null;
	}

	function handleSelect(id: string) {
		selectedId = id;
	}
</script>

<PanelShell title="Dynamic States" subtitle="state-aware audit · debt metric">
	{#snippet toolbar()}
		<label class="flex items-center gap-1.5 text-[11px] text-[var(--panel-text-muted)]">
			<span>Budget</span>
			<input
				type="range"
				min="2"
				max="24"
				bind:value={budget}
				class="w-24"
				disabled={running}
				aria-label="Exploration budget (total candidate interactions across all depths)"
			/>
			<span class="w-6 text-right font-mono text-[var(--panel-text)]">{budget}</span>
		</label>
		<label
			class="flex items-center gap-1.5 text-[11px] text-[var(--panel-text-muted)]"
			title="Maximum BFS depth from base. Each additional depth replays the path via a base reload, so deeper levels are slower."
		>
			<span>Depth</span>
			<select
				bind:value={maxDepth}
				disabled={running}
				class="rounded border bg-[var(--panel-bg-elevated)] px-1 py-0.5 text-[11px] text-[var(--panel-text)]"
				style:border-color="var(--panel-border)"
				aria-label="Max BFS depth from base"
			>
				<option value={1}>1</option>
				<option value={2}>2</option>
				<option value={3}>3</option>
				<option value={4}>4</option>
			</select>
		</label>
		<label
			class="flex items-center gap-1 text-[11px] text-[var(--panel-text-muted)]"
			title="Skip dialog openers, generic buttons, and any anchor that looks like navigation. Useful for production sites where exploration must not click anything destructive."
		>
			<input
				type="checkbox"
				bind:checked={safeMode}
				disabled={running}
				aria-label="Safe mode: skip risky candidates"
			/>
			<span>Safe mode</span>
		</label>
		{#if running}
			<ToolbarButton onclick={handleStop}>Stop</ToolbarButton>
		{:else if graph}
			<ToolbarButton onclick={handleClear}>Clear</ToolbarButton>
		{/if}
		<ToolbarButton variant="primary" onclick={handleRun} disabled={running} loading={running}>
			{running ? 'Exploring…' : 'Explore States'}
		</ToolbarButton>
	{/snippet}

	<div class="flex flex-col gap-3 px-3 py-3">
		{#if running && progress}
			<div
				class="rounded-md border px-3 py-2 text-[11px]"
				style="border-color: var(--panel-border); background-color: var(--panel-summary-bg);"
			>
				<div class="flex items-center justify-between">
					<span class="font-semibold text-[var(--panel-text)] capitalize">{progress.phase}</span>
					<span class="font-mono text-[var(--panel-text-muted)]"
						>{progress.candidatesProcessed}/{progress.candidatesTotal} · {progressPct}%</span
					>
				</div>
				<div
					class="mt-1.5 h-1.5 overflow-hidden rounded-full"
					style="background-color: var(--panel-hover);"
					role="progressbar"
					aria-valuenow={progressPct}
					aria-valuemin="0"
					aria-valuemax="100"
				>
					<span
						class="block h-full transition-all"
						style="background-color: var(--panel-primary); width: {progressPct}%;"
					></span>
				</div>
				<div class="mt-1 text-[10px] text-[var(--panel-text-muted)]">{progress.message}</div>
			</div>
		{/if}

		{#if error}
			<div
				class="rounded-md border px-3 py-2 text-[11px]"
				style="border-color: var(--panel-error-border); background-color: var(--panel-error-bg); color: var(--panel-error-text);"
				role="alert"
			>
				{error}
			</div>
		{/if}

		{#if graph && debt}
			<DebtCard {debt} />

			{#if graph.attempts.length > 0 || graph.skipped.length > 0}
				<div
					class="rounded-md border px-3 py-2 text-[11px]"
					style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
				>
					<div
						class="flex items-center justify-between text-[9px] font-bold tracking-wide uppercase"
						style:color="var(--panel-text-muted)"
					>
						<span>Coverage report</span>
						<span class="normal-case"
							>{graph.attempts.length} attempt{graph.attempts.length === 1 ? '' : 's'}</span
						>
					</div>
					{#if graph.attempts.length > 0}
						<div class="mt-1.5 flex flex-wrap gap-1">
							{#each outcomeOrder as o (o)}
								{#if outcomeCounts[o]}
									<span
										class="rounded px-1.5 py-0.5 font-mono text-[10px]"
										style:background-color="color-mix(in srgb, {outcomeColor(o)} 14%, transparent)"
										style:color={outcomeColor(o)}
										title="{o} candidates"
									>
										{o} · {outcomeCounts[o]}
									</span>
								{/if}
							{/each}
						</div>
					{/if}
					{#if graph.skipped.length > 0}
						<div class="mt-1.5 text-[10px] text-[var(--panel-text-muted)]">
							Skipped: {#each graph.skipped as s, i (s.kind + i)}{i > 0 ? ' · ' : ''}<span
									class="font-mono">{s.kind} ({s.count})</span
								>
								{s.reason}{/each}
						</div>
					{/if}
				</div>
			{/if}

			<div
				class="flex items-center gap-0.5 rounded-md border p-0.5 text-[10px]"
				style="border-color: var(--panel-border); background-color: var(--panel-summary-bg);"
				role="tablist"
				aria-label="State explorer view"
			>
				<button
					type="button"
					role="tab"
					aria-selected={view === 'graph'}
					class="flex-1 rounded px-2 py-1.5 font-semibold transition-colors"
					style:background-color={view === 'graph' ? 'var(--panel-bg-elevated)' : 'transparent'}
					style:color={view === 'graph' ? 'var(--panel-text)' : 'var(--panel-text-muted)'}
					onclick={() => (view = 'graph')}
				>
					Radial graph
				</button>
				<button
					type="button"
					role="tab"
					aria-selected={view === 'matrix'}
					class="flex-1 rounded px-2 py-1.5 font-semibold transition-colors"
					style:background-color={view === 'matrix' ? 'var(--panel-bg-elevated)' : 'transparent'}
					style:color={view === 'matrix' ? 'var(--panel-text)' : 'var(--panel-text-muted)'}
					onclick={() => (view = 'matrix')}
				>
					Issue matrix
				</button>
			</div>

			<div class="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
				<div class="flex flex-col gap-3">
					{#if view === 'graph'}
						<StateGraphView {graph} {selectedId} onselect={handleSelect} />
					{:else}
						<StateIssueMatrix {graph} {selectedId} onselect={handleSelect} />
					{/if}
					<StateTimeline {graph} {selectedId} onselect={handleSelect} />
				</div>
				<div class="flex flex-col gap-3">
					{#if selectedState}
						<StateDetail current={selectedState} {baseState} />
					{:else}
						<div
							class="rounded-md border px-3 py-8 text-center text-[11px] text-[var(--panel-text-muted)]"
							style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
						>
							Select a state to inspect its issues.
						</div>
					{/if}
				</div>
			</div>
		{:else if !running && !error}
			<EmptyState
				title="Dynamic state explorer"
				description="Performs a depth-bounded BFS over safe interactions (disclosures, tabs, dialogs, in-page links). At each frontier state the explorer collects fresh candidates, replays the path from base via a hard reload to reach deeper states, screenshots each discovered state, and reruns the audit. Emits a state graph, a state-by-category issue matrix, and a state-conditional accessibility debt metric."
				action="Tune the budget slider, then click <strong>Explore States</strong>."
			>
				<div class="mt-5 grid w-full max-w-md grid-cols-2 gap-2 text-left text-[11px]">
					<div
						class="rounded-md border p-2"
						style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
					>
						<div class="text-[9px] font-bold tracking-wide text-[var(--viz-info)] uppercase">
							Radial state graph
						</div>
						<p class="mt-1 text-[var(--panel-text-muted)]">
							base at center · severity-colored ring
						</p>
					</div>
					<div
						class="rounded-md border p-2"
						style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
					>
						<div class="text-[9px] font-bold tracking-wide text-[var(--viz-bad)] uppercase">
							Debt metric
						</div>
						<p class="mt-1 text-[var(--panel-text-muted)]">
							severity × depth decay · per-category breakdown
						</p>
					</div>
					<div
						class="rounded-md border p-2"
						style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
					>
						<div class="text-[9px] font-bold tracking-wide text-[var(--viz-warn)] uppercase">
							Issue matrix
						</div>
						<p class="mt-1 text-[var(--panel-text-muted)]">
							state × category heatmap with Δ vs base
						</p>
					</div>
					<div
						class="rounded-md border p-2"
						style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
					>
						<div class="text-[9px] font-bold tracking-wide text-[var(--viz-accent)] uppercase">
							Timeline
						</div>
						<p class="mt-1 text-[var(--panel-text-muted)]">
							chronological discovery · new/gone issue counts
						</p>
					</div>
				</div>
			</EmptyState>
		{/if}
	</div>
</PanelShell>
