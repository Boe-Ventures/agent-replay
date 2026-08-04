# Agent Replay Chrome extension privacy disclosure

Agent Replay is a local developer tool. It records only pages served from `localhost` or `127.0.0.1`, and it sends evidence only to the Agent Replay sidecar at `127.0.0.1:3700`.

## Data handled

While active on a local development page, the extension may capture DOM changes, semantic clicks and form changes, console output, JavaScript errors, route changes, performance entries, fetch/XHR/WebSocket metadata, and size-limited same-origin text bodies. All form values are masked. Authorization values, cookies, passwords, secrets, tokens, API keys, session identifiers, credentials, and equivalent structured fields are redacted before local persistence.

The user-initiated **Record polished demo** control uses Chrome tab capture to record the active tab's pixels. Tab audio is off by default and may be enabled as a beta option. Source media is streamed in chunks to the local sidecar and retained as WebM. Agent Replay does not request microphone access.

## Storage and transfer

- No Agent Replay account is required.
- No evidence is sent to Boe Ventures or another hosted service.
- Structured recordings and media stay in the user's local Agent Replay directory.
- `chrome.storage.session` stores only temporary tab/session identity and recording status so navigation does not split a recording.
- Retention, deletion, export, and disk quotas are controlled by the local Agent Replay CLI.

## Permissions

- `activeTab`: identify the tab selected by the user for demo recording.
- `storage`: preserve temporary session identity across navigation.
- `tabCapture`: capture the selected tab after an explicit user action.
- `offscreen`: keep MediaRecorder alive in an MV3 offscreen document while the popup is closed.
- Host access to `localhost` and `127.0.0.1`: instrument local development pages and connect to the local sidecar.

Agent Replay does not sell data, use recordings for advertising, or perform remote code execution.
