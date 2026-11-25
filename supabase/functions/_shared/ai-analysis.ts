import { HttpError } from "./http.ts";

export interface FailureAnalysis {
  category: string;
  cause: string;
  fix_steps: string[];
  evidence: string[];
  confidence: "high" | "medium" | "low";
}

function normalizeEvidence(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();
}

/**
 * Parses the provider response and retains only evidence snippets that can be
 * found in the already-redacted source logs. Evidence that cannot be verified
 * is never returned to the client as if it came from the logs.
 */
export function parseAnalysis(
  content: string,
  sourceLogs: string,
): FailureAnalysis {
  const cleaned = content.trim().replace(/^\u0060\u0060\u0060(?:json)?\s*/i, "")
    .replace(/\s*\u0060\u0060\u0060$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new HttpError(
      502,
      "AI_RESPONSE_INVALID",
      "The analysis provider returned an invalid response.",
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new HttpError(
      502,
      "AI_RESPONSE_INVALID",
      "The analysis provider returned an invalid response.",
    );
  }

  const value = parsed as Record<string, unknown>;
  const category = typeof value.category === "string"
    ? value.category.trim().slice(0, 80)
    : "";
  const cause = typeof value.cause === "string"
    ? value.cause.trim().slice(0, 2_000)
    : "";
  const confidence = value.confidence;
  const fixSteps = Array.isArray(value.fix_steps)
    ? value.fix_steps.filter((step): step is string => typeof step === "string")
      .slice(0, 10).map((step) => step.slice(0, 500))
    : [];
  const proposedEvidence = Array.isArray(value.evidence)
    ? value.evidence.filter((item): item is string => typeof item === "string")
      .slice(0, 10).map((item) => item.slice(0, 500))
    : [];

  if (
    !category || !cause ||
    (confidence !== "high" && confidence !== "medium" && confidence !== "low")
  ) {
    throw new HttpError(
      502,
      "AI_RESPONSE_INVALID",
      "The analysis provider response did not match the expected schema.",
    );
  }

  const normalizedLogs = normalizeEvidence(sourceLogs);
  const evidence = proposedEvidence.filter((item) => {
    const normalizedItem = normalizeEvidence(item);
    return normalizedItem.length >= 8 && normalizedLogs.includes(normalizedItem);
  });

  if (evidence.length === 0) {
    return {
      category,
      cause:
        "Insufficient verifiable evidence in the workflow logs to identify a reliable root cause.",
      fix_steps: [],
      evidence: [],
      confidence: "low",
    };
  }

  const hasUnverifiedEvidence = evidence.length !== proposedEvidence.length;
  return {
    category,
    cause,
    fix_steps: fixSteps,
    evidence,
    confidence: hasUnverifiedEvidence ? "low" : confidence,
  };
}
