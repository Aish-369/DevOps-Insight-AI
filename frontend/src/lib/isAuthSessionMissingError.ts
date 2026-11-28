/** Distinguish a normal signed-out state from a session verification failure. */
export function isAuthSessionMissingError(error: unknown): boolean {
  return error instanceof Error && error.name === "AuthSessionMissingError";
}
