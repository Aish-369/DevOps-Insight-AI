import { requireAuth, requireTeamRole, writeAudit } from "../_shared/auth.ts";
import { assertAllowedOrigin, handleError, HttpError, jsonResponse, preflight, readJsonObject } from "../_shared/http.ts";

Deno.serve(async (request: Request) => {
  const options = preflight(request);
  if (options) return options;

  try {
    assertAllowedOrigin(request);
    if (request.method !== "POST") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST for this operation.");

    const context = await requireAuth(request);
    const body = await readJsonObject(request);
    const teamId = typeof body.team_id === "string" ? body.team_id : "";
    const invitationId = typeof body.invitation_id === "string" ? body.invitation_id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(teamId) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(invitationId)) {
      throw new HttpError(400, "INVALID_INVITATION", "A valid team and invitation ID are required.");
    }
    await requireTeamRole(context, teamId);

    const { data, error } = await context.admin.from("team_invitations")
      .update({ status: "revoked", revoked_at: new Date().toISOString() })
      .eq("id", invitationId)
      .eq("team_id", teamId)
      .eq("status", "pending")
      .is("accepted_at", null)
      .select("id")
      .maybeSingle();

    if (error) throw new HttpError(500, "INVITATION_REVOKE_FAILED", "The invitation could not be revoked.");
    if (!data) throw new HttpError(404, "INVITATION_NOT_PENDING", "The pending invitation was not found.");

    await writeAudit(context.admin, teamId, context.user.id, "team.invitation.revoked", {
      invitation_id: invitationId,
    });
    return jsonResponse(request, { ok: true, invitation_id: invitationId });
  } catch (error) {
    return handleError(request, error);
  }
});
