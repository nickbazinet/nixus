import { test, expect } from '@playwright/test';

test('CSS variables are set on :root with correct design token values', async ({ page }) => {
  await page.goto('/');

  const vars = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      primary: style.getPropertyValue('--primary').trim(),
      background: style.getPropertyValue('--background').trim(),
      foreground: style.getPropertyValue('--foreground').trim(),
      positive: style.getPropertyValue('--positive').trim(),
      warning: style.getPropertyValue('--warning').trim(),
      destructive: style.getPropertyValue('--destructive').trim(),
      muted: style.getPropertyValue('--muted').trim(),
      accent: style.getPropertyValue('--accent').trim(),
    };
  });

  expect(vars.primary).toBe('#0D9488');
  expect(vars.background).toBe('#FFFFFF');
  expect(vars.foreground).toBe('#0F172A');
  expect(vars.positive).toBe('#059669');
  expect(vars.warning).toBe('#F59E0B');
  expect(vars.destructive).toBe('#F43F5E');
  expect(vars.muted).toBe('#F1F5F9');
  expect(vars.accent).toBe('#F0FDFA');
});

test('body text uses Inter font family', async ({ page }) => {
  await page.goto('/');

  const fontFamily = await page.evaluate(() => {
    return getComputedStyle(document.body).fontFamily;
  });

  expect(fontFamily).toContain('Inter');
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
