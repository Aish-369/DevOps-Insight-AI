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
