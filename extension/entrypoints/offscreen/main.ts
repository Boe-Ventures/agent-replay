interface Capture {
  recorder: MediaRecorder;
  stream: MediaStream;
  sessionId: string;
  captureId: string;
  sidecarUrl: string;
  queue: Promise<void>;
  audioContext?: AudioContext;
  finalizing?: Promise<void>;
}

const captures = new Map<string, Capture>();
let lastError: string | null = null;

async function upload(capture: Capture, blob: Blob, final = false): Promise<void> {
  try {
    const response = await fetch(capture.sidecarUrl + "/api/v1/media", {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "video/webm",
        "X-Agent-Replay-Session": capture.sessionId,
        "X-Agent-Replay-Capture": capture.captureId,
        "X-Agent-Replay-Final": String(final),
      },
      body: blob,
    });
    if (!response.ok) throw new Error("Sidecar rejected demo media: " + response.status);
    lastError = null;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

function finalize(capture: Capture, requestStop = true): Promise<void> {
  if (capture.finalizing) return capture.finalizing;
  capture.finalizing = (async () => {
    if (requestStop && capture.recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        capture.recorder.addEventListener("stop", () => resolve(), { once: true });
        capture.recorder.stop();
      });
    }
    await capture.queue;
    await upload(capture, new Blob([], { type: capture.recorder.mimeType }), true);
    capture.stream.getTracks().forEach((track) => track.stop());
    await capture.audioContext?.close();
    captures.delete(capture.captureId);
    await chrome.runtime.sendMessage({ target: "background", type: "DEMO_FINISHED", captureId: capture.captureId });
  })();
  return capture.finalizing;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== "offscreen") return;
  void (async () => {
    if (message.type === "START_DEMO") {
      lastError = null;
      const constraints = {
        audio: message.audio ? { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: message.streamId } } : false,
        video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: message.streamId } },
      } as unknown as MediaStreamConstraints;
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const mimeCandidates = message.audio
        ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
        : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
      const mimeType = mimeCandidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
      const capture: Capture = {
        recorder, stream, sessionId: message.sessionId, captureId: message.captureId,
        sidecarUrl: message.sidecarUrl, queue: Promise.resolve(),
      };
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length) {
        capture.audioContext = new AudioContext();
        capture.audioContext.createMediaStreamSource(new MediaStream(audioTracks)).connect(capture.audioContext.destination);
      }
      recorder.ondataavailable = (event) => {
        if (event.data.size) capture.queue = capture.queue.then(() => upload(capture, event.data));
      };
      recorder.addEventListener("stop", () => { if (!capture.finalizing) void finalize(capture, false); });
      stream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => void finalize(capture)));
      recorder.start(1_000);
      captures.set(capture.captureId, capture);
      sendResponse({ ok: true });
    } else if (message.type === "GET_DEMO_STATUS") {
      sendResponse({
        captures: [...captures.values()].map((capture) => ({
          captureId: capture.captureId,
          sessionId: capture.sessionId,
          state: capture.recorder.state,
        })),
        lastError,
      });
    } else if (message.type === "STOP_DEMO") {
      const capture = captures.get(message.captureId);
      if (!capture) return sendResponse({ ok: true });
      await finalize(capture);
      sendResponse({ ok: true });
    }
  })().catch((error) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
  return true;
});
