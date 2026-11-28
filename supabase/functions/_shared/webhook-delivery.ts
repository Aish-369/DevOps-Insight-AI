export interface ExistingWebhookDelivery {
  status: string;
  attempts: number | null;
  processing_started_at: string | null;
  dead: boolean;
}

export type WebhookDeliveryDisposition =
  | { kind: "terminal_duplicate" }
  | { kind: "processing_duplicate" }
  | { kind: "dead_letter"; attempts: number }
  | { kind: "retry"; attempts: number };

const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 8;

export function getWebhookDeliveryDisposition(
  delivery: ExistingWebhookDelivery,
  nowMs: number,
): WebhookDeliveryDisposition {
  if (
    delivery.status === "processed" ||
    delivery.status === "unmatched" ||
    delivery.dead
  ) {
    return { kind: "terminal_duplicate" };
  }

  const processingStartedAt = delivery.processing_started_at
    ? Date.parse(delivery.processing_started_at)
    : 0;
  const currentlyProcessing = delivery.status === "processing" &&
    Number.isFinite(processingStartedAt) &&
    nowMs - processingStartedAt < PROCESSING_TIMEOUT_MS;

  if (currentlyProcessing) return { kind: "processing_duplicate" };

  const currentAttempts = Number(delivery.attempts ?? 0);
  if (currentAttempts >= MAX_DELIVERY_ATTEMPTS) {
    return { kind: "dead_letter", attempts: currentAttempts };
  }

  return { kind: "retry", attempts: currentAttempts + 1 };
}
