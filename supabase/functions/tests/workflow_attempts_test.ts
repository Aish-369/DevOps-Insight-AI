import { assertEquals } from "@std/assert";
import { isFlakyWorkflowAttempts } from "../_shared/workflow-attempts.ts";

Deno.test("a failed first attempt followed by a successful latest retry is flaky", () => {
  assertEquals(isFlakyWorkflowAttempts([
    { run_attempt: 1, status: "completed", conclusion: "failure" },
    { run_attempt: 2, status: "completed", conclusion: "success" },
  ]), true);
});

Deno.test("a later failed attempt is not classified as recovered flaky", () => {
  assertEquals(isFlakyWorkflowAttempts([
    { run_attempt: 1, status: "completed", conclusion: "failure" },
    { run_attempt: 2, status: "completed", conclusion: "success" },
    { run_attempt: 3, status: "completed", conclusion: "failure" },
  ]), false);
});

Deno.test("an in-progress retry is not classified before completion", () => {
  assertEquals(isFlakyWorkflowAttempts([
    { run_attempt: 1, status: "completed", conclusion: "failure" },
    { run_attempt: 2, status: "in_progress", conclusion: null },
  ]), false);
});

Deno.test("a success without an earlier failure is not flaky", () => {
  assertEquals(isFlakyWorkflowAttempts([
    { run_attempt: 1, status: "completed", conclusion: "success" },
  ]), false);
});

Deno.test("attempt arrival order does not affect classification", () => {
  assertEquals(isFlakyWorkflowAttempts([
    { run_attempt: 2, status: "completed", conclusion: "success" },
    { run_attempt: 1, status: "completed", conclusion: "failure" },
  ]), true);
});
