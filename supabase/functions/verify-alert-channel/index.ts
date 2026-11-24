import { requireAuth, requireTeamRole, writeAudit } from "../_shared/auth.ts";
import { sendEmail } from "../_shared/email.ts";
import { sendTelegramMessage } from "../_shared/telegram.ts";
import {
  assertAllowedOrigin,
  handleError,
  HttpError,
  jsonResponse,
  preflight,
  readJsonObject,
} from "../_shared/http.ts";
import { randomNumericCode, sha256Hex } from "../_shared/security.ts";

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
    await requireTeamRole(context, teamId);

    const channelId = typeof body.channel_id === "string"
      ? body.channel_id
      : "";
    const submittedCode = typeof body.code === "string" ? body.code.trim() : "";

    if (channelId || submittedCode) {
      if (!channelId || !/^\d{6}$/.test(submittedCode)) {
        throw new HttpError(
          400,
          "INVALID_VERIFICATION_CODE",
          "Enter the 6-digit verification code.",
        );
      }

      const { data: channel, error } = await context.admin
        .from("alert_channels")
        .select(
          "id,team_id,channel_type,target,verified_at,verification_code_hash,verification_expires_at,verification_attempts",
        )
        .eq("id", channelId)
        .eq("team_id", teamId)
        .maybeSingle();

      if (
        error || !channel || channel.verified_at ||
        !channel.verification_code_hash || !channel.verification_expires_at
      ) {
        throw new HttpError(
          404,
          "VERIFICATION_NOT_AVAILABLE",
          "The channel verification request is invalid or expired.",
        );
      }
      if (Date.parse(channel.verification_expires_at) <= Date.now()) {
        await context.admin.from("alert_channels")
          .update({
            verification_code_hash: null,
            verification_expires_at: null,
          })
          .eq("id", channelId);
        throw new HttpError(
          410,
          "VERIFICATION_EXPIRED",
          "The verification code has expired. Request a new one.",
        );
      }

      const submittedHash = await sha256Hex(
        [teamId, channelId, submittedCode].join(":"),
      );
      const attempts = Number(channel.verification_attempts ?? 0);
      if (attempts >= 5) {
        throw new HttpError(
          429,
          "VERIFICATION_ATTEMPTS_EXCEEDED",
          "Too many incorrect codes. Wait until the code expires, then request a new one.",
        );
      }
      if (submittedHash !== channel.verification_code_hash) {
        const { data: attemptUpdate, error: attemptError } = await context.admin
          .from("alert_channels")
          .update({ verification_attempts: attempts + 1 })
          .eq("id", channelId)
          .eq("team_id", teamId)
          .eq("verification_attempts", attempts)
          .select("id")
          .maybeSingle();
        if (attemptError || !attemptUpdate) {
          throw new HttpError(
            409,
            "VERIFICATION_RETRY",
            "The verification code changed. Try the latest code.",
          );
        }
        throw new HttpError(
          400,
          "VERIFICATION_CODE_INCORRECT",
          "The verification code is incorrect.",
        );
      }

      const { error: updateError } = await context.admin.from("alert_channels")
        .update({
          verified_at: new Date().toISOString(),
          verification_code_hash: null,
          verification_expires_at: null,
          verification_attempts: 0,
        })
        .eq("id", channelId)
        .eq("team_id", teamId)
        .is("verified_at", null);

      if (updateError) {
        throw new HttpError(
          500,
          "CHANNEL_VERIFY_FAILED",
          "The alert channel could not be verified.",
        );
      }

      await writeAudit(
        context.admin,
        teamId,
        context.user.id,
        "alerts.channel.verified",
        {
          channel_id: channelId,
          channel_type: channel.channel_type,
        },
      );
      return jsonResponse(request, {
        ok: true,
        verified: true,
        channel_id: channelId,
      });
    }

    const channelType = body.channel_type;
    const target = typeof body.target === "string" ? body.target.trim() : "";
    if (channelType !== "email" && channelType !== "telegram") {
      throw new HttpError(
        400,
        "INVALID_CHANNEL_TYPE",
        "Choose email or Telegram notifications.",
      );
    }
    if (!target || target.length > 254) {
      throw new HttpError(
        400,
        "INVALID_CHANNEL_TARGET",
        "Enter a valid alert destination.",
      );
    }
    if (
      channelType === "email" &&
      (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) ||
        !Deno.env.get("RESEND_API_KEY") || !Deno.env.get("EMAIL_FROM"))
    ) {
      throw new HttpError(
        503,
        "EMAIL_PROVIDER_NOT_CONFIGURED",
        "Email delivery is not configured or the address is invalid.",
      );
    }
    if (channelType === "telegram" && !Deno.env.get("TELEGRAM_BOT_TOKEN")) {
      throw new HttpError(
        503,
        "TELEGRAM_PROVIDER_NOT_CONFIGURED",
        "Telegram delivery is not configured.",
      );
    }

    const code = randomNumericCode(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const normalizedTarget = channelType === "email" ? target.toLowerCase() : target;

    const { data: existingChannel, error: existingError } = await context.admin
      .from("alert_channels")
      .select("id,verified_at,verification_expires_at,verification_attempts")
      .eq("team_id", teamId)
      .eq("channel_type", channelType)
      .eq("target", normalizedTarget)
      .maybeSingle();
    if (existingError) {
      throw new HttpError(500, "CHANNEL_LOOKUP_FAILED", "The alert destination could not be checked.");
    }
    if (existingChannel?.verified_at) {
      throw new HttpError(409, "CHANNEL_ALREADY_VERIFIED", "This alert destination is already verified.");
    }
    if (
      existingChannel?.verification_expires_at &&
      Date.parse(existingChannel.verification_expires_at) > Date.now() &&
      Number(existingChannel.verification_attempts ?? 0) < 5
    ) {
      throw new HttpError(409, "CHANNEL_VERIFICATION_PENDING", "A verification code is already active for this destination.");
    }

    let channelId = existingChannel?.id as string | undefined;
    let createdNewChannel = false;
    if (channelId) {
      const { error: resetError } = await context.admin.from("alert_channels")
        .update({
          verification_code_hash: "pending",
          verification_expires_at: expiresAt,
          verification_attempts: 0,
          target: normalizedTarget,
        })
        .eq("id", channelId)
        .eq("team_id", teamId)
        .is("verified_at", null);
      if (resetError) throw new HttpError(500, "CHANNEL_RENEW_FAILED", "A new verification request could not be created.");
    } else {
      const { data: channel, error: insertError } = await context.admin.from("alert_channels")
        .insert({
          team_id: teamId,
          channel_type: channelType,
          target: normalizedTarget,
          created_by: context.user.id,
          verified_at: null,
          verification_code_hash: "pending",
          verification_expires_at: expiresAt,
          verification_attempts: 0,
        })
        .select("id")
        .single();

      if (insertError || !channel) {
        if (insertError?.code === "23505") {
          throw new HttpError(409, "CHANNEL_ALREADY_EXISTS", "This alert destination has already been added to the team.");
        }
        throw new HttpError(500, "CHANNEL_CREATE_FAILED", "The alert channel could not be created.");
      }
      channelId = channel.id;
      createdNewChannel = true;
    }

    const codeHash = await sha256Hex([teamId, channelId, code].join(":"));
    const { error: hashError } = await context.admin.from("alert_channels")
      .update({ verification_code_hash: codeHash })
      .eq("id", channelId)
      .eq("team_id", teamId);
    if (hashError) {
      if (createdNewChannel) await context.admin.from("alert_channels").delete().eq("id", channelId).eq("team_id", teamId);
      throw new HttpError(500, "CHANNEL_CREATE_FAILED", "The alert channel could not be created.");
    }

    try {
      if (channelType === "email") {
        await sendEmail(
          target,
          "Verify your DevOps Insight AI alert destination",
          "<p>Your verification code is <strong>" + code +
            "</strong>.</p><p>This code expires in 10 minutes. If you did not request it, ignore this message.</p>",
        );
      } else {
        await sendTelegramMessage(
          target,
          "Your DevOps Insight AI alert verification code is " + code +
            ". It expires in 10 minutes.",
        );
      }
    } catch {
      if (createdNewChannel) {
        await context.admin.from("alert_channels").delete().eq("id", channelId).eq("team_id", teamId);
      } else {
        await context.admin.from("alert_channels").update({
          verification_code_hash: null,
          verification_expires_at: null,
        }).eq("id", channelId).eq("team_id", teamId);
      }
      throw new HttpError(
        503,
        "VERIFICATION_DELIVERY_FAILED",
        "The verification code could not be delivered. The pending channel was removed.",
      );
    }

    await writeAudit(
      context.admin,
      teamId,
      context.user.id,
      "alerts.channel.verification_requested",
      {
        channel_id: channelId,
        channel_type: channelType,
      },
    );

    return jsonResponse(request, {
      ok: true,
      verification_required: true,
      channel_id: channelId,
      expires_at: expiresAt,
    }, 201);
  } catch (error) {
    return handleError(request, error);
  }
});
