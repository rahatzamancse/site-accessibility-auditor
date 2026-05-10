<script lang="ts">
	import type { InteractionState, StateGraph } from '../../session/types.ts';

	interface Props {
		graph: StateGraph;
		selectedId: string | null;
		onselect: (id: string) => void;
	}

	let { graph, selectedId, onselect }: Props = $props();

	const width = 640;
	const height = 360;
	const cx = width / 2;
	const cy = height / 2;
	const nodeR = 24;
	const nodeSelR = 30;

	interface Positioned {
		state: InteractionState;
		x: number;
		y: number;
		angle: number;
	}

	// Concentric radial layout: base at center, depth-1 states on the inner
	// ring, depth-2 on the next ring, etc. Within each ring, states are
	// sorted by severity (worst first) so high-impact states land on top and
	// the layout stays spatially stable across re-renders.
	const layout = $derived.by(() => {
		const rootIdx = graph.states.findIndex((s) => s.id === graph.rootId);
		const root = rootIdx >= 0 ? graph.states[rootIdx] : graph.states[0];
		if (!root) return { root: null as Positioned | null, ring: [] as Positioned[] };
		const others = graph.states.filter((s) => s.id !== root.id);
		const byDepth = new Map<number, InteractionState[]>();
		for (const s of others) {
			const d = Math.max(1, s.depth);
			const arr = byDepth.get(d) ?? [];
			arr.push(s);
			byDepth.set(d, arr);
		}
		const sortFn = (a: InteractionState, b: InteractionState) => {
			const f = b.result.summary.fail - a.result.summary.fail;
			if (f !== 0) return f;
			const w = b.result.summary.warning - a.result.summary.warning;
			if (w !== 0) return w;
			return a.discoveredAt.localeCompare(b.discoveredAt);
		};
		const maxDepth = Math.max(0, ...byDepth.keys());
		const rootPos: Positioned = { state: root, x: cx, y: cy, angle: 0 };
		const ring: Positioned[] = [];
		const baseRadius = Math.min(width, height) * 0.22;
		const ringStep = Math.min(width, height) * 0.16;
		for (let d = 1; d <= maxDepth; d++) {
			const list = (byDepth.get(d) ?? []).slice().sort(sortFn);
			if (list.length === 0) continue;
			const radius = baseRadius + ringStep * (d - 1);
			for (let i = 0; i < list.length; i++) {
				const angle = (i / list.length) * Math.PI * 2 - Math.PI / 2;
				ring.push({
					state: list[i],
					x: cx + Math.cos(angle) * radius,
					y: cy + Math.sin(angle) * radius,
					angle
				});
			}
		}
		return { root: rootPos, ring };
	});

	const positionById = $derived.by(() => {
		const m = new Map<string, Positioned>();
		if (layout.root) m.set(layout.root.state.id, layout.root);
		for (const p of layout.ring) m.set(p.state.id, p);
		return m;
	});

	function severityColor(s: InteractionState): string {
		if (s.result.summary.fail > 0) return 'var(--viz-node-bad)';
		if (s.result.summary.warning > 0) return 'var(--viz-node-warn)';
		return 'var(--viz-node-ok)';
	}

	function handleKey(e: KeyboardEvent, id: string) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onselect(id);
		}
	}

	// Chord endpoint trimmed to the node edge so arrows land on the stroke.
	function trim(p: Positioned, toward: Positioned, r: number): { x: number; y: number } {
		const dx = toward.x - p.x;
		const dy = toward.y - p.y;
		const len = Math.hypot(dx, dy);
		if (len < 0.0001) return { x: p.x, y: p.y };
		return { x: p.x + (dx / len) * r, y: p.y + (dy / len) * r };
	}

	function labelFor(p: Positioned): string {
		const raw = p.state.id === graph.rootId ? 'Base' : p.state.triggerLabel;
		return raw.length > 20 ? raw.slice(0, 19) + '…' : raw;
	}

	// Place the label outside the node along the radial axis so labels never
	// overlap the node circle or each other in the common star topology.
	function labelOffset(p: Positioned): { dx: number; dy: number; anchor: string } {
		if (p.state.id === graph.rootId) return { dx: 0, dy: nodeR + 16, anchor: 'middle' };
		const pad = 8;
		const dx = Math.cos(p.angle) * (nodeR + pad);
		const dy = Math.sin(p.angle) * (nodeR + pad) + 3;
		const cosA = Math.cos(p.angle);
		const anchor = Math.abs(cosA) < 0.3 ? 'middle' : cosA > 0 ? 'start' : 'end';
		return { dx, dy, anchor };
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
		<span>State graph</span>
		<span class="text-[10px] normal-case tabular-nums" style:color="var(--panel-text-muted)">
			{graph.states.length} state{graph.states.length === 1 ? '' : 's'} · {graph.transitions.length} transition{graph
				.transitions.length === 1
				? ''
				: 's'}
		</span>
	</div>
	<svg
		role="img"
		aria-label="Radial state graph: base state at center, discovered states on the ring"
		viewBox="0 0 {width} {height}"
		width="100%"
		height="auto"
		preserveAspectRatio="xMidYMid meet"
	>
		<defs>
			<marker
				id="state-arrow"
				viewBox="0 0 10 10"
				refX="9"
				refY="5"
				markerWidth="5"
				markerHeight="5"
				orient="auto-start-reverse"
			>
				<path d="M0,0 L10,5 L0,10 Z" fill="var(--viz-link)" />
			</marker>
			<radialGradient id="state-bg" cx="50%" cy="50%" r="60%">
				<stop offset="0%" stop-color="color-mix(in srgb, var(--panel-primary) 6%, transparent)" />
				<stop offset="100%" stop-color="transparent" />
			</radialGradient>
		</defs>

		<rect x="0" y="0" {width} {height} fill="url(#state-bg)" />

		{#if layout.root}
			{#each [0.36, 0.18] as rf (rf)}
				<circle
					{cx}
					{cy}
					r={Math.min(width, height) * rf}
					fill="none"
					stroke="var(--panel-border)"
					stroke-width="1"
					stroke-dasharray="2 4"
					opacity="0.5"
				/>
			{/each}

			{#each graph.transitions as t, ti (`${t.from}-${t.to}-${ti}`)}
				{@const src = positionById.get(t.from)}
				{@const tgt = positionById.get(t.to)}
				{#if src && tgt && src !== tgt}
					{@const a = trim(src, tgt, nodeR)}
					{@const b = trim(tgt, src, nodeR + 3)}
					<line
						x1={a.x}
						y1={a.y}
						x2={b.x}
						y2={b.y}
						stroke="var(--viz-link)"
						stroke-width="1.3"
						marker-end="url(#state-arrow)"
						opacity={selectedId && selectedId !== t.from && selectedId !== t.to ? 0.25 : 0.9}
					/>
				{/if}
			{/each}

			{#each [layout.root, ...layout.ring] as p (p.state.id)}
				{@const isSel = selectedId === p.state.id}
				{@const isRoot = p.state.id === graph.rootId}
				{@const r = isSel ? nodeSelR : nodeR}
				{@const off = labelOffset(p)}
				<g
					role="button"
					tabindex="0"
					aria-label="State {p.state.id}: {p.state.triggerLabel} — {p.state.result.summary
						.fail} failures, {p.state.result.summary.warning} warnings"
					aria-pressed={isSel}
					onclick={() => onselect(p.state.id)}
					onkeydown={(e) => handleKey(e, p.state.id)}
					style="cursor: pointer;"
				>
					<circle
						cx={p.x}
						cy={p.y}
						r={r + 4}
						fill="transparent"
						stroke={isSel ? 'var(--panel-primary)' : 'transparent'}
						stroke-width="2"
						opacity={isSel ? 0.6 : 0}
					/>
					<circle
						cx={p.x}
						cy={p.y}
						{r}
						fill="var(--panel-bg-elevated)"
						stroke={severityColor(p.state)}
						stroke-width={isSel ? 3 : 2}
					/>
					<circle cx={p.x} cy={p.y} r={r - 4} fill={severityColor(p.state)} opacity="0.22" />
					<text
						x={p.x}
						y={p.y + 4}
						fill={severityColor(p.state)}
						font-size={isRoot ? '14' : '12'}
						font-weight="800"
						text-anchor="middle"
						pointer-events="none"
					>
						{isRoot ? '★' : p.state.result.summary.fail || p.state.result.summary.total || 0}
					</text>
					<text
						x={p.x + off.dx}
						y={p.y + off.dy}
						fill="var(--panel-text)"
						font-size="10"
						text-anchor={off.anchor}
						font-weight={isSel ? 700 : 500}
						pointer-events="none"
					>
						{labelFor(p)}
					</text>
				</g>
			{/each}
		{/if}
	</svg>
	<div
		class="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-[var(--panel-text-subtle)]"
		style="border-color: var(--panel-border);"
	>
		<span class="flex items-center gap-1">
			<span class="inline-block h-2 w-2 rounded-full" style="background-color: var(--viz-node-ok);"
			></span>
			clean
		</span>
		<span class="flex items-center gap-1">
			<span
				class="inline-block h-2 w-2 rounded-full"
				style="background-color: var(--viz-node-warn);"
			></span>
			warnings
		</span>
		<span class="flex items-center gap-1">
			<span class="inline-block h-2 w-2 rounded-full" style="background-color: var(--viz-node-bad);"
			></span>
			failures
		</span>
		<span class="ml-auto">★ base · number = fail count</span>
	</div>
</div>
