import { assertEquals } from "@std/assert";
import { parseAnalysis } from "../_shared/ai-analysis.ts";

function response(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    category: "Dependency installation",
    cause: "The package resolver reported a dependency conflict.",
    fix_steps: ["Review the package version constraints."],
    evidence: ["npm ERR! code ERESOLVE"],
    confidence: "high",
    ...overrides,
  });
}

Deno.test("AI analysis retains evidence snippets present in redacted source logs", () => {
  const analysis = parseAnalysis(
    response(),
    "Install dependencies\nnpm ERR! code ERESOLVE\nBuild failed",
  );
  assertEquals(analysis.evidence, ["npm ERR! code ERESOLVE"]);
  assertEquals(analysis.confidence, "high");
  assertEquals(analysis.fix_steps.length, 1);
});

Deno.test("AI analysis rejects invented evidence and downgrades confidence", () => {
  const analysis = parseAnalysis(
    response({
      evidence: [
        "npm ERR! code ERESOLVE",
        "Error: database password was rejected",
      ],
    }),
    "npm ERR! code ERESOLVE",
  );
  assertEquals(analysis.evidence, ["npm ERR! code ERESOLVE"]);
  assertEquals(analysis.confidence, "low");
  assertEquals(analysis.category, "unknown");
  assertEquals(analysis.fix_steps, []);
  assertEquals(
    analysis.cause,
    "Some cited evidence could not be verified against the workflow logs; the root cause remains uncertain.",
  );
});

Deno.test("AI analysis replaces the cause and fixes when no evidence is verifiable", () => {
  const analysis = parseAnalysis(
    response({
      cause: "The production database is definitely corrupted.",
      fix_steps: ["Delete the production database."],
      evidence: ["The database is corrupted at line 9000"],
      confidence: "high",
    }),
    "Build failed with an unknown error.",
  );
  assertEquals(
    analysis.cause,
    "Insufficient verifiable evidence in the workflow logs to identify a reliable root cause.",
  );
  assertEquals(analysis.fix_steps, []);
  assertEquals(analysis.evidence, []);
  assertEquals(analysis.confidence, "low");
  assertEquals(analysis.category, "unknown");
});

Deno.test("AI analysis normalizes whitespace when verifying evidence", () => {
  const analysis = parseAnalysis(
    response({ evidence: ["npm ERR!   code ERESOLVE"] }),
    "npm ERR!\n  code ERESOLVE",
  );
  assertEquals(analysis.evidence, ["npm ERR!   code ERESOLVE"]);
  assertEquals(analysis.confidence, "high");
});

Deno.test("AI analysis returns low confidence when provider supplies no evidence", () => {
  const analysis = parseAnalysis(
    response({ evidence: [], confidence: "medium" }),
    "There are logs but no cited evidence.",
  );
  assertEquals(analysis.evidence, []);
  assertEquals(analysis.fix_steps, []);
  assertEquals(analysis.confidence, "low");
});
