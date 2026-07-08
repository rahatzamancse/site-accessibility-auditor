import {
	CHECK_PAGE_ACCESS_MESSAGE,
	GRANT_PAGE_CLOSED_MESSAGE,
	OPEN_GRANT_PAGE_MESSAGE,
	PAGE_ACCESS_ORIGINS
} from '../lib/shared/page-access.ts';

export interface CaptureViewportMessage {
	type: 'CAPTURE_VIEWPORT';
	tabId: number;
}

export interface CaptureViewportResponse {
	ok: boolean;
	dataUrl?: string;
	error?: string;
}

async function captureViewport(tabId: number): Promise<CaptureViewportResponse> {
	try {
		const tab = await chrome.tabs.get(tabId);
		if (!tab?.windowId) {
			return { ok: false, error: 'Tab has no associated window' };
		}
		const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
		if (!dataUrl) {
			return { ok: false, error: 'captureVisibleTab returned empty result' };
		}
		return { ok: true, dataUrl };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : 'Unknown capture error'
		};
	}
}

const grantTabIds = new Set<number>();

chrome.tabs.onRemoved.addListener((tabId) => {
	if (!grantTabIds.delete(tabId)) return;
	void chrome.runtime.sendMessage({ type: GRANT_PAGE_CLOSED_MESSAGE }).catch(() => undefined);
});

async function openGrantPage(): Promise<void> {
	const url = chrome.runtime.getURL('grant-access/grant-access.html');
	const existing = await chrome.tabs.query({ url });
	if (existing.length > 0 && existing[0].id !== undefined) {
		grantTabIds.add(existing[0].id);
		await chrome.tabs.update(existing[0].id, { active: true });
		if (existing[0].windowId !== undefined) {
			await chrome.windows.update(existing[0].windowId, { focused: true });
		}
		return;
	}
	const tab = await chrome.tabs.create({ url });
	if (tab.id !== undefined) grantTabIds.add(tab.id);
}

chrome.runtime.onMessage.addListener(
	(message: { type?: string; tabId?: number }, _sender, sendResponse) => {
		switch (message?.type) {
			case 'CAPTURE_VIEWPORT':
				captureViewport((message as CaptureViewportMessage).tabId).then(sendResponse);
				return true;
			case CHECK_PAGE_ACCESS_MESSAGE:
				chrome.permissions
					.contains({ origins: PAGE_ACCESS_ORIGINS })
					.then((granted) => sendResponse({ granted }))
					.catch(() => sendResponse({ granted: false }));
				return true;
			case OPEN_GRANT_PAGE_MESSAGE:
				openGrantPage()
					.then(() => sendResponse({ ok: true }))
					.catch((err) =>
						sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
					);
				return true;
			default:
				return false;
		}
	}
);
