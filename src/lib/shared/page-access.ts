/**
 * Runtime grant flow for the optional <all_urls> host permission, which is
 * only needed by chrome.tabs.captureVisibleTab (screenshots). DevTools panels
 * cannot use chrome.permissions, so checks are proxied through the service
 * worker and the actual request happens in the grant-access extension page.
 */

export const PAGE_ACCESS_ORIGINS = ['<all_urls>'];

export const CHECK_PAGE_ACCESS_MESSAGE = 'CHECK_PAGE_ACCESS';
export const OPEN_GRANT_PAGE_MESSAGE = 'OPEN_GRANT_PAGE';
export const PAGE_ACCESS_GRANTED_MESSAGE = 'PAGE_ACCESS_GRANTED';
export const GRANT_PAGE_CLOSED_MESSAGE = 'GRANT_PAGE_CLOSED';

const POLL_INTERVAL_MS = 1_500;
const DEFAULT_TIMEOUT_MS = 120_000;
/** Time for the grant tab to close so focus returns to the inspected tab
 * before any captureVisibleTab call. */
const REFOCUS_DELAY_MS = 1_000;

export async function hasPageAccess(): Promise<boolean> {
	try {
		const res = (await chrome.runtime.sendMessage({ type: CHECK_PAGE_ACCESS_MESSAGE })) as {
			granted?: boolean;
		} | null;
		return res?.granted === true;
	} catch {
		return false;
	}
}

/**
 * Returns true if screenshot capture is available. If the permission has not
 * been granted yet, opens the grant page and resolves once the user grants,
 * declines (grant tab closed), or the timeout elapses. Callers should degrade
 * gracefully on false — audits still run, just without screenshots.
 */
export async function ensurePageAccess(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
	if (await hasPageAccess()) return true;

	try {
		await chrome.runtime.sendMessage({ type: OPEN_GRANT_PAGE_MESSAGE });
	} catch {
		return false;
	}

	return new Promise<boolean>((resolve) => {
		let settled = false;

		const finish = (granted: boolean) => {
			if (settled) return;
			settled = true;
			chrome.runtime.onMessage.removeListener(onMessage);
			clearInterval(poll);
			clearTimeout(timer);
			if (granted) setTimeout(() => resolve(true), REFOCUS_DELAY_MS);
			else resolve(false);
		};

		const onMessage = (message: unknown): undefined => {
			const type = (message as { type?: string } | null)?.type;
			if (type === PAGE_ACCESS_GRANTED_MESSAGE) finish(true);
			if (type === GRANT_PAGE_CLOSED_MESSAGE) void hasPageAccess().then(finish);
			return undefined;
		};
		chrome.runtime.onMessage.addListener(onMessage);

		const poll = setInterval(() => {
			void hasPageAccess().then((granted) => {
				if (granted) finish(true);
			});
		}, POLL_INTERVAL_MS);

		const timer = setTimeout(() => finish(false), timeoutMs);
	});
}
