import { test, expect, type Page } from '@playwright/test';

/**
 * The ten-item Finance tab strip collapsed into FOUR destinations, each owning a segmented sub-nav.
 * `src/lib/navigation.ts` makes a fifth destination a compile error, so this list is the complete
 * surface area of the destination strip — the count assertion below is what keeps it that way at
 * runtime too. Clicking a destination deep-links to its first sub-surface, which is why `path` and
 * `heading` describe that sub-surface rather than a bare `/spending`-style index.
 */
const destinations = [
  { label: 'Today', path: '/', heading: 'Today' },
  { label: 'Spending', path: '/spending/budget', heading: 'Budget' },
  { label: 'Wealth', path: '/wealth/accounts', heading: 'Accounts' },
  { label: 'Insights', path: '/insights/trends', heading: 'Spending trends' },
] as const;

/**
 * The segmented sub-nav that replaced `InnerTabNav` and `NetWorthSectionNav`. Items are real links
 * with `aria-current="page"` — deliberately NOT an ARIA tablist, and arrow keys are not bound.
 */
const subNavs = [
  {
    landing: '/spending/budget',
    items: ['Budget', 'Transactions', 'Income', 'Recurring'],
  },
  {
    landing: '/wealth/accounts',
    items: ['Accounts', 'Projects', 'What you own', 'Net worth', 'Where to put your money'],
  },
  {
    landing: '/insights/trends',
    items: ['Spending trends', 'Year summary', 'Projection', 'Retirement'],
  },
] as const;

const financeNav = (page: Page) =>
  page.locator('nav[aria-label="Finance navigation"]');
const segmentedNav = (page: Page) =>
  page.locator('nav[data-slot="segmented-nav"]');

test('destination nav renders exactly the four destinations', async ({ page }) => {
  await page.goto('/');

  const nav = financeNav(page);
  await expect(nav).toBeVisible();

  for (const item of destinations) {
    await expect(nav.getByRole('link', { name: item.label, exact: true })).toBeVisible();
  }

  // Counting is the point: the retired ten-item strip and any smuggled-in fifth destination both
  // fail here, where a per-label loop would pass.
  await expect(nav.getByRole('link')).toHaveCount(destinations.length);
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

test('clicking each destination navigates to its first sub-surface with active state', async ({
  page,
}) => {
  await page.goto('/');

  const brand = await resolveToken(page, '--brand');
  const brandInk = await resolveToken(page, '--brand-ink');

  for (const item of destinations) {
    const nav = financeNav(page);
    const link = nav.getByRole('link', { name: item.label, exact: true });
    await link.click();

    await expect(page).toHaveURL(new RegExp(`${item.path.replace(/\//g, '\\/')}(\\?|$)`));
    await expect(page.locator('h1')).toHaveText(item.heading);

    // Semantics first, then the painted result: reading computed style means a token rename
    // cannot pass a class-string check while the user sees no active destination. `toHaveCSS`
    // retries, which is required because the underline is a colour transition.
    await expect(link).toHaveAttribute('aria-current', 'page');
    await expect(link).toHaveCSS('color', brandInk);
    await expect(link).toHaveCSS('border-bottom-color', brand);
    await expect(link).toHaveCSS('border-bottom-width', '2px');

    for (const other of destinations.filter((i) => i.label !== item.label)) {
      const inactive = nav.getByRole('link', { name: other.label, exact: true });
      await expect(inactive).not.toHaveAttribute('aria-current', 'page');

      // The inactive underline is transparent rather than absent, so activating a destination
      // cannot shift the strip by a pixel.
      await expect(inactive).toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)');
      await expect(inactive).toHaveCSS('border-bottom-width', '2px');
    }
  }
});

test('each destination surface displays its H1 in the page header', async ({ page }) => {
  for (const item of destinations) {
    await page.goto(item.path);

    const heading = page.locator('h1');
    await expect(heading).toHaveText(item.heading);
    // The shell's skip link and its route-change focus move both target this id.
    await expect(heading).toHaveAttribute('id', 'surface-heading');
  }
});

test('Today renders no sub-nav; every other destination renders its own', async ({ page }) => {
  await page.goto('/');
  await expect(segmentedNav(page)).toHaveCount(0);

  for (const { landing, items } of subNavs) {
    await page.goto(landing);

    const sub = segmentedNav(page);
    await expect(sub).toBeVisible();
    await expect(sub.getByRole('link')).toHaveCount(items.length);

    for (const label of items) {
      await expect(sub.getByRole('link', { name: label, exact: true })).toBeVisible();
    }

    // Landing on a destination marks its first sub-surface as current.
    await expect(sub.getByRole('link', { name: items[0], exact: true })).toHaveAttribute(
      'aria-current',
      'page'
    );
  }
});

test('sub-nav items are links, not a tablist', async ({ page }) => {
  await page.goto('/spending/budget');

  const sub = segmentedNav(page);
  await expect(sub).toBeVisible();

  // A screen reader announces these as links, so binding the tablist arrow-key convention to them
  // would contradict the announced role. Asserting the roles are absent is what holds that line.
  await expect(sub.locator('[role="tablist"], [role="tab"], [role="tabpanel"]')).toHaveCount(0);
  await expect(sub).not.toHaveAttribute('role', 'tablist');
});

test('activating a sub-nav item moves aria-current to it', async ({ page }) => {
  await page.goto('/spending/budget');

  const sub = segmentedNav(page);
  const budget = sub.getByRole('link', { name: 'Budget', exact: true });
  const income = sub.getByRole('link', { name: 'Income', exact: true });

  await income.click();

  await expect(page).toHaveURL(/\/spending\/income(\?|$)/);
  await expect(income).toHaveAttribute('aria-current', 'page');
  await expect(budget).not.toHaveAttribute('aria-current', 'page');
  // The destination itself stays current while a sibling sub-surface is open.
  await expect(
    financeNav(page).getByRole('link', { name: 'Spending', exact: true })
  ).toHaveAttribute('aria-current', 'page');
});

test('the global period control is rendered once, by the nav, only where it applies', async ({
  page,
}) => {
  // Period-aware destinations get exactly one month control and it lives in the destination nav —
  // no surface renders its own any more.
  for (const path of ['/', '/spending/budget', '/insights/trends']) {
    await page.goto(path);
    await expect(page.getByTestId('month-navigator')).toHaveCount(1);
    await expect(financeNav(page).getByTestId('month-navigator')).toHaveCount(1);
    await expect(page.getByTestId('prev-month-button')).toHaveCount(1);
    await expect(page.getByTestId('next-month-button')).toHaveCount(1);
    await expect(page.getByTestId('current-month-label')).toHaveCount(1);
  }

  // Wealth is a point-in-time picture, so it shows no period at all.
  await page.goto('/wealth/accounts');
  await expect(page.getByTestId('month-navigator')).toHaveCount(0);
});

test('the selected period is mirrored to the URL and retained across navigation', async ({
  page,
}) => {
  await page.goto('/?period=2026-03');
  await expect(page.getByTestId('current-month-label')).toHaveText('March 2026');

  await financeNav(page).getByRole('link', { name: 'Spending', exact: true }).click();

  await expect(page).toHaveURL(/period=2026-03/);
  await expect(page.getByTestId('current-month-label')).toHaveText('March 2026');
});

test('main content area has max-width 1280px', async ({ page }) => {
  await page.goto('/');

  const content = page.locator('main > div');
  const maxWidth = await content.evaluate((el) => getComputedStyle(el).maxWidth);
  expect(maxWidth).toBe('1280px');
});
