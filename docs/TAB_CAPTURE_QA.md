# Chrome tab-capture release QA

Chrome intentionally requires a real user invocation of the extension action before `tabCapture` grants access. API-only automation cannot manufacture that permission, so the final true-pixel check is a short, deterministic browser acceptance test.

1. Build the package and extension:

   ```sh
   bun run build
   bun run --cwd extension build
   ```

2. Start the isolated harness:

   ```sh
   node scripts/extension-demo-harness.mjs
   ```

3. In the opened Chrome for Testing window, press **Control-Shift-R** on macOS (**Alt-Shift-R** elsewhere) to invoke the Agent Replay action, then select **Record polished demo**. The extension menu can be used instead when the action is pinned.
4. Follow the fixture's navigation link. Chrome must continue to show **Tab content shared**, and the destination must say **The recording survived navigation**.
5. Finalize without closing the browser:

   ```sh
   curl http://127.0.0.1:3899/__control/stop
   ```

6. Confirm that `.agent-replay-tab-capture-qa/sessions/<id>/media/<capture-id>.webm` exists with no `.partial` sibling, then validate it:

   ```sh
   ffprobe -v error -show_streams -show_format -of json <capture.webm>
   ```

Acceptance requires a VP8 or VP9 video stream, at least 800×600 resolution, duration greater than two seconds, representative frames from both fixture pages, and a clean stop after the navigation. The popup must show an explicit active/demo state while recording and return to the ordinary recording state after finalization.

This check was completed for v0.3.0 on July 15, 2026. One uninterrupted run
proved that the same capture remained in `recording` state before and after
navigation, finalized without a `.partial` sibling, and contained inspected
frames from both fixture pages. It exposed and verified fixes for
Chrome-extension write-only ingestion and idempotent offscreen finalization.

The silent fixture's optional Opus track still produces an FFmpeg packet-header
warning even though its VP9 video decodes completely. Tab audio is therefore
opt-in beta and remains a separate open acceptance item; the default
navigation-safe visual capture is verified.
