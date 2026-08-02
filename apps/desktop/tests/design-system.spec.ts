import { test, expect, type Page } from '@playwright/test';

/* Seeds enough of the Finance dashboard for the money-treatment sweep below to have figures to
 * look at. Every `plugin:` command must resolve null: a truthy updater response renders an
 * always-open Dialog, whose focus trap puts aria-hidden on the whole app. */
async function setupSeededDashboard(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      convertFileSrc: (path: string) => path,
      invoke: (cmd: string) => {
        if (cmd.startsWith('plugin:')) return Promise.resolve(null);
        switch (cmd) {
          case 'check_onboarding_status':
            return Promise.resolve({ needs_onboarding: false });
          case 'get_budget_summary':
            return Promise.resolve({
              total_target_cents: 250000,
              total_spent_cents: 118350,
              remaining_cents: 131650,
              month: '2026-08',
            });
          case 'get_top_budget_categories':
            return Promise.resolve([
              { id: 1, name: 'Groceries', group_name: 'Essentials', target_cents: 70000, spent_cents: 35125, percentage: 50 },
              { id: 2, name: 'Restaurants', group_name: 'Lifestyle', target_cents: 20000, spent_cents: 28640, percentage: 143 },
            ]);
          case 'get_current_net_worth':
            return Promise.resolve({
              total_cents: 50150000,
              cash_cents: 150000,
              investments_cents: 0,
              assets_cents: 50000000,
            });
          case 'get_spending_breakdown':
            return Promise.resolve([
              { category_id: 1, category_name: 'Groceries', spent_cents: 35125 },
            ]);
          case 'get_income_total':
            return Promise.resolve(720000);
          case 'get_latest_expense':
            return Promise.resolve({
              id: 9,
              merchant: 'Costco',
              amount_cents: 4512,
              budget_category_id: 1,
              account_id: null,
              date: '2026-08-01',
              source: 'manual',
            });
          case 'get_yearly_summary':
            return Promise.resolve({
              year: 2026,
              is_current_year: true,
              total_spent_cents: 450000,
              total_income_cents: 600000,
              cash_flow_net_cents: 150000,
              net_worth_gain_cents: 2500000,
              net_worth_gain_available: true,
              top_categories: [],
              monthly_totals: [],
              all_categories: [],
              available_years: [2026],
            });
          case 'get_financial_health_summary':
            return Promise.resolve({
              data_sufficient: false,
              emergency_fund: null,
              savings: null,
              waterfall: {
                current_step: 'build_emergency_fund',
                action_line_key: 'build_emergency_fund',
              },
            });
          // A command that resolves null where an array is expected crashes on `.map` and shows the
          // error boundary, which fails every locator in this file for an unrelated reason.
          case 'get_recent_net_worth_snapshots':
          case 'get_net_worth_history':
          case 'get_expenses':
          case 'get_all_budget_categories':
            return Promise.resolve([]);
          default:
            return Promise.resolve(null);
        }
      },
    };
  });
}

/* The values asserted here are the Direction A spine tokens defined in
 * packages/shared/src/styles/tokens.css. Their CONTRAST MARGINS are guarded
 * separately and computationally by packages/shared's contrast.test.ts — this
 * spec only proves the tokens actually reach the running app. */
const SPINE_LIGHT = {
  bg: '#FAF8F5',
  card: '#FFFFFF',
  ink: '#1C1917',
  'ink-dim': '#6B635A',
  line: '#E8E3DA',
  brand: '#5B54D6',
  'brand-on': '#FFFFFF',
  good: '#15803D',
  caution: '#B45309',
  over: '#BE123C',
} as const;

test('spine colour tokens reach the document root', async ({ page }) => {
  await page.goto('/');

  const actual = await page.evaluate((names) => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      names.map((name) => [name, style.getPropertyValue(`--${name}`).trim()])
    );
  }, Object.keys(SPINE_LIGHT));

  expect(actual).toEqual(SPINE_LIGHT);
});

