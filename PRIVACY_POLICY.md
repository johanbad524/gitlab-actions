# Privacy Policy — GitLab MR Actions

**Last updated:** May 2026

## Overview

GitLab MR Actions is a browser extension that adds one-click action buttons and UX enhancements to GitLab merge request pages, with optional Jira integration. This policy describes how the extension handles your data.

## Data Collection

**This extension does not collect, store, or transmit any personal data to third parties.**

No analytics, telemetry, tracking, or advertising is included.

## Data Usage

### GitLab API

The extension communicates exclusively with your GitLab instance (the one you are currently browsing). It uses your existing browser session cookies to authenticate API requests — the same cookies your browser already sends when you use GitLab normally. No API tokens are required or stored.

API calls are made to perform actions you explicitly trigger (rebase, merge, version bump, etc.) and to read MR metadata displayed in the UI.

### Jira API (Optional)

If you configure a Jira URL in settings, the extension reads your Jira session cookies via the `chrome.cookies` API to fetch ticket statuses and details. This data is:
- Fetched directly from your Jira instance
- Cached locally in memory for up to 5 minutes to reduce API calls
- Never sent anywhere else

You must explicitly grant host permission for your Jira domain before this feature activates.

### Local Storage

The extension uses `chrome.storage.sync` to save your settings (button toggles, version bump config, Jira URL, etc.). This data syncs across your Chrome browsers via your Google account, as is standard for Chrome extensions. No other data is stored persistently.

### Cookies

The extension reads cookies only for:
- **GitLab**: Session cookies on the GitLab page you are visiting (via standard `credentials: 'same-origin'` fetch)
- **Jira**: Session cookies for the Jira domain you configure (via `chrome.cookies` API, requires explicit permission grant)

Cookies are read for authentication purposes only and are never copied, stored, or transmitted to any third party.

## Permissions Explained

| Permission | Purpose |
|-----------|---------|
| `storage` | Save your extension settings |
| `notifications` | Show desktop notifications when background jobs complete |
| `tabs` | Relay API calls between background worker and content scripts |
| `cookies` | Read Jira session cookies for authentication (Jira integration only) |
| `optional_host_permissions` | Access Jira API on the domain you specify (granted on demand) |

## Data Sharing

No data is shared with third parties. All communication happens exclusively between your browser and your own GitLab/Jira instances.

## Open Source

This extension is open source. You can review the full source code to verify these claims.

## Contact

If you have questions about this privacy policy, please open an issue on the GitHub repository.
