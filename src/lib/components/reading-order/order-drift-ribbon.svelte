<script lang="ts">
	import type { DiffKind, ReadingOrderDiff } from '../../reading-order/types.ts';
	import { INFO_KINDS } from '../../reading-order/types.ts';

	interface Props {
		diff: ReadingOrderDiff;
		selectedKey: string | null;
		hoveredKey: string | null;
		onselect: (key: string) => void;
		onhover: (key: string | null) => void;
	}

	let { diff, selectedKey, hoveredKey, onselect, onhover }: Props = $props();

	const rowHeight = 22;
	const padding = 18;
	const width = 640;

	// Only tabbable entries — ribbon contrasts DOM, Visual and Tab orders.
	const rows = $derived(diff.pairs.filter((p) => p.entry.tabIndex !== null));
	const rowCount = $derived(rows.length);
	const height = $derived(Math.max(180, rowCount * rowHeight + padding * 2));

	const xDom = $derived(width * 0.12);
	const xVis = $derived(width * 0.5);
	const xTab = $derived(width * 0.88);

	function bandY(i: number): number {
		return padding + i * rowHeight + rowHeight / 2;
	}

	/**
	 * Map an entry to its rank (0..n-1) under the given projection, computed
	 * across the tabbable subset so ribbon columns always line up evenly.
	 */
	function projected(getter: (pair: { key: string; visualIndex: number; domIndex: number; tabIndex: number | null }) => number) {
		const sorted = rows
			.map((p) => ({
				key: p.entry.key,
				domIndex: p.entry.domIndex,
				visualIndex: p.entry.visualIndex,
				tabIndex: p.entry.tabIndex
			}))
			.slice()
			.sort((a, b) => getter(a) - getter(b));
		const map = new Map<string, number>();
		sorted.forEach((s, i) => map.set(s.key, i));
		return map;
	}

	const domRank = $derived(projected((p) => p.domIndex));
	const visRank = $derived(projected((p) => p.visualIndex));
	const tabRank = $derived(projected((p) => p.tabIndex ?? 0));

	function ribbonPath(x1: number, y1: number, x2: number, y2: number): string {
		const mx = (x1 + x2) / 2;
		return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
	}

	function ribbonColor(kind: string, a: number, b: number): string {
		if (kind === 'tab-break') return 'var(--viz-bad)';
		if (kind === 'positive-tabindex') return 'var(--viz-warn)';
		if (INFO_KINDS.has(kind as DiffKind)) return 'var(--viz-muted)';
		if (a === b) return 'var(--viz-link)';
		return 'color-mix(in srgb, var(--viz-accent) 55%, transparent)';
	}

	/**
	 * Info-tier ribbons render dashed + reduced opacity so they read as
	 * "explanation, not problem" against the solid bug-tier ribbons.
	 */
	function ribbonDash(kind: string): string | null {
		return INFO_KINDS.has(kind as DiffKind) ? '4 3' : null;
	}
	function ribbonOpacity(kind: string, isActive: boolean): number {
		if (isActive) return 1;
		if (INFO_KINDS.has(kind as DiffKind)) return 0.45;
		return 0.7;
	}

	function truncate(s: string, n: number): string {
		if (s.length <= n) return s;
		return s.slice(0, n - 1) + '…';
	}
</script>

