import { assertEquals } from "@std/assert";
import { analyzeLogsWithRules } from "../_shared/rule-analysis.ts";

Deno.test("rule analysis identifies npm dependency resolution failures with exact evidence", () => {
  const analysis = analyzeLogsWithRules(
    "Installing packages\nnpm ERR! code ERESOLVE\nBuild failed",
  );
  assertEquals(analysis.category, "dependency-conflict");
  assertEquals(analysis.evidence, ["npm ERR! code ERESOLVE"]);
  assertEquals(analysis.confidence, "medium");
  assertEquals(analysis.fix_steps.length, 2);
});

Deno.test("rule analysis identifies TypeScript compiler diagnostics", () => {
  const analysis = analyzeLogsWithRules(
    "Checking types\nsrc/app.ts(12,4): error TS2322: Type mismatch",
  );
  assertEquals(analysis.category, "typescript");
  assertEquals(
    analysis.evidence,
    ["src/app.ts(12,4): error TS2322: Type mismatch"],
  );
});

Deno.test("rule analysis identifies missing modules", () => {
  const analysis = analyzeLogsWithRules(
    "Build started\nError: Cannot find module 'missing-package'",
  );
  assertEquals(analysis.category, "missing-module");
  assertEquals(analysis.evidence.length, 1);
});

Deno.test("rule analysis does not invent a cause when no known signature exists", () => {
  const analysis = analyzeLogsWithRules(
    "Starting workflow\nStep failed\nProcess completed with exit code 1",
  );
  assertEquals(analysis.category, "unknown");
  assertEquals(analysis.evidence, []);
  assertEquals(analysis.confidence, "low");
  assertEquals(analysis.fix_steps.length, 2);
});

Deno.test("rule analysis limits evidence to one bounded source line", () => {
  const longLine = "npm ERR! code ERESOLVE " + "x".repeat(800);
  const analysis = analyzeLogsWithRules(longLine);
  assertEquals(analysis.evidence.length, 1);
  assertEquals(analysis.evidence[0].length, 500);
});
