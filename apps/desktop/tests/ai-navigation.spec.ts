import { test, expect } from '@playwright/test';

test.describe('AI Section Navigation', () => {

  test('sidebar shows AI section label', async ({ page }) => {
    await page.goto('/');
    // Hover to expand sidebar
    await page.locator('aside').hover();
    await expect(page.locator('aside').getByText('AI')).toBeVisible();
  });

  test('agent landing page shows agent cards', async ({ page }) => {
    await page.goto('/ai');
    await expect(page.locator('h1')).toBeVisible();
    // At least one agent card with "Budget Helper" text
    await expect(page.getByText('Budget Helper')).toBeVisible();
  });

  test('clicking agent card navigates to agent route', async ({ page }) => {
    await page.goto('/ai');
    await page.getByText('Budget Helper').click();
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

  test('InnerTabNav shows AI tabs on /ai/* routes', async ({ page }) => {
    await page.goto('/ai/budget-helper');
    const nav = page.locator('nav[aria-label="AI navigation"]');
    await expect(nav.getByText('Budget Helper')).toBeVisible();
    // Finance-specific tab should not appear in AI nav
    await expect(nav.getByText('Dashboard')).not.toBeVisible();
  });

  test('InnerTabNav shows Finance tabs on Finance routes', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('nav[aria-label="Finance navigation"]');
    await expect(nav.getByText('Dashboard')).toBeVisible();
  });

  test('InnerTabNav shows Settings tabs on /settings routes', async ({ page }) => {
    await page.goto('/settings');
    const nav = page.locator('nav[aria-label="Settings navigation"]');
    await expect(nav.getByText('AI Provider')).toBeVisible();
    await expect(nav.getByText('Dashboard')).not.toBeVisible();
  });

  test('/settings redirects to AI Provider', async ({ page }) => {
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/settings\/ai-provider/);
  });

});
