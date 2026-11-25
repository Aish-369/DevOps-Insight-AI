import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { HttpError } from "./http.ts";

export interface AuthContext {
  user: User;
  admin: SupabaseClient;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new HttpError(
      503,
      "SERVER_CONFIGURATION_MISSING",
      "A required server integration is not configured.",
    );
  }
  return value;
}

function getPublishableKey(): string {
  const publishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (publishableKeys) {
    try {
      const parsed: unknown = JSON.parse(publishableKeys);
      if (
        typeof parsed === "object" && parsed !== null && "default" in parsed
      ) {
        const key = (parsed as Record<string, unknown>).default;
        if (typeof key === "string" && key.length > 0) return key;
      }
    } catch {
      throw new HttpError(
        503,
        "SUPABASE_KEY_CONFIGURATION_INVALID",
        "Supabase key configuration is invalid.",
      );
    }
  }

  const legacyKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  if (legacyKey) return legacyKey;
  throw new HttpError(
    503,
    "SUPABASE_PUBLISHABLE_KEY_MISSING",
    "Supabase publishable key is not configured.",
  );
}

export function createAdminClient(): SupabaseClient {
  const url = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function requireAuth(request: Request): Promise<AuthContext> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    throw new HttpError(401, "AUTH_REQUIRED", "Please sign in and try again.");
  }

  const url = requiredEnv("SUPABASE_URL");
  const userClient = createClient(url, getPublishableKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: `Bearer ${match[1]}` } },
  });

  const { data, error } = await userClient.auth.getUser(match[1]);
  if (error || !data.user) {
    throw new HttpError(
      401,
      "SESSION_INVALID",
      "Your session is invalid or has expired. Please sign in again.",
    );
  }

  return { user: data.user, admin: createAdminClient() };
}

export async function requireTeamRole(
  context: AuthContext,
  teamId: string,
  allowedRoles: readonly string[] = ["owner", "admin"],
): Promise<string> {
  const { data, error } = await context.admin
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", context.user.id)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      "MEMBERSHIP_LOOKUP_FAILED",
      "Team access could not be verified.",
    );
  }
  if (!data || !allowedRoles.includes(String(data.role))) {
    throw new HttpError(
      403,
      "TEAM_ACCESS_DENIED",
      "You do not have permission to perform this team action.",
    );
  }
  return String(data.role);
}

export async function writeAudit(
  admin: SupabaseClient,
  teamId: string,
  actorUserId: string | null,
  eventType: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await admin.from("team_audit_events").insert({
    team_id: teamId,
    actor_user_id: actorUserId,
    event_type: eventType,
    details,
  });
  if (error) {
    // Audit failures should be visible to platform logs, but must not leak to clients.
    console.error("Audit event write failed", { eventType, code: error.code });
  }
}
