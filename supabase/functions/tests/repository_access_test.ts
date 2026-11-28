import { assertEquals } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveRepositoryMapping } from "../_shared/repository-access.ts";

type Mapping = {
  github_repo_id: number;
  installation_id: number;
  full_name: string;
  team_id: string;
  active: boolean;
};

function mockAdmin(
  mapping: Mapping | null,
  shouldError = false,
): SupabaseClient {
  const filters: Array<[string, unknown]> = [];
  let selectedColumns = "";
  const query = {
    select(columns: string) {
      selectedColumns = columns;
      return this;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return this;
    },
    maybeSingle() {
      if (shouldError) return { data: null, error: new Error("query failed") };
      const matches = mapping !== null &&
        filters.every(([column, value]) =>
          mapping[column as keyof Mapping] === value
        );
      if (!matches) return { data: null, error: null };
      const projected = Object.fromEntries(
        selectedColumns.split(",").map((column) => [
          column,
          mapping[column.trim() as keyof Mapping],
        ]),
      );
      return { data: projected, error: null };
    },
  };
  return {
    from(table: string) {
      if (table !== "team_repositories") {
        throw new Error("Unexpected table: " + table);
      }
      return query;
    },
  } as unknown as SupabaseClient;
}

const activeMapping: Mapping = {
  github_repo_id: 123,
  installation_id: 456,
  full_name: "acme/service",
  team_id: "team-a",
  active: true,
};

Deno.test("active repository mapping is accepted for its team and installation", async () => {
  const result = await getActiveRepositoryMapping(
    mockAdmin(activeMapping),
    "team-a",
    123,
    456,
  );
  assertEquals(result, {
    github_repo_id: 123,
    installation_id: 456,
    full_name: "acme/service",
  });
});

Deno.test("inactive repository mapping is rejected", async () => {
  const result = await getActiveRepositoryMapping(
    mockAdmin({ ...activeMapping, active: false }),
    "team-a",
    123,
    456,
  );
  assertEquals(result, null);
});

Deno.test("repository linked to another team is rejected", async () => {
  const result = await getActiveRepositoryMapping(
    mockAdmin(activeMapping),
    "team-b",
    123,
    456,
  );
  assertEquals(result, null);
});

Deno.test("repository linked to another installation is rejected", async () => {
  const result = await getActiveRepositoryMapping(
    mockAdmin(activeMapping),
    "team-a",
    123,
    999,
  );
  assertEquals(result, null);
});

Deno.test("unlinked repository is rejected", async () => {
  const result = await getActiveRepositoryMapping(
    mockAdmin(null),
    "team-a",
    123,
    456,
  );
  assertEquals(result, null);
});

Deno.test("repository lookup errors fail closed", async () => {
  const result = await getActiveRepositoryMapping(
    mockAdmin(activeMapping, true),
    "team-a",
    123,
    456,
  );
  assertEquals(result, null);
});
