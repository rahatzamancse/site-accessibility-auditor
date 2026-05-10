/**
 * Shared wrappers around chrome.devtools.inspectedWindow.eval and
 * chrome.tabs.captureVisibleTab so every module has consistent error handling
 * and typing. Adds a hard timeout to every eval so a blocked confirm()/alert()
 * or runaway script can't hang the panel, an AbortSignal hook so the explorer
 * can cancel mid-step, and a token-bucket throttle on captureVisibleTab to
 * stay below the Manifest V3 ~2 calls/second cap.
 */

const DEFAULT_EVAL_TIMEOUT_MS = 5_000;
const CAPTURE_MIN_INTERVAL_MS = 600;

export class EvalTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`evalInPage timed out after ${timeoutMs} ms`);
		this.name = 'EvalTimeoutError';
	}
}

export class EvalAbortedError extends Error {
	constructor() {
		super('evalInPage aborted by signal');
		this.name = 'EvalAbortedError';
	}
}

export interface EvalOptions {
	timeoutMs?: number;
	signal?: AbortSignal;
}

export function evalInPage<T = unknown>(expression: string, options: EvalOptions = {}): Promise<T> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_EVAL_TIMEOUT_MS;
	const signal = options.signal;

	if (signal?.aborted) return Promise.reject(new EvalAbortedError());

	return new Promise((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | null = null;
		const onAbort = () => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			reject(new EvalAbortedError());
		};
		signal?.addEventListener('abort', onAbort, { once: true });

		timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener('abort', onAbort);
			reject(new EvalTimeoutError(timeoutMs));
		}, timeoutMs);

		try {
			chrome.devtools.inspectedWindow.eval(expression, {}, (result, exInfo) => {
				if (settled) return;
				settled = true;
				if (timer) clearTimeout(timer);
				signal?.removeEventListener('abort', onAbort);
				if (exInfo?.isException) {
					reject(new Error(exInfo.value || 'Evaluation failed'));
				} else {
					resolve(result as T);
				}
			});
		} catch (err) {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			reject(err instanceof Error ? err : new Error(String(err)));
		}
	});
}

let lastCaptureAt = 0;
let captureChain: Promise<unknown> = Promise.resolve();

function throttledCapture<T>(fn: () => Promise<T>): Promise<T> {
	const next = captureChain.then(async () => {
		const now = Date.now();
		const wait = Math.max(0, CAPTURE_MIN_INTERVAL_MS - (now - lastCaptureAt));
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		try {
			return await fn();
		} finally {
			lastCaptureAt = Date.now();
		}
	});
	captureChain = next.catch(() => undefined);
	return next;
}

export async function captureTab(quality = 80): Promise<string | null> {
	const tabId = chrome.devtools?.inspectedWindow?.tabId;
	if (typeof tabId !== 'number') return null;
	return throttledCapture(async () => {
		try {
			const tab = await chrome.tabs.get(tabId);
			if (typeof tab.windowId !== 'number') return null;
			return await chrome.tabs.captureVisibleTab(tab.windowId, {
				format: 'jpeg',
				quality
			});
		} catch {
			return null;
		}
	});
}

export async function downscaleDataUrl(dataUrl: string, maxWidth = 320): Promise<string> {
	if (!dataUrl.startsWith('data:image')) return dataUrl;
	const img = new Image();
	const loaded = new Promise<void>((resolve, reject) => {
		img.onload = () => resolve();
		img.onerror = () => reject(new Error('image load failed'));
	});
	img.src = dataUrl;
	try {
		await loaded;
	} catch {
		return dataUrl;
	}
	const scale = Math.min(1, maxWidth / img.naturalWidth);
	const w = Math.max(1, Math.round(img.naturalWidth * scale));
	const h = Math.max(1, Math.round(img.naturalHeight * scale));
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) return dataUrl;
	ctx.drawImage(img, 0, 0, w, h);
	return canvas.toDataURL('image/jpeg', 0.7);
}

export function getPageInfo(
	options: EvalOptions = {}
): Promise<{ origin: string; url: string; title: string }> {
	return evalInPage<{ origin: string; url: string; title: string }>(
		`(function(){ return { origin: location.origin, url: location.href, title: document.title }; })()`,
		options
	);
}

/**
 * Hard-navigate the inspected tab via the extension's tabs API. Used to
 * recover from cross-origin navigations triggered by an explored candidate,
 * where evalInPage("location.replace(...)") would still execute on the wrong
 * page if it has a CSP that blocks scripted navigations away.
 */
export async function navigateInspectedTab(url: string): Promise<void> {
	const tabId = chrome.devtools?.inspectedWindow?.tabId;
	if (typeof tabId !== 'number') return;
	try {
		await chrome.tabs.update(tabId, { url });
	} catch {
		// best-effort; caller will detect via subsequent getPageInfo
	}
}

/**
 * Poll document.readyState until it is `complete` or the deadline elapses.
 * inspectedWindow.eval cannot await Promises returned by the page expression,
 * so navigation/load waits have to be driven from the panel side.
 */
export async function waitForReady(maxMs = 4_000, options: EvalOptions = {}): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < maxMs) {
		if (options.signal?.aborted) return false;
		try {
			const ready = await evalInPage<string>(
				`(function(){ return document.readyState; })()`,
				options
			);
			if (ready === 'complete') return true;
		} catch {
			// page may be mid-navigation; retry until deadline
		}
		await new Promise((r) => setTimeout(r, 120));
	}
	return false;
}
