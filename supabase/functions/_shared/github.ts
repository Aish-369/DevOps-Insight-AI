function encodeDerLength(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length]);
  const octets: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    octets.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return new Uint8Array([0x80 | octets.length, ...octets]);
}

function wrapDer(tag: number, value: Uint8Array): Uint8Array {
  const length = encodeDerLength(value.length);
  const result = new Uint8Array(1 + length.length + value.length);
  result[0] = tag;
  result.set(length, 1);
  result.set(value, 1 + length.length);
  return result;
}

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const length = values.reduce((total, value) => total + value.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

function bytesToPem(label: string, bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${
    lines.join("\n")
  }\n-----END ${label}-----`;
}

/**
 * GitHub App downloads use PKCS#1 PEM ("RSA PRIVATE KEY") by default.
 * jose.importPKCS8 expects PKCS#8 ("PRIVATE KEY"), so wrap the RSA key in
 * a PKCS#8 PrivateKeyInfo structure without changing key material.
 */
export function normalizeGithubPrivateKeyPem(pem: string): string {
  const normalized = pem.replaceAll("\\n", "\n").trim();
  if (/^-----BEGIN PRIVATE KEY-----/.test(normalized)) return normalized;

  const match = normalized.match(
    /^-----BEGIN RSA PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+)\s*-----END RSA PRIVATE KEY-----$/,
  );
  if (!match) {
    throw new Error(
      "GitHub App private key must be a PKCS#1 RSA or PKCS#8 PEM key.",
    );
  }

  const base64 = match[1].replace(/\s+/g, "");
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new Error("GitHub App private key PEM is not valid base64.");
  }
  const pkcs1 = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (pkcs1.length < 64) {
    throw new Error("GitHub App private key is incomplete.");
  }

  // AlgorithmIdentifier for rsaEncryption (1.2.840.113549.1.1.1) + NULL.
  const algorithmIdentifier = new Uint8Array([
    0x30,
    0x0d,
    0x06,
    0x09,
    0x2a,
    0x86,
    0x48,
    0x86,
    0xf7,
    0x0d,
    0x01,
    0x01,
    0x01,
    0x05,
    0x00,
  ]);
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const privateKeyInfo = wrapDer(
    0x30,
    concatBytes(version, algorithmIdentifier, wrapDer(0x04, pkcs1)),
  );
  return bytesToPem("PRIVATE KEY", privateKeyInfo);
}

import { importPKCS8, SignJWT } from "jose";
import { fetchWithTimeout, HttpError } from "./http.ts";

const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new HttpError(
      503,
      "GITHUB_APP_NOT_CONFIGURED",
      "GitHub App integration is not configured.",
    );
  }
  return value;
}

export async function createGithubAppJwt(): Promise<string> {
  const appId = requiredEnv("GITHUB_APP_ID");
  const privateKeyPem = normalizeGithubPrivateKeyPem(
    requiredEnv("GITHUB_APP_PRIVATE_KEY"),
  );
  const privateKey = await importPKCS8(privateKeyPem, "RS256");
  const issuedAt = Math.floor(Date.now() / 1000) - 60;

  return await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(appId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 9 * 60)
    .sign(privateKey);
}

export async function githubAppRequest<T>(
  path: string,
  method = "GET",
  body?: Record<string, unknown>,
): Promise<T> {
  const appJwt = await createGithubAppJwt();
  const response = await fetchWithTimeout(API_BASE + path, {
    method,
    headers: {
      authorization: "Bearer " + appJwt,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  }, 15_000);

  if (!response.ok) {
    console.error("GitHub App API request failed", {
      path,
      status: response.status,
    });
    throw new HttpError(
      502,
      "GITHUB_APP_API_FAILED",
      "GitHub could not verify the installation.",
    );
  }

  return await response.json() as T;
}

export async function createInstallationToken(
  installationId: number,
): Promise<string> {
  const result = await githubAppRequest<{ token?: string }>(
    "/app/installations/" + installationId + "/access_tokens",
    "POST",
    {},
  );
  if (!result.token) {
    throw new HttpError(
      502,
      "GITHUB_TOKEN_MISSING",
      "GitHub did not issue an installation token.",
    );
  }
  return result.token;
}

export async function githubInstallationRequest<T>(
  installationToken: string,
  path: string,
): Promise<{ data: T; nextPage: boolean }> {
  const response = await fetchWithTimeout(API_BASE + path, {
    headers: {
      authorization: "Bearer " + installationToken,
      accept: "application/vnd.github+json",
      "x-github-api-version": API_VERSION,
    },
  }, 15_000);

  if (!response.ok) {
    console.error("GitHub installation API request failed", {
      path,
      status: response.status,
    });
    throw new HttpError(
      502,
      "GITHUB_INSTALLATION_API_FAILED",
      "GitHub repository data could not be loaded.",
    );
  }

  const linkHeader = response.headers.get("link") ?? "";
  return {
    data: await response.json() as T,
    nextPage: /rel="next"/i.test(linkHeader),
  };
}
