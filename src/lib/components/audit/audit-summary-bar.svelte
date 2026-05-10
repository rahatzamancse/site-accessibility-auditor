<script lang="ts">
	import type { AuditResult, WcagSC } from '../../types.ts';
	import { CRITERION_META } from '../../types.ts';

	type StatusFilter = 'all' | 'fail' | 'warning' | 'pass' | 'exempt';
	type CategoryFilter = 'all' | 'Targets' | 'Focus' | 'Drag' | 'Forms' | 'Help';

	interface Props {
		result: AuditResult;
		statusFilter: StatusFilter;
		categoryFilter: CategoryFilter;
		query: string;
		onstatuschange: (s: StatusFilter) => void;
		oncategorychange: (c: CategoryFilter) => void;
		onquerychange: (q: string) => void;
	}

	let {
		result,
		statusFilter,
		categoryFilter,
		query,
		onstatuschange,
		oncategorychange,
		onquerychange
	}: Props = $props();

	const STATUS: { id: StatusFilter; label: string }[] = [
		{ id: 'all', label: 'All' },
		{ id: 'fail', label: 'Fail' },
		{ id: 'warning', label: 'Warn' },
		{ id: 'pass', label: 'Pass' },
		{ id: 'exempt', label: 'Exempt' }
	];

	const CATEGORIES: CategoryFilter[] = ['all', 'Targets', 'Focus', 'Drag', 'Forms', 'Help'];

	function statusCount(s: StatusFilter): number {
		if (s === 'all') return result.summary.total;
		return result.summary[s];
	}

	function criterionList(): {
		wcag: WcagSC;
		summary: { fail: number; warning: number; pass: number; exempt: number; total: number };
	}[] {
		return Object.keys(result.perCriterion).map((w) => ({
			wcag: w as WcagSC,
			summary: result.perCriterion[w as WcagSC]!
		}));
	}
</script>

<div
	class="flex flex-col gap-2 rounded-md border px-3 py-2"
	style:border-color="var(--panel-border)"
	style:background-color="var(--panel-summary-bg)"
>
	<div class="grid grid-cols-5 gap-2">
		<div
			class="rounded p-2 text-center shadow-sm"
			style:background-color="var(--panel-bg-elevated)"
		>
			<div class="text-base font-bold" style:color="var(--panel-text)">
				{result.summary.total}
			</div>
			<div class="text-[10px]" style:color="var(--panel-text-muted)">Total</div>
		</div>
		<div
			class="rounded p-2 text-center shadow-sm"
			style:background-color="var(--panel-bg-elevated)"
		>
			<div class="text-base font-bold" style:color="var(--status-pass)">
				{result.summary.pass}
			</div>
			<div class="text-[10px]" style:color="var(--panel-text-muted)">Pass</div>
		</div>
		<div
			class="rounded p-2 text-center shadow-sm"
			style:background-color="var(--panel-bg-elevated)"
		>
			<div class="text-base font-bold" style:color="var(--status-warning)">
				{result.summary.warning}
			</div>
			<div class="text-[10px]" style:color="var(--panel-text-muted)">Warn</div>
		</div>
		<div
			class="rounded p-2 text-center shadow-sm"
			style:background-color="var(--panel-bg-elevated)"
		>
			<div class="text-base font-bold" style:color="var(--status-fail)">
				{result.summary.fail}
			</div>
			<div class="text-[10px]" style:color="var(--panel-text-muted)">Fail</div>
		</div>
		<div
			class="rounded p-2 text-center shadow-sm"
			style:background-color="var(--panel-bg-elevated)"
		>
			<div class="text-base font-bold" style:color="var(--panel-text-muted)">
				{result.summary.exempt}
			</div>
			<div class="text-[10px]" style:color="var(--panel-text-muted)">Exempt</div>
		</div>
	</div>

	<div class="flex flex-wrap gap-1">
		{#each criterionList() as c (c.wcag)}
			<span
				class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]"
				style:border-color="var(--panel-border)"
				style:background-color="var(--panel-bg-elevated)"
				style:color="var(--panel-text)"
				title={CRITERION_META[c.wcag]?.title}
			>
				<span class="font-mono">{c.wcag}</span>
				{#if c.summary.fail}
					<span style:color="var(--status-fail)">{c.summary.fail}F</span>
				{/if}
				{#if c.summary.warning}
					<span style:color="var(--status-warning)">{c.summary.warning}W</span>
				{/if}
				{#if c.summary.pass}
					<span style:color="var(--status-pass)">{c.summary.pass}P</span>
				{/if}
			</span>
		{/each}
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<div class="flex flex-wrap gap-1">
			{#each STATUS as s (s.id)}
				<button
					type="button"
					onclick={() => onstatuschange(s.id)}
					class="rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
					style:background-color={statusFilter === s.id
						? 'var(--panel-filter-active-bg)'
						: 'transparent'}
					style:color={statusFilter === s.id
						? 'var(--panel-filter-active-text)'
						: 'var(--panel-text-muted)'}
				>
					{s.label}
					<span
						class="ml-1 rounded-full px-1 text-[9px]"
						style:background-color={statusFilter === s.id
							? 'rgba(255,255,255,0.2)'
							: 'var(--panel-filter-inactive-bg)'}
					>
						{statusCount(s.id)}
					</span>
				</button>
			{/each}
		</div>
		<div class="flex flex-wrap gap-1">
			{#each CATEGORIES as cat (cat)}
				<button
					type="button"
					onclick={() => oncategorychange(cat)}
					class="rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
					style:background-color={categoryFilter === cat
						? 'var(--panel-filter-active-bg)'
						: 'transparent'}
					style:color={categoryFilter === cat
						? 'var(--panel-filter-active-text)'
						: 'var(--panel-text-muted)'}
				>
					{cat === 'all' ? 'All' : cat}
				</button>
			{/each}
		</div>
		<input
			type="search"
			value={query}
			oninput={(e) => onquerychange(e.currentTarget.value)}
			placeholder="Search tag, text, selector…"
			class="ml-auto min-w-32 flex-1 rounded border px-2 py-1 text-[11px]"
			style:border-color="var(--panel-border)"
			style:background-color="var(--panel-bg-elevated)"
			style:color="var(--panel-text)"
			aria-label="Search issues"
		/>
	</div>
</div>