<div class="flex flex-col gap-2 p-2">
	<div
		class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-1.5 text-[10px]"
		style="border-color: var(--panel-border); background-color: var(--panel-summary-bg);"
	>
		<span class="font-bold tracking-wide text-[var(--panel-text)] uppercase">Order drift</span>
		<span style:color="var(--panel-text-muted)"
			>DOM ↔ Visual: <strong style:color="var(--panel-text)">{diff.mismatches.domVsVisual}</strong></span
		>
		<span style:color="var(--panel-text-muted)"
			>Visual ↔ Tab: <strong style:color="var(--panel-text)">{diff.mismatches.visualVsTab}</strong></span
		>
		<span style:color="var(--panel-text-muted)"
			>DOM ↔ Tab: <strong style:color="var(--panel-text)">{diff.mismatches.domVsTab}</strong></span
		>
		<span style:color="var(--panel-text-muted)"
			>AX ↔ Visual: <strong style:color="var(--panel-text)">{diff.mismatches.axVsVisual}</strong></span
		>
		<div
			class="ml-auto flex items-center gap-2 rounded border px-2 py-0.5"
			style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated);"
			aria-label="Ribbon color legend"
		>
			<span class="text-[9px] font-semibold tracking-wide uppercase" style:color="var(--panel-text-subtle)"
				>Ribbon</span
			>
			<span class="flex items-center gap-1" style:color="var(--panel-text-muted)">
				<svg width="18" height="6" aria-hidden="true"
					><line x1="1" y1="3" x2="17" y2="3" stroke="var(--viz-link)" stroke-width="2" /></svg
				>
				aligned
			</span>
			<span class="flex items-center gap-1" style:color="var(--panel-text-muted)">
				<svg width="18" height="6" aria-hidden="true"
					><line
						x1="1"
						y1="3"
						x2="17"
						y2="3"
						stroke="color-mix(in srgb, var(--viz-accent) 55%, transparent)"
						stroke-width="2"
					/></svg
				>
				drift
			</span>
			<span class="flex items-center gap-1" style:color="var(--panel-text-muted)">
				<svg width="18" height="6" aria-hidden="true"
					><line x1="1" y1="3" x2="17" y2="3" stroke="var(--viz-bad)" stroke-width="2" /></svg
				>
				tab break
			</span>
			<span class="flex items-center gap-1" style:color="var(--panel-text-muted)">
				<svg width="18" height="6" aria-hidden="true"
					><line x1="1" y1="3" x2="17" y2="3" stroke="var(--viz-warn)" stroke-width="2" /></svg
				>
				positive tabindex
			</span>
			<span class="flex items-center gap-1" style:color="var(--panel-text-muted)">
				<svg width="18" height="6" aria-hidden="true"
					><line
						x1="1"
						y1="3"
						x2="17"
						y2="3"
						stroke="var(--viz-muted)"
						stroke-width="2"
						stroke-dasharray="4 3"
					/></svg
				>
				hint (intentional pattern)
			</span>
		</div>
	</div>

	{#if rowCount === 0}
		<div
			class="rounded-md border px-3 py-6 text-center text-[11px]"
			style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated); color: var(--panel-text-muted);"
		>
			No keyboard-reachable entries.
		</div>
	{:else}
		<div
			class="overflow-auto rounded-md border"
			style="border-color: var(--panel-border); background-color: var(--panel-bg-elevated); max-height: 360px;"
		>
			<svg
				role="img"
				aria-label="Order drift ribbon linking DOM, visual, and tab orders"
				viewBox="0 0 {width} {height}"
				width="100%"
				{height}
				preserveAspectRatio="xMidYMid meet"
			>
				<g>
					{#each ['DOM', 'VISUAL', 'TAB'] as col, ci (col)}
						{@const x = [xDom, xVis, xTab][ci]}
						<text
							{x}
							y={padding / 2 + 4}
							fill="var(--panel-text-muted)"
							font-size="10"
							font-weight="700"
							text-anchor="middle"
							letter-spacing="1"
						>
							{col}
						</text>
					{/each}
				</g>
				<g>
					{#each rows as pair (pair.entry.key)}
						{@const dI = domRank.get(pair.entry.key) ?? 0}
						{@const vI = visRank.get(pair.entry.key) ?? 0}
						{@const tI = tabRank.get(pair.entry.key) ?? 0}
						{@const yD = bandY(dI)}
						{@const yV = bandY(vI)}
						{@const yT = bandY(tI)}
						{@const isActive = selectedKey === pair.entry.key || hoveredKey === pair.entry.key}
						<g
							role="button"
							tabindex="0"
							aria-label="Reading entry {pair.entry.tag}"
							onmouseenter={() => onhover(pair.entry.key)}
							onmouseleave={() => onhover(null)}
							onclick={() => onselect(pair.entry.key)}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									onselect(pair.entry.key);
								}
							}}
							style="cursor: pointer;"
						>
							<path
								d={ribbonPath(xDom + 4, yD, xVis - 4, yV)}
								fill="none"
								stroke={ribbonColor(pair.kind, dI, vI)}
								stroke-width={isActive ? 3.5 : 1.5}
								stroke-dasharray={ribbonDash(pair.kind) ?? 'none'}
								opacity={ribbonOpacity(pair.kind, isActive)}
							/>
							<path
								d={ribbonPath(xVis + 4, yV, xTab - 4, yT)}
								fill="none"
								stroke={ribbonColor(pair.kind, vI, tI)}
								stroke-width={isActive ? 3.5 : 1.5}
								stroke-dasharray={ribbonDash(pair.kind) ?? 'none'}
								opacity={ribbonOpacity(pair.kind, isActive)}
							/>
						</g>
						{#each [0, 1, 2] as col (col)}
							{@const xs = [xDom, xVis, xTab]}
							{@const ys = [yD, yV, yT]}
							{@const idx = [dI, vI, tI][col]}
							<g
								role="button"
								tabindex="0"
								aria-label="Node {pair.entry.tag}"
								onmouseenter={() => onhover(pair.entry.key)}
								onmouseleave={() => onhover(null)}
								onclick={() => onselect(pair.entry.key)}
								onkeydown={(e) => {
									if (e.key === 'Enter' || e.key === ' ') {
										e.preventDefault();
										onselect(pair.entry.key);
									}
								}}
								style="cursor: pointer;"
							>
								<circle
									cx={xs[col]}
									cy={ys[col]}
									r={isActive ? 7 : 5}
									fill={isActive ? 'var(--panel-primary)' : 'var(--viz-node)'}
									stroke="var(--viz-surface)"
									stroke-width="1.5"
								/>
								<text
									x={col === 0 ? xs[col] - 10 : col === 2 ? xs[col] + 10 : xs[col]}
									y={ys[col] + 3}
									fill="var(--panel-text)"
									font-size="9"
									text-anchor={col === 0 ? 'end' : col === 2 ? 'start' : 'middle'}
									font-weight={isActive ? 700 : 500}
								>
									{idx + 1}
								</text>
							</g>
						{/each}
						{#if isActive}
							{@const label = truncate(
								pair.entry.ax?.name || pair.entry.visual?.text || pair.entry.tag,
								22
							)}
							<g>
								<rect
									x={xVis - 70}
									y={yV - rowHeight / 2 + 1}
									width={140}
									height={rowHeight - 2}
									rx={4}
									fill="var(--panel-bg-elevated)"
									stroke="var(--panel-primary)"
									stroke-width="1"
									opacity="0.95"
								/>
								<text
									x={xVis}
									y={yV + 3}
									fill="var(--panel-text)"
									font-size="10"
									text-anchor="middle"
									font-weight="600"
								>
									&lt;{pair.entry.tag}&gt; {label}
								</text>
							</g>
						{/if}
					{/each}
				</g>
			</svg>
		</div>
	{/if}
</div>
