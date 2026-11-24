import { expect, test } from "@playwright/test";

test("an unauthenticated visitor is redirected from protected routes to sign in", async ({ page }) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("login provider errors are shown and the submit button recovers", async ({ page }) => {
  await page.route(/\/auth\/v1\/token\?grant_type=password$/, async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        code: "invalid_credentials",
        message: "Invalid login credentials",
      }),
    });
  });

  await page.goto("/login");
  await page.getByLabel("Email address").fill("test@example.com");
  await page.getByLabel("Password", { exact: true }).fill("IncorrectPassword123!");
  const submit = page.getByRole("button", { name: "Sign in" });
  await submit.click();

  await expect(page.getByRole("alert")).toContainText("Invalid login credentials");
  await expect(submit).toBeEnabled();
});

test("signup client validation prevents mismatched passwords from reaching Supabase", async ({ page }) => {
  let signupRequestCount = 0;
  await page.route(/\/auth\/v1\/signup$/, async (route) => {
    signupRequestCount += 1;
    await route.continue();
  });

  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Test User");
  await page.getByLabel("Email address").fill("test@example.com");
  await page.getByLabel("Password", { exact: true }).fill("StrongPassword123!");
  await page.getByLabel("Confirm password").fill("DifferentPassword123!");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("alert")).toContainText("Passwords do not match");
  expect(signupRequestCount).toBe(0);
});

test("signup provider errors are shown and the submit button recovers", async ({ page }) => {
  await page.route(/\/auth\/v1\/signup$/, async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        code: "user_already_exists",
        message: "User already registered",
      }),
    });
  });

  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Test User");
  await page.getByLabel("Email address").fill("existing@example.com");
  await page.getByLabel("Password", { exact: true }).fill("StrongPassword123!");
  await page.getByLabel("Confirm password").fill("StrongPassword123!");
  const submit = page.getByRole("button", { name: "Create account" });
  await submit.click();

  await expect(page.getByRole("alert")).toContainText("User already registered");
  await expect(submit).toBeEnabled();
});


test("forgot password submits a same-origin reset redirect and uses a generic response", async ({ page }) => {
  let submittedBody: Record<string, unknown> | undefined;
  await page.route(/\\/auth\\/v1\\/recover$/, async (route) => {
    submittedBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto("/forgot-password");
  await page.getByLabel("Email address").fill("person@example.com");
  await page.getByRole("button", { name: "Send reset instructions" }).click();

  await expect(page.getByRole("status")).toContainText("If an account exists");
  expect(submittedBody?.email).toBe("person@example.com");
  expect(submittedBody?.redirect_to).toBe("http://127.0.0.1:4173/reset-password");
});

test("an auth callback provider denial shows a safe error instead of trusting redirect parameters", async ({ page }) => {
  await page.goto("/auth/callback?error=access_denied&error_description=Cancelled&next=https%3A%2F%2Fevil.example");
  await expect(page.getByRole("alert")).toContainText("Sign-in could not be completed");
  await expect(page.getByRole("link", { name: "Return to sign in" })).toHaveAttribute("href", "/login");
  await expect(page).toHaveURL(/\\/auth\\/callback/);
});

test("an expired password recovery link cannot open the password update form", async ({ page }) => {
  await page.goto("/reset-password");
  await expect(page.getByRole("heading", { name: "Reset link unavailable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute("href", "/forgot-password");
});

test("account settings remains protected for signed-out visitors", async ({ page }) => {
  await page.goto("/settings/account");
  await expect(page).toHaveURL(/\\/login$/);
});
