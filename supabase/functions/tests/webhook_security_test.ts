import { assertEquals } from "@std/assert";
import { verifyGithubWebhookSignature } from "../_shared/webhook-security.ts";

Deno.test("GitHub webhook signature validates the exact raw body", async () => {
  const body = new TextEncoder().encode('{"action":"opened","repository":{"id":123}}');
  const secret = "unit-test-webhook-secret";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, body);
  const hex = Array.from(new Uint8Array(signature), (value) => value.toString(16).padStart(2, "0")).join("");
  assertEquals(await verifyGithubWebhookSignature(body, "sha256=" + hex, secret), true);
  assertEquals(await verifyGithubWebhookSignature(body, "sha256=" + "0".repeat(64), secret), false);
  assertEquals(await verifyGithubWebhookSignature(body, null, secret), false);
  assertEquals(await verifyGithubWebhookSignature(new TextEncoder().encode("{}"), "sha256=" + hex, secret), false);
});
