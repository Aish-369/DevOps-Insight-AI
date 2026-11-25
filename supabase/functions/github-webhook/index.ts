import { handleGithubWebhook } from "./handler.ts";

Deno.serve((request: Request) => handleGithubWebhook(request));
