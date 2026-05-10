<script lang="ts">
	import type { AuditIssue, AuditResult } from '../types.ts';
	import { CRITERION_META } from '../types.ts';
	import AuditThumb from './audit/audit-thumb.svelte';

	type StatusFilter = 'all' | 'fail' | 'warning' | 'pass' | 'exempt';
	type CategoryFilter = 'all' | 'Targets' | 'Focus' | 'Drag' | 'Forms' | 'Help';

	interface Props {
		result: AuditResult;
		selectedId: number | null;
		hoveredId: number | null;
		statusFilter: StatusFilter;
		categoryFilter: CategoryFilter;
		query: string;
		onselect: (id: number) => void;
		onhover: (id: number | null) => void;
	}

	let {
		result,
		selectedId,
		hoveredId,
		statusFilter,
		categoryFilter,
		query,
		onselect,
		onhover
	}: Props = $props();

	function categoryOfIssue(i: AuditIssue): CategoryFilter {
		return CRITERION_META[i.wcag]?.shortLabel as CategoryFilter;
	}

	function passesQuery(i: AuditIssue): boolean {
		if (!query) return true;
		const lower = query.toLowerCase();
		const haystack = [i.tag, i.text, i.wcag, i.selector ?? '', issueLabel(i)]
			.join(' ')
			.toLowerCase();
		return haystack.includes(lower);
	}

	const filteredIssues = $derived(
		result.issues.filter((i) => {
			if (statusFilter !== 'all' && i.status !== statusFilter) return false;
			if (categoryFilter !== 'all' && categoryOfIssue(i) !== categoryFilter) return false;
			if (!passesQuery(i)) return false;
			return true;
		})
	);

	function statusColor(status: AuditIssue['status']): string {
		switch (status) {
			case 'fail':
				return 'var(--status-fail)';
			case 'warning':
				return 'var(--status-warning)';
			case 'pass':
				return 'var(--status-pass)';
			case 'exempt':
				return 'var(--panel-text-muted)';
		}
	}

	function issueLabel(i: AuditIssue): string {
		if (i.text) return i.text;
		if (i.attributes['aria-label']) return i.attributes['aria-label']!;
		if (i.attributes.placeholder) return i.attributes.placeholder!;
		if (i.attributes.name) return i.attributes.name!;
		if (i.attributes.id) return `#${i.attributes.id}`;
		if (i.attributes.type) return `[type="${i.attributes.type}"]`;
		return `<${i.tag}>`;
	}
</script>

<div
	class="flex h-full flex-col overflow-hidden rounded-md border"
	style:border-color="var(--panel-border)"
	style:background-color="var(--panel-bg-elevated)"
>
	<div
		class="flex shrink-0 items-center justify-between border-b px-2 py-1 text-[9px] font-bold tracking-wide uppercase"
		style:border-color="var(--panel-border)"
		style:color="var(--panel-text-muted)"
	>
		<span>Findings</span>
		<span class="normal-case tabular-nums" style:color="var(--panel-text-muted)">
			{filteredIssues.length} / {result.issues.length}
		</span>
	</div>

	<div class="flex-1 overflow-y-auto">
		{#if filteredIssues.length === 0}
			<div class="px-4 py-8 text-center text-xs" style:color="var(--panel-text-subtle)">
				No findings match this filter.
			</div>
		{:else}
			<ul class="divide-y" style:border-color="var(--panel-border)">
				{#each filteredIssues as issue (issue.id)}
					{@const selected = selectedId === issue.id}
					{@const hovered = hoveredId === issue.id}
					<li>
						<button
							type="button"
							onclick={() => onselect(issue.id)}
							onpointerenter={() => onhover(issue.id)}
							onpointerleave={() => onhover(null)}
							onfocus={() => onhover(issue.id)}
							onblur={() => onhover(null)}
							class="flex w-full items-start gap-2 border-l-3 px-3 py-2 text-left transition-colors hover:bg-[var(--panel-hover)]"
							style:border-left-color={selected
								? 'var(--panel-primary)'
								: hovered
									? statusColor(issue.status)
									: 'transparent'}
							style:background-color={selected
								? 'var(--panel-selected)'
								: hovered
									? 'var(--panel-hover)'
									: 'transparent'}
						>
							<AuditThumb thumb={issue.thumb} status={issue.status} tag={issue.tag} size={48} />
							<div class="min-w-0 flex-1">
								<div class="flex flex-wrap items-center gap-1.5">
									<span
										class="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide uppercase"
										style:background-color="color-mix(in srgb, {statusColor(issue.status)} 15%, transparent)"
										style:color={statusColor(issue.status)}
									>
										{issue.status}
									</span>
									<code
										class="rounded px-1.5 py-0.5 font-mono text-[10px]"
										style:background-color="var(--panel-code-bg)"
										style:color="var(--panel-text)"
										title={CRITERION_META[issue.wcag]?.title}
									>
										WCAG {issue.wcag}
									</code>
									<code
										class="rounded px-1.5 py-0.5 text-[10px]"
										style:background-color="var(--panel-code-bg)"
										style:color="var(--panel-text)"
									>
										&lt;{issue.tag}&gt;
									</code>
									{#if issue.rect}
										<span class="text-[10px]" style:color="var(--panel-text-subtle)">
											{Math.round(issue.rect.width)}×{Math.round(issue.rect.height)} px
										</span>
									{/if}
								</div>
								<div
									class="mt-0.5 truncate text-[11px] font-semibold"
									style:color="var(--panel-text)"
								>
									{issueLabel(issue)}
								</div>
								<p
									class="mt-0.5 line-clamp-2 text-[10px] leading-snug"
									style:color="var(--panel-text-muted)"
								>
									{issue.suggestion}
								</p>
							</div>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>
