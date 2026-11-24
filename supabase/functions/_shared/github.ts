import { importPKCS8, SignJWT } from "jose";
import { HttpError } from "./http.ts";

const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new HttpError(503, "GITHUB_APP_NOT_CONFIGURED", "GitHub App integration is not configured.");
  }
  return value;
}

export async function createGithubAppJwt(): Promise<string> {
  const appId = requiredEnv("GITHUB_APP_ID");
  const privateKeyPem = requiredEnv("GITHUB_APP_PRIVATE_KEY").replaceAll("\\n", "\n");
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
  const response = await fetch(API_BASE + path, {
    method,
    headers: {
      authorization: "Bearer " + appJwt,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "x-github-api-version": API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    console.error("GitHub App API request failed", { path, status: response.status });
    throw new HttpError(502, "GITHUB_APP_API_FAILED", "GitHub could not verify the installation.");
  }

  return await response.json() as T;
}

export async function createInstallationToken(installationId: number): Promise<string> {
  const result = await githubAppRequest<{ token?: string }>(
    "/app/installations/" + installationId + "/access_tokens",
    "POST",
    {},
  );
  if (!result.token) throw new HttpError(502, "GITHUB_TOKEN_MISSING", "GitHub did not issue an installation token.");
  return result.token;
}

export async function githubInstallationRequest<T>(
  installationToken: string,
  path: string,
): Promise<{ data: T; nextPage: boolean }> {
  const response = await fetch(API_BASE + path, {
    headers: {
      authorization: "Bearer " + installationToken,
      accept: "application/vnd.github+json",
      "x-github-api-version": API_VERSION,
    },
  });

  if (!response.ok) {
    console.error("GitHub installation API request failed", { path, status: response.status });
    throw new HttpError(502, "GITHUB_INSTALLATION_API_FAILED", "GitHub repository data could not be loaded.");
  }

  const linkHeader = response.headers.get("link") ?? "";
  return {
    data: await response.json() as T,
    nextPage: /rel="next"/i.test(linkHeader),
  };
}
