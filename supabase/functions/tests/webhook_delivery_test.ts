import { assertEquals } from "@std/assert";
import { getWebhookDeliveryDisposition } from "../_shared/webhook-delivery.ts";
import type { ExistingWebhookDelivery } from "../_shared/webhook-delivery.ts";

const now = Date.parse("2026-11-25T12:00:00.000Z");

function delivery(
  overrides: Partial<ExistingWebhookDelivery> = {},
): ExistingWebhookDelivery {
  return {
    status: "failed",
    attempts: 1,
    processing_started_at: null,
    dead: false,
    ...overrides,
  };
}

Deno.test("processed webhook deliveries are treated as terminal duplicates", () => {
  assertEquals(
    getWebhookDeliveryDisposition(delivery({ status: "processed" }), now),
    { kind: "terminal_duplicate" },
  );
});

Deno.test("unmatched webhook deliveries are not reprocessed on duplicate delivery", () => {
  assertEquals(
    getWebhookDeliveryDisposition(delivery({ status: "unmatched" }), now),
    { kind: "terminal_duplicate" },
  );
});

Deno.test("dead-lettered webhook deliveries are terminal duplicates", () => {
  assertEquals(
    getWebhookDeliveryDisposition(delivery({ dead: true }), now),
    { kind: "terminal_duplicate" },
  );
});

Deno.test("a recently claimed webhook delivery is not processed concurrently", () => {
  assertEquals(
    getWebhookDeliveryDisposition(
      delivery({
        status: "processing",
        processing_started_at: new Date(now - 60_000).toISOString(),
      }),
      now,
    ),
    { kind: "processing_duplicate" },
  );
});

Deno.test("a stale processing claim can be retried with an incremented attempt", () => {
  assertEquals(
    getWebhookDeliveryDisposition(
      delivery({
        status: "processing",
        attempts: 3,
        processing_started_at: new Date(now - 6 * 60_000).toISOString(),
      }),
      now,
    ),
    { kind: "retry", attempts: 4 },
  );
});

Deno.test("failed webhook delivery is retried below the attempt limit", () => {
  assertEquals(
    getWebhookDeliveryDisposition(delivery({ attempts: 7 }), now),
    { kind: "retry", attempts: 8 },
  );
});

Deno.test("webhook delivery at the attempt limit is dead-lettered", () => {
  assertEquals(
    getWebhookDeliveryDisposition(delivery({ attempts: 8 }), now),
    { kind: "dead_letter", attempts: 8 },
  );
});
