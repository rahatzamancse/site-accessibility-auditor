<script lang="ts">
	import type { DiffKind, ReadingOrderDiff } from '../../reading-order/types.ts';

	interface Props {
		diff: ReadingOrderDiff;
		filter: Set<DiffKind>;
		query: string;
		followSelection: boolean;
		showHints: boolean;
		onfilterchange: (next: Set<DiffKind>) => void;
		onquerychange: (next: string) => void;
		onfollowchange: (next: boolean) => void;
	}

	let {
		diff,
		filter,
		query,
		followSelection,
		showHints,
		onfilterchange,
		onquerychange,
		onfollowchange
	}: Props = $props();

	type ChipDef = {
		key: DiffKind;
		label: string;
		glyph: string;
		color: string;
		tier: 'bug' | 'info';
		desc: string;
	};

	const bugChips: ChipDef[] = [
		{ key: 'match', label: 'Match', glyph: '✓', color: 'var(--viz-ok)', tier: 'bug', desc: 'Visual, AX and keyboard orderings agree for this element.' },
		{ key: 'missing-in-ax', label: 'Missing in AX', glyph: '−', color: 'var(--viz-bad)', tier: 'bug', desc: 'Visible/interactive but not exposed to assistive tech (no role + no name).' },
		{ key: 'extra-in-ax', label: 'Extra in AX', glyph: '+', color: 'var(--viz-warn)', tier: 'bug', desc: 'AX tree exposes this element but it has no visual or interactive footprint.' },
		{ key: 'role-mismatch', label: 'Role mismatch', glyph: '≠', color: 'var(--viz-bad)', tier: 'bug', desc: 'Implicit tag role and explicit role= attribute disagree.' },
		{ key: 'name-missing', label: 'Name missing', glyph: '!', color: 'var(--viz-warn)', tier: 'bug', desc: 'AX node has no accessible name. Add aria-label, label-for, alt, or text content.' },
		{ key: 'order-drift', label: 'Order drift', glyph: '⇅', color: 'var(--viz-accent)', tier: 'bug', desc: 'Visual reading order differs from DOM/AX order. Screen readers will hear the page in a different sequence than sighted users see.' },
		{ key: 'tab-break', label: 'Tab break', glyph: '↯', color: 'var(--viz-bad)', tier: 'bug', desc: 'Keyboard tab order disagrees with visual order — WCAG 2.4.3 risk. Keyboard users jump in unexpected directions.' },
		{ key: 'tab-unreachable', label: 'No tab stop', glyph: '⌨', color: 'var(--viz-bad)', tier: 'bug', desc: 'Element looks interactive but cannot be reached by keyboard.' },
		{ key: 'positive-tabindex', label: 'tabindex>0', glyph: '#', color: 'var(--viz-warn)', tier: 'bug', desc: 'tabindex="1+" forces this element out of natural sequence. Almost always an authoring smell.' }
	];

	const infoChips: ChipDef[] = [
		{ key: 'skip-link', label: 'Skip link', glyph: '⏭', color: 'var(--viz-muted)', tier: 'info', desc: 'Anchor href="#…" that is offscreen by default and visible on focus. Intentionally early in the tab order so keyboard users can bypass nav.' },
		{ key: 'sticky-pinned', label: 'Sticky', glyph: '📌', color: 'var(--viz-muted)', tier: 'info', desc: 'position: sticky / fixed. Visually pinned regardless of where it sits in the DOM, so visual rank legitimately differs from DOM rank.' },
		{ key: 'roving-group', label: 'Roving', glyph: '↺', color: 'var(--viz-muted)', tier: 'info', desc: 'Inside role="toolbar | menu | tablist | radiogroup | listbox | tree | grid". Only one item is in the tab sequence at a time; arrow keys move within the group.' },
		{ key: 'modal-context', label: 'Outside modal', glyph: '🪟', color: 'var(--viz-muted)', tier: 'info', desc: 'A modal dialog is open. Focus is trapped inside the dialog, so background tabbables look "unreachable" — that is the correct behavior.' },
		{ key: 'inert-subtree', label: 'Inert', glyph: '⊘', color: 'var(--viz-muted)', tier: 'info', desc: 'Inside an inert ancestor. Excluded from focus and the AX tree by design (e.g. background of a modal, hidden carousel slide).' },
		{ key: 'decorative-hidden', label: 'Decorative', glyph: '✦', color: 'var(--viz-muted)', tier: 'info', desc: 'Small unnamed icon (svg/img/i/span ≤ 32px) inside an interactive parent. Correctly hidden from AX so the parent provides the single accessible name.' }
	];

	function toggle(kind: DiffKind) {
		const next = new Set(filter);
		if (next.has(kind)) next.delete(kind);
		else next.add(kind);
		onfilterchange(next);
	}

	function clearFilter() {
		onfilterchange(new Set());
		onquerychange('');
	}

	const activeCount = $derived(filter.size);

	let hintsExpanded = $state(false);
</script>

