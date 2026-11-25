import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { importPKCS8, SignJWT, jwtVerify } from "jose";
import { normalizeGithubPrivateKeyPem } from "../_shared/github.ts";
import {
  constantTimeEqual,
  randomNumericCode,
  randomToken,
  redactSecrets,
  sha256Hex,
} from "../_shared/security.ts";

Deno.test("sha256Hex returns a stable SHA-256 digest", async () => {
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

Deno.test("randomToken has the requested entropy length and is different per call", () => {
  const first = randomToken(32);
  const second = randomToken(32);
  assertEquals(first.length, 64);
  assertNotEquals(first, second);
});

Deno.test("randomNumericCode produces fixed-width numeric codes", () => {
  const code = randomNumericCode();
  assertEquals(code.length, 6);
  assertMatch(code, /^\d{6}$/);
});

Deno.test("constantTimeEqual compares matching and mismatching inputs", () => {
  assertEquals(constantTimeEqual("same", "same"), true);
  assertEquals(constantTimeEqual("same", "different"), false);
  assertEquals(constantTimeEqual("short", "shorter"), false);
});

Deno.test("redactSecrets removes common GitHub credentials and bearer values", () => {
  const input =
    "token=ghp_123456789012345678901234567890 and Authorization: Bearer abcdefghijklmnopqrstuv";
  const redacted = redactSecrets(input);
  assertEquals(redacted.includes("ghp_123"), false);
  assertEquals(redacted.includes("abcdefghijklmnopqrstuv"), false);
  assertMatch(redacted, /REDACTED/);
});

function readDerValue(bytes: Uint8Array, offset: number): { tag: number; value: Uint8Array; next: number } {
  const tag = bytes[offset];
  let cursor = offset + 1;
  const firstLength = bytes[cursor++];
  let length = firstLength;
  if ((firstLength & 0x80) !== 0) {
    const count = firstLength & 0x7f;
    length = 0;
    for (let index = 0; index < count; index += 1) {
      length = (length << 8) | bytes[cursor++];
    }
  }
  return { tag, value: bytes.subarray(cursor, cursor + length), next: cursor + length };
}

Deno.test("GitHub PKCS#1 PEM private keys are normalized to usable PKCS#8", async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const outer = readDerValue(pkcs8, 0);
  const version = readDerValue(outer.value, 0);
  const algorithm = readDerValue(outer.value, version.next);
  const privateOctets = readDerValue(outer.value, algorithm.next);
  assertEquals(outer.tag, 0x30);
  assertEquals(privateOctets.tag, 0x04);

  let binary = "";
  for (const byte of privateOctets.value) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g) ?? [];
  const pkcs1Pem = "-----BEGIN RSA PRIVATE KEY-----\n" +
    lines.join("\n") + "\n-----END RSA PRIVATE KEY-----";

  const normalized = normalizeGithubPrivateKeyPem(pkcs1Pem);
  assertMatch(normalized, /^-----BEGIN PRIVATE KEY-----/);
  const imported = await importPKCS8(normalized, "RS256");
  const token = await new SignJWT({ scope: "test" })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer("test-app")
    .setIssuedAt()
    .setExpirationTime("1m")
    .sign(imported);
  const publicKey = await crypto.subtle.exportKey("spki", pair.publicKey);
  const verifyKey = await crypto.subtle.importKey(
    "spki",
    publicKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const { payload } = await jwtVerify(
    token,
    verifyKey,
    { issuer: "test-app" },
  );
  assertEquals(payload.scope, "test");
});

Deno.test("PKCS#8 private keys are passed through unchanged", () => {
  const pem = "-----BEGIN PRIVATE KEY-----\nYWJj\n-----END PRIVATE KEY-----";
  assertEquals(normalizeGithubPrivateKeyPem(pem), pem);
});
