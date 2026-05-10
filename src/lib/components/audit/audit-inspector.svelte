<script lang="ts">
	import type { AuditIssue } from '../../types.ts';
	import { CRITERION_META } from '../../types.ts';
	import { evalInPage } from '../../shared/devtools-eval.ts';
	import AuditHoverCard from './audit-hover-card.svelte';
	import AuditThumb from './audit-thumb.svelte';

	interface Props {
		issue: AuditIssue | null;
	}

	let { issue }: Props = $props();

	let copied = $state(false);

	async function copySelector() {
		if (!issue?.selector) return;
		try {
			await navigator.clipboard.writeText(issue.selector);
			copied = true;
			setTimeout(() => (copied = false), 1200);
		} catch {
			// clipboard may be unavailable in some embeds; fail silently
		}
	}

	async function inspectInElements() {
		if (!issue?.selector) return;
		try {
			await evalInPage(
				`(function(){
					var el = document.querySelector(${JSON.stringify(issue.selector)});
					if (el && typeof inspect === 'function') inspect(el);
				})()`
			);
		} catch {
			// inspect() is only defined inside the DevTools console context;
			// some pages or hosts strip it. Best-effort.
		}
	}

	const pathCrumbs = $derived(
		issue?.domPath
			? issue.domPath
					.split('>')
					.map((s) => s.trim())
					.filter(Boolean)
			: []
	);
</script>

<div
	class="flex h-full flex-col gap-2 overflow-y-auto rounded-md border p-2"
	style:border-color="var(--panel-border)"
	style:background-color="var(--panel-bg-elevated)"
>
	{#if !issue}
		<div
			class="flex h-full items-center justify-center px-4 py-8 text-center text-[11px]"
			style:color="var(--panel-text-muted)"
		>
			Select an issue to inspect details, evidence, and selectors.
		</div>
	{:else}
		<div class="flex items-start gap-2 rounded p-2" style:background-color="var(--panel-bg)">
			<AuditThumb thumb={issue.thumb} status={issue.status} tag={issue.tag} size={120} />
			<div class="min-w-0 flex-1">
				<div
					class="text-[9px] font-bold tracking-wide uppercase"
					style:color="var(--panel-text-muted)"
				>
					{CRITERION_META[issue.wcag]?.shortLabel ?? issue.category}
				</div>
				<div class="mt-0.5 text-[12px] font-semibold" style:color="var(--panel-text)">
					{CRITERION_META[issue.wcag]?.title ?? issue.wcag}
				</div>
				<div class="mt-1 text-[11px] break-words" style:color="var(--panel-text-muted)">
					{issue.text || `<${issue.tag}>`}
				</div>
			</div>
		</div>

		<AuditHoverCard {issue} variant="block" />

		{#if pathCrumbs.length > 0}
			<section class="rounded border p-2" style:border-color="var(--panel-border)">
				<header
					class="text-[9px] font-bold tracking-wide uppercase"
					style:color="var(--panel-text-muted)"
				>
					Trace
				</header>
				<ol class="mt-1 flex flex-wrap items-center gap-1">
					{#each pathCrumbs as crumb, i (i + crumb)}
						{#if i > 0}
							<span class="text-[10px]" style:color="var(--panel-text-subtle)">›</span>
						{/if}
						<code
							class="rounded px-1.5 py-0.5 font-mono text-[10px]"
							style:background-color="var(--panel-code-bg)"
							style:color="var(--panel-text)"
						>
							{crumb}
						</code>
					{/each}
				</ol>
			</section>
		{/if}

		{#if issue.selector}
			<section class="rounded border p-2" style:border-color="var(--panel-border)">
				<header
					class="flex items-center justify-between text-[9px] font-bold tracking-wide uppercase"
					style:color="var(--panel-text-muted)"
				>
					<span>Selector</span>
					<div class="flex gap-1 normal-case">
						<button
							type="button"
							class="rounded border px-1.5 py-0.5 text-[10px] font-semibold hover:bg-[var(--panel-hover)]"
							style:border-color="var(--panel-border)"
							style:color="var(--panel-text)"
							onclick={copySelector}
						>
							{copied ? 'Copied' : 'Copy'}
						</button>
						<button
							type="button"
							class="rounded border px-1.5 py-0.5 text-[10px] font-semibold hover:bg-[var(--panel-hover)]"
							style:border-color="var(--panel-border)"
							style:color="var(--panel-text)"
							onclick={inspectInElements}
							title="Reveal this element in DevTools Elements"
						>
							Inspect
						</button>
					</div>
				</header>
				<code
					class="mt-1 block overflow-x-auto rounded p-1.5 font-mono text-[10px] leading-snug"
					style:background-color="var(--panel-code-bg)"
					style:color="var(--panel-text)"
				>
					{issue.selector}
				</code>
			</section>
		{/if}

		<section class="rounded border p-2" style:border-color="var(--panel-border)">
			<header
				class="text-[9px] font-bold tracking-wide uppercase"
				style:color="var(--panel-text-muted)"
			>
				Raw evidence
			</header>
			<pre
				class="mt-1 overflow-x-auto rounded p-1.5 text-[10px] leading-snug"
				style:background-color="var(--panel-code-bg)"
				style:color="var(--panel-text)">{JSON.stringify(issue.evidence, null, 2)}</pre>
		</section>
	{/if}
</div>
