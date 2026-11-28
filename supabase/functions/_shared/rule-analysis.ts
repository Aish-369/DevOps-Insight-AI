export interface FailureAnalysis {
  category: string;
  cause: string;
  fix_steps: string[];
  evidence: string[];
  confidence: "high" | "medium" | "low";
}

interface DiagnosticRule {
  pattern: RegExp;
  category: string;
  cause: string;
  fixSteps: string[];
}

const RULES: DiagnosticRule[] = [
  {
    pattern: /npm ERR! code ERESOLVE|unable to resolve dependency tree/i,
    category: "dependency-conflict",
    cause: "The package manager could not resolve compatible dependency versions.",
    fixSteps: [
      "Review the conflicting package versions in package.json and the lockfile.",
      "Reproduce with the repository's documented Node.js and npm versions before changing dependencies.",
    ],
  },
  {
    pattern: /Cannot find module|Module not found|ERR_MODULE_NOT_FOUND/i,
    category: "missing-module",
    cause: "The build or test process could not resolve a required module.",
    fixSteps: [
      "Confirm the module is declared in the correct dependencies section.",
      "Check import path casing and ensure the lockfile is in sync.",
    ],
  },
  {
    pattern: /error TS\d+:/i,
    category: "typescript",
    cause: "The TypeScript compiler reported a type or compilation error.",
    fixSteps: [
      "Open the first TypeScript diagnostic and inspect the referenced file and line.",
      "Correct the type or source issue, then rerun the same typecheck command.",
    ],
  },
  {
    pattern: /ESLint .*error|\berror\s+[\w-]+\s+.+\s+at\s+.+:\d+:\d+/i,
    category: "lint",
    cause: "The lint step reported a code-quality or rule violation.",
    fixSteps: [
      "Review the exact lint diagnostic and fix the source issue rather than disabling the rule globally.",
      "Rerun the repository's lint command.",
    ],
  },
  {
    pattern: /AssertionError|\b(failed|failing)\s+tests?\b|Tests? failed/i,
    category: "test-failure",
    cause: "A test assertion or test case failed.",
    fixSteps: [
      "Inspect the first failing test and its expected-versus-actual output.",
      "Reproduce the failure locally before changing implementation or test expectations.",
    ],
  },
  {
    pattern: /EACCES|permission denied|Operation not permitted/i,
    category: "permissions",
    cause: "The process was denied permission to access a resource.",
    fixSteps: [
      "Check the affected path's ownership and least-privilege permissions.",
      "Avoid running the workflow with elevated privileges unless the repository explicitly requires it.",
    ],
  },
  {
    pattern: /ETIMEDOUT|ECONNREFUSED|ENOTFOUND|network timeout|socket hang up/i,
    category: "network",
    cause: "A network request failed or could not reach its destination.",
    fixSteps: [
      "Verify the target service URL and availability from the workflow environment.",
      "Check whether the failure is transient and use bounded retries only for safe idempotent requests.",
    ],
  },
  {
    pattern: /failed to solve|Dockerfile parse error|docker build failed/i,
    category: "docker-build",
    cause: "The container image build failed.",
    fixSteps: [
      "Inspect the first Docker build error and the corresponding Dockerfile instruction.",
      "Reproduce the build with the same build context and arguments before changing the image.",
    ],
  },
];

function findEvidenceLine(logs: string, pattern: RegExp): string | null {
  for (const line of logs.split(/\r?\n/)) {
    if (pattern.test(line)) return line.trim().slice(0, 500);
  }
  return null;
}

/**
 * Deterministic, zero-provider-cost CI diagnostics. This is deliberately not
 * described as an LLM result: it only reports a cause when a known signature
 * is present in the redacted source logs.
 */
export function analyzeLogsWithRules(logs: string): FailureAnalysis {
  for (const rule of RULES) {
    const evidence = findEvidenceLine(logs, rule.pattern);
    if (evidence) {
      return {
        category: rule.category,
        cause: rule.cause,
        fix_steps: [...rule.fixSteps],
        evidence: [evidence],
        confidence: "medium",
      };
    }
  }

  return {
    category: "unknown",
    cause: "No known failure signature was detected. The logs need manual review; no root cause can be asserted safely.",
    fix_steps: [
      "Open the failed job in GitHub Actions and inspect the earliest error preceding the final failure summary.",
      "Review the surrounding log context and rerun only after identifying a safe, testable correction.",
    ],
    evidence: [],
    confidence: "low",
  };
}
