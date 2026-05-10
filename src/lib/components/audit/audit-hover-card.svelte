<script lang="ts">
	import type { AuditIssue } from '../../types.ts';
	import { CRITERION_META } from '../../types.ts';
	import { explain } from './why.ts';
	import AuditThumb from './audit-thumb.svelte';

	interface Props {
		issue: AuditIssue;
		variant?: 'tooltip' | 'block';
	}

	let { issue, variant = 'tooltip' }: Props = $props();

	const why = $derived(explain(issue));
	const meta = $derived(CRITERION_META[issue.wcag]);
	const statusColor = $derived(
		issue.status === 'fail'
			? 'var(--status-fail)'
			: issue.status === 'warning'
				? 'var(--status-warning)'
				: issue.status === 'pass'
					? 'var(--status-pass)'
					: 'var(--panel-text-muted)'
	);

	function fmtRatio(r: number) {
		if (!Number.isFinite(r)) return '—';
		return `${r.toFixed(2)}:1`;
	}
</script>

<div
	class="audit-hover-card flex flex-col gap-2 rounded-md border p-2.5 text-[11px]"
	class:tooltip={variant === 'tooltip'}
	style:border-color="var(--panel-border)"
	style:background-color="var(--panel-bg)"
	style:color="var(--panel-text)"
>
	<header class="flex items-start gap-2">
		<AuditThumb thumb={issue.thumb} status={issue.status} tag={issue.tag} size={48} />
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1.5">
				<span
					class="rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide uppercase"
					style:background-color="color-mix(in srgb, {statusColor} 16%, transparent)"
					style:color={statusColor}
				>
					{issue.status}
				</span>
				<code
					class="rounded px-1.5 py-0.5 font-mono text-[10px]"
					style:background-color="var(--panel-code-bg)"
					style:color="var(--panel-text)"
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
			</div>
			<div class="mt-1 truncate text-[11px] font-semibold" style:color="var(--panel-text)">
				{meta?.title ?? issue.wcag}
			</div>
			{#if issue.text}
				<div class="truncate text-[10px]" style:color="var(--panel-text-muted)">
					{issue.text}
				</div>
			{/if}
		</div>
	</header>

	<p class="leading-snug" style:color="var(--panel-text)">{why.headline}</p>

	{#if why.chips.length > 0}
		<dl class="flex flex-col gap-1">
			{#each why.chips as chip, i (i)}
				<div
					class="flex items-center gap-2 rounded px-1.5 py-1"
					style:background-color="var(--panel-bg-elevated)"
				>
					<dt
						class="shrink-0 text-[9px] font-bold tracking-wide uppercase"
						style:color="var(--panel-text-muted)"
					>
						{chip.label}
					</dt>
					<dd class="min-w-0 flex-1 text-right">
						{#if chip.kind === 'compare'}
							<span
								class="font-mono text-[10px]"
								style:color={chip.bad ? 'var(--status-fail)' : 'var(--panel-text)'}
							>
								{chip.actual}
							</span>
							<span class="mx-1 text-[10px]" style:color="var(--panel-text-muted)">vs</span>
							<span class="font-mono text-[10px]" style:color="var(--status-pass)">
								{chip.target}
							</span>
						{:else if chip.kind === 'contrast'}
							<div class="flex items-center justify-end gap-2">
								{#if chip.fg && chip.bg}
									<span class="flex items-center gap-0.5">
										<span
											class="inline-block h-3 w-3 rounded-sm border"
											style:background-color={chip.bg}
											style:border-color="var(--panel-border)"
										></span>
										<span
											class="inline-block h-3 w-3 rounded-sm border"
											style:background-color={chip.fg}
											style:border-color="var(--panel-border)"
										></span>
									</span>
								{/if}
								<span
									class="font-mono text-[10px]"
									style:color={chip.ratio < chip.threshold
										? 'var(--status-fail)'
										: 'var(--status-pass)'}
								>
									{fmtRatio(chip.ratio)}
								</span>
								<span class="text-[10px]" style:color="var(--panel-text-muted)">
									/ {chip.threshold}:1
								</span>
							</div>
						{:else if chip.kind === 'fact'}
							<span class="font-mono text-[10px]" style:color="var(--panel-text)">
								{chip.value}
							</span>
						{:else if chip.kind === 'list'}
							<span class="text-[10px]" style:color="var(--panel-text-muted)">
								{#each chip.items.slice(0, 4) as item, j (j)}{j > 0 ? ', ' : ''}<code>{item}</code
									>{/each}{#if chip.items.length > 4}<span> +{chip.items.length - 4}</span>{/if}
							</span>
						{:else if chip.kind === 'rect'}
							<span class="font-mono text-[10px]">
								{Math.round(chip.width)}×{Math.round(chip.height)} px
							</span>
						{/if}
					</dd>
				</div>
			{/each}
		</dl>
	{/if}

	{#if issue.suggestion && issue.suggestion !== why.headline}
		<footer
			class="rounded border-l-2 px-2 py-1 text-[10px] leading-snug"
			style:border-color={statusColor}
			style:background-color="var(--panel-bg-elevated)"
			style:color="var(--panel-text-muted)"
		>
			{issue.suggestion}
		</footer>
	{/if}
</div>

<style>
	.audit-hover-card.tooltip {
		max-width: 18rem;
		box-shadow:
			0 8px 24px rgba(0, 0, 0, 0.14),
			0 2px 6px rgba(0, 0, 0, 0.08);
	}
</style>
