<script lang="ts">
	import { onMount } from 'svelte';
	import { getApiKey } from '../lib/shared/openai-key.ts';
	import {
		scanCharts,
		analyzeAll,
		analyzeChart,
		cancelScan,
		type AnalyzeAllProgress
	} from '../lib/data-viz/chart-pipeline.ts';
	import { highlightChart } from '../lib/data-viz/chart-extractor.ts';
	import { ensurePageAccess } from '../lib/shared/page-access.ts';
	import type { ChartScanResult, DetectedChart } from '../lib/data-viz/types.ts';
	import ChartList from '../lib/components/data-viz/chart-list.svelte';
	import PanelShell from '../lib/components/ui/panel-shell.svelte';
	import ToolbarButton from '../lib/components/ui/toolbar-button.svelte';
	import EmptyState from '../lib/components/ui/empty-state.svelte';
	import LoadingSkeleton from '../lib/components/ui/loading-skeleton.svelte';
	import ApiKeyForm from '../lib/components/shared/api-key-form.svelte';
	import SettingsView from '../lib/components/shared/settings-view.svelte';

	type View = 'loading' | 'key-form' | 'main' | 'settings';

	let view = $state<View>('loading');
	let scanning = $state(false);
	let error = $state<string | null>(null);
	let result = $state<ChartScanResult | null>(null);
	let selectedId = $state<number | null>(null);
	let apiKey = $state<string | null>(null);
	let analyzingAll = $state(false);
	let progress = $state<{ completed: number; total: number }>({ completed: 0, total: 0 });

	onMount(async () => {
		const key = await getApiKey();
		apiKey = key;
		view = key ? 'main' : 'key-form';
	});

	async function handleScan() {
		scanning = true;
		error = null;
		selectedId = null;
		try {
			const scan = await scanCharts();
			if (scan.charts.length === 0) {
				error = 'No data visualization charts detected on the page.';
				result = null;
			} else {
				result = scan;
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Chart scan failed';
			result = null;
		} finally {
			scanning = false;
		}
	}

	async function handleAnalyzeAll() {
		if (!result || !apiKey) return;
		analyzingAll = true;
		error = null;
		progress = { completed: 0, total: result.charts.length };
		try {
			// Screenshot fallback for chart capture needs the optional host
			// permission; SVG/IMG captures still work if the user declines.
			await ensurePageAccess();
			await analyzeAll(apiKey, result.charts, (p: AnalyzeAllProgress) => {
				progress = { completed: p.completed, total: p.total };
				result = { ...result! };
			});
		} catch (e) {
			error = e instanceof Error ? e.message : 'Analysis failed';
		} finally {
			analyzingAll = false;
			result = result ? { ...result } : null;
		}
	}

	async function handleAnalyzeOne(id: number) {
		if (!result || !apiKey) return;
		const chart = result.charts.find((c) => c.id === id);
		if (!chart) return;
		error = null;
		await ensurePageAccess();
		await analyzeChart(apiKey, chart);
		result = { ...result };
	}

	async function handleSelect(id: number) {
		selectedId = selectedId === id ? null : id;
		await highlightChart(selectedId);
	}

	async function handleClear() {
		await cancelScan();
		result = null;
		selectedId = null;
		error = null;
	}

	const unanalyzedCount = $derived(
		result ? result.charts.filter((c: DetectedChart) => c.analysisState !== 'done').length : 0
	);
</script>

{#if view === 'loading'}
	<div class="flex h-full items-center justify-center text-xs text-[var(--panel-text-muted)]">
		Loading…
	</div>
{:else if view === 'key-form'}
	<ApiKeyForm
		title="OpenAI API Key Required"
		description="The Data Visualizations panel uses GPT-5.2-pro vision to audit every chart on the page. Your key is stored locally in the extension and never sent elsewhere."
		onsaved={async () => {
			apiKey = await getApiKey();
			view = 'main';
		}}
	/>
{:else if view === 'settings'}
	<SettingsView
		description="Used by the Color Audit and Data Visualization panels to analyze pages with GPT-5.2-pro."
		onback={() => (view = 'main')}
		oncleared={() => {
			apiKey = null;
			result = null;
			view = 'key-form';
		}}
	/>
{:else}
	<PanelShell title="Data Visualizations" subtitle="vision-first audit">
		{#snippet toolbar()}
			{#if result && unanalyzedCount > 0}
				<ToolbarButton
					variant="primary"
					onclick={handleAnalyzeAll}
					disabled={analyzingAll}
					loading={analyzingAll}
				>
					{analyzingAll
						? `Analyzing ${progress.completed}/${progress.total}…`
						: `Analyze all (${unanalyzedCount})`}
				</ToolbarButton>
			{/if}
			{#if result}
				<ToolbarButton onclick={handleClear}>Clear</ToolbarButton>
			{/if}
			<ToolbarButton variant="primary" onclick={handleScan} disabled={scanning} loading={scanning}>
				{scanning ? 'Scanning…' : 'Scan Page'}
			</ToolbarButton>
			<ToolbarButton onclick={() => (view = 'settings')}>Settings</ToolbarButton>
		{/snippet}

		{#if error}
			<div
				class="m-3 rounded-lg border px-4 py-3 text-xs"
				style="border-color: var(--panel-error-border); background-color: var(--panel-error-bg); color: var(--panel-error-text);"
			>
				{error}
			</div>
		{/if}

		{#if analyzingAll && progress.total > 0}
			<div class="border-b px-3 py-2" style="border-color: var(--panel-border);">
				<div
					class="h-1.5 overflow-hidden rounded-full"
					style="background-color: var(--panel-hover);"
				>
					<div
						class="h-full transition-all"
						style="width: {(progress.completed / Math.max(1, progress.total)) *
							100}%; background-color: var(--panel-primary);"
					></div>
				</div>
				<div class="mt-1 text-[10px] text-[var(--panel-text-muted)]">
					Vision analysis: {progress.completed} / {progress.total}
				</div>
			</div>
		{/if}

		{#if scanning}
			<LoadingSkeleton
				rows={3}
				label="Scanning for charts across SVG, canvas, image, iframes, and shadow DOM…"
			/>
		{:else if result}
			<ChartList
				charts={result.charts}
				{selectedId}
				onselect={handleSelect}
				onanalyze={handleAnalyzeOne}
			/>
		{:else if !error}
			<EmptyState
				title="Vision-first chart audit"
				description="Detects every chart on the page, captures a crop, and uses GPT-5.2-pro vision to extract data, narrate L1–L4 summaries, verify existing descriptions, and list WCAG issues."
				action="Click <strong>Scan Page</strong> to detect charts, then <strong>Analyze all</strong>."
			>
				<div class="mt-5 grid w-full max-w-md grid-cols-2 gap-2 text-left text-[11px]">
					<div
						class="rounded-lg border p-2"
						style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
					>
						<div class="text-[9px] font-bold tracking-wide text-[var(--viz-info)] uppercase">
							Any chart kind
						</div>
						<p class="mt-1 text-[var(--panel-text-muted)]">
							SVG, canvas, image, figure, or container — across shadow DOM and iframes.
						</p>
					</div>
					<div
						class="rounded-lg border p-2"
						style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
					>
						<div class="text-[9px] font-bold tracking-wide text-[var(--viz-accent)] uppercase">
							Vision extraction
						</div>
						<p class="mt-1 text-[var(--panel-text-muted)]">
							Long-format data rows, series, axes, insights, and L1–L4 prose.
						</p>
					</div>
					<div
						class="rounded-lg border p-2"
						style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
					>
						<div class="text-[9px] font-bold tracking-wide text-[var(--viz-ok)] uppercase">
							Auditable
						</div>
						<p class="mt-1 text-[var(--panel-text-muted)]">
							SVG geometry + classifier cross-checks every vision claim.
						</p>
					</div>
					<div
						class="rounded-lg border p-2"
						style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
					>
						<div class="text-[9px] font-bold tracking-wide text-[var(--viz-bad)] uppercase">
							WCAG critique
						</div>
						<p class="mt-1 text-[var(--panel-text-muted)]">
							Chart-specific accessibility issues with severity and fix hints.
						</p>
					</div>
				</div>
			</EmptyState>
		{/if}
	</PanelShell>
{/if}
