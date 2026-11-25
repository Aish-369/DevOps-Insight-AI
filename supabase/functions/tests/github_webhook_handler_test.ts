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

type MockFilter = { column: string; value: unknown };

interface RepositoryMockConfig {
  installationId: number;
  repositoryId: number;
  repositoryInstallationId: number;
  teamId: string;
  active: boolean;
  duplicateStatus?: string;
}

class MockSupabaseQuery implements PromiseLike<{ data: unknown; error: null }> {
  private readonly filters: MockFilter[] = [];

  constructor(
    private readonly table: string,
    private readonly config: RepositoryMockConfig,
    private readonly writes: { pendingJobs: unknown[] },
  ) {}

  select(_columns: string): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ column, value });
    return this;
  }

  update(values: unknown): this {
    if (
      this.table === "team_repositories" &&
      typeof values === "object" &&
      values !== null &&
      "active" in values &&
      values.active === false
    ) {
      this.config.active = false;
    }
    return this;
  }

  delete(): this {
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ column, value: values });
    return this;
  }

  insert(_values: unknown): Promise<{ error: { code: string } | null }> {
    if (this.table === "webhook_events" && this.config.duplicateStatus) {
      return Promise.resolve({ error: { code: "23505" } });
    }
    return Promise.resolve({ error: null });
  }

  upsert(values: unknown): Promise<{ error: null }> {
    if (this.table === "pending_workflow_jobs") {
      this.writes.pendingJobs.push(values);
    }
    return Promise.resolve({ error: null });
  }

  maybeSingle(): Promise<{ data: unknown; error: null }> {
    const matches = (expected: MockFilter[]) =>
      expected.every((filter) =>
        this.filters.some((actual) =>
          actual.column === filter.column && actual.value === filter.value
        )
      );

    if (
      this.table === "webhook_events" &&
      this.config.duplicateStatus
    ) {
      return Promise.resolve({
        data: {
          status: this.config.duplicateStatus,
          attempts: 1,
          processing_started_at: null,
          dead: false,
        },
        error: null,
      });
    }

    if (
      this.table === "github_installations" &&
      matches([
        { column: "installation_id", value: this.config.installationId },
        { column: "deleted_at", value: null },
      ])
    ) {
      return Promise.resolve({
        data: {
          installation_id: this.config.installationId,
          team_id: this.config.teamId,
        },
        error: null,
      });
    }

    if (
      this.table === "team_repositories" &&
      matches([
        { column: "team_id", value: this.config.teamId },
        { column: "github_repo_id", value: this.config.repositoryId },
        { column: "active", value: true },
        {
          column: "installation_id",
          value: this.config.repositoryInstallationId,
        },
      ]) &&
      this.config.active &&
      this.config.repositoryInstallationId === this.config.installationId
    ) {
      return Promise.resolve({
        data: {
          github_repo_id: this.config.repositoryId,
          installation_id: this.config.repositoryInstallationId,
          full_name: "acme/service",
        },
        error: null,
      });
    }

    return Promise.resolve({ data: null, error: null });
  }

  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: (
      value: { data: unknown; error: null },
    ) => TResult1 | PromiseLike<TResult1>,
    onrejected?: (reason: unknown) => TResult2 | PromiseLike<TResult2>,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: null, error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

function mockAdmin(config: RepositoryMockConfig): {
  client: ReturnType<WebhookHandlerDependencies["createAdminClient"]>;
  writes: { pendingJobs: unknown[] };
} {
  const writes = { pendingJobs: [] as unknown[] };
  const client = {
    from(table: string) {
      return new MockSupabaseQuery(table, config, writes);
    },
  };
  return {
    client: client as unknown as ReturnType<
      WebhookHandlerDependencies["createAdminClient"]
    >,
    writes,
  };
}

function workflowJobPayload(
  installationId: number,
  repositoryId: number,
): string {
  return JSON.stringify({
    installation: { id: installationId },
    repository: { id: repositoryId },
    workflow_job: {
      id: 789,
      run_id: 987,
      name: "test job",
      status: "completed",
      conclusion: "success",
      steps: [],
    },
  });
}

Deno.test("workflow_job webhook is processed for its active repository installation", async () => {
  const mock = mockAdmin({
    installationId: 456,
    repositoryId: 123,
    repositoryInstallationId: 456,
    teamId: "team-a",
    active: true,
  });
  const req = await request(
    workflowJobPayload(456, 123),
    "workflow_job",
    "delivery-valid-repository",
  );
  const response = await handleGithubWebhook(
    req,
    dependencies({ createAdminClient: () => mock.client }),
  );
  assertEquals(response.status, 200);
  assertEquals(mock.writes.pendingJobs.length, 1);
});

Deno.test("workflow_job webhook rejects an inactive repository mapping", async () => {
  const mock = mockAdmin({
    installationId: 456,
    repositoryId: 123,
    repositoryInstallationId: 456,
    teamId: "team-a",
    active: false,
  });
  const req = await request(
    workflowJobPayload(456, 123),
    "workflow_job",
    "delivery-inactive-repository",
  );
  const response = await handleGithubWebhook(
    req,
    dependencies({ createAdminClient: () => mock.client }),
  );
  assertEquals(response.status, 500);
  assertEquals(mock.writes.pendingJobs.length, 0);
});

Deno.test("workflow_job webhook rejects a repository mapped to another installation", async () => {
  const mock = mockAdmin({
    installationId: 456,
    repositoryId: 123,
    repositoryInstallationId: 999,
    teamId: "team-a",
    active: true,
  });
  const req = await request(
    workflowJobPayload(456, 123),
    "workflow_job",
    "delivery-wrong-installation",
  );
  const response = await handleGithubWebhook(
    req,
    dependencies({ createAdminClient: () => mock.client }),
  );
  assertEquals(response.status, 500);
  assertEquals(mock.writes.pendingJobs.length, 0);
});

Deno.test("processed duplicate webhook delivery is acknowledged without reprocessing", async () => {
  const mock = mockAdmin({
    installationId: 456,
    repositoryId: 123,
    repositoryInstallationId: 456,
    teamId: "team-a",
    active: true,
    duplicateStatus: "processed",
  });
  const req = await request(
    workflowJobPayload(456, 123),
    "workflow_job",
    "delivery-already-processed",
  );
  const response = await handleGithubWebhook(
    req,
    dependencies({ createAdminClient: () => mock.client }),
  );
  assertEquals(response.status, 200);
  assertEquals(await responseBody(response), { ok: true, duplicate: true });
  assertEquals(mock.writes.pendingJobs.length, 0);
});

Deno.test("repository removal deactivates mapping and blocks later workflow job events", async () => {
  const mock = mockAdmin({
    installationId: 456,
    repositoryId: 123,
    repositoryInstallationId: 456,
    teamId: "team-a",
    active: true,
  });
  const removalPayload = JSON.stringify({
    installation: { id: 456 },
    repositories_removed: [{ id: 123 }],
  });
  const removalRequest = await request(
    removalPayload,
    "installation_repositories",
    "delivery-repository-removed",
  );
  const removalResponse = await handleGithubWebhook(
    removalRequest,
    dependencies({ createAdminClient: () => mock.client }),
  );
  assertEquals(removalResponse.status, 200);

  const workflowRequest = await request(
    workflowJobPayload(456, 123),
    "workflow_job",
    "delivery-job-after-repository-removal",
  );
  const workflowResponse = await handleGithubWebhook(
    workflowRequest,
    dependencies({ createAdminClient: () => mock.client }),
  );
  assertEquals(workflowResponse.status, 500);
  assertEquals(mock.writes.pendingJobs.length, 0);
});
