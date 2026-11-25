const encoder = new TextEncoder();

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return bytesToHex(new Uint8Array(digest));
}

export function randomToken(byteLength = 32): string {
  if (
    !Number.isSafeInteger(byteLength) || byteLength < 16 || byteLength > 128
  ) {
    throw new Error("Token byte length must be between 16 and 128.");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function randomNumericCode(length = 6): string {
  if (!Number.isSafeInteger(length) || length < 6 || length > 8) {
    throw new Error("Verification code length must be between 6 and 8.");
  }

  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => String(value % 10)).join("");
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const maximum = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < maximum; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function redactSecrets(input: string): string {
  return input
    .replace(/gh[pousr]_[A-Za-z0-9_]{20,}/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]{12,}/gi, "Bearer [REDACTED]")
    .replace(
      /(api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
      "[REDACTED_PRIVATE_KEY]",
    );
}

export async function hmacSha256Hex(
  secret: string,
  value: string,
): Promise<string> {
  if (!secret) throw new Error("A non-empty HMAC secret is required.");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return bytesToHex(new Uint8Array(signature));
}
