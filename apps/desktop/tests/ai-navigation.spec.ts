import { test, expect } from '@playwright/test';

test.describe('AI Section Navigation', () => {

  test('the rail shows the AI module label without needing hover', async ({ page }) => {
    await page.goto('/');
    // The rail opens LABELLED — icon-only-by-default was retired, so no hover is required.
    // Scoped to the link role because `getByText('AI')` is a case-insensitive substring match and
    // also hits the language toggle's "Français".
    await expect(
      page.locator('aside').getByRole('link', { name: 'AI', exact: true })
    ).toBeVisible();
  });

  test('agent landing page shows agent cards', async ({ page }) => {
    await page.goto('/ai');
    await expect(page.locator('h1')).toBeVisible();
    // The card heading, not the sub-nav link of the same name: each agent is now reachable from
    // both, so an unscoped text match is ambiguous.
    await expect(
      page.getByRole('heading', { level: 2, name: 'Budget Helper', exact: true })
    ).toBeVisible();
  });

  test('clicking agent card navigates to agent route', async ({ page }) => {
    await page.goto('/ai');
    // The whole card is one link with one accessible name, so clicking the card IS clicking the
    // link. Scoped to the card so this cannot silently start testing the sub-nav instead.
    await page
      .locator('a[data-slot="card"]')
      .filter({ hasText: 'Budget Helper' })
      .click();
    await expect(page).toHaveURL(/\/ai\/budget-helper/);
  });

  test('legacy /chat redirects to /ai/budget-helper', async ({ page }) => {
    await page.goto('/chat');
    await expect(page).toHaveURL('/ai/budget-helper');
    // No error page
    await expect(page.locator('body')).not.toContainText('404');
  });

  test('legacy /chat?conversation=42 redirects preserving param', async ({ page }) => {
    await page.goto('/chat?conversation=42');
    await expect(page).toHaveURL(/\/ai\/budget-helper\?conversation=42/);
  });

  test('DestinationNav shows AI sub-nav on /ai/* routes', async ({ page }) => {
    await page.goto('/ai/budget-helper');
    const nav = page.locator('nav[aria-label="AI navigation"]');
    await expect(nav.getByRole('link', { name: 'Budget Helper', exact: true })).toBeVisible();
    // A Finance destination must never leak into the AI sub-nav.
    await expect(nav.getByRole('link', { name: 'Today', exact: true })).toHaveCount(0);
  });

  test('DestinationNav shows the Finance destinations on Finance routes', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('nav[aria-label="Finance navigation"]');
    // "Dashboard" retired as a Finance label — the first destination is "Today". It survives only
    // as the CAR module's sub-nav item, which must not appear here.
    await expect(nav.getByRole('link', { name: 'Today', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toHaveCount(0);
  });

  test('Settings routes render no destination nav', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('nav[aria-label="Settings navigation"]')).toHaveCount(0);
    // Falling through to FinanceNav is the regression this guards against.
    await expect(page.locator('nav[aria-label="Finance navigation"]')).toHaveCount(0);
    await expect(page.getByTestId('settings-sub-nav')).toBeVisible();
  });

  test('/settings redirects to AI Provider', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings\/ai-provider/);
  });

  test('"Dashboard" is still the Car module sub-nav label', async ({ page }) => {
    await page.goto('/car');
    const nav = page.locator('nav[aria-label="Car navigation"]');
    await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  });

});
