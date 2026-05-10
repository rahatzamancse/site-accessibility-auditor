<script lang="ts">
	import type { AuditStatus } from '../../types.ts';

	interface Props {
		thumb: string | null | undefined;
		status: AuditStatus;
		tag: string;
		size?: number;
		alt?: string;
	}

	let { thumb, status, tag, size = 56, alt }: Props = $props();

	const statusColor = $derived(
		status === 'fail'
			? 'var(--status-fail)'
			: status === 'warning'
				? 'var(--status-warning)'
				: status === 'pass'
					? 'var(--status-pass)'
					: 'var(--panel-text-muted)'
	);
</script>

<div
	class="audit-thumb relative shrink-0 overflow-hidden rounded"
	style:width="{size}px"
	style:height="{size}px"
	style:background-color="var(--panel-bg)"
	style:border="2px solid {statusColor}"
	role="img"
	aria-label={alt ?? `Element preview for <${tag}>`}
>
	{#if thumb}
		<img
			src={thumb}
			alt=""
			class="block h-full w-full object-cover"
			style:image-rendering="auto"
			loading="lazy"
		/>
	{:else}
		<div class="flex h-full w-full items-center justify-center">
			<code
				class="rounded px-1 text-[9px]"
				style:color="var(--panel-text-muted)"
				style:background-color="var(--panel-code-bg)"
			>
				&lt;{tag}&gt;
			</code>
		</div>
	{/if}
</div>

<style>
	.audit-thumb {
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
	}
</style>
