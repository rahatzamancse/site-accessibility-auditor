/**
 * Standalone extension page that requests the optional <all_urls> host
 * permission. chrome.permissions.request must run during a user gesture in a
 * regular extension page — DevTools panels don't have access to the
 * permissions API — so panels open this page and wait for the broadcast.
 */

import { PAGE_ACCESS_GRANTED_MESSAGE, PAGE_ACCESS_ORIGINS } from '../lib/shared/page-access.ts';

const button = document.getElementById('grant') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLDivElement;

async function closeSelf(): Promise<void> {
	const tab = await chrome.tabs.getCurrent();
	if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
}

button.addEventListener('click', async () => {
	button.disabled = true;
	let granted = false;
	try {
		granted = await chrome.permissions.request({ origins: PAGE_ACCESS_ORIGINS });
	} catch (err) {
		status.className = 'status denied';
		status.textContent = err instanceof Error ? err.message : 'Permission request failed';
		button.disabled = false;
		return;
	}

	if (granted) {
		status.className = 'status granted';
		status.textContent = 'Access granted. Returning to DevTools…';
		try {
			await chrome.runtime.sendMessage({ type: PAGE_ACCESS_GRANTED_MESSAGE });
		} catch {
			// no listeners (panel closed); polling in the panel covers this
		}
		setTimeout(() => void closeSelf(), 600);
	} else {
		status.className = 'status denied';
		status.textContent = 'Access was declined. Screenshot-based features stay disabled.';
		button.disabled = false;
	}
});
