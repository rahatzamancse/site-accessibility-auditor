<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		scanReadingOrder,
		setOverlayMode,
		updateAnnotationColor,
		clearReadingOrder,
		highlightEntry,
		hoverEntry,
		pollHoveredKey,
		checkRecalcRequested
	} from '../lib/reading-order/extractor.ts';
	import { diffReadingOrder } from '../lib/reading-order/differ.ts';
	import { buildTree } from '../lib/reading-order/tree-builder.ts';
	import type {
		DiffKind,
		DiffPair,
		OverlayMode,
		ReadingOrderResult
	} from '../lib/reading-order/types.ts';
	import PanelShell from '../lib/components/ui/panel-shell.svelte';
	import ToolbarButton from '../lib/components/ui/toolbar-button.svelte';
	import EmptyState from '../lib/components/ui/empty-state.svelte';
	import LoadingSkeleton from '../lib/components/ui/loading-skeleton.svelte';
	import SplitPane3 from '../lib/components/ui/split-pane-3.svelte';
	import ReadingFilterBar from '../lib/components/reading-order/reading-filter-bar.svelte';
	import ReadingTree from '../lib/components/reading-order/reading-tree.svelte';
	import ReadingWireframe from '../lib/components/reading-order/reading-wireframe.svelte';
	import ReadingInspector from '../lib/components/reading-order/reading-inspector.svelte';
	import OrderDriftRibbon from '../lib/components/reading-order/order-drift-ribbon.svelte';

	let scanning = $state(false);
	let error = $state<string | null>(null);
	let result = $state<ReadingOrderResult | null>(null);
	let selectedKey = $state<string | null>(null);
	let hoveredKey = $state<string | null>(null);
	let filter = $state<Set<DiffKind>>(new Set());
	let query = $state('');
	let followSelection = $state(true);
	let fitVersion = $state(0);
	let overlayMode = $state<OverlayMode>('tab');
	let showTabPath = $state(true);
	let showHints = $state(true);
	let ribbonCollapsed = $state(false);
	let annotationColor = $state('#2563eb');
	let recalcTimer: ReturnType<typeof setInterval> | null = null;
	let hoverTimer: ReturnType<typeof setInterval> | null = null;
	let panelIsHovering = false;

	const diff = $derived(result ? diffReadingOrder(result.entries) : null);
	const built = $derived(diff ? buildTree(diff) : null);
	const selectedPair = $derived(
		selectedKey && diff ? diff.pairsByKey.get(selectedKey) ?? null : null
	);

	function bumpFit() {
		fitVersion += 1;
	}

	function startPolling() {
		stopPolling();
		recalcTimer = setInterval(async () => {
			if (scanning || overlayMode === 'none') return;
			try {
				const requested = await checkRecalcRequested();
				if (requested) await handleScan();
			} catch {
				stopPolling();
			}
		}, 500);
		hoverTimer = setInterval(async () => {
			if (scanning || panelIsHovering || overlayMode === 'none') return;
			try {
				const key = await pollHoveredKey();
				hoveredKey = key;
			} catch {
				// ignore
			}
		}, 120);
	}

	function stopPolling() {
		if (recalcTimer !== null) {
			clearInterval(recalcTimer);
			recalcTimer = null;
		}
		if (hoverTimer !== null) {
			clearInterval(hoverTimer);
			hoverTimer = null;
		}
	}

	onDestroy(stopPolling);

	async function handleScan() {
		scanning = true;
		error = null;
		try {
			const next = await scanReadingOrder();
			if (next.entries.length === 0) {
				error = 'No reading-order entries detected.';
				result = null;
				stopPolling();
			} else {
				result = next;
				bumpFit();
				await setOverlayMode(overlayMode, annotationColor, next.entries);
				if (overlayMode !== 'none') startPolling();
				else stopPolling();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Reading order scan failed';
			result = null;
			stopPolling();
		} finally {
			scanning = false;
		}
	}

	async function handleClear() {
		stopPolling();
		await clearReadingOrder();
		result = null;
		selectedKey = null;
		hoveredKey = null;
		error = null;
		filter = new Set();
		query = '';
	}

	async function handleSelect(pair: DiffPair, key: string) {
		selectedKey = selectedKey === key ? null : key;
		await highlightEntry(selectedKey);
	}

	async function handleSelectByKey(key: string) {
		const pair = diff?.pairsByKey.get(key);
		if (!pair) return;
		await handleSelect(pair, key);
	}

	async function handleHover(key: string | null) {
		panelIsHovering = key !== null;
		hoveredKey = key;
		if (overlayMode !== 'none' || key !== null) await hoverEntry(key);
	}

	function handleFilterChange(next: Set<DiffKind>) {
		filter = next;
		bumpFit();
	}

	function handleQueryChange(next: string) {
		query = next;
		bumpFit();
	}

	async function handleOverlayModeChange(mode: OverlayMode) {
		overlayMode = mode;
		if (result) {
			await setOverlayMode(mode, annotationColor, result.entries);
			if (mode === 'none') stopPolling();
			else startPolling();
		}
	}

	async function handleColorChange(e: Event) {
		const input = e.target as HTMLInputElement;
		annotationColor = input.value;
		if (result && overlayMode !== 'none') {
			await updateAnnotationColor(annotationColor, overlayMode, result.entries);
		}
	}

	const overlayModes: { id: OverlayMode; label: string; title: string }[] = [
		{ id: 'none', label: 'None', title: 'No overlay — keep only hover/select highlight on the page.' },
		{ id: 'tab', label: 'Tab', title: 'Show keyboard tab sequence with numbered badges and connectors.' },
		{ id: 'ax', label: 'Screen-reader', title: 'Show accessibility-tree reading order (AX index).' },
		{ id: 'visual', label: 'Visual', title: 'Show row-major visual reading order.' }
	];
</script>

<PanelShell title="Reading & Focus Order" subtitle="DOM · Visual · AX · Tab">
	{#snippet toolbar()}
		{#if result}
			<div
				class="flex items-center rounded-md border p-0.5 text-[11px]"
				style="border-color: var(--panel-border);"
				role="group"
				aria-label="Overlay mode"
			>
				{#each overlayModes as mode (mode.id)}
					<button
						onclick={() => handleOverlayModeChange(mode.id)}
						title={mode.title}
						class="rounded-md px-2 py-0.5 transition-colors"
						style:background-color={overlayMode === mode.id
							? 'var(--panel-filter-active-bg)'
							: 'transparent'}
						style:color={overlayMode === mode.id
							? 'var(--panel-filter-active-text)'
							: 'var(--panel-text-muted)'}
						aria-pressed={overlayMode === mode.id}
					>
						{mode.label}
					</button>
				{/each}
			</div>
			<button
				type="button"
				onclick={() => (showTabPath = !showTabPath)}
				class="rounded-md border px-2 py-0.5 text-[11px] transition-colors"
				style:border-color={showTabPath ? 'var(--panel-primary)' : 'var(--panel-border)'}
				style:background-color={showTabPath
					? 'color-mix(in srgb, var(--panel-primary) 14%, var(--panel-bg-elevated))'
					: 'var(--panel-bg-elevated)'}
				style:color={showTabPath ? 'var(--panel-primary)' : 'var(--panel-text-muted)'}
				aria-pressed={showTabPath}
				title="Toggle tab-path overlay inside the tree and wireframe"
			>
				Tab path
			</button>
			<button
				type="button"
				onclick={() => (showHints = !showHints)}
				class="rounded-md border px-2 py-0.5 text-[11px] transition-colors"
				style:border-color={showHints ? 'var(--panel-primary)' : 'var(--panel-border)'}
				style:background-color={showHints
					? 'color-mix(in srgb, var(--panel-primary) 14%, var(--panel-bg-elevated))'
					: 'var(--panel-bg-elevated)'}
				style:color={showHints ? 'var(--panel-primary)' : 'var(--panel-text-muted)'}
				aria-pressed={showHints}
				title="Show recognised intentional patterns (skip links, sticky elements, roving tabindex, modals, inert, decorative icons) as info chips"
			>
				Hints
			</button>
		{/if}
		<label
			class="flex items-center gap-1.5 text-xs"
			style:color={overlayMode === 'none' && result ? 'var(--panel-text-subtle)' : 'var(--panel-text-muted)'}
		>
			<input
				type="color"
				value={annotationColor}
				oninput={handleColorChange}
				disabled={!result || overlayMode === 'none'}
				class="h-6 w-6 cursor-pointer rounded border border-[var(--panel-border)] bg-transparent p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
			/>
			Color
		</label>
		{#if result}
			<ToolbarButton onclick={handleClear}>Clear</ToolbarButton>
		{/if}
		<ToolbarButton variant="primary" onclick={handleScan} disabled={scanning} loading={scanning}>
			{scanning ? 'Scanning…' : 'Scan'}
		</ToolbarButton>
	{/snippet}

	<div class="flex h-full min-h-0 flex-col gap-2 px-3 py-3">
		{#if error}
			<div
				class="shrink-0 rounded-md border px-3 py-2 text-[11px]"
				style="border-color: var(--panel-error-border); background-color: var(--panel-error-bg); color: var(--panel-error-text);"
			>
				{error}
			</div>
		{/if}

		{#if scanning}
			<LoadingSkeleton rows={5} label="Walking DOM for reading, AX, and tab orders…" />
		{:else if result && diff && built}
			<div class="shrink-0">
				<ReadingFilterBar
					{diff}
					{filter}
					{query}
					{followSelection}
					{showHints}
					onfilterchange={handleFilterChange}
					onquerychange={handleQueryChange}
					onfollowchange={(next) => (followSelection = next)}
				/>
			</div>
			<div class="min-h-0 flex-1">
				<SplitPane3 initialRatios={[0.38, 0.36, 0.26]}>
					{#snippet left()}
						<ReadingTree
							forest={built.forest}
							{filter}
							{query}
							{selectedKey}
							{followSelection}
							{fitVersion}
							{showTabPath}
							onselect={handleSelect}
						/>
					{/snippet}
					{#snippet middle()}
						<ReadingWireframe
							forest={built.forest}
							{filter}
							{query}
							{selectedKey}
							{followSelection}
							{fitVersion}
							{showTabPath}
							onselect={handleSelect}
						/>
					{/snippet}
					{#snippet right()}
						<ReadingInspector pair={selectedPair} viewport={result?.viewport ?? null} />
					{/snippet}
				</SplitPane3>
			</div>
			<div
				class="shrink-0 rounded-md border"
				style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
			>
				<button
					type="button"
					class="flex w-full items-center justify-between px-2 py-1 text-left text-[10px] font-bold tracking-wide uppercase"
					style:color="var(--panel-text-muted)"
					onclick={() => (ribbonCollapsed = !ribbonCollapsed)}
					aria-expanded={!ribbonCollapsed}
				>
					<span>Order drift ribbon</span>
					<span class="text-[10px]">{ribbonCollapsed ? '▸' : '▾'}</span>
				</button>
				{#if !ribbonCollapsed}
					<OrderDriftRibbon
						{diff}
						{selectedKey}
						{hoveredKey}
						onselect={handleSelectByKey}
						onhover={handleHover}
					/>
				{/if}
			</div>
		{:else if !error}
			<EmptyState
				title="Reading & Focus Order"
				description="A single walk reconstructs four orderings at once — DOM, visual reading order, accessibility tree, and keyboard tab order — and highlights where they disagree."
				action="Click <strong>Scan</strong> to analyse the current page."
			>
				<div class="mt-5 grid w-full max-w-md grid-cols-2 gap-2 text-left text-[11px]">
					<div
						class="rounded-md border p-2"
						style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
					>
						<div class="text-[9px] font-bold tracking-wide text-[var(--viz-bad)] uppercase">
							Missing in AX
						</div>
						<p class="mt-1 text-[var(--panel-text-muted)]">
							Visible elements a screen reader will skip.
						</p>
					</div>
					<div
						class="rounded-md border p-2"
						style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
					>
						<div class="text-[9px] font-bold tracking-wide text-[var(--viz-bad)] uppercase">
							Tab break
						</div>
						<p class="mt-1 text-[var(--panel-text-muted)]">
							Keyboard sequence disagrees with visual order.
						</p>
					</div>
					<div
						class="rounded-md border p-2"
						style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
					>
						<div class="text-[9px] font-bold tracking-wide text-[var(--viz-bad)] uppercase">
							No tab stop
						</div>
						<p class="mt-1 text-[var(--panel-text-muted)]">
							Interactive elements unreachable via keyboard.
						</p>
					</div>
					<div
						class="rounded-md border p-2"
						style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
					>
						<div class="text-[9px] font-bold tracking-wide text-[var(--viz-accent)] uppercase">
							Order drift
						</div>
						<p class="mt-1 text-[var(--panel-text-muted)]">
							Visual order differs from DOM or AX order.
						</p>
					</div>
				</div>
			</EmptyState>
		{/if}
	</div>
</PanelShell>
