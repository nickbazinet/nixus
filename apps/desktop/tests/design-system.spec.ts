import { test, expect } from '@playwright/test';

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
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const offenders = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((el) => {
        const text = el.textContent ?? '';
        if (!/\$\s?[\d,]/.test(text)) return false;
        if (el.children.length > 0) return false;
        return /mono/i.test(getComputedStyle(el).fontFamily);
      })
      .map((el) => el.textContent?.trim().slice(0, 40) ?? '')
  );

  expect(offenders).toEqual([]);
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

  await expect(page.locator('h1')).toContainText('Dashboard');
  await expect(page.locator('body')).not.toBeEmpty();
});
