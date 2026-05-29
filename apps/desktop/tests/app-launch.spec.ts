import { test, expect } from '@playwright/test';

test('default React page renders content', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).not.toBeEmpty();
});
