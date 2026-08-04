import type {
  AgentReplayEvent,
  InteractionEntry,
  NetworkEntry,
  PageMetadata,
  PrivacyPreset,
  RecorderConfig,
  RedactionConfig,
  SessionMetadata,
} from "./types.js";

const DEFAULT_REPLACEMENT = "[REDACTED]";
const SECRET_NAME = /(?:^|[-_.])(authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|session(?:id)?|credential|private[-_]?key|client[-_]?secret|refresh[-_]?token|access[-_]?token)(?:$|[-_.])/i;
const TEXT_CONTENT = /^(?:text\/|application\/(?:json|ld\+json|xml|x-www-form-urlencoded|graphql)|image\/svg\+xml)/i;

function configuredPatterns(config?: RedactionConfig): RegExp[] {
  const values = [
    ...(config?.fieldNames ?? []),
    ...(config?.headerNames ?? []),
    ...(config?.queryParameters ?? []),
    ...(config?.jsonKeys ?? []),
  ];
  return values.map((name) => new RegExp(name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"), "i"));
}

export function isSensitiveName(name: string, config?: RedactionConfig): boolean {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const builtIn = SECRET_NAME.test(name)
    || normalized.includes("authorization")
    || normalized.includes("password")
    || normalized.includes("passwd")
    || normalized.includes("secret")
    || normalized.includes("token")
    || normalized.includes("apikey")
    || normalized.includes("sessionid")
    || normalized.includes("privatekey")
    || normalized.includes("credential")
    || normalized === "cookie"
    || normalized === "setcookie";
  return builtIn || configuredPatterns(config).some((pattern) => pattern.test(name));
}

export function redactText(value: string, config?: RedactionConfig): string {
  const replacement = config?.replacement ?? DEFAULT_REPLACEMENT;
  return value
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, "$1 " + replacement)
    .replace(
      /(["']?(?:password|secret|token|api[-_]?key|session(?:id)?|authorization)["']?\s*[:=]\s*)["']?[^"'\s,}]+["']?/gi,
      "$1\"" + replacement + "\"",
    );
}

export function redactHeaders(
  headers: Record<string, string> | undefined,
  config?: RedactionConfig,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const replacement = config?.replacement ?? DEFAULT_REPLACEMENT;
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      isSensitiveName(key, config) ? replacement : redactText(value, config),
    ]),
  );
}

export function redactUrl(value: string, config?: RedactionConfig): string {
  try {
    const base = typeof location === "undefined" ? "http://localhost" : location.href;
    const url = new URL(value, base);
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveName(key, config)) {
        url.searchParams.set(key, config?.replacement ?? DEFAULT_REPLACEMENT);
      }
    }
    return url.toString();
  } catch {
    return redactText(value, config);
  }
}

export function redactStructured(value: unknown, config?: RedactionConfig): unknown {
  const replacement = config?.replacement ?? DEFAULT_REPLACEMENT;
  if (Array.isArray(value)) return value.map((item) => redactStructured(item, config));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        isSensitiveName(key, config) ? replacement : redactStructured(item, config),
      ]),
    );
  }
  return typeof value === "string" ? redactText(value, config) : value;
}

export function redactBody(
  body: string | undefined,
  contentType: string | undefined,
  maxBytes: number,
  config?: RedactionConfig,
): string | undefined {
  if (body == null) return undefined;
  if (contentType && !TEXT_CONTENT.test(contentType)) return undefined;
  let result = body;
  try {
    result = JSON.stringify(redactStructured(JSON.parse(body), config));
  } catch {
    result = redactText(body, config);
  }
  if (new TextEncoder().encode(result).byteLength > maxBytes) {
    return result.slice(0, maxBytes) + "…[truncated]";
  }
  return result;
}

function privacyLimits(preset: PrivacyPreset) {
  if (preset === "diagnostic") return { bodyBytes: 64 * 1024, headers: true, bodies: true, values: true };
  if (preset === "demo") return { bodyBytes: 0, headers: false, bodies: false, values: true };
  return { bodyBytes: 16 * 1024, headers: true, bodies: true, values: false };
}

export function sanitizeNetworkEntry(
  entry: NetworkEntry,
  preset: PrivacyPreset,
  config?: RedactionConfig,
  pageUrl?: string,
): NetworkEntry {
  const limits = privacyLimits(preset);
  const sameOrigin = (() => {
    try {
      return !pageUrl || new URL(entry.url, pageUrl).origin === new URL(pageUrl).origin;
    } catch {
      return false;
    }
  })();
  const contentType = entry.contentType ?? entry.responseHeaders?.["content-type"] ?? entry.responseHeaders?.["Content-Type"];
  return {
    ...entry,
    url: redactUrl(entry.url, config),
    requestHeaders: limits.headers ? redactHeaders(entry.requestHeaders, config) : undefined,
    responseHeaders: limits.headers ? redactHeaders(entry.responseHeaders, config) : undefined,
    requestBody: limits.bodies && sameOrigin
      ? redactBody(entry.requestBody, entry.requestHeaders?.["content-type"], limits.bodyBytes, config)
      : undefined,
    responseBody: limits.bodies && sameOrigin
      ? redactBody(entry.responseBody, contentType, limits.bodyBytes, config)
      : undefined,
  };
}

export function sanitizeSessionMetadata(
  metadata: SessionMetadata,
  config?: RedactionConfig,
): SessionMetadata {
  return {
    ...metadata,
    url: redactUrl(metadata.url, config),
    metadata: metadata.metadata
      ? redactStructured(metadata.metadata, config) as Record<string, unknown>
      : undefined,
  };
}

export function sanitizePageMetadata(
  metadata: PageMetadata | undefined,
  config?: RedactionConfig,
): PageMetadata | undefined {
  return metadata ? { ...metadata, url: redactUrl(metadata.url, config) } : undefined;
}

export function sanitizeEvent(
  event: AgentReplayEvent,
  config: Pick<RecorderConfig, "privacyPreset" | "redaction">,
  pageUrl?: string,
): AgentReplayEvent {
  const preset = config.privacyPreset ?? "safe";
  if (event.type === "network") {
    return { ...event, data: sanitizeNetworkEntry(event.data as NetworkEntry, preset, config.redaction, pageUrl) };
  }
  if (event.type === "interaction") {
    const interaction = event.data as InteractionEntry;
    const value = interaction.value == null
      ? undefined
      : preset === "safe"
        ? "[MASKED]"
        : redactText(interaction.value, config.redaction);
    return { ...event, data: { ...interaction, value } };
  }
  if (event.type === "console") {
    const data = event.data as import("./types.js").ConsoleEntry;
    return {
      ...event,
      data: { ...data, args: (data.args ?? []).map((arg) => redactStructured(arg, config.redaction)) },
    };
  }
  return { ...event, data: redactStructured(event.data, config.redaction) as AgentReplayEvent["data"] };
}
