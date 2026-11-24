import {
  assertAllowedOrigin,
  handleError,
  HttpError,
  jsonResponse,
  preflight,
  readJsonObject,
} from "../_shared/http.ts";
import { requireAuth, requireTeamRole, writeAudit } from "../_shared/auth.ts";
import { sendEmail } from "../_shared/email.ts";
import { randomToken, sha256Hex } from "../_shared/security.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (request: Request) => {
  const options = preflight(request);
  if (options) return options;

  try {
    assertAllowedOrigin(request);
    if (request.method !== "POST") {
      throw new HttpError(
        405,
        "METHOD_NOT_ALLOWED",
        "Use POST for this operation.",
      );
    }

    const context = await requireAuth(request);
    const body = await readJsonObject(request);
    const teamId = typeof body.team_id === "string" ? body.team_id : "";
    const email = typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";
    const requestedRole = typeof body.role === "string" ? body.role : "member";

    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        .test(teamId)
    ) {
      throw new HttpError(
        400,
        "INVALID_TEAM_ID",
        "A valid team ID is required.",
      );
    }
    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      throw new HttpError(
        400,
        "INVALID_EMAIL",
        "Enter a valid invitation email address.",
      );
    }
    if (requestedRole !== "member" && requestedRole !== "admin") {
      throw new HttpError(
        400,
        "INVALID_ROLE",
        "Invitations can only be for admin or member roles.",
      );
    }
    if (
      !Deno.env.get("APP_BASE_URL")?.trim() ||
      !Deno.env.get("RESEND_API_KEY")?.trim() ||
      !Deno.env.get("EMAIL_FROM")?.trim()
    ) {
      throw new HttpError(
        503,
        "INVITATION_DELIVERY_NOT_CONFIGURED",
        "Invitation email delivery is not configured.",
      );
    }

    const inviterRole = await requireTeamRole(context, teamId);
    if (inviterRole === "admin" && requestedRole !== "member") {
      throw new HttpError(
        403,
        "ROLE_ESCALATION_DENIED",
        "Only a team owner can invite an administrator.",
      );
    }
    if (context.user.email?.toLowerCase() === email) {
      throw new HttpError(
        400,
        "SELF_INVITATION",
        "You cannot invite your own email address.",
      );
    }

    const token = randomToken(32);
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString();

    const { data: team, error: teamError } = await context.admin
      .from("teams")
      .select("name")
      .eq("id", teamId)
      .maybeSingle();
    if (teamError || !team) {
      throw new HttpError(
        404,
        "TEAM_NOT_FOUND",
        "The requested team was not found.",
      );
    }

    const { data: invitation, error: insertError } = await context.admin
      .from("team_invitations")
      .insert({
        team_id: teamId,
        email,
        role: requestedRole,
        invited_by: context.user.id,
        status: "pending",
        token_hash: tokenHash,
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (insertError || !invitation) {
      if (insertError?.code === "23505") {
        throw new HttpError(
          409,
          "INVITATION_ALREADY_PENDING",
          "A pending invitation already exists for this email.",
        );
      }
      throw new HttpError(
        500,
        "INVITATION_CREATE_FAILED",
        "The invitation could not be created.",
      );
    }

    const appBaseUrl = Deno.env.get("APP_BASE_URL")!.replace(/\/$/, "");
    const inviteUrl = new URL("/accept-invitation", appBaseUrl);
    inviteUrl.searchParams.set("token", token);

    try {
      await sendEmail(
        email,
        `You have been invited to ${String(team.name)}`,
        `<p>You have been invited to join <strong>${
          escapeHtml(String(team.name))
        }</strong> as a ${requestedRole}.</p>
         <p><a href="${
          escapeHtml(inviteUrl.toString())
        }">Accept invitation</a></p>
         <p>This invitation expires in 7 days. If you were not expecting it, you can ignore this email.</p>`,
      );
    } catch {
      await context.admin
        .from("team_invitations")
        .delete()
        .eq("id", invitation.id)
        .eq("status", "pending");
      throw new HttpError(
        503,
        "INVITATION_DELIVERY_FAILED",
        "The invitation email could not be delivered. No pending invitation was left behind.",
      );
    }

    await writeAudit(
      context.admin,
      teamId,
      context.user.id,
      "team.invitation.created",
      {
        invitation_id: invitation.id,
        role: requestedRole,
      },
    );

    return jsonResponse(request, {
      ok: true,
      invitation_id: invitation.id,
      expires_at: expiresAt,
    }, 201);
  } catch (error) {
    return handleError(request, error);
  }
});

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(
    ">",
    "&gt;",
  ).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
