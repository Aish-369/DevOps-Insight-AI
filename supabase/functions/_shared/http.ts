const DEFAULT_HEADERS = {
  "access-control-allow-headers":
    "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-max-age": "600",
  "vary": "Origin",
};

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return true;

  const configured = Deno.env.get("APP_BASE_URL")?.trim();
  if (configured) {
    try {
      if (new URL(configured).origin === origin) return true;
    } catch {
      return false;
    }
  }

  return !configured && isLoopbackOrigin(origin);
}

export function corsHeaders(request: Request): Headers {
  const headers = new Headers(DEFAULT_HEADERS);
  const origin = request.headers.get("origin");
  if (origin && isAllowedOrigin(origin)) {
    headers.set("access-control-allow-origin", origin);
  }
  return headers;
}

export function preflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") return null;
  const origin = request.headers.get("origin") ?? "";
  if (origin && !isAllowedOrigin(origin)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function jsonResponse(
  request: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  const headers = corsHeaders(request);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

export function assertAllowedOrigin(request: Request): void {
  const origin = request.headers.get("origin") ?? "";
  if (origin && !isAllowedOrigin(origin)) {
    throw new HttpError(
      403,
      "ORIGIN_NOT_ALLOWED",
      "This request origin is not allowed.",
    );
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function handleError(request: Request, error: unknown): Response {
  if (error instanceof HttpError) {
    return jsonResponse(
      request,
      { error: error.code, message: error.message },
      error.status,
    );
  }
  // Do not send database/provider response bodies or stack traces to browsers.
  return jsonResponse(
    request,
    {
      error: "INTERNAL_ERROR",
      message: "The request could not be completed. Please try again.",
    },
    500,
  );
}

const MAX_JSON_BODY_BYTES = 16_384;

/** Read raw request bytes without buffering an unbounded incoming body. */
export async function readRequestBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("The request byte limit must be a positive integer.");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new HttpError(
      413,
      "PAYLOAD_TOO_LARGE",
      "The request payload is too large.",
    );
  }

  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new HttpError(
          413,
          "PAYLOAD_TOO_LARGE",
          "The request payload is too large.",
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * Fetch an upstream service with a bounded lifetime. The timeout signal remains
 * attached to the response so a stalled response body is also aborted.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("The upstream timeout must be a positive integer.");
  }
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal });
  } catch (error) {
    if (signal.aborted) {
      throw new HttpError(
        504,
        "UPSTREAM_TIMEOUT",
        "An external service did not respond in time.",
      );
    }
    throw error;
  }
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: { timeoutMs?: number; maxRetries?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    throw new Error("Automatic retries are restricted to idempotent GET/HEAD requests.");
  }

  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxRetries = options.maxRetries ?? 2;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) {
    throw new Error("The retry count must be between zero and three.");
  }

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchWithTimeout(input, init, timeoutMs, fetchImpl);
    const retryable = [429, 500, 502, 503, 504].includes(response.status);
    if (!retryable || attempt === maxRetries) return response;

    const retryAfter = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfter === null ? Number.NaN : Number(retryAfter);
    const retryAfterDate = retryAfter === null ? Number.NaN : Date.parse(retryAfter);
    const delayMs = Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1_000
      : Number.isFinite(retryAfterDate)
      ? Math.max(0, retryAfterDate - Date.now())
      : 250 * (2 ** attempt);

    // Do not violate a provider's longer Retry-After window inside a short-lived function.
    if (delayMs > 2_000) return response;
    await response.body?.cancel();
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("Unreachable retry state.");
}

export async function readJsonObject(
  request: Request,
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new HttpError(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Send a JSON request body.",
    );
  }

  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let totalBytes = 0;
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        totalBytes += chunk.value.byteLength;
        if (totalBytes > MAX_JSON_BODY_BYTES) {
          await reader.cancel();
          throw new HttpError(
            413,
            "REQUEST_TOO_LARGE",
            "The request is too large.",
          );
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(
      400,
      "INVALID_JSON",
      "The request body is not valid JSON.",
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new HttpError(
      400,
      "INVALID_BODY",
      "The request body must be a JSON object.",
    );
  }

  return parsed as Record<string, unknown>;
}
