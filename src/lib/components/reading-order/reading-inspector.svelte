<script lang="ts">
	import type { DiffPair, ViewportInfo } from '../../reading-order/types.ts';
	import { kindColor, kindLabel } from '../../reading-order/hierarchy-adapter.ts';

	interface Props {
		pair: DiffPair | null;
		viewport: ViewportInfo | null;
	}

	let { pair, viewport }: Props = $props();

	const entry = $derived(pair?.entry ?? null);
	const ax = $derived(entry?.ax ?? null);
	const visual = $derived(entry?.visual ?? null);
	const tab = $derived(entry?.tab ?? null);
	const rect = $derived(entry?.rect ?? null);
	const ariaEntries = $derived(ax ? Object.entries(ax.ariaProps) : []);

	const frame = $derived.by(() => {
		if (!viewport || !rect) return null;
		const vpW = Math.max(viewport.width, 1);
		const vpH = Math.max(viewport.height, 1);
		const padX = vpW * 0.04;
		const padY = vpH * 0.04;
		const minX = Math.min(0, rect.x) - padX;
		const minY = Math.min(0, rect.y) - padY;
		const maxX = Math.max(vpW, rect.x + rect.width) + padX;
		const maxY = Math.max(vpH, rect.y + rect.height) + padY;
		return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY), vpW, vpH };
	});

	const rectOutOfViewport = $derived.by(() => {
		if (!rect || !viewport) return false;
		return (
			rect.x < 0 ||
			rect.y < 0 ||
			rect.x + rect.width > viewport.width ||
			rect.y + rect.height > viewport.height
		);
	});

	const description = $derived.by(() => {
		if (!pair) return '';
		switch (pair.kind) {
			case 'match': return 'Visual, AX and keyboard representations agree.';
			case 'missing-in-ax': return 'This element is visible but not exposed to assistive tech.';
			case 'extra-in-ax': return 'Exposed to AX but has no visual/interactive footprint.';
			case 'role-mismatch': return 'Implicit and explicit roles disagree.';
			case 'name-missing': return 'Element needs an accessible name.';
			case 'order-drift': return 'Visual reading order differs from the DOM/AX order.';
			case 'tab-break': return 'Keyboard tab order disagrees with the visual reading order.';
			case 'tab-unreachable': return 'Element looks interactive but cannot be reached by keyboard.';
			case 'positive-tabindex': return 'Positive tabindex forces this element out of natural sequence.';
			case 'skip-link': return 'Skip link — intentionally early in tab order, off-screen until focused.';
			case 'sticky-pinned': return 'Pinned by position: sticky/fixed — visual rank diverges from DOM by design.';
			case 'roving-group': return 'Inside a roving-tabindex widget — only the active item is in the tab sequence.';
			case 'modal-context': return 'Outside the active modal — focus is restricted to the dialog subtree.';
			case 'inert-subtree': return 'Inside an inert subtree — excluded from focus and drift analysis.';
			case 'decorative-hidden': return 'Decorative icon inside an interactive parent — correctly hidden from AX.';
		}
	});

	const layout = $derived(entry?.layout ?? null);
	const layoutNotes = $derived.by(() => {
		if (!layout) return [] as string[];
		const notes: string[] = [];
		if (layout.position === 'sticky' || layout.position === 'fixed') {
			notes.push(`position: ${layout.position} — visually pinned regardless of DOM position.`);
		}
		if (layout.offscreen) {
			notes.push('Visually offscreen (sr-only / clipped). Common for skip links.');
		}
		if (layout.inertAncestor) {
			notes.push('Ancestor has inert — excluded from focus and AX.');
		}
		if (layout.ariaHiddenSelf) {
			notes.push('aria-hidden=true on self or ancestor — invisible to assistive tech.');
		}
		if (layout.dialogContext === 'modal') {
			notes.push('Inside the active modal dialog (focus trap).');
		} else if (layout.dialogContext === 'open') {
			notes.push('Inside an open non-modal dialog.');
		}
		if (layout.rovingGroupRole) {
			notes.push(`Inside role="${layout.rovingGroupRole}" — roving tabindex pattern.`);
		}
		if (layout.multiColumnAncestor) {
			notes.push('Inside a multi-column container — visual order is column-major.');
		}
		if (layout.skipLinkCandidate) {
			notes.push('Looks like a skip link (anchor href="#…", offscreen).');
		}
		if (layout.decorativeCandidate) {
			notes.push('Small icon inside an interactive parent — likely decorative.');
		}
		return notes;
	});

	/**
	 * DOM index is the baseline for the ordering table; the other orders show
	 * their absolute index and delta from DOM so drifts are spotted at a glance.
	 */
	const orderingRows = $derived.by(() => {
		if (!pair) return [] as { label: string; value: number | null; delta: number | null; drift: boolean }[];
		const rows: { label: string; value: number | null; delta: number | null; drift: boolean }[] = [];
		rows.push({ label: 'DOM', value: pair.domIndex, delta: 0, drift: false });
		rows.push({
			label: 'Visual',
			value: pair.visualIndex,
			delta: pair.visualIndex !== null ? pair.visualIndex - pair.domIndex : null,
			drift: pair.visualIndex !== null && pair.visualIndex !== pair.domIndex
		});
		rows.push({
			label: 'AX',
			value: pair.axIndex,
			delta: pair.axIndex !== null ? pair.axIndex - pair.domIndex : null,
			drift: pair.axIndex !== null && pair.axIndex !== pair.domIndex
		});
		rows.push({
			label: 'Tab',
			value: pair.tabIndex,
			delta: pair.tabIndex !== null ? pair.tabIndex - pair.domIndex : null,
			drift: pair.tabIndex !== null && pair.tabIndex !== pair.domIndex
		});
		return rows;
	});
