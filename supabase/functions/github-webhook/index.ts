import { handleGithubWebhook } from "./handler.ts";

Deno.serve(handleGithubWebhook);
