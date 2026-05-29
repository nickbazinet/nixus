import { test, expect } from '@playwright/test';

const navItems = [
  { label: 'Dashboard', path: '/', heading: 'Dashboard' },
  { label: 'Budget', path: '/budget', heading: 'Budget' },
  { label: 'Accounts', path: '/accounts', heading: 'Accounts' },
  { label: 'Assets', path: '/assets', heading: 'Assets' },
  { label: 'Net Worth', path: '/net-worth', heading: 'Net Worth' },
  { label: 'Import', path: '/import', heading: 'Import' },
];

test('tab nav renders with all nav items', async ({ page }) => {
  await page.goto('/');

  const nav = page.locator('nav[aria-label="Finance navigation"]');
  await expect(nav).toBeVisible();

  for (const item of navItems) {
    await expect(nav.getByText(item.label)).toBeVisible();
  }
});

test('clicking each nav item navigates to the correct page with active state', async ({ page }) => {
  await page.goto('/');

  for (const item of navItems) {
    const nav = page.locator('nav[aria-label="Finance navigation"]');
    const link = nav.getByText(item.label);
    await link.click();

    // Verify the page heading
    await expect(page.locator('h1')).toHaveText(item.heading);

    // Verify active link has the active styling class (bottom border)
    const activeLink = nav.locator('a').filter({ hasText: item.label });
    await expect(activeLink).toHaveClass(/text-primary/);
    await expect(activeLink).toHaveClass(/border-primary/);
  }
});

test('each page displays its H1 title in the page header', async ({ page }) => {
  for (const item of navItems) {
    await page.goto(item.path);
    await expect(page.locator('h1')).toHaveText(item.heading);
  }
});

test('main content area has max-width 1280px', async ({ page }) => {
  await page.goto('/');

  const content = page.locator('main > div');
  const maxWidth = await content.evaluate((el) => getComputedStyle(el).maxWidth);
  expect(maxWidth).toBe('1280px');
});
