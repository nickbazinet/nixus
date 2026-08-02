import { test, expect, type Page } from '@playwright/test';

const navItems = [
  { label: 'Dashboard', path: '/', heading: 'Dashboard' },
  { label: 'Budget', path: '/spending/budget', heading: 'Budget' },
  { label: 'Accounts', path: '/wealth/accounts', heading: 'Accounts' },
  { label: 'Assets', path: '/wealth/assets', heading: 'Assets' },
  { label: 'Net Worth', path: '/wealth/net-worth', heading: 'Net Worth' },
];

test('tab nav renders with all nav items', async ({ page }) => {
  await page.goto('/');

  const nav = page.locator('nav[aria-label="Finance navigation"]');
  await expect(nav).toBeVisible();

  for (const item of navItems) {
    await expect(nav.getByText(item.label)).toBeVisible();
  }
});

/** Resolves a spine token to the same computed colour string the browser reports for an element. */
async function resolveToken(page: Page, token: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, token);
}

test('clicking each nav item navigates to the correct page with active state', async ({ page }) => {
  await page.goto('/');

  const brand = await resolveToken(page, '--brand');
  const brandInk = await resolveToken(page, '--brand-ink');

  for (const item of navItems) {
    const nav = page.locator('nav[aria-label="Finance navigation"]');
    const link = nav.getByRole('link', { name: item.label, exact: true });
    await link.click();

    // Verify the page heading
    await expect(page.locator('h1')).toHaveText(item.heading);

    // Semantics first, then the painted result: reading computed style means a token rename
    // cannot pass a class-string check while the user sees no active destination.
    await expect(link).toHaveAttribute('aria-current', 'page');

    const active = await link.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        color: style.color,
        borderBottomColor: style.borderBottomColor,
        borderBottomWidth: style.borderBottomWidth,
      };
    });
    expect(active.color).toBe(brandInk);
    expect(active.borderBottomColor).toBe(brand);
    expect(active.borderBottomWidth).toBe('2px');

    for (const other of navItems.filter((i) => i.label !== item.label)) {
      const inactive = nav.getByRole('link', { name: other.label, exact: true });
      await expect(inactive).not.toHaveAttribute('aria-current', 'page');
    }
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
