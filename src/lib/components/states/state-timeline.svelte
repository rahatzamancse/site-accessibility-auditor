<script lang="ts">
	import type { AuditIssue } from '../../types.ts';
	import type { InteractionState, StateGraph } from '../../session/types.ts';

	interface Props {
		graph: StateGraph;
		selectedId: string | null;
		onselect: (id: string) => void;
	}

	let { graph, selectedId, onselect }: Props = $props();

	function issueKey(issue: AuditIssue): string {
		return [issue.wcag, issue.category, issue.selector ?? issue.domPath ?? '', issue.tag].join('|');
	}

	// Precompute base issue fingerprints once per graph so each row can cheaply
	// report new vs. gone issues relative to the base state.
	const baseKeys = $derived.by<Set<string>>(() => {
		const root = graph.states.find((s) => s.id === graph.rootId) ?? graph.states[0];
		if (!root) return new Set<string>();
		return new Set(root.result.issues.map(issueKey));
	});

	function delta(state: InteractionState): { added: number; removed: number } {
		if (state.id === graph.rootId) return { added: 0, removed: 0 };
		const cur = new Set(state.result.issues.map(issueKey));
		let added = 0;
		let removed = 0;
		for (const k of cur) if (!baseKeys.has(k)) added++;
		for (const k of baseKeys) if (!cur.has(k)) removed++;
		return { added, removed };
	}

	function formatTime(iso: string): string {
		try {
			return new Date(iso).toLocaleTimeString([], {
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit'
			});
		} catch {
			return '';
		}
	}
</script>

<div
	class="overflow-hidden rounded-md border"
	style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
>
	<div
		class="flex items-center justify-between border-b px-3 py-1.5 text-[9px] font-bold tracking-wide uppercase"
		style="border-color: var(--panel-border); color: var(--panel-text-muted);"
	>
		<span>Discovery timeline</span>
		<span class="text-[10px] normal-case" style:color="var(--panel-text-muted)">
			chronological · click to inspect
		</span>
	</div>
	<ol class="flex flex-col">
		{#each graph.states as state, i (state.id)}
			{@const d = delta(state)}
			{@const isRoot = state.id === graph.rootId}
			{@const isSel = selectedId === state.id}
			<li class="group relative border-b last:border-b-0" style:border-color="var(--panel-border)">
				<button
					type="button"
					onclick={() => onselect(state.id)}
					class="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--panel-hover)]"
					style:background-color={isSel ? 'var(--panel-selected)' : 'transparent'}
				>
					<div class="flex shrink-0 flex-col items-center" aria-hidden="true">
						<span
							class="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold"
							style:color="var(--viz-surface)"
							style:background-color={state.result.summary.fail > 0
								? 'var(--viz-node-bad)'
								: state.result.summary.warning > 0
									? 'var(--viz-node-warn)'
									: 'var(--viz-node-ok)'}
						>
							{isRoot ? '★' : i}
						</span>
						{#if i < graph.states.length - 1}
							<span
								class="mt-0.5 w-px grow"
								style:background-color="var(--panel-border)"
								style:min-height="24px"
							></span>
						{/if}
					</div>

					{#if state.screenshot}
						<img
							src={state.screenshot}
							alt="Screenshot of state {state.id}"
							loading="lazy"
							class="h-12 w-16 shrink-0 rounded border object-cover"
							style:border-color={isSel ? 'var(--panel-primary)' : 'var(--panel-border)'}
						/>
					{:else}
						<div
							class="flex h-12 w-16 shrink-0 items-center justify-center rounded border text-[9px] text-[var(--panel-text-subtle)]"
							style="border-color: var(--panel-border); background-color: var(--panel-summary-bg);"
						>
							no shot
						</div>
					{/if}

					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span
								class="rounded px-1 font-mono text-[9px]"
								style="background-color: var(--panel-code-bg); color: var(--panel-text);"
								>{state.id}</span
							>
							<span class="truncate text-[11px] font-semibold text-[var(--panel-text)]">
								{isRoot ? 'Base state' : state.triggerLabel}
							</span>
							{#if !isRoot && state.outcome}
								<span
									class="shrink-0 rounded px-1 font-mono text-[9px]"
									style="background-color: color-mix(in srgb, var(--viz-info) 14%, transparent); color: var(--viz-info);"
									title="Discovery outcome">{state.outcome}</span
								>
							{/if}
							<span class="ml-auto shrink-0 font-mono text-[9px] text-[var(--panel-text-subtle)]">
								{formatTime(state.discoveredAt)}
							</span>
						</div>
						<div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
							<span class="tabular-nums" style:color="var(--status-fail)">
								{state.result.summary.fail} fail
							</span>
							<span class="tabular-nums" style:color="var(--status-warning)">
								{state.result.summary.warning} warn
							</span>
							<span class="tabular-nums" style:color="var(--status-pass)">
								{state.result.summary.pass} pass
							</span>
							{#if !isRoot}
								<span class="text-[var(--panel-text-subtle)]">·</span>
								{#if d.added > 0}
									<span
										class="rounded px-1 tabular-nums"
										style="background-color: color-mix(in srgb, var(--viz-bad) 14%, transparent); color: var(--viz-bad);"
										title="Issues that only appear in this state">+{d.added} new</span
									>
								{/if}
								{#if d.removed > 0}
									<span
										class="rounded px-1 tabular-nums"
										style="background-color: color-mix(in srgb, var(--viz-ok) 14%, transparent); color: var(--viz-ok);"
										title="Base issues that vanish in this state">−{d.removed}</span
									>
								{/if}
								{#if d.added === 0 && d.removed === 0}
									<span class="text-[var(--panel-text-subtle)]">same as base</span>
								{/if}
							{/if}
						</div>
					</div>
				</button>
			</li>
		{/each}
	</ol>
</div>
