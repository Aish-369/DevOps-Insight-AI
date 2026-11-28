import { fetchWithTimeout } from "./http.ts";

export async function sendTelegramMessage(
  chatId: string,
  messageText: string,
): Promise<string> {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")?.trim();
  if (!botToken) throw new Error("Telegram delivery is not configured.");

  const response = await fetchWithTimeout(
    "https://api.telegram.org/bot" + botToken + "/sendMessage",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText,
        disable_web_page_preview: true,
      }),
    },
    15_000,
  );

  const result: unknown = await response.json().catch(() => null);
  if (
    !response.ok || typeof result !== "object" || result === null ||
    !("ok" in result) || result.ok !== true
  ) {
    console.error("Telegram provider rejected a message", {
      status: response.status,
    });
    throw new Error("Telegram delivery failed.");
  }

  const message = "result" in result ? result.result : null;
  const messageId =
    typeof message === "object" && message !== null && "message_id" in message
      ? String(message.message_id)
      : "accepted";
  return messageId;
}
