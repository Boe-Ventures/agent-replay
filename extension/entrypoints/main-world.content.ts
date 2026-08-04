import type { eventWithTime } from "@rrweb/types";
import { record } from "@rrweb/record";
import { getRecordConsolePlugin } from "@rrweb/rrweb-plugin-console-record";

declare global { interface Window { __AGENT_REPLAY_ACTIVE__?: boolean | string } }

export default defineContentScript({
  matches: ["http://localhost:*/*", "http://127.0.0.1:*/*"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    const SOURCE = "agent-replay-main-v1";
    let started = false;
    let deciding = false;
    let sessionStart = Date.now();
    const emit = (type: string, data: unknown) => window.postMessage({ source: SOURCE, type: "EVENT", signal: type, data }, "*");
    const plainJson = (value: unknown): unknown => {
      try {
        return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? String(item) : item)) as unknown;
      } catch {
        return undefined;
      }
    };
    const sensitive = /authorization|cookie|password|secret|token|api[-_]?key|session/i;
    const redact = (value: string) => value.replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [REDACTED]");
    const headers = (input: Headers) => Object.fromEntries([...input.entries()].map(([key, value]) => [key, sensitive.test(key) ? "[REDACTED]" : redact(value)]));
    const requestBody = (body: BodyInit | null | undefined) => {
      if (typeof body === "string") return body.slice(0, 16 * 1024);
      if (body instanceof URLSearchParams) return body.toString().slice(0, 16 * 1024);
      if (body instanceof Blob) return `[Blob: ${body.size} bytes, ${body.type || "unknown"}]`;
      if (body instanceof ArrayBuffer) return `[ArrayBuffer: ${body.byteLength} bytes]`;
      if (ArrayBuffer.isView(body)) return `[${body.constructor.name}: ${body.byteLength} bytes]`;
      if (body instanceof FormData) return "[FormData: values masked]";
      if (body instanceof ReadableStream) return "[ReadableStream]";
      return undefined;
    };
    const target = (element: EventTarget | null) => {
      if (!(element instanceof Element)) return {};
      return {
        target: element.id ? "#" + CSS.escape(element.id) : element.tagName.toLowerCase() + (element.getAttribute("name") ? `[name="${CSS.escape(element.getAttribute("name")!)}"]` : ""),
        text: (element.getAttribute("aria-label") || element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
      };
    };

    const start = () => {
      if (started) return;
      if (window.__AGENT_REPLAY_ACTIVE__) {
        window.postMessage({ source: SOURCE, type: "PROVIDER_DETECTED" }, "*");
        return;
      }
      started = true;
      sessionStart = Date.now();
      window.__AGENT_REPLAY_ACTIVE__ = "extension";

      record({
        emit(event: eventWithTime) {
          emit("rrweb", event);
          if (event.type === 6) {
            const data = (event as unknown as { data?: { plugin?: string; payload?: { level?: string; payload?: unknown[]; trace?: string[] } } }).data;
            if (data?.plugin === "rrweb/console@1" && data.payload) {
              const entry = {
                timestamp: Date.now(), offsetMs: Date.now() - sessionStart,
                level: data.payload.level, args: data.payload.payload ?? [], trace: data.payload.trace?.join("\n"),
              };
              emit("console", entry);
              if (data.payload.level === "error") emit("error", { ...entry, message: (data.payload.payload ?? []).map(String).join(" "), type: "console-error", source: "console" });
            }
          }
        },
        plugins: [getRecordConsolePlugin({ level: ["log", "info", "warn", "error", "debug"], lengthThreshold: 500 })],
        maskAllInputs: true,
        sampling: { mousemove: 50, mouseInteraction: true, scroll: 150, input: "last" },
        checkoutEveryNms: 30_000,
      });

      const originalFetch = window.fetch;
      window.fetch = async function (input, init) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("127.0.0.1:3700") || url.includes("localhost:3700")) return originalFetch.call(this, input, init);
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const requestHeaderBag = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => requestHeaderBag.set(key, value));
        const body = init?.body ?? (input instanceof Request ? input.body : undefined);
        const before = performance.now();
        try {
          const response = await originalFetch.call(this, input, init);
          const now = Date.now();
          const base = {
            timestamp: now, offsetMs: now - sessionStart, requestId: crypto.randomUUID(), method, url,
            status: response.status, statusText: response.statusText, durationMs: performance.now() - before,
            responseHeaders: headers(response.headers), contentType: response.headers.get("content-type") ?? undefined,
            requestHeaders: headers(requestHeaderBag), requestBody: requestBody(body),
            isError: response.status >= 400, initiator: "fetch",
          };
          void (async () => {
            let responseBody: string | undefined;
            const contentType = response.headers.get("content-type") ?? "";
            if (new URL(url, location.href).origin === location.origin && /^(text\/|application\/json)/i.test(contentType)) {
              try { responseBody = redact((await response.clone().text()).slice(0, 16 * 1024)); } catch { /* stream or locked */ }
            }
            emit("network", { ...base, responseBody });
          })();
          if (response.status >= 500) emit("error", { timestamp: now, offsetMs: now - sessionStart, message: `${method} ${url} returned ${response.status}`, type: "network", source: "network" });
          return response;
        } catch (error) {
          const now = Date.now();
          emit("network", { timestamp: now, offsetMs: now - sessionStart, method, url, status: null, durationMs: performance.now() - before, error: error instanceof Error ? error.message : String(error), isError: true, initiator: "fetch" });
          throw error;
        }
      };

      const xhrPrototype = XMLHttpRequest.prototype;
      const xhrOpen = xhrPrototype.open;
      const xhrSend = xhrPrototype.send;
      const xhrSetRequestHeader = xhrPrototype.setRequestHeader;
      type CapturedXhr = XMLHttpRequest & { __arMethod?: string; __arUrl?: string; __arStart?: number; __arHeaders?: Record<string, string>; __arBody?: string };
      (xhrPrototype as unknown as { open: typeof xhrOpen }).open = function (this: CapturedXhr, method: string, url: string | URL, ...rest: unknown[]) {
        this.__arMethod = method;
        this.__arUrl = String(url);
        this.__arHeaders = {};
        return (xhrOpen as unknown as (...args: unknown[]) => void).call(this, method, url, ...rest);
      } as typeof xhrOpen;
      xhrPrototype.setRequestHeader = function (this: CapturedXhr, name: string, value: string) {
        (this.__arHeaders ??= {})[name] = sensitive.test(name) ? "[REDACTED]" : redact(value);
        return xhrSetRequestHeader.call(this, name, value);
      };
      (xhrPrototype as unknown as { send: typeof xhrSend }).send = function (this: CapturedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
        if ((this.__arUrl ?? "").includes("127.0.0.1:3700")) return xhrSend.call(this, body);
        this.__arStart = performance.now();
        this.__arBody = requestBody(body instanceof Document ? undefined : body) ?? undefined;
        this.addEventListener("loadend", () => {
          const now = Date.now();
          let responseBody: string | undefined;
          try {
            const sameOrigin = new URL(this.__arUrl ?? "", location.href).origin === location.origin;
            const contentType = this.getResponseHeader("content-type") ?? "";
            if (sameOrigin && /^(text\/|application\/json)/i.test(contentType) && (!this.responseType || this.responseType === "text")) {
              responseBody = redact(this.responseText.slice(0, 16 * 1024));
            }
          } catch { /* binary or inaccessible response */ }
          emit("network", {
            timestamp: now, offsetMs: now - sessionStart, requestId: crypto.randomUUID(),
            method: (this.__arMethod ?? "GET").toUpperCase(), url: this.__arUrl ?? "",
            status: this.status || null, statusText: this.statusText,
            durationMs: performance.now() - (this.__arStart ?? performance.now()),
            requestHeaders: this.__arHeaders, requestBody: this.__arBody,
            responseHeaders: Object.fromEntries(this.getAllResponseHeaders().trim().split(/[\r\n]+/).filter(Boolean).map((line) => {
              const index = line.indexOf(":");
              const name = index < 0 ? line : line.slice(0, index).trim();
              const value = index < 0 ? "" : line.slice(index + 1).trim();
              return [name, sensitive.test(name) ? "[REDACTED]" : redact(value)];
            })),
            responseBody, contentType: this.getResponseHeader("content-type") ?? undefined,
            isError: this.status === 0 || this.status >= 400, initiator: "xhr",
          });
        }, { once: true });
        return xhrSend.call(this, body);
      } as typeof xhrSend;

      const NativeWebSocket = window.WebSocket;
      window.WebSocket = new Proxy(NativeWebSocket, {
        construct(Target, args: [string | URL, string | string[] | undefined]) {
          const socket = args[1] === undefined ? new Target(args[0]) : new Target(args[0], args[1]);
          const url = String(args[0]);
          socket.addEventListener("open", () => emit("websocket", { timestamp: Date.now(), offsetMs: Date.now() - sessionStart, url, direction: "open" }));
          socket.addEventListener("message", (event) => emit("websocket", { timestamp: Date.now(), offsetMs: Date.now() - sessionStart, url, direction: "receive", data: typeof event.data === "string" ? redact(event.data.slice(0, 16 * 1024)) : "[binary]" }));
          socket.addEventListener("close", (event) => emit("websocket", { timestamp: Date.now(), offsetMs: Date.now() - sessionStart, url, direction: "close", code: event.code, reason: event.reason }));
          socket.addEventListener("error", () => emit("websocket", { timestamp: Date.now(), offsetMs: Date.now() - sessionStart, url, direction: "error" }));
          const send = socket.send.bind(socket);
          socket.send = (data) => {
            emit("websocket", { timestamp: Date.now(), offsetMs: Date.now() - sessionStart, url, direction: "send", data: typeof data === "string" ? redact(data.slice(0, 16 * 1024)) : "[binary]" });
            return send(data);
          };
          return socket;
        },
      });

      if (typeof PerformanceObserver !== "undefined") {
        for (const entryType of ["navigation", "paint", "largest-contentful-paint", "longtask"]) {
          try {
            const observer = new PerformanceObserver((list) => list.getEntries().forEach((entry) => emit("performance", {
              timestamp: Date.now(), offsetMs: Date.now() - sessionStart, name: entry.name,
              entryType: entry.entryType, duration: entry.duration, startTime: entry.startTime,
              detail: typeof entry.toJSON === "function" ? plainJson(entry.toJSON()) : undefined,
            })));
            observer.observe({ type: entryType, buffered: true });
          } catch { /* unsupported entry type */ }
        }
      }

      const onError = (event: ErrorEvent) => emit("error", {
        timestamp: Date.now(), offsetMs: Date.now() - sessionStart, message: event.message,
        source: event.filename, line: event.lineno, column: event.colno, stack: event.error?.stack, type: "error",
      });
      const onRejection = (event: PromiseRejectionEvent) => emit("error", {
        timestamp: Date.now(), offsetMs: Date.now() - sessionStart,
        message: event.reason instanceof Error ? event.reason.message : String(event.reason),
        stack: event.reason instanceof Error ? event.reason.stack : undefined, type: "unhandledrejection",
      });
      addEventListener("error", onError);
      addEventListener("unhandledrejection", onRejection);
      for (const kind of ["click", "input", "change", "submit"]) {
        document.addEventListener(kind, (event) => {
          const element = event.target;
          const value = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? "[MASKED]" : undefined;
          emit("interaction", { timestamp: Date.now(), offsetMs: Date.now() - sessionStart, type: kind, ...target(element), value, x: event instanceof MouseEvent ? event.clientX : undefined, y: event instanceof MouseEvent ? event.clientY : undefined });
        }, true);
      }
      let previous = location.href;
      const route = (navigationType: string) => {
        const next = location.href;
        if (next !== previous) {
          emit("route-change", { timestamp: Date.now(), offsetMs: Date.now() - sessionStart, from: previous, to: next, navigationType });
          previous = next;
        }
      };
      const push = history.pushState;
      const replace = history.replaceState;
      history.pushState = function (...args) { const result = push.apply(this, args); queueMicrotask(() => route("push")); return result; };
      history.replaceState = function (...args) { const result = replace.apply(this, args); queueMicrotask(() => route("replace")); return result; };
      addEventListener("popstate", () => route("pop"));
      emit("route-change", { timestamp: Date.now(), offsetMs: 0, from: "", to: location.href, navigationType: "load" });
      window.postMessage({ source: SOURCE, type: "STARTED" }, "*");
    };

    const decide = async () => {
      if (started || deciding) return;
      deciding = true;
      for (let attempt = 0; attempt < 30; attempt++) {
        if (window.__AGENT_REPLAY_ACTIVE__) {
          window.postMessage({ source: SOURCE, type: "PROVIDER_DETECTED" }, "*");
          deciding = false;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      deciding = false;
      start();
    };

    addEventListener("message", (event) => {
      if (event.source === window && event.data?.source === "agent-replay-isolated-v1" && event.data.type === "INIT") void decide();
    });
  },
});
