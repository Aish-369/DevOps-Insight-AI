export async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<string> {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  const from = Deno.env.get("EMAIL_FROM")?.trim();
  if (!apiKey || !from) {
    throw new Error("Email delivery is not configured.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });

  if (!response.ok) {
    console.error("Email provider rejected a message", {
      status: response.status,
    });
    throw new Error("Email delivery failed.");
  }

  const result: unknown = await response.json();
  if (
    typeof result !== "object" || result === null || !("id" in result) ||
    typeof result.id !== "string"
  ) {
    throw new Error("Email provider returned an invalid response.");
  }
  return result.id;
}
