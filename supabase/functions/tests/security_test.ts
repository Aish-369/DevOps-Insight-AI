import { assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert@1.0.14";
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
  const input = "token=ghp_123456789012345678901234567890 and Authorization: Bearer abcdefghijklmnopqrstuv";
  const redacted = redactSecrets(input);
  assertEquals(redacted.includes("ghp_123"), false);
  assertEquals(redacted.includes("abcdefghijklmnopqrstuv"), false);
  assertMatch(redacted, /REDACTED/);
});
