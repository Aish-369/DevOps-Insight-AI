import { bytesToHex, constantTimeEqual } from "./security.ts";

export async function verifyGithubWebhookSignature(
  rawBody: Uint8Array,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (
    !signatureHeader || !/^sha256=[0-9a-f]{64}$/i.test(signatureHeader) ||
    !secret
  ) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bodyBuffer = new ArrayBuffer(rawBody.byteLength);
  new Uint8Array(bodyBuffer).set(rawBody);
  const digest = await crypto.subtle.sign("HMAC", key, bodyBuffer);
  const expected = "sha256=" + bytesToHex(new Uint8Array(digest));
  return constantTimeEqual(
    expected.toLowerCase(),
    signatureHeader.toLowerCase(),
  );
}