<div class="flex flex-col gap-2">
	<div class="flex flex-wrap items-center gap-1.5">
		{#each bugChips as e (e.key)}
			{@const active = filter.has(e.key)}
			{@const count = diff.summary[e.key]}
			<button
				type="button"
				onclick={() => toggle(e.key)}
				disabled={count === 0}
				class="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40"
				style:border-color={active
					? e.color
					: `color-mix(in srgb, ${e.color} 35%, var(--panel-border))`}
				style:background-color={active
					? `color-mix(in srgb, ${e.color} 18%, var(--panel-bg-elevated))`
					: 'var(--panel-bg-elevated)'}
				style:color={active ? e.color : 'var(--panel-text)'}
				aria-pressed={active}
				title="{e.label} ({count}) — {e.desc}"
			>
				<span
					class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold"
					style:background-color={e.color}
					style:color="white"
				>{e.glyph}</span>
				<span class="tracking-wide uppercase">{e.label}</span>
				<span class="tabular-nums" style:color={active ? e.color : 'var(--panel-text-muted)'}>
					{count}
				</span>
			</button>
		{/each}
		{#if showHints}
			<span
				class="mx-1 h-4 w-px"
				style:background-color="var(--panel-border)"
				aria-hidden="true"
			></span>
			<span
				class="text-[9px] font-bold tracking-wide uppercase"
				style:color="var(--panel-text-subtle)"
				title="Recognised intentional patterns — not bugs"
			>
				Hints
			</span>
			{#each infoChips as e (e.key)}
				{@const active = filter.has(e.key)}
				{@const count = diff.summary[e.key]}
				<button
					type="button"
					onclick={() => toggle(e.key)}
					disabled={count === 0}
					class="flex items-center gap-1.5 rounded-full border border-dashed px-2 py-0.5 text-[10px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-40"
					style:border-color={active
						? e.color
						: `color-mix(in srgb, ${e.color} 35%, var(--panel-border))`}
					style:background-color={active
						? `color-mix(in srgb, ${e.color} 18%, var(--panel-bg-elevated))`
						: 'var(--panel-bg-elevated)'}
					style:color={active ? e.color : 'var(--panel-text-muted)'}
					aria-pressed={active}
					title="{e.label} ({count}) — {e.desc}"
				>
					<span class="text-[10px]" aria-hidden="true">{e.glyph}</span>
					<span class="tracking-wide uppercase">{e.label}</span>
					<span class="tabular-nums" style:color={active ? e.color : 'var(--panel-text-subtle)'}>
						{count}
					</span>
				</button>
			{/each}
			<button
				type="button"
				onclick={() => (hintsExpanded = !hintsExpanded)}
				class="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-bold leading-none transition-colors hover:bg-[var(--panel-hover)]"
				style:border-color="var(--panel-border)"
				style:color="var(--panel-text-muted)"
				aria-expanded={hintsExpanded}
				aria-controls="hints-explainer"
				title="What do these hints mean?"
			>?</button>
		{/if}
		<div class="ml-auto flex items-center gap-1.5">
			{#if activeCount > 0 || query.length > 0}
				<button
					type="button"
					onclick={clearFilter}
					class="rounded px-2 py-0.5 text-[10px] text-[var(--panel-text-muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--panel-text)]"
				>
					Clear
				</button>
			{/if}
			<button
				type="button"
				onclick={() => onfollowchange(!followSelection)}
				class="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all"
				style:border-color={followSelection ? 'var(--panel-primary)' : 'var(--panel-border)'}
				style:background-color={followSelection
					? 'color-mix(in srgb, var(--panel-primary) 18%, var(--panel-bg-elevated))'
					: 'var(--panel-bg-elevated)'}
				style:color={followSelection ? 'var(--panel-primary)' : 'var(--panel-text-muted)'}
				aria-pressed={followSelection}
				title="When on, selecting a node pans and zooms all views to it"
			>
				<span
					class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px]"
					style:background-color={followSelection ? 'var(--panel-primary)' : 'var(--panel-border)'}
					style:color="white"
				>◎</span>
				<span class="tracking-wide uppercase">Follow selection</span>
			</button>
		</div>
	</div>

	{#if showHints && hintsExpanded}
		<div
			id="hints-explainer"
			class="rounded-md border px-3 py-2 text-[10px] leading-snug"
			style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
		>
			<div class="mb-1.5 flex items-center justify-between">
				<span
					class="font-bold tracking-wide uppercase"
					style:color="var(--panel-text)"
				>
					Hints — recognised intentional patterns
				</span>
				<span style:color="var(--panel-text-subtle)">
					Each hint is a layout pattern that looks like drift but is actually correct. Click a chip to filter to those entries.
				</span>
			</div>
			<dl class="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
				{#each infoChips as e (e.key)}
					<dt class="flex items-center gap-1.5" style:color="var(--panel-text)">
						<span aria-hidden="true">{e.glyph}</span>
						<span class="font-semibold tracking-wide uppercase">{e.label}</span>
					</dt>
					<dd style:color="var(--panel-text-muted)">{e.desc}</dd>
				{/each}
			</dl>
			<div
				class="mt-2 border-t pt-1.5 text-[9px]"
				style="border-color: var(--panel-border); color: var(--panel-text-subtle);"
			>
				Hints downgrade what would otherwise be a bug-tier finding into an informational note. They are excluded from the four mismatch counters in the order-drift ribbon. Toggle the <strong>Hints</strong> button in the toolbar to hide them entirely.
			</div>
		</div>
	{/if}

	<div class="relative">
		<input
			type="search"
			placeholder="Search role, name, tag, path…"
			value={query}
			oninput={(e) => onquerychange((e.currentTarget as HTMLInputElement).value)}
			class="w-full rounded-md border px-2.5 py-1 text-[11px] outline-none transition-colors focus:border-[var(--panel-primary)]"
			style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated); color: var(--panel-text);"
		/>
	</div>
</div>
