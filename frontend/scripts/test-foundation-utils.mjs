import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isPatchedViteVersion } from "./viteVersionPolicy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
async function importTs(relativePath) {
  const source = await readFile(path.resolve(here, relativePath), "utf8");
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
}
const { validateSupabasePublishableKey } = await importTs("../src/lib/validateSupabasePublishableKey.ts");
const { validateSupabaseUrl } = await importTs("../src/lib/validateSupabaseUrl.ts");
const { getErrorMessage } = await importTs("../src/lib/errorMessage.ts");
const { isAuthSessionMissingError } = await importTs("../src/lib/isAuthSessionMissingError.ts");

assert.equal(validateSupabasePublishableKey("sb_publishable_example_public_key"), "sb_publishable_example_public_key");
const jwt = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
assert.equal(validateSupabasePublishableKey(jwt("anon")), jwt("anon"));
assert.throws(() => validateSupabasePublishableKey(jwt("service_role")));
assert.throws(() => validateSupabasePublishableKey("malformed"));
assert.throws(() => validateSupabasePublishableKey("header.e30.signature"));
assert.equal(validateSupabaseUrl("https://project.supabase.co/"), "https://project.supabase.co");
assert.equal(validateSupabaseUrl("http://localhost:54321"), "http://localhost:54321");
assert.equal(validateSupabaseUrl("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
assert.throws(() => validateSupabaseUrl("http://project.supabase.co"));
assert.throws(() => validateSupabaseUrl("ftp://project.supabase.co"));
assert.throws(() => validateSupabaseUrl("https://user:pass@project.supabase.co"));
assert.throws(() => validateSupabaseUrl("https://project.supabase.co?apikey=x"));
assert.throws(() => validateSupabaseUrl("https://project.supabase.co#fragment"));
assert.equal(getErrorMessage(new Error("network unavailable"), "fallback"), "network unavailable");
assert.equal(getErrorMessage({ message: "request failed" }, "fallback"), "request failed");
assert.equal(getErrorMessage({ code: "E_UNKNOWN" }, "fallback"), "fallback");
assert.equal(isAuthSessionMissingError(Object.assign(new Error("Auth session missing!"), { name: "AuthSessionMissingError" })), true);
assert.equal(isAuthSessionMissingError(new Error("Network failure")), false);
assert.equal(isAuthSessionMissingError({ name: "AuthSessionMissingError" }), false);
assert.equal(isPatchedViteVersion("8.3.7"), true);
assert.equal(isPatchedViteVersion("8.3.8"), true);
assert.equal(isPatchedViteVersion("8.3.8+build.1"), true);
assert.equal(isPatchedViteVersion("8.3.6"), false);
assert.equal(isPatchedViteVersion("8.3.7-beta.1"), false);
assert.equal(isPatchedViteVersion("8.3.8-rc.0"), false);
assert.equal(isPatchedViteVersion("not-a-version"), false);
console.log("Foundation utility tests passed (22 assertions).");
