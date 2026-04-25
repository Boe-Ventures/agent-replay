# Network Interception Research for @boe-ventures/agent-replay

> Research date: 2025-04-25
> Purpose: Determine the best approach(es) for capturing network requests/responses in a local session recording package for AI coding agents.

## TL;DR Recommendation

**Dual-layer approach:**
1. **NPM package (core):** Monkey-patch `fetch` + `XMLHttpRequest` for request/response bodies, headers, timing. Use `PerformanceObserver` for accurate timing metrics. This is what PostHog and Sentry both do.
2. **Chrome extension (optional, premium):** Use `chrome.debugger` API (CDP) for response bodies without cloning, WebSocket frame capture, and Service Worker bypass. `chrome.webRequest` alone can't get response bodies in MV3.

For agent-replay specifically, the NPM-only approach covers 95% of use cases since agents interact with APIs via `fetch`/`XHR`. The extension layer is a nice-to-have for WebSocket debugging and opaque response scenarios.

---

## Comparison Table

| Capability | NPM Monkey-Patching | PerformanceObserver | Chrome Extension (webRequest) | Chrome Extension (debugger/CDP) | Service Worker |
|---|---|---|---|---|---|
| **Request URL** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Request method** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **Request headers** | ✅ (from args) | ❌ | ✅ | ✅ | ✅ |
| **Request body** | ✅ | ❌ | ✅ (MV2 only) | ✅ | ✅ |
| **Response status** | ✅ | ❌ | ✅ | ✅ | ✅ |
| **Response headers** | ⚠️ CORS limits | ❌ | ✅ | ✅ | ✅ |
| **Response body** | ⚠️ clone() needed | ❌ | ❌ (MV3) / ⚠️ ≤1MB (MV2) | ✅ (any size) | ✅ |
| **Timing (TTFB, duration)** | ⚠️ Date.now() | ✅ (high precision) | ✅ | ✅ | ⚠️ manual |
| **Transfer size** | ❌ | ✅ | ❌ | ✅ | ❌ |
| **DNS/TCP/TLS timing** | ❌ | ✅ | ❌ | ✅ | ❌ |
| **CORS-failed requests** | ⚠️ catch error only | ⚠️ partial | ✅ | ✅ | ❌ |
| **WebSocket messages** | ✅ (patch WebSocket) | ❌ | ❌ (handshake only) | ✅ | ❌ |
| **Streaming responses** | ⚠️ complex (tee()) | ❌ | ❌ | ✅ | ⚠️ complex |
| **No code changes needed** | ❌ (inject script) | ❌ (inject script) | ✅ | ✅ | ❌ |
| **Works in all browsers** | ✅ | ✅ | Chrome only | Chrome only | ✅ (modern) |
| **Self-request filtering** | Manual | Manual | Built-in URL filter | Built-in URL filter | Manual |
| **Bundle size impact** | Small (~5KB) | Tiny (~1KB) | N/A (separate) | N/A (separate) | Small |

---

## 1. PostHog's Approach

