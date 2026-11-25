import { assertEquals, assertRejects } from "@std/assert";
import {
  fetchWithRetry,
  fetchWithTimeout,
  HttpError,
  readJsonObject,
  readResponseBytes,
} from "../_shared/http.ts";

Deno.test("readJsonObject parses a bounded JSON object", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ team_id: "team-1" }),
  });

  assertEquals(await readJsonObject(request), { team_id: "team-1" });
});

Deno.test("readJsonObject rejects an oversized body while streaming", async () => {
  const request = new Request("https://example.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "x".repeat(17_000) }),
  });

  const error = await assertRejects(
    () => readJsonObject(request),
    HttpError,
  );
  assertEquals(error.status, 413);
  assertEquals(error.code, "REQUEST_TOO_LARGE");
});

Deno.test("fetchWithTimeout converts an upstream timeout to HTTP 504", async () => {
  const stalledFetch: typeof fetch = (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("Expected an abort signal."));
        return;
      }
      signal.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });

  const error = await assertRejects(
    () => fetchWithTimeout("https://example.test", {}, 5, stalledFetch),
    HttpError,
  );
  assertEquals(error.status, 504);
  assertEquals(error.code, "UPSTREAM_TIMEOUT");
});

Deno.test("fetchWithRetry retries transient idempotent reads", async () => {
  let calls = 0;
  const transientFetch: typeof fetch = () => {
    calls += 1;
    if (calls === 1) {
      return Promise.resolve(
        new Response("temporarily unavailable", {
          status: 503,
          headers: { "retry-after": "0" },
        }),
      );
    }
    return Promise.resolve(new Response("ok", { status: 200 }));
  };

  const response = await fetchWithRetry(
    "https://example.test",
    {},
    { timeoutMs: 100, maxRetries: 1 },
    transientFetch,
  );
  assertEquals(response.status, 200);
  assertEquals(calls, 2);
});

Deno.test("fetchWithRetry refuses to retry non-idempotent requests", async () => {
  const unusedFetch: typeof fetch = () => {
    throw new Error("Fetch must not run for a rejected method.");
  };
  const error = await assertRejects(
    () =>
      fetchWithRetry(
        "https://example.test",
        { method: "POST" },
        { maxRetries: 1 },
        unusedFetch,
      ),
    Error,
  );
  assertEquals(
    error.message,
    "Automatic retries are restricted to idempotent GET/HEAD requests.",
  );
});

Deno.test("fetchWithRetry retries GitHub primary rate-limit 403 responses", async () => {
  let calls = 0;
  const rateLimitedFetch: typeof fetch = () => {
    calls += 1;
    if (calls === 1) {
      return Promise.resolve(
        new Response("rate limited", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0", "retry-after": "0" },
        }),
      );
    }
    return Promise.resolve(new Response("ok", { status: 200 }));
  };

  const response = await fetchWithRetry(
    "https://api.github.com",
    {},
    { timeoutMs: 100, maxRetries: 1 },
    rateLimitedFetch,
  );
  assertEquals(response.status, 200);
  assertEquals(calls, 2);
});


Deno.test("readResponseBytes reads an upstream body within its hard limit", async () => {
  const response = new Response(new Uint8Array([1, 2, 3]));
  assertEquals(
    Array.from(await readResponseBytes(response, 3)),
    [1, 2, 3],
  );
});

Deno.test("readResponseBytes rejects oversized streamed bodies without content length", async () => {
  const response = new Response(new Uint8Array([1, 2, 3, 4, 5]));
  const error = await assertRejects(
    () => readResponseBytes(response, 4, "ARCHIVE_TOO_LARGE"),
    HttpError,
  );
  assertEquals(error.status, 413);
  assertEquals(error.code, "ARCHIVE_TOO_LARGE");
});

Deno.test("readResponseBytes enforces the stream cap when content length is misleading", async () => {
  const response = new Response(new Uint8Array([1, 2, 3, 4, 5]), {
    headers: { "content-length": "2" },
  });
  const error = await assertRejects(
    () => readResponseBytes(response, 4, "ARCHIVE_TOO_LARGE"),
    HttpError,
  );
  assertEquals(error.status, 413);
  assertEquals(error.code, "ARCHIVE_TOO_LARGE");
});

Deno.test("readResponseBytes rejects a declared oversized body before reading it", async () => {
  const response = new Response(new Uint8Array([1, 2]), {
    headers: { "content-length": "20" },
  });
  const error = await assertRejects(
    () => readResponseBytes(response, 4, "ARCHIVE_TOO_LARGE"),
    HttpError,
  );
  assertEquals(error.status, 413);
  assertEquals(error.code, "ARCHIVE_TOO_LARGE");
});
