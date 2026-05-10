/**
 * Full-page screenshot stitching for the Interaction Audits panel.
 *
 * Driven from the panel side because chrome.tabs.captureVisibleTab is
 * throttled (~600 ms) and must be sequenced with scroll commands inside the
 * inspected page. The captured chunks are pasted into a single canvas at
 * device-pixel-ratio scale; per-issue thumbnails are then cropped from that
 * canvas using rects that runAudit already stores in page coordinates.
 */

import type { ElementRect } from '../types.ts';
import { captureTab, evalInPage, type EvalOptions } from './devtools-eval.ts';

export interface PageCaptureBounds {
	scrollWidth: number;
	scrollHeight: number;
	viewportWidth: number;
	viewportHeight: number;
	dpr: number;
}

export interface StitchedPage {
	canvas: HTMLCanvasElement;
	bounds: PageCaptureBounds;
}

export interface CapturePageOptions extends EvalOptions {
	onProgress?: (chunk: number, total: number) => void;
	/** Hard cap on the stitched canvas height in CSS pixels. Defaults to 16k. */
	maxHeight?: number;
}

const DEFAULT_MAX_HEIGHT = 16_000;

export async function getPageBounds(options: EvalOptions = {}): Promise<PageCaptureBounds> {
	return evalInPage<PageCaptureBounds>(
		`(function(){
		var de = document.documentElement;
		var bd = document.body;
		return {
			scrollWidth: Math.max(de ? de.scrollWidth : 0, bd ? bd.scrollWidth : 0, window.innerWidth || 0),
			scrollHeight: Math.max(de ? de.scrollHeight : 0, bd ? bd.scrollHeight : 0, window.innerHeight || 0),
			viewportWidth: window.innerWidth || 0,
			viewportHeight: window.innerHeight || 0,
			dpr: window.devicePixelRatio || 1
		};
	})()`,
		options
	);
}

async function setScroll(x: number, y: number, options: EvalOptions = {}): Promise<void> {
	await evalInPage(
		`(function(){ window.scrollTo({ left: ${x}, top: ${y}, behavior: 'instant' }); return null; })()`,
		options
	);
}

async function getScroll(options: EvalOptions = {}): Promise<{ x: number; y: number }> {
	return evalInPage<{ x: number; y: number }>(
		`(function(){ return { x: window.scrollX || window.pageXOffset || 0, y: window.scrollY || window.pageYOffset || 0 }; })()`,
		options
	);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('image load failed'));
		img.src = dataUrl;
	});
}

/**
 * Stitch a full-page screenshot by scrolling the inspected page in
 * viewport-height chunks and pasting each captureVisibleTab() result into
 * one canvas. Restores scroll position when done.
 *
 * Returns null if the page is too tall, capture is unsupported, or any
 * intermediate step fails — callers should treat thumbnails as best-effort.
 */
export async function capturePage(opts: CapturePageOptions = {}): Promise<StitchedPage | null> {
	const maxHeight = opts.maxHeight ?? DEFAULT_MAX_HEIGHT;
	let bounds: PageCaptureBounds;
	try {
		bounds = await getPageBounds(opts);
	} catch {
		return null;
	}

	const cssWidth = Math.max(1, Math.min(bounds.scrollWidth, bounds.viewportWidth * 4));
	const cssHeight = Math.max(1, Math.min(bounds.scrollHeight, maxHeight));
	const dpr = Math.max(1, bounds.dpr || 1);

	const canvas = document.createElement('canvas');
	canvas.width = Math.round(cssWidth * dpr);
	canvas.height = Math.round(cssHeight * dpr);
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;

	let saved = { x: 0, y: 0 };
	try {
		saved = await getScroll(opts);
	} catch {
		// best-effort restore
	}

	const chunks: number[] = [];
	for (let y = 0; y < cssHeight; y += bounds.viewportHeight) {
		chunks.push(y);
	}
	const total = chunks.length;

	try {
		for (let i = 0; i < chunks.length; i++) {
			if (opts.signal?.aborted) return null;
			const y = chunks[i];
			await setScroll(0, y, opts);
			// Give the page one frame to settle (sticky/lazy content).
			await new Promise((r) => setTimeout(r, 60));
			const dataUrl = await captureTab();
			if (!dataUrl) continue;
			let img: HTMLImageElement;
			try {
				img = await loadImage(dataUrl);
			} catch {
				continue;
			}
			// captureVisibleTab returns the viewport at the source dpr; paste at
			// (0, y*dpr) sized to img.naturalWidth/Height so we don't accidentally
			// rescale.
			ctx.drawImage(img, 0, Math.round(y * dpr));
			opts.onProgress?.(i + 1, total);
		}
	} catch {
		try {
			await setScroll(saved.x, saved.y, opts);
		} catch {}
		return null;
	}

	try {
		await setScroll(saved.x, saved.y, opts);
	} catch {}

	return {
		canvas,
		bounds: { ...bounds, scrollWidth: cssWidth, scrollHeight: cssHeight }
	};
}

/**
 * Crop a single page-coord rect from a stitched canvas and return it as a
 * JPEG data URL. Long side is clamped to maxSide CSS pixels so list rows
 * stay light; rects fully outside the canvas return null.
 */
export function cropToThumb(
	stitched: StitchedPage,
	rect: ElementRect,
	maxSide = 96
): string | null {
	if (rect.width <= 0 || rect.height <= 0) return null;
	const dpr = Math.max(1, stitched.bounds.dpr || 1);
	const padCss = 4;
	const cssX = Math.max(0, rect.x - padCss);
	const cssY = Math.max(0, rect.y - padCss);
	const cssW = Math.min(stitched.bounds.scrollWidth - cssX, rect.width + padCss * 2);
	const cssH = Math.min(stitched.bounds.scrollHeight - cssY, rect.height + padCss * 2);
	if (cssW <= 0 || cssH <= 0) return null;

	const sx = Math.round(cssX * dpr);
	const sy = Math.round(cssY * dpr);
	const sw = Math.round(cssW * dpr);
	const sh = Math.round(cssH * dpr);
	if (sx >= stitched.canvas.width || sy >= stitched.canvas.height) return null;

	const longSide = Math.max(cssW, cssH);
	const scale = longSide > maxSide ? maxSide / longSide : 1;
	const dw = Math.max(1, Math.round(cssW * scale));
	const dh = Math.max(1, Math.round(cssH * scale));

	const out = document.createElement('canvas');
	out.width = dw;
	out.height = dh;
	const ctx = out.getContext('2d');
	if (!ctx) return null;
	try {
		ctx.drawImage(stitched.canvas, sx, sy, sw, sh, 0, 0, dw, dh);
		return out.toDataURL('image/jpeg', 0.6);
	} catch {
		return null;
	}
}