PostHog uses a **custom rrweb plugin** (`network-plugin.ts`) that monkey-patches `fetch` and `XMLHttpRequest`. Their implementation lives in `posthog-js/src/extensions/replay/external/network-plugin.ts` (MIT licensed, based on the unmerged rrweb network plugin PR #1105/#1689).

### Architecture
- **Two layers of capture:**
  1. `PerformanceObserver` — captures timing data (TTFB, transfer size, etc.) for all resource loads
  2. Monkey-patching `fetch`/`XHR` — captures request/response bodies, headers, status codes

- **Recording integration:** Network events are emitted as rrweb custom events, timestamped and included in the replay stream

### Key Patterns

#### Fetch Patching (PostHog style)
```typescript
// PostHog wraps the global fetch, clones the response to read the body
const originalFetch = window.fetch;
window.fetch = async function (...args) {
  const startTime = performance.now();
  const request = new Request(...args);
  
  // Capture request details BEFORE the call
  const requestHeaders = {};
  request.headers.forEach((v, k) => { requestHeaders[k] = v; });
  const requestBody = await getBodyFromRequest(request);
  
  try {
    const response = await originalFetch.apply(this, args);
    const endTime = performance.now();
    
    // Clone response to read body without consuming it
    const clonedResponse = response.clone();
    let responseBody;
    try {
      responseBody = await clonedResponse.text();
    } catch (e) {
      responseBody = '[Failed to read response body]';
    }
    
    recordNetworkEvent({
      method: request.method,
      url: request.url,
      requestHeaders,
      requestBody,
      status: response.status,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      responseBody,
      startTime,
      endTime,
      duration: endTime - startTime,
    });
    
    return response; // Return original, not clone
  } catch (error) {
    recordNetworkEvent({
      method: request.method,
      url: request.url,
      requestBody,
      error: error.message,
      startTime,
      endTime: performance.now(),
    });
    throw error;
  }
};
```

#### Self-Request Filtering
PostHog filters out its own analytics requests by checking the URL against known PostHog endpoints:
```typescript
// PostHog checks if URL matches their own API endpoints
const isPostHogRequest = (url: string) => {
  return url.includes('i.posthog.com') || 
         url.includes('/e/') || // their event endpoint
         url.includes('/decide/');
};
```
For agent-replay, we'd filter out our own recording upload URLs.

#### Streaming Response Handling
PostHog uses `response.clone()` and a **500ms timeout** for reading the body. If the body is a stream that doesn't resolve quickly, they give up:
```typescript
// From Sentry's implementation (PostHog does similar)
function _tryGetResponseText(response: Response): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timeout while trying to read response body')), 
      500
    );
    response.text()
      .then(txt => resolve(txt), reason => reject(reason))
      .finally(() => clearTimeout(timeout));
  });
}
```

#### CORS Header Limitations
PostHog documents that cross-origin response headers are NOT readable by JS unless the server sets `Access-Control-Expose-Headers`. This is a browser security limitation, not a code limitation. For agent-replay, this is less of an issue since the app and API are typically same-origin in dev.

---

## 2. Sentry's Approach

Sentry's replay SDK uses a **breadcrumb enrichment** pattern. The core Sentry SDK already patches `fetch`/`XHR` for error tracking, and the replay integration hooks into those breadcrumbs.

### Architecture
```
Sentry Core SDK
├── instrumentFetch() → patches window.fetch
├── instrumentXhr() → patches XMLHttpRequest.prototype.open/send
│   └── Emits breadcrumbs with: url, method, status_code, timestamps
│
Sentry Replay Integration  
├── handleNetworkBreadcrumbs() → hooks into client.on('beforeAddBreadcrumb')
│   ├── enrichFetchBreadcrumb() → adds request_body_size, response_body_size
│   ├── captureFetchBreadcrumbToReplay() → reads body, headers if URL is allowed
│   ├── enrichXhrBreadcrumb() → adds sizes from XHR object
│   └── captureXhrBreadcrumbToReplay() → reads body, headers if URL is allowed
```

### Key Patterns

#### URL-Based Allowlist for Body Capture
Sentry requires users to explicitly opt-in to body capture per URL. This is a PII protection measure:
```typescript
const captureDetails = 
  urlMatches(url, options.networkDetailAllowUrls) && 
  !urlMatches(url, options.networkDetailDenyUrls);

// Only capture headers/body if URL matches allowlist
const request = captureDetails
  ? _getRequestInfo(options, hint.input, requestBodySize)
  : buildSkippedNetworkRequestOrResponse(requestBodySize);
```

For agent-replay, we can default to capturing everything (since it's local-only, no PII concern for the agent).

#### XHR Response Body Extraction
Sentry handles different XHR `responseType` values:
```typescript
function _parseXhrResponse(
  body: XMLHttpRequest['response'],
  responseType: XMLHttpRequest['responseType'],
): [string | undefined, NetworkMetaWarning?] {
  if (typeof body === 'string') return [body];
  if (body instanceof Document) return [body.body.outerHTML];
  if (responseType === 'json' && body && typeof body === 'object') {
    return [JSON.stringify(body)];
  }
  if (!body) return [undefined];
  return [undefined, 'UNPARSEABLE_BODY_TYPE'];
}
```

#### XHR vs Fetch Response Size
- **XHR**: Can read `getResponseHeader('content-length')`, or fall back to measuring `xhr.response` directly
- **Fetch**: Can only read `Content-Length` header (if exposed). Reading the actual body size requires `response.clone()` + `blob()` which is expensive and async

#### Own-Request Filtering
Sentry uses `xhr.__sentry_own_request__` flag:
```typescript
// On outgoing Sentry requests, they set:
xhr.__sentry_own_request__ = true;
// Then in the breadcrumb handler:
if (handlerData.xhr.__sentry_own_request__) return; // skip
```

### Differences from PostHog
| Aspect | PostHog | Sentry |
|---|---|---|
| Patching layer | Custom rrweb plugin | Core SDK instrumentation + replay hook |
| Body capture default | Configurable per-project | Opt-in per URL allowlist |
| Streaming handling | 500ms timeout | 500ms timeout (same) |
| Response body (fetch) | `response.clone().text()` | `response.clone().text()` |
| Response body (XHR) | `xhr.responseText` + fallbacks | `xhr.responseText` + `xhr.response` parsing |
| Self-filtering | URL pattern matching | `__sentry_own_request__` flag |

---

## 3. rrweb Network Plugin Status

**There is NO official rrweb network plugin.** It's been an open issue since 2021 (#552) with two unmerged PRs:
- **PR #1105** (Jan 2023) — Original network plugin by `jlalmes`, never merged
- **PR #1689** (Apr 2025) — Follow-up by `crutch12`, still open

PostHog forked the original PR and maintains their own version in `posthog-js`. The PostHog maintainer (@pauldambra) confirmed this in PR #1689.

There's a third-party package `@sailfish-rrweb/rrweb-plugin-network-record` (v0.5.2) on npm that implements network recording as an rrweb plugin, but it's not widely used.

### What rrweb DOES have:
- `@rrweb/rrweb-plugin-console-record` — Console log capture (this is the pattern to follow)
- `@rrweb/rrweb-plugin-sequential-id-record` — Sequential ID tracking
- Custom event emission via `record.addCustomEvent()` — This is how PostHog emits network events

### Implication for agent-replay
Since we're not using rrweb for replay (we have our own DOM mutation observer), we can build a standalone network interceptor without worrying about rrweb plugin compatibility.

---

## 4. Chrome Extension Network Capture

### chrome.webRequest API
**Can capture:** URLs, methods, request headers, response headers, status codes, timing
**Cannot capture:** Response bodies (in MV3), individual WebSocket messages

```javascript
// Example: Capture all XHR/fetch requests
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // details.requestBody available with 'requestBody' in extraInfoSpec
    // But only for form data / raw bytes, not parsed JSON
    console.log('Request:', details.url, details.method);
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    console.log('Response:', details.url, details.statusCode);
    // NO response body available here!
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);
```

**Key limitations:**
- MV3 removed `webRequestBlocking` for non-policy extensions
- Response body is NOT available via webRequest at all
- WebSocket: Only handshake captured, not individual messages
- Request body: Only available as raw bytes or form data, not parsed

### chrome.debugger API (CDP)
**Can capture:** EVERYTHING — full request/response bodies, WebSocket frames, timing, etc.

```javascript
// Attach debugger to tab
chrome.debugger.attach({ tabId }, '1.3', () => {
  // Enable Network domain
  chrome.debugger.sendCommand({ tabId }, 'Network.enable');
});

// Listen for responses
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (method === 'Network.responseReceived') {
    // Get the full response body
    chrome.debugger.sendCommand(
      { tabId: source.tabId },
      'Network.getResponseBody',
      { requestId: params.requestId },
      (result) => {
        // result.body = full response text/base64
        // result.base64Encoded = true if binary
        console.log('Response body:', result.body);
      }
    );
  }
  
  // WebSocket frames!
  if (method === 'Network.webSocketFrameReceived') {
    console.log('WS frame:', params.response.payloadData);
  }
  if (method === 'Network.webSocketFrameSent') {
    console.log('WS sent:', params.response.payloadData);
  }
});
```

**Key limitations:**
- Shows a warning banner: "Extension is debugging this browser"
- Requires `debugger` permission in manifest
- Complex lifecycle management (attach/detach on tab navigation)
- Performance overhead for high-traffic apps
- Only works in Chrome/Chromium

### Service Worker Interception
A Service Worker can intercept all `fetch` requests from the page:

```javascript
// sw.js
self.addEventListener('fetch', (event) => {
  const request = event.request.clone();
  
  event.respondWith(
    fetch(event.request).then(response => {
      const cloned = response.clone();
      
      // Log to IndexedDB or postMessage to page
      cloned.text().then(body => {
        self.clients.matchAll().then(clients => {
          clients.forEach(client => {
            client.postMessage({
              type: 'network-capture',
              url: request.url,
              method: request.method,
              status: response.status,
              responseBody: body,
            });
          });
        });
      });
      
      return response;
    })
  );
});
```

**Advantages:** Captures all fetch traffic, can read response bodies
**Limitations:**
- Only intercepts `fetch`, not `XMLHttpRequest`
- Requires registration and page reload to activate
- Complex lifecycle (install → activate → fetch events)
- Can't capture requests that bypass the service worker (e.g., WebSocket)
- Conflicts with existing service workers (PWA, etc.)

---

## 5. Gotchas and Edge Cases

### Response Body Reading
- **`response.clone()` is mandatory** for fetch — the body can only be read once
- **Streaming responses (ReadableStream):** Must use `response.clone()` + `tee()` or timeout. Both PostHog and Sentry use a 500ms timeout
- **Large responses:** Should cap body size (PostHog caps at ~1MB). For agent-replay, we probably want full bodies since it's local
- **Binary responses:** `response.blob()` for images/files, but probably skip these for agent-replay

### XHR Gotchas
- **`xhr.responseType = 'json'`:** Response is a POJO, not a string. Must `JSON.stringify()` it (Sentry discovered this bug in production, PR #9623)
- **`xhr.responseType = 'arraybuffer'` or `'blob'`:** Can't easily stringify, skip or base64-encode
- **`xhr.responseText` throws** if `responseType` is not `''` or `'text'`

### Monkey-Patching Risks
- **Other libraries may also patch:** Sentry, PostHog, DataDog, etc. all monkey-patch fetch/XHR
  - Solution: Store reference to `__rrweb_original__` or `__original_fetch__`, check for it
  - Always call the "current" implementation, not a stored original (to maintain the chain)
- **Prototype chain:** Some libraries patch `XMLHttpRequest.prototype.open/send` vs wrapping the constructor
- **Frameworks that polyfill:** Angular's zone.js patches everything. React Native uses a different fetch

### Timing Accuracy
- `Date.now()` — millisecond precision, but affected by system clock changes
- `performance.now()` — sub-millisecond, monotonic, preferred
- `PerformanceObserver` — gives you the real Resource Timing data (DNS, TCP, TTFB, etc.)

### Self-Request Filtering
Multiple approaches:
1. **URL pattern matching** (PostHog): Check if URL contains your own API endpoint
2. **Request flag** (Sentry): Set a flag like `xhr.__agent_replay_own_request__ = true`
3. **Custom header** : Add `X-Agent-Replay-Internal: true` to your own requests

---

## 6. Amplitude's Approach

Amplitude's session replay SDK (`@amplitude/plugin-session-replay-browser`) captures **network errors only**, not full network traffic. Their approach:

- Uses the Browser SDK's built-in event capture (Analytics Browser SDK v2.24.0+)
- Captures failed network requests and API calls
- Captures console errors/warnings
- Does NOT capture request/response bodies
- Does NOT provide network waterfall/timeline

This is significantly less capable than PostHog/Sentry for network inspection. Not useful as a reference for agent-replay.

---

## 7. Recommended Architecture for agent-replay

### Phase 1: NPM Package (Core)
```
agent-replay/src/interceptors/
├── network.ts          # Main orchestrator
├── fetch-interceptor.ts    # Monkey-patches window.fetch
├── xhr-interceptor.ts      # Monkey-patches XMLHttpRequest  
├── websocket-interceptor.ts # Monkey-patches WebSocket
├── performance-observer.ts  # PerformanceObserver for timing
└── types.ts                # NetworkEvent types
```

#### Fetch Interceptor
```typescript
export function patchFetch(onEvent: (event: NetworkEvent) => void): () => void {
  const originalFetch = window.fetch;
  
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const startTime = performance.now();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    
    // Capture request body
    let requestBody: string | undefined;
    const body = init?.body || (input instanceof Request ? input.body : undefined);
    if (body && typeof body === 'string') {
      requestBody = body;
    } else if (body instanceof FormData) {
      requestBody = '[FormData]';
    } else if (body instanceof ReadableStream) {
      requestBody = '[ReadableStream]';
    }
    
    // Capture request headers
    const requestHeaders: Record<string, string> = {};
    const headers = init?.headers || (input instanceof Request ? input.headers : undefined);
    if (headers instanceof Headers) {
      headers.forEach((v, k) => { requestHeaders[k] = v; });
    } else if (headers && typeof headers === 'object') {
      Object.entries(headers).forEach(([k, v]) => { requestHeaders[k] = String(v); });
    }
    
    try {
      const response = await originalFetch.apply(this, [input, init]);
      const endTime = performance.now();
      
      // Clone to read body without consuming
      let responseBody: string | undefined;
      let responseHeaders: Record<string, string> = {};
      
      try {
        response.headers.forEach((v, k) => { responseHeaders[k] = v; });
      } catch {}
      
      try {
        const cloned = response.clone();
        // Timeout to handle streaming responses
        responseBody = await Promise.race([
          cloned.text(),
          new Promise<string>((_, reject) => 
            setTimeout(() => reject(new Error('timeout')), 2000)
          ),
        ]);
      } catch {
        responseBody = undefined; // streaming or timeout
      }
      
      onEvent({
        type: 'fetch',
        timestamp: Date.now(),
        method,
        url,
        requestHeaders,
        requestBody,
        status: response.status,
        statusText: response.statusText,
        responseHeaders,
        responseBody,
        duration: endTime - startTime,
        startTime,
        endTime,
      });
      
      return response;
    } catch (error) {
      const endTime = performance.now();
      onEvent({
        type: 'fetch',
        timestamp: Date.now(),
        method,
        url,
        requestHeaders,
        requestBody,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
        duration: endTime - startTime,
        startTime,
        endTime,
      });
      throw error;
    }
  };
  
  // Return unpatch function
  return () => { window.fetch = originalFetch; };
}
```

#### XHR Interceptor
```typescript
export function patchXHR(onEvent: (event: NetworkEvent) => void): () => void {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  
  XMLHttpRequest.prototype.open = function (method: string, url: string, ...rest: any[]) {
    this.__agentReplay = { method, url, requestHeaders: {}, startTime: 0 };
    return originalOpen.apply(this, [method, url, ...rest]);
  };
  
  XMLHttpRequest.prototype.setRequestHeader = function (name: string, value: string) {
    if (this.__agentReplay) {
      this.__agentReplay.requestHeaders[name] = value;
    }
    return originalSetRequestHeader.apply(this, [name, value]);
  };
  
  XMLHttpRequest.prototype.send = function (body?: any) {
    if (this.__agentReplay) {
      this.__agentReplay.startTime = performance.now();
      this.__agentReplay.requestBody = typeof body === 'string' ? body : undefined;
    }
    
    this.addEventListener('loadend', () => {
      if (!this.__agentReplay) return;
      const endTime = performance.now();
      const { method, url, requestHeaders, requestBody, startTime } = this.__agentReplay;
      
      // Parse response headers
      const responseHeaders: Record<string, string> = {};
      const rawHeaders = this.getAllResponseHeaders();
      rawHeaders.split('\r\n').forEach(line => {
        const [key, ...vals] = line.split(': ');
        if (key) responseHeaders[key.toLowerCase()] = vals.join(': ');
      });
      
      // Get response body
      let responseBody: string | undefined;
      try {
        if (this.responseType === '' || this.responseType === 'text') {
          responseBody = this.responseText;
        } else if (this.responseType === 'json') {
          responseBody = JSON.stringify(this.response);
        }
      } catch {}
      
      onEvent({
        type: 'xhr',
        timestamp: Date.now(),
        method,
        url,
        requestHeaders,
        requestBody,
        status: this.status,
        statusText: this.statusText,
        responseHeaders,
        responseBody,
        duration: endTime - startTime,
        startTime,
        endTime,
      });
    });
    
    return originalSend.apply(this, [body]);
  };
  
  return () => {
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
    XMLHttpRequest.prototype.setRequestHeader = originalSetRequestHeader;
  };
}
```

#### WebSocket Interceptor (Bonus)
```typescript
export function patchWebSocket(onEvent: (event: NetworkEvent) => void): () => void {
  const OriginalWebSocket = window.WebSocket;
  
  window.WebSocket = function (url: string | URL, protocols?: string | string[]) {
    const ws = new OriginalWebSocket(url, protocols);
    const wsUrl = typeof url === 'string' ? url : url.href;
    
    ws.addEventListener('message', (event) => {
      onEvent({
        type: 'ws-receive',
        timestamp: Date.now(),
        url: wsUrl,
        responseBody: typeof event.data === 'string' ? event.data : '[Binary]',
      });
    });
    
    const originalSend = ws.send.bind(ws);
    ws.send = function (data: any) {
      onEvent({
        type: 'ws-send',
        timestamp: Date.now(),
        url: wsUrl,
        requestBody: typeof data === 'string' ? data : '[Binary]',
      });
      return originalSend(data);
    };
    
    return ws;
  } as any;
  
  // Copy static properties
  Object.assign(window.WebSocket, OriginalWebSocket);
  window.WebSocket.prototype = OriginalWebSocket.prototype;
  
  return () => { window.WebSocket = OriginalWebSocket; };
}
```

### Phase 2: PerformanceObserver Integration
```typescript
export function observePerformance(onEvent: (data: PerformanceTiming) => void): () => void {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.entryType === 'resource') {
        const resource = entry as PerformanceResourceTiming;
        onEvent({
          url: resource.name,
          initiatorType: resource.initiatorType, // 'fetch', 'xmlhttprequest', 'script', etc.
          startTime: resource.startTime,
          duration: resource.duration,
          redirectTime: resource.redirectEnd - resource.redirectStart,
          dnsTime: resource.domainLookupEnd - resource.domainLookupStart,
          tcpTime: resource.connectEnd - resource.connectStart,
          tlsTime: resource.secureConnectionStart > 0 
            ? resource.connectEnd - resource.secureConnectionStart : 0,
          ttfb: resource.responseStart - resource.requestStart,
          downloadTime: resource.responseEnd - resource.responseStart,
          transferSize: resource.transferSize,
          encodedBodySize: resource.encodedBodySize,
          decodedBodySize: resource.decodedBodySize,
        });
      }
    }
  });
  
  observer.observe({ type: 'resource', buffered: true });
  return () => observer.disconnect();
}
```

### Phase 3: Chrome Extension (Future)
Only if we need:
- WebSocket frame capture without monkey-patching
- Response bodies for opaque/CORS responses
- Network capture without any code injection

Use `chrome.debugger` API — `webRequest` alone isn't enough for response bodies.

---

## 8. Key Decisions for agent-replay

| Decision | Recommendation | Rationale |
|---|---|---|
| **Capture bodies by default?** | Yes | Local tool, no PII risk. Agents need full bodies. |
| **Body size limit?** | 1MB, configurable | Prevent memory issues with large downloads |
| **Timeout for streaming bodies?** | 2s (vs PostHog/Sentry's 500ms) | Agents may hit slow APIs, 2s is acceptable |
| **Capture WebSocket?** | Yes, Phase 1 | Many dev tools (HMR, DevTools) use WS |
| **PerformanceObserver?** | Yes | Free timing data, no patching needed |
| **Self-request filtering?** | URL pattern + header flag | Simple and reliable |
| **Store raw vs structured?** | Structured JSON | Easier for agents to query/analyze |
| **Chrome extension?** | Phase 2/3 | NPM package handles 95% of cases |

---

## References

- PostHog network plugin: `posthog-js/src/extensions/replay/external/network-plugin.ts` (MIT)
- Sentry replay network: `sentry-javascript/packages/replay-internal/src/coreHandlers/handleNetworkBreadcrumbs.ts`
- Sentry fetch utils: `sentry-javascript/packages/replay-internal/src/coreHandlers/util/fetchUtils.ts`
- Sentry XHR utils: `sentry-javascript/packages/replay-internal/src/coreHandlers/util/xhrUtils.ts`
- rrweb network plugin PR: https://github.com/rrweb-io/rrweb/pull/1689
- Chrome webRequest API: https://developer.chrome.com/docs/extensions/reference/api/webRequest
- Chrome debugger API: https://developer.chrome.com/docs/extensions/reference/api/debugger