</script>

<div
	class="flex h-full min-h-0 flex-col overflow-hidden rounded-md border"
	style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
>
	<div
		class="flex shrink-0 items-center justify-between border-b px-2 py-1.5 text-[9px] font-bold tracking-wide uppercase"
		style="border-color: var(--panel-border); color: var(--panel-text-muted);"
	>
		<span>Inspector</span>
		{#if pair}
			<span
				class="rounded-full px-1.5 py-0.5 text-[9px] tracking-wide uppercase"
				style:background-color={`color-mix(in srgb, ${kindColor(pair.kind)} 16%, transparent)`}
				style:color={kindColor(pair.kind)}
			>
				{kindLabel(pair.kind)}
			</span>
		{/if}
	</div>

	<div class="flex-1 overflow-y-auto p-3 text-[11px]">
		{#if !pair || !entry}
			<div class="flex h-full flex-col items-center justify-center text-center">
				<p class="text-[var(--panel-text-subtle)]">
					Select a node to inspect its accessibility, visual, and keyboard properties.
				</p>
			</div>
		{:else}
			<p class="mb-3 text-[var(--panel-text-muted)]">{description}</p>

			<section class="mb-3">
				<h3 class="mb-1 text-[9px] font-bold tracking-wide text-[var(--panel-text-muted)] uppercase">
					Identity
				</h3>
				<dl class="grid grid-cols-[80px_1fr] gap-y-1 gap-x-2">
					<dt class="text-[var(--panel-text-subtle)]">Role</dt>
					<dd class="text-[var(--panel-text)]">
						{#if ax}
							<span
								class="rounded px-1 text-[9px] font-bold tracking-wide uppercase"
								style="background-color: color-mix(in srgb, var(--viz-accent) 14%, transparent); color: var(--viz-accent);"
							>{ax.role}</span>
						{:else}
							<span class="italic text-[var(--panel-text-subtle)]">—</span>
						{/if}
						{#if visual?.explicitRole && visual.explicitRole !== ax?.role}
							<span class="ml-1 text-[var(--panel-text-muted)]">visual: {visual.explicitRole}</span>
						{/if}
					</dd>
					<dt class="text-[var(--panel-text-subtle)]">Tag</dt>
					<dd class="text-[var(--panel-text)]">
						<code
							class="rounded px-1 text-[9px]"
							style="background-color: var(--panel-code-bg);"
						>&lt;{entry.tag}&gt;</code>
					</dd>
					<dt class="text-[var(--panel-text-subtle)]">Name</dt>
					<dd class="text-[var(--panel-text)]">
						{#if ax?.name}
							{ax.name}
						{:else if visual?.text}
							<span class="text-[var(--panel-text-muted)]">{visual.text}</span>
							<span class="ml-1 text-[9px] text-[var(--panel-text-subtle)]">(visual text)</span>
						{:else}
							<span class="italic text-[var(--panel-text-subtle)]">(no accessible name)</span>
						{/if}
					</dd>
				</dl>
			</section>

			{#if layoutNotes.length > 0}
				<section class="mb-3">
					<h3 class="mb-1 text-[9px] font-bold tracking-wide text-[var(--panel-text-muted)] uppercase">
						Layout context
					</h3>
					<ul
						class="space-y-0.5 rounded-md border px-2 py-1.5 text-[10px]"
						style="border-color: var(--panel-border); background-color: var(--panel-bg);"
					>
						{#each layoutNotes as note (note)}
							<li
								class="flex gap-1.5 leading-snug"
								style:color="var(--panel-text-muted)"
							>
								<span aria-hidden="true" style:color="var(--viz-muted)">·</span>
								<span>{note}</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			<section class="mb-3">
				<h3 class="mb-1 text-[9px] font-bold tracking-wide text-[var(--panel-text-muted)] uppercase">
					Keyboard
				</h3>
				<dl class="grid grid-cols-[80px_1fr] gap-y-1 gap-x-2">
					<dt class="text-[var(--panel-text-subtle)]">Focusable</dt>
					<dd class="text-[var(--panel-text)]">
						{#if tab}
							<span
								class="rounded px-1 text-[9px] font-bold tracking-wide uppercase"
								style:background-color={`color-mix(in srgb, var(--viz-accent) 16%, transparent)`}
								style:color="var(--viz-accent)"
							>{tab.focusable}</span>
						{:else}
							<span class="italic text-[var(--panel-text-subtle)]">none</span>
						{/if}
					</dd>
					<dt class="text-[var(--panel-text-subtle)]">tabindex</dt>
					<dd class="text-[var(--panel-text)] tabular-nums">
						{#if tab?.tabindex !== null && tab?.tabindex !== undefined}
							<span
								class:text-[var(--viz-warn)]={tab.tabindex > 0}
							>{tab.tabindex}</span>
						{:else}
							<span class="italic text-[var(--panel-text-subtle)]">(default)</span>
						{/if}
					</dd>
				</dl>
			</section>

			<section class="mb-3">
				<h3 class="mb-1 text-[9px] font-bold tracking-wide text-[var(--panel-text-muted)] uppercase">
					Ordering
				</h3>
				<table class="w-full text-[10px]">
					<thead>
						<tr class="text-left" style="color: var(--panel-text-subtle);">
							<th class="pr-2 pb-0.5 font-medium">Order</th>
							<th class="pr-2 pb-0.5 font-medium tabular-nums">Index</th>
							<th class="pb-0.5 font-medium tabular-nums">Δ DOM</th>
						</tr>
					</thead>
					<tbody>
						{#each orderingRows as row (row.label)}
							<tr class="border-t" style="border-color: var(--panel-border);">
								<td class="py-0.5 pr-2 text-[var(--panel-text-muted)]">
									{#if row.drift}
										<span
											class="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle"
											style:background-color={kindColor('order-drift')}
										></span>
									{/if}
									{row.label}
								</td>
								<td class="py-0.5 pr-2 text-[var(--panel-text)] tabular-nums">
									{row.value !== null ? row.value : '—'}
								</td>
								<td class="py-0.5 text-[var(--panel-text-muted)] tabular-nums">
									{#if row.delta === null}
										—
									{:else if row.delta === 0}
										0
									{:else}
										<span style:color={kindColor('order-drift')}
											>{row.delta > 0 ? `+${row.delta}` : row.delta}</span
										>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</section>

			<section class="mb-3">
				<h3 class="mb-1 text-[9px] font-bold tracking-wide text-[var(--panel-text-muted)] uppercase">
					DOM path
				</h3>
				<code
					class="block overflow-x-auto rounded px-2 py-1 font-mono text-[10px] whitespace-nowrap"
					style="background-color: var(--panel-code-bg); color: var(--panel-text);"
				>{entry.path || '(body)'}</code>
			</section>

			{#if ariaEntries.length > 0}
				<section class="mb-3">
					<h3
						class="mb-1 text-[9px] font-bold tracking-wide text-[var(--panel-text-muted)] uppercase"
					>
						ARIA attributes
					</h3>
					<table class="w-full border-collapse text-[10px]">
						<tbody>
							{#each ariaEntries as [name, value] (name)}
								<tr class="border-b" style="border-color: var(--panel-border);">
									<td
										class="py-0.5 pr-2 font-mono text-[var(--viz-accent)]"
										style="vertical-align: top;"
									>{name}</td>
									<td class="py-0.5 break-all text-[var(--panel-text)]">{value}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
			{/if}

			{#if rect && frame}
				<section class="mb-1">
					<h3
						class="mb-1 text-[9px] font-bold tracking-wide text-[var(--panel-text-muted)] uppercase"
					>
						Position on page
					</h3>
					<div class="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-[var(--panel-text-muted)]">
						<span>x: {Math.round(rect.x)}</span>
						<span>y: {Math.round(rect.y)}</span>
						<span>{Math.round(rect.width)}×{Math.round(rect.height)}</span>
						{#if viewport}
							<span class="text-[var(--panel-text-subtle)]">
								viewport {viewport.width}×{viewport.height}
							</span>
						{/if}
					</div>
					{#if rectOutOfViewport}
						<div
							class="mb-1.5 rounded px-1.5 py-0.5 text-[10px]"
							style="background-color: color-mix(in srgb, var(--viz-warn) 14%, transparent); color: var(--viz-warn);"
						>
							Element extends outside the viewport fold.
						</div>
					{/if}
					<svg
						role="img"
						aria-label="Viewport wireframe showing node position"
						viewBox="{frame.x} {frame.y} {frame.w} {frame.h}"
						preserveAspectRatio="xMidYMid meet"
						class="block w-full rounded border"
						style="border-color: var(--panel-border); background-color: var(--panel-bg); aspect-ratio: {frame.w} / {frame.h}; max-height: 220px;"
					>
						<rect
							x={0}
							y={0}
							width={frame.vpW}
							height={frame.vpH}
							fill="color-mix(in srgb, var(--panel-text-muted) 6%, transparent)"
							stroke="var(--viz-axis)"
							stroke-width={Math.max(frame.w, frame.h) / 400}
							stroke-dasharray={`${Math.max(frame.w, frame.h) / 120} ${Math.max(frame.w, frame.h) / 200}`}
						/>
						<rect
							x={rect.x}
							y={rect.y}
							width={Math.max(rect.width, Math.max(frame.w, frame.h) / 200)}
							height={Math.max(rect.height, Math.max(frame.w, frame.h) / 200)}
							fill={`color-mix(in srgb, ${kindColor(pair.kind)} 38%, transparent)`}
							stroke={kindColor(pair.kind)}
							stroke-width={Math.max(frame.w, frame.h) / 300}
						/>
					</svg>
				</section>
			{/if}
		{/if}
	</div>
</div>
