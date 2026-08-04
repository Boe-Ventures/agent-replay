import { describe, expect, test } from "bun:test";
import * as crypto from "node:crypto";
import { parseTransportPayload } from "../../src/core/schema.js";
import { isSensitiveName, redactBody, redactHeaders, sanitizeNetworkEntry, sanitizeSessionMetadata } from "../../src/core/privacy.js";
import { event, metadata } from "./helpers.js";

describe("schema and privacy contract", () => {
  test("accepts UUID-addressed event envelopes", () => {
    const session = metadata();
    const value = event(session.id, "marker", { timestamp: Date.now(), offsetMs: 0, label: "ready" });
    expect(parseTransportPayload({ events: [value], sessionMetadata: session }).events[0]?.id).toBe(value.id);
  });

  test("rejects path-like session IDs", () => {
    const value = event(crypto.randomUUID(), "marker", { timestamp: Date.now(), offsetMs: 0, label: "bad" });
    value.sessionId = "../../escape";
    expect(() => parseTransportPayload({ events: [value] })).toThrow();
  });

  test("redacts headers, JSON keys, query secrets, and bearer values", () => {
    expect(redactHeaders({ Authorization: "Bearer abc", cookie: "sid=secret", Accept: "text/plain" })).toEqual({
      Authorization: "[REDACTED]", cookie: "[REDACTED]", Accept: "text/plain",
    });
    expect(redactBody('{"email":"hello@example.com","password":"hunter2","nested":{"apiKey":"abc"}}', "application/json", 16_384))
      .toBe('{"email":"hello@example.com","password":"[REDACTED]","nested":{"apiKey":"[REDACTED]"}}');
    expect(redactBody('{"debugToken":"never","sessionIdentifier":"never","ordinary":"kept"}', "application/json", 16_384))
      .toBe('{"debugToken":"[REDACTED]","sessionIdentifier":"[REDACTED]","ordinary":"kept"}');
    expect(isSensitiveName("debugToken")).toBe(true);
    expect(isSensitiveName("apiKey")).toBe(true);
  });

  test("redacts session URLs and arbitrary metadata before persistence", () => {
    const safe = sanitizeSessionMetadata({
      ...metadata(),
      url: "http://localhost:3000/orders?api_key=never&filter=open",
      metadata: { debugToken: "never", fixture: "BugBoard" },
    });
    expect(safe.url).toContain("api_key=%5BREDACTED%5D");
    expect(safe.url).toContain("filter=open");
    expect(safe.metadata).toEqual({ debugToken: "[REDACTED]", fixture: "BugBoard" });
  });

  test("safe mode keeps small same-origin text and strips cross-origin bodies", () => {
    const base = {
      timestamp: 1, offsetMs: 0, method: "POST", url: "http://localhost:3000/api",
      status: 200, durationMs: 10, requestHeaders: { authorization: "secret", "content-type": "application/json" },
      responseHeaders: { "content-type": "application/json" }, requestBody: '{"token":"abc","name":"Ada"}',
      responseBody: '{"ok":true}', isError: false, initiator: "fetch" as const,
    };
    const safe = sanitizeNetworkEntry(base, "safe", undefined, "http://localhost:3000/");
    expect(safe.requestHeaders?.authorization).toBe("[REDACTED]");
    expect(safe.requestBody).toContain("[REDACTED]");
    expect(sanitizeNetworkEntry({ ...base, url: "https://example.com/api" }, "safe", undefined, "http://localhost:3000/").responseBody).toBeUndefined();
    expect(sanitizeNetworkEntry(base, "demo", undefined, "http://localhost:3000/").requestHeaders).toBeUndefined();
  });
});
