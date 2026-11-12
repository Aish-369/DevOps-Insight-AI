
const CACHE_TTL_MS = 60_000;

// Store successful API responses temporarily in memory.
const cache = new Map<
  string,
  { data: unknown; expiresAt: number }
>();

export async function cachedFetchJson<T>(
  url: string,
  signal?: AbortSignal,
  forceRefresh = false
): Promise<T> {
  const cached = cache.get(url);

  // Return fresh cached data without making another API request.
  if (
    !forceRefresh &&
    cached &&
    cached.expiresAt > Date.now()
  ) {
    return cached.data as T;
  }

  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "application/vnd.github+json",
    },
  });

  // Handle GitHub API errors and rate limits.
  if (!response.ok) {
    const remaining = response.headers.get(
      "X-RateLimit-Remaining"
    );

    const reset = response.headers.get(
      "X-RateLimit-Reset"
    );

    if (
      response.status === 429 ||
      (response.status === 403 && remaining === "0")
    ) {
      const resetTime = reset
        ? new Date(Number(reset) * 1000).toLocaleTimeString()
        : "later";

      throw new Error(
        `GitHub API rate limit reached. Try again after ${resetTime}.`
      );
    }

    if (response.status === 403) {
      throw new Error(
        "GitHub access denied. Check permissions or API limits."
      );
    }

    if (response.status === 404) {
      throw new Error(
        "GitHub resource not found. Check the username or repository."
      );
    }

    throw new Error(`GitHub API error: ${response.status}`);
  }

  const data = (await response.json()) as T;

  // Cache only successful responses.
  cache.set(url, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return data;
}