test('the compatibility alias layer resolves to spine values', async ({ page }) => {
  await page.goto('/');

  const aliases = await page.evaluate(() => {
    const probe = document.createElement('div');
    document.body.append(probe);
    const read = (value: string) => {
      probe.style.color = value;
      return getComputedStyle(probe).color;
    };
    const result = {
      background: read('var(--background)'),
      bg: read('var(--bg)'),
      primary: read('var(--primary)'),
      brand: read('var(--brand)'),
      destructive: read('var(--destructive)'),
      over: read('var(--over)'),
    };
    probe.remove();
    return result;
  });

  expect(aliases.background).toBe(aliases.bg);
  expect(aliases.primary).toBe(aliases.brand);
  expect(aliases.destructive).toBe(aliases.over);
});

test('the eight-step chart ramp is fully defined', async ({ page }) => {
  await page.goto('/');

  const steps = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      style.getPropertyValue(`--chart-${n}`).trim()
    );
  });

  expect(steps).toHaveLength(8);
  expect(steps.every((hex) => /^#[0-9A-Fa-f]{6}$/.test(hex))).toBe(true);
  expect(new Set(steps).size).toBe(8);
});

test('body text uses Inter and no monospace family is loaded for money', async ({
  page,
}) => {
  await page.goto('/');

  const fonts = await page.evaluate(() => ({
    body: getComputedStyle(document.body).fontFamily,
    loaded: [...document.fonts].map((f) => f.family),
  }));

  expect(fonts.body).toContain('Inter');
  expect(fonts.loaded.join(' ')).not.toContain('JetBrains');
});

test('no element renders a monospace font on a money figure', async ({ page }) => {
  await setupSeededDashboard(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('metric-card').first()).toBeVisible();

  const figures = await page.evaluate(() => {
    const leaves = [...document.querySelectorAll('*')].filter(
      (el) => el.children.length === 0 && /\$\s?[\d,]/.test(el.textContent ?? '')
    );
    const slots = [
      ...document.querySelectorAll('[data-slot="money"], [data-slot="masked-figure"]'),
    ];
    const describe = (el: Element) => el.textContent?.trim().slice(0, 40) ?? '';
    return {
      dollarLeafCount: leaves.length,
      moneySlotCount: slots.length,
      monospace: leaves
        .filter((el) => /mono/i.test(getComputedStyle(el).fontFamily))
        .map(describe),
      notInter: slots
        .filter((el) => !getComputedStyle(el).fontFamily.includes('Inter'))
        .map(describe),
      // Tabular figures are what buy the column alignment a monospace family used to be used for,
      // so "not monospace" is only half the rule.
      notTabular: slots
        .filter((el) => !getComputedStyle(el).fontVariantNumeric.includes('tabular-nums'))
        .map(describe),
    };
  });

  // Vacuity guard. Unseeded, `/` renders skeletons and zero money figures, so every assertion
  // below passed for the wrong reason and the rule was in practice unguarded.
  expect(figures.dollarLeafCount).toBeGreaterThan(0);
  expect(figures.moneySlotCount).toBeGreaterThan(0);

  expect(figures.monospace).toEqual([]);
  expect(figures.notInter).toEqual([]);
  expect(figures.notTabular).toEqual([]);
});

test('no surface renders banned 10px or 11px text', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const offenders = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((el) => {
        if ((el.textContent ?? '').trim().length === 0) return false;
        if (el.children.length > 0) return false;
        const size = Number.parseFloat(getComputedStyle(el).fontSize);
        return size > 0 && size < 12.5;
      })
      .map((el) => {
        const size = getComputedStyle(el).fontSize;
        return `${size}: ${el.textContent?.trim().slice(0, 40) ?? ''}`;
      })
  );

  expect(offenders).toEqual([]);
});

test('cards carry no shadow', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const shadowed = await page.evaluate(() =>
    [...document.querySelectorAll('[data-slot="card"]')]
      .filter((el) => {
        const shadow = getComputedStyle(el).boxShadow;
        return shadow !== 'none' && shadow.length > 0;
      })
      .map((el) => getComputedStyle(el).boxShadow)
  );

  expect(shadowed).toEqual([]);
});

test('app renders without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  expect(errors).toEqual([]);
});

test('app renders content with design system', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('h1')).toHaveText('Today');
  await expect(page.locator('body')).not.toBeEmpty();
});
