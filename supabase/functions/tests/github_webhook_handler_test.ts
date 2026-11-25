import { assertEquals } from "@std/assert";
import { handleGithubWebhook } from "../github-webhook/handler.ts";
import type { WebhookHandlerDependencies } from "../github-webhook/handler.ts";

const TEST_SECRET = "webhook-handler-test-secret";

function dependencies(
  overrides: Partial<WebhookHandlerDependencies> = {},
): WebhookHandlerDependencies {
  return {
    getSecret: () => TEST_SECRET,
    createAdminClient: () => {
      throw new Error("Database client must not be created for this request.");
    },
    ...overrides,
  };
}

async function signature(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TEST_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  const hex = Array.from(
    new Uint8Array(digest),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  return "sha256=" + hex;
}

async function request(
  body: string,
  event = "ping",
  delivery = "delivery-test-1",
): Promise<Request> {
  return new Request("https://example.test/github-webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": await signature(body),
      "x-github-event": event,
      "x-github-delivery": delivery,
    },
    body,
  });
}

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

Deno.test("webhook handler rejects methods other than POST", async () => {
  const response = await handleGithubWebhook(
    new Request("https://example.test/github-webhook", { method: "GET" }),
    dependencies(),
  );
  assertEquals(response.status, 405);
  assertEquals(await responseBody(response), { error: "METHOD_NOT_ALLOWED" });
});

Deno.test("webhook handler rejects missing server configuration", async () => {
  const response = await handleGithubWebhook(
    new Request("https://example.test/github-webhook", {
      method: "POST",
      body: "{}",
    }),
    dependencies({ getSecret: () => undefined }),
  );
  assertEquals(response.status, 503);
  assertEquals(await responseBody(response), {
    error: "WEBHOOK_NOT_CONFIGURED",
  });
});

Deno.test("webhook handler rejects oversized request bodies", async () => {
  const response = await handleGithubWebhook(
    new Request("https://example.test/github-webhook", {
      method: "POST",
      body: "x".repeat(2_000_001),
    }),
    dependencies(),
  );
  assertEquals(response.status, 413);
  assertEquals(await responseBody(response), { error: "PAYLOAD_TOO_LARGE" });
});

Deno.test("webhook handler rejects invalid signatures before database access", async () => {
  const body = "{}";
  const req = new Request("https://example.test/github-webhook", {
    method: "POST",
    headers: {
      "x-hub-signature-256": "sha256=" + "0".repeat(64),
      "x-github-event": "ping",
      "x-github-delivery": "delivery-invalid-signature",
    },
    body,
  });
  const response = await handleGithubWebhook(req, dependencies());
  assertEquals(response.status, 401);
  assertEquals(await responseBody(response), { error: "INVALID_SIGNATURE" });
});

Deno.test("webhook handler rejects missing delivery and event headers", async () => {
  const body = "{}";
  const req = new Request("https://example.test/github-webhook", {
    method: "POST",
    headers: { "x-hub-signature-256": await signature(body) },
    body,
  });
  const response = await handleGithubWebhook(req, dependencies());
  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), {
    error: "INVALID_WEBHOOK_HEADERS",
  });
});

Deno.test("webhook handler rejects malformed JSON after signature verification", async () => {
  const req = await request("{", "ping", "delivery-invalid-json");
  const response = await handleGithubWebhook(req, dependencies());
  assertEquals(response.status, 400);
  assertEquals(await responseBody(response), { error: "INVALID_WEBHOOK_JSON" });
});

Deno.test("webhook handler acknowledges unsupported events without database access", async () => {
  const req = await request(
    "{}",
    "deployment_status",
    "delivery-unsupported-event",
  );
  const response = await handleGithubWebhook(req, dependencies());
  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { ok: true, ignored: true });
});
