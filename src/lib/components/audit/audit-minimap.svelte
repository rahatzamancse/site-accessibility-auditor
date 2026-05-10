<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { AuditIssue, AuditResult, AuditStatus, PageBounds } from '../../types.ts';
	import AuditHoverCard from './audit-hover-card.svelte';

	type StatusFilter = 'all' | 'fail' | 'warning' | 'pass' | 'exempt';

	interface Props {
		result: AuditResult;
		selectedId: number | null;
		hoveredId: number | null;
		statusFilter: StatusFilter;
		query: string;
		onselect: (id: number) => void;
		onhover: (id: number | null) => void;
	}

	let { result, selectedId, hoveredId, statusFilter, query, onselect, onhover }: Props = $props();

	let container = $state<HTMLDivElement | null>(null);
	let svgEl = $state<SVGSVGElement | null>(null);
	let width = $state(0);
	let height = $state(0);
	let hoverPos = $state({ x: 0, y: 0 });
	let panning = $state(false);
	let panStart = { x: 0, y: 0, vbX: 0, vbY: 0 };

	interface Box {
		x: number;
		y: number;
		w: number;
		h: number;
	}

	let viewBox = $state<Box>({ x: 0, y: 0, w: 1280, h: 800 });
	let animHandle: number | null = null;
	let initialFitDone = false;

	const fullBounds = $derived.by<Box>(() => {
		const b: PageBounds = result.pageBounds ?? { width: 1280, height: 800 };
		return { x: 0, y: 0, w: Math.max(1, b.width), h: Math.max(1, b.height) };
	});

	function statusColor(status: AuditStatus): string {
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

	const placedIssues = $derived(result.issues.filter((i) => i.rect));

	function passesFilter(issue: AuditIssue): boolean {
		if (statusFilter !== 'all' && issue.status !== statusFilter) return false;
		if (!query) return true;
		const lower = query.toLowerCase();
		const haystack = [issue.tag, issue.text, issue.wcag, issue.selector ?? '']
			.join(' ')
			.toLowerCase();
		return haystack.includes(lower);
	}

	const sortedIssues = $derived(
		placedIssues.slice().sort((a, b) => {
			const sa = (a.rect?.width ?? 0) * (a.rect?.height ?? 0);
			const sb = (b.rect?.width ?? 0) * (b.rect?.height ?? 0);
			return sb - sa;
		})
	);

	const viewBoxStr = $derived(
		`${viewBox.x} ${viewBox.y} ${Math.max(1, viewBox.w)} ${Math.max(1, viewBox.h)}`
	);

	const hoveredIssue = $derived(
		hoveredId !== null ? (placedIssues.find((i) => i.id === hoveredId) ?? null) : null
	);

	const counts = $derived.by(() => {
		const c = { fail: 0, warning: 0, pass: 0, exempt: 0 };
		for (const i of placedIssues) c[i.status]++;
		return c;
	});

	onMount(() => {
		if (!container) return;
		const ro = new ResizeObserver((entries) => {
			for (const e of entries) {
				width = e.contentRect.width;
				height = Math.max(220, e.contentRect.height);
			}
			if (!initialFitDone && width > 0 && height > 0) {
				initialFitDone = true;
				fitAll();
			} else {
				reshapeViewBoxToAspect();
			}
		});
		ro.observe(container);
		return () => {
			ro.disconnect();
			if (animHandle !== null) cancelAnimationFrame(animHandle);
		};
	});

	function expandToContainerAspect(box: Box): Box {
		const w = width > 0 ? width : (container?.clientWidth ?? 0);
		const h = height > 0 ? height : (container?.clientHeight ?? 0);
		if (w <= 0 || h <= 0 || box.w <= 0 || box.h <= 0) return box;
		const ca = w / h;
		const ba = box.w / box.h;
		if (ba > ca) {
			const newH = box.w / ca;
			return { x: box.x, y: box.y - (newH - box.h) / 2, w: box.w, h: newH };
		}
		const newW = box.h * ca;
		return { x: box.x - (newW - box.w) / 2, y: box.y, w: newW, h: box.h };
	}

	function reshapeViewBoxToAspect() {
		if (width <= 0 || height <= 0) return;
		if (viewBox.w <= 0 || viewBox.h <= 0) return;
		const ca = width / height;
		const va = viewBox.w / viewBox.h;
		if (Math.abs(va - ca) < 1e-3) return;
		const cx = viewBox.x + viewBox.w / 2;
		const cy = viewBox.y + viewBox.h / 2;
		let newW = viewBox.w;
		let newH = viewBox.h;
		if (va > ca) newH = newW / ca;
		else newW = newH * ca;
		viewBox = { x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH };
	}

	function animateTo(target: Box, duration = 260) {
		if (animHandle !== null) cancelAnimationFrame(animHandle);
		const start = { ...viewBox };
		const t0 = performance.now();
		const ease = (t: number) => 1 - Math.pow(1 - t, 3);
		const step = (now: number) => {
			const t = Math.min(1, (now - t0) / duration);
			const e = ease(t);
			viewBox = {
				x: start.x + (target.x - start.x) * e,
				y: start.y + (target.y - start.y) * e,
				w: start.w + (target.w - start.w) * e,
				h: start.h + (target.h - start.h) * e
			};
			if (t < 1) animHandle = requestAnimationFrame(step);
			else animHandle = null;
		};
		animHandle = requestAnimationFrame(step);
	}

	function padBox(b: Box, padPct: number, minPad = 0): Box {
		const padX = Math.max(minPad, b.w * padPct);
		const padY = Math.max(minPad, b.h * padPct);
		return { x: b.x - padX, y: b.y - padY, w: b.w + padX * 2, h: b.h + padY * 2 };
	}

	function fitAll() {
		animateTo(expandToContainerAspect(padBox(fullBounds, 0.02, 8)));
	}

	function fitToFiltered() {
		const visible = placedIssues.filter(passesFilter);
		if (visible.length === 0) {
			fitAll();
			return;
		}
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const i of visible) {
			const r = i.rect!;
			if (r.x < minX) minX = r.x;
			if (r.y < minY) minY = r.y;
			if (r.x + r.width > maxX) maxX = r.x + r.width;
			if (r.y + r.height > maxY) maxY = r.y + r.height;
		}
		animateTo(
			expandToContainerAspect(
				padBox(
					{ x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) },
					0.06,
					16
				)
			)
		);
	}

	function fitToSelection() {
		if (selectedId === null) return;
		const sel = placedIssues.find((i) => i.id === selectedId);
		if (!sel?.rect) return;
		const padding = Math.max(sel.rect.width, sel.rect.height, 160);
		animateTo(
			expandToContainerAspect({
				x: sel.rect.x - padding,
				y: sel.rect.y - padding,
				w: sel.rect.width + padding * 2,
				h: sel.rect.height + padding * 2
			})
		);
	}

	$effect(() => {
		void selectedId;
		if (!initialFitDone) return;
		untrack(() => {
			if (selectedId !== null) fitToSelection();
		});
	});

	function clientToSvg(clientX: number, clientY: number): { x: number; y: number } | null {
		if (!svgEl) return null;
		const pt = svgEl.createSVGPoint();
		pt.x = clientX;
		pt.y = clientY;
		const ctm = svgEl.getScreenCTM();
		if (!ctm) return null;
		return pt.matrixTransform(ctm.inverse());
	}

	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		if (animHandle !== null) cancelAnimationFrame(animHandle);
		animHandle = null;
		const factor = Math.exp(e.deltaY * 0.0015);
		const anchor = clientToSvg(e.clientX, e.clientY);
		if (!anchor) return;
		const maxW = Math.max(fullBounds.w, 4000) * 20;
		const minW = Math.min(fullBounds.w, 200) / 40;
		const newW = Math.min(maxW, Math.max(minW, viewBox.w * factor));
		const newH = viewBox.h * (newW / viewBox.w);
		const nx = anchor.x - ((anchor.x - viewBox.x) * newW) / viewBox.w;
		const ny = anchor.y - ((anchor.y - viewBox.y) * newH) / viewBox.h;
		viewBox = { x: nx, y: ny, w: newW, h: newH };
	}

	function handlePointerDown(e: PointerEvent) {
		if ((e.target as Element).closest('[data-issue]')) return;
		if (animHandle !== null) cancelAnimationFrame(animHandle);
		animHandle = null;
		panning = true;
		panStart = { x: e.clientX, y: e.clientY, vbX: viewBox.x, vbY: viewBox.y };
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
	}

	function handlePointerMovePan(e: PointerEvent) {
		if (!panning || !svgEl) return;
		const rect = svgEl.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		const dx = ((e.clientX - panStart.x) * viewBox.w) / rect.width;
		const dy = ((e.clientY - panStart.y) * viewBox.h) / rect.height;
		viewBox = { ...viewBox, x: panStart.vbX - dx, y: panStart.vbY - dy };
	}

	function handlePointerUp(e: PointerEvent) {
		if (!panning) return;
		panning = false;
		try {
			(e.currentTarget as Element).releasePointerCapture(e.pointerId);
		} catch {}
	}

	function handleIssueHover(issue: AuditIssue, e: PointerEvent) {
		onhover(issue.id);
		if (!container) return;
		const rect = container.getBoundingClientRect();
		hoverPos = {
			x: Math.min(rect.width - 300, e.clientX - rect.left + 14),
			y: Math.min(rect.height - 200, e.clientY - rect.top + 14)
		};
	}

	function handleIssueLeave() {
		onhover(null);
	}

	const zoomLevel = $derived(fullBounds.w <= 0 || viewBox.w <= 0 ? 1 : fullBounds.w / viewBox.w);
