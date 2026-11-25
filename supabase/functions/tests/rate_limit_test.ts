import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { rateLimitKeyHash } from "../_shared/rate-limit.ts";

Deno.test("rate-limit keys are stable SHA-256 hashes", async () => {
  const first = await rateLimitKeyHash(
    "00000000-0000-0000-0000-000000000001",
    "dispatch-alerts",
  );
  const second = await rateLimitKeyHash(
    "00000000-0000-0000-0000-000000000001",
    "dispatch-alerts",
  );
  assertEquals(first, second);
  assertMatch(first, /^[0-9a-f]{64}$/);
});

Deno.test("rate-limit keys are isolated by user and endpoint", async () => {
  const base = await rateLimitKeyHash("user-a", "dispatch-alerts");
  const otherUser = await rateLimitKeyHash("user-b", "dispatch-alerts");
  const otherEndpoint = await rateLimitKeyHash(
    "user-a",
    "verify-alert-channel",
  );
  assertNotEquals(base, otherUser);
  assertNotEquals(base, otherEndpoint);
});
