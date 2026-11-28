/** Return a safe, user-readable message from an unknown thrown value. */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "object" && error !== null && "message" in error &&
      typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}