</script>

<div
	bind:this={container}
	class="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-md border"
	style:border-color="var(--panel-border)"
	style:background-color="var(--panel-bg-elevated)"
	role="application"
	aria-label="Audit minimap"
>
	<div
		class="flex shrink-0 items-center justify-between border-b px-2 py-1 text-[9px] font-bold tracking-wide uppercase"
		style:border-color="var(--panel-border)"
		style:color="var(--panel-text-muted)"
	>
		<span>Page map</span>
		<div class="flex items-center gap-1.5 normal-case">
			<span class="flex items-center gap-1 tabular-nums" style:color="var(--panel-text-muted)">
				<span style:color="var(--status-fail)">{counts.fail}F</span>
				<span style:color="var(--status-warning)">{counts.warning}W</span>
				<span style:color="var(--status-pass)">{counts.pass}P</span>
			</span>
			<span
				class="rounded border px-1.5 py-0.5 font-semibold tabular-nums"
				style:border-color="var(--panel-border)"
				style:color="var(--panel-text-muted)"
				title="Zoom relative to full page bounds"
			>
				{Math.round(zoomLevel * 100)}%
			</span>
			<button
				type="button"
				class="rounded border px-1.5 py-0.5 font-semibold hover:bg-[var(--panel-hover)]"
				style:border-color="var(--panel-border)"
				style:color="var(--panel-text)"
				onclick={fitToFiltered}
				title="Fit visible issues"
			>
				Fit
			</button>
			<button
				type="button"
				class="rounded border px-1.5 py-0.5 font-semibold hover:bg-[var(--panel-hover)]"
				style:border-color="var(--panel-border)"
				style:color="var(--panel-text)"
				onclick={fitAll}
				title="Show entire page"
			>
				1:1
			</button>
		</div>
	</div>

	<div class="relative min-h-0 flex-1 overflow-hidden">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<svg
			bind:this={svgEl}
			role="application"
			aria-label="Issue minimap viewport"
			viewBox={viewBoxStr}
			preserveAspectRatio="xMidYMid meet"
			class="block h-full w-full touch-none select-none"
			style:background-color="var(--panel-bg)"
			style:cursor={panning ? 'grabbing' : 'grab'}
			onwheel={handleWheel}
			onpointerdown={handlePointerDown}
			onpointermove={handlePointerMovePan}
			onpointerup={handlePointerUp}
			onpointercancel={handlePointerUp}
		>
			<rect
				x={fullBounds.x}
				y={fullBounds.y}
				width={fullBounds.w}
				height={fullBounds.h}
				fill="transparent"
				stroke="var(--viz-grid)"
				stroke-width="1.5"
				vector-effect="non-scaling-stroke"
			/>

			{#each sortedIssues as issue (issue.id)}
				{@const r = issue.rect!}
				{@const color = statusColor(issue.status)}
				{@const selected = issue.id === selectedId}
				{@const hovered = issue.id === hoveredId}
				{@const matches = passesFilter(issue)}
				{@const dimmed = (statusFilter !== 'all' || query.length > 0) && !matches}
				<g
					data-issue
					class="cursor-pointer"
					opacity={dimmed ? 0.12 : 1}
					onclick={() => onselect(issue.id)}
					onpointermove={(e) => handleIssueHover(issue, e)}
					onpointerleave={handleIssueLeave}
					role="button"
					tabindex="0"
					aria-label={`${issue.status} ${issue.wcag} <${issue.tag}>`}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							onselect(issue.id);
						}
					}}
				>
					<rect
						x={r.x}
						y={r.y}
						width={Math.max(4, r.width)}
						height={Math.max(4, r.height)}
						fill="color-mix(in srgb, {color} 22%, transparent)"
						stroke={selected ? 'var(--panel-primary)' : color}
						stroke-width={selected ? 3 : hovered ? 2.5 : 1.2}
						vector-effect="non-scaling-stroke"
					/>
					{#if hovered || selected}
						<rect
							x={r.x - 6}
							y={r.y - 6}
							width={Math.max(4, r.width) + 12}
							height={Math.max(4, r.height) + 12}
							fill="none"
							stroke={selected ? 'var(--panel-primary)' : color}
							stroke-width="1"
							stroke-dasharray="4 3"
							opacity="0.8"
							vector-effect="non-scaling-stroke"
						/>
					{/if}
				</g>
			{/each}
		</svg>

		{#if hoveredIssue}
			<div
				class="pointer-events-none absolute z-20"
				style:left="{hoverPos.x}px"
				style:top="{hoverPos.y}px"
			>
				<AuditHoverCard issue={hoveredIssue} variant="tooltip" />
			</div>
		{/if}

		{#if placedIssues.length === 0}
			<div
				class="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px]"
				style:color="var(--panel-text-muted)"
			>
				No issues with rects to plot.
			</div>
		{/if}
	</div>
</div>
