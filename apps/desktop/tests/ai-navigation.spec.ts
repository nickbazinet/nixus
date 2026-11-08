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

  test('the agent grid is driven by list_agents, not a hardcoded frontend list', async ({ page }) => {
    // Nothing about `registry-probe` exists in the frontend — no icon entry, no locale keys — so
    // its card can only have come from the backend registry over IPC.
    await page.addInitScript(() => {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        transformCallback: () => 1,
        unregisterCallback: () => {},
        convertFileSrc: (path: string) => path,
        invoke: (cmd: string) => {
          if (cmd.startsWith('plugin:')) return Promise.resolve(null);
          if (cmd === 'check_picker_gate') return Promise.resolve({ needs_picker: false });
          if (cmd === 'check_onboarding_status') return Promise.resolve({ needs_onboarding: false });
          if (cmd === 'list_agents') {
            return Promise.resolve([
              {
                id: 'budget-helper',
                name_key: 'agents.budgetHelper.name',
                description_key: 'agents.budgetHelper.description',
                kind: 'chat',
                routable: false,
              },
              {
                id: 'registry-probe',
                name_key: 'Registry Probe',
                description_key: 'Served by list_agents',
                kind: 'chat',
                routable: false,
              },
            ]);
          }
          return Promise.resolve(null);
        },
      };
      (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };
    });
    await page.goto('/ai');

    await expect(
      page.getByRole('heading', { level: 2, name: 'Registry Probe', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Budget Helper', exact: true })
    ).toBeVisible();
  });

  test('both chat agents are listed and each has its own route', async ({ page }) => {
    await page.addInitScript((agents) => {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        transformCallback: () => 1,
        unregisterCallback: () => {},
        convertFileSrc: (path: string) => path,
        invoke: (cmd: string) => {
          if (cmd.startsWith('plugin:')) return Promise.resolve(null);
          if (cmd === 'check_picker_gate') return Promise.resolve({ needs_picker: false });
          if (cmd === 'check_onboarding_status') return Promise.resolve({ needs_onboarding: false });
          if (cmd === 'list_agents') return Promise.resolve(agents);
          return Promise.resolve(null);
        },
      };
      (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };
    }, [
              {
                id: "budget-helper",
                name_key: "agents.budgetHelper.name",
                description_key: "agents.budgetHelper.description",
                kind: "chat",
                ready_key: "agents.budgetHelper.ready",
                scope_key: "agents.budgetHelper.scope",
                starter_keys: [
                  "agents.budgetHelper.starterTracking",
                  "agents.budgetHelper.starterVsLastMonth",
                  "agents.budgetHelper.starterWhereItGoes",
                ],
                routable: false,
              },
              {
                id: "car-maintenance",
                name_key: "agents.carMaintenance.name",
                description_key: "agents.carMaintenance.description",
                kind: "chat",
                ready_key: "agents.carMaintenance.ready",
                scope_key: "agents.carMaintenance.scope",
                starter_keys: [
                  "agents.carMaintenance.starterDue",
                  "agents.carMaintenance.starterHistory",
                  "agents.carMaintenance.starterOdometer",
                ],
                routable: false,
              },
            ]);
    await page.goto('/ai');

    await expect(
      page.getByRole('heading', { level: 2, name: 'Budget Helper', exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Car Maintenance', exact: true })
    ).toBeVisible();

    // The route itself is asserted in chat-maintenance-query.spec.ts, which carries the full
    // chat-page mock this spec deliberately does not.
    await page
      .locator('a[data-slot="card"]')
      .filter({ hasText: 'Car Maintenance' })
      .click();
    await expect(page).toHaveURL(/\/ai\/car-maintenance/);
  });

  /* `home-composer` is a backend surface, not a pickable agent. It must never reach this page. */
  test('the dashboard composer is not listed as an agent', async ({ page }) => {
    await page.goto('/ai');

    await expect(page.getByRole('heading', { level: 2, name: /composer/i })).toHaveCount(0);
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
