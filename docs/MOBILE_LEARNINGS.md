# Mobile E2E Learnings

_From testing Wander PR #753 on iOS simulator — April 2026_

## Maestro on iOS 26.x Beta

### Tab bar accessibility labels
Tab bar items have accessibility labels that DON'T match the visible text:
- Visible: "Trips" → Accessibility: `"Travel History, tab, 2 of 4"`
- Visible: "Explore" → Accessibility: `"Where to next?, tab, 1 of 4"`
- Always use the existing Maestro flows to discover the correct labels
- `maestro hierarchy` dumps the full accessibility tree (but strip the first 2 lines before parsing as JSON)

### Point taps are unreliable for system UI
- `tapOn: point: "147,833"` doesn't reliably hit tab bar items
- Safe area offsets, Dynamic Island, and scale factors cause coordinate mismatches
- Always prefer text/id-based selectors over coordinates

### Maestro crashes on iOS 26.x
- `kAXErrorInvalidUIElement` when SpringBoard crashes or during screen transitions
- `maestro hierarchy` hangs indefinitely on some screens
- SpringBoard itself can SIGSEGV (beta instability, not our fault)
- Workaround: reboot simulator (`xcrun simctl shutdown all && xcrun simctl boot <name>`)

### Dismiss system dialogs first
- Notification permission prompts (`"Fitness" Would Like to Send You Notifications`) block Maestro
- `xcrun simctl privacy booted grant notifications <app>` doesn't work on iOS 26
- Must dismiss via Maestro tap or wait for them to clear

## Component State Isolation

### FirstTimeBooker vs UpcomingTrips
The Wander Trips tab has TWO possible views:
- `FirstTimeBooker` — shown when `trips?.length === 0` (user has NEVER had a trip)
- `TripsListWrapper` → `TripsList` → `TabView(Upcoming/Active/Past)` — shown when user has had at least one trip

This means testing the Upcoming empty state requires a user who:
1. Has had at least one trip in the past (so TripsList renders)
2. Has no currently upcoming trips (so UpcomingTrips shows empty state)

### Forcing component state for screenshots
When you can't reach the right state via navigation:
1. Force-skip conditionals: `false && trips?.length === 0`
2. Force feature flags: `const FeatureFlag_x = true`
3. Force empty data: `data={[]}`
4. Take screenshot
5. Revert all changes

This is a legitimate testing pattern — you're testing the rendered output, not the data flow.

## Guerrilla Mail + Mobile Auth
- Guerrilla Mail worked for Wander web E2E but NOT mobile auth
- OTP emails never arrived after 60+ seconds of polling
- Possible causes: Postmark blocklist update, different email provider for mobile, rate limiting
- The existing Maestro flows (`create-inbox.js` + `poll-otp.js`) assume Guerrilla Mail works
- May need an alternative disposable email provider or a pre-authenticated simulator snapshot

## Simulator Management
- `xcrun simctl boot <name>` / `xcrun simctl shutdown all` for lifecycle
- `xcrun simctl launch booted <bundle-id>` to open app
- `xcrun simctl io booted screenshot <path>` for screenshots
- `xcrun simctl list devices booted` to check state
- `xcrun simctl list runtimes` to see available iOS versions
- No `xcrun simctl io tap` command exists — must use Maestro or AppleScript

## Image Upload for PR Reviews
- GitHub has NO API for uploading images to PR comments
- img402.dev: free tier, one curl, 7-day retention, perfect for PR reviews
  ```bash
  sips -Z 800 screenshot.png --out small.png  # resize under 1MB
  curl -s -X POST https://img402.dev/api/free -F image=@small.png
  # → {"url": "https://i.img402.dev/abc123.png"}
  ```
- Embed in PR comment: `![Description](https://i.img402.dev/abc123.png)`

## Relevance to agent-replay

These learnings directly inform agent-replay's mobile support (Phase 3):
- **State isolation is hard** — agents need to force component state, not navigate to it
- **System dialogs block automation** — agent-replay should capture these as events
- **Network interception matters more on mobile** — can't inspect DevTools in simulator
- **Screenshot + structured data** — both are needed (visual for layout verification, structured for debugging)
