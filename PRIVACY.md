# Privacy Policy — Site Accessibility Auditor

Site Accessibility Auditor is a Chrome DevTools extension that audits web pages for accessibility issues. This policy describes what data the extension handles and where it goes.

## What the extension accesses

- **Page content of the inspected tab.** When you run an audit, the extension reads the DOM and captures a screenshot of the page open in the tab you are inspecting with DevTools. This is used solely to compute accessibility results (touch target sizes, reading order, interactive states, color contrast, and chart readability) shown to you in the DevTools panels.
- **Your OpenAI API key (optional).** If you enable AI-assisted analysis, you provide your own OpenAI API key in the extension settings.

## Where data is stored

All data is stored locally on your machine using Chrome's `chrome.storage.local`:

- Your OpenAI API key
- Audit history and extension settings

Nothing is stored on our servers. We do not operate any servers and have no access to your data.

## What data is transmitted, and to whom

- **OpenAI (optional, user-initiated only).** When you explicitly run an AI-assisted color or chart analysis, the relevant page data (such as extracted colors, chart images, or page screenshots) is sent to the OpenAI API (`api.openai.com`) using your own API key. This happens only when you trigger it and never automatically. OpenAI's handling of that data is governed by the [OpenAI API privacy policy](https://openai.com/policies/privacy-policy).
- **No one else.** The extension makes no other network requests. No analytics, telemetry, tracking, or advertising of any kind.

## What we do not do

- We do not collect, sell, or transfer user data to third parties.
- We do not use data for any purpose unrelated to accessibility auditing.
- We do not log your browsing history, clicks, keystrokes, or any user activity.
- We do not use or transfer user data to determine creditworthiness or for lending purposes.

## Data removal

To remove all locally stored data (API key, audit history, settings), remove the extension from Chrome, or clear its storage via the extension settings.

## Contact

Questions or concerns: open an issue at [https://github.com/EpiForeSITE/site-accessibility-auditor/issues](https://github.com/EpiForeSITE/site-accessibility-auditor/issues).
