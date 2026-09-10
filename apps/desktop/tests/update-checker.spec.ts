import { test, expect, type Page } from '@playwright/test';

/* The only spec that lets `plugin:updater|check` answer truthy. Everywhere else it MUST resolve
 * null: an available update opens a modal whose focus trap aria-hides the rest of the app. */

type MockWindow = Record<string, unknown>;

/* Exactly what scripts/generate-release-notes.mjs writes: `###` heads, `-` bullets, `**scope:**`.
 * The `~1.2s` / `~/.config` line is load-bearing — it pins remark-gfm's singleTilde:false. */
const GENERATED_NOTES = [
  '### Features',
  '',
  '- **ai:** Improve statement imports (a1b2c3d)',
  '- **budget:** Add rollover targets (e4f5g6h)',
  '',
  '### Bug Fixes',
  '',
  '- **updater:** Drop the ~1.2s stall and tidy ~/.config handling (i7j8k9l)',
].join('\n');

const bullets = (n: number) =>
  Array.from({ length: n }, (_, i) => `- **area${i}:** Change ${i} (00${i}abc)`).join('\n');

const LONG_NOTES = `### Features\n\n${bullets(40)}`;

/* `body` absent is the real "release had no notes" state: the plugin omits the field. */
async function setupUpdateAvailable(page: Page, body: string | null) {
  await page.addInitScript((releaseBody: string | null) => {
    const w = window as unknown as Record<string, unknown>;
    // useAuthSession and CloudSignInNavigator both call event.listen() on mount.
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

    let downloadChannel: { onmessage: (event: unknown) => void } | null = null;
    let releaseDownload: (() => void) | null = null;
    const restarts: number[] = [];
    w.__MOCK_RESTARTS__ = restarts;
    w.__MOCK_EMIT_DOWNLOAD_EVENT__ = (event: unknown) => downloadChannel?.onmessage(event);
    w.__MOCK_FINISH_DOWNLOAD__ = () => releaseDownload?.();

    w.__TAURI_INTERNALS__ = {
      // Channel (used by downloadAndInstall) registers its handler through this on construction.
      transformCallback: () => 1,
      unregisterCallback: () => {},
      convertFileSrc: (path: string) => path,
      invoke: (cmd: string, args: Record<string, unknown>) => {
        // Must precede the blanket `plugin:` branch, or no update is ever available.
        if (cmd === 'plugin:updater|check')
          return Promise.resolve({ rid: 1, currentVersion: '0.3.17', version: '0.4.0', date: '2026-09-10 12:00:00.000 +00:00:00', body: releaseBody ?? undefined, rawJson: {} });
        if (cmd === 'plugin:updater|download_and_install') {
          downloadChannel = args.onEvent as { onmessage: (event: unknown) => void };
          // Held open so the downloading stage can be observed instead of racing past it.
          return new Promise<null>((resolve) => { releaseDownload = () => resolve(null); });
        }
        if (cmd === 'plugin:process|restart') { restarts.push(Date.now()); return Promise.resolve(null); }
        if (cmd.startsWith('plugin:')) return Promise.resolve(null);

        switch (cmd) {
          // A truthy gate redirects to /picker, where UpdateChecker is deliberately unmounted.
          case 'check_picker_gate': return Promise.resolve({ needs_picker: false });
          case 'check_onboarding_status': return Promise.resolve({ needs_onboarding: false });
          case 'get_budget_summary': return Promise.resolve({ total_target_cents: 250000, total_spent_cents: 118350, remaining_cents: 131650, month: '2026-08' });
          case 'get_current_net_worth': return Promise.resolve({ total_cents: 50150000, cash_cents: 150000, investments_cents: 0, assets_cents: 50000000 });
          case 'get_income_total': return Promise.resolve(720000);
          case 'get_savings_projects_summary': return Promise.resolve({ active_project_count: 0, total_saved_cents: 0, total_target_cents: 0 });
          case 'get_financial_health_summary': return Promise.resolve({ data_sufficient: false, emergency_fund: null, savings: null, waterfall: { current_step: 'build_emergency_fund', action_line_key: 'build_emergency_fund' } });
          // null where an array is expected crashes on `.map` and shows the error boundary, which
          // would fail every locator below for an unrelated reason.
          case 'get_top_budget_categories':
          case 'get_spending_breakdown':
          case 'get_recent_net_worth_snapshots':
          case 'get_net_worth_history':
          case 'get_expenses':
          case 'get_all_budget_categories': return Promise.resolve([]);
          default: return Promise.resolve(null);
        }
      },
    };
  }, body);
}

const notesRegion = (page: Page) => page.getByTestId('update-release-notes');
const dismiss = (page: Page) => page.getByRole('button', { name: 'Not now' });

async function openDialog(page: Page, body: string | null) {
  await setupUpdateAvailable(page, body);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Update available/ })).toBeVisible();
}

test('generated release notes render as semantic markup, not raw Markdown', async ({ page }) => {
  await openDialog(page, GENERATED_NOTES);

  const notes = notesRegion(page);
  await expect(notes.getByRole('heading', { name: 'Features' })).toBeVisible();
  await expect(notes.getByRole('heading', { name: 'Bug Fixes' })).toBeVisible();
  await expect(notes.getByRole('list')).toHaveCount(2);
  await expect(notes.getByRole('listitem')).toHaveCount(3);
  await expect(notes.getByRole('listitem').first()).toHaveText('ai: Improve statement imports (a1b2c3d)');
  await expect(notes.locator('strong').first()).toHaveText('ai:');

  const text = (await notes.innerText()).trim();
  expect(text).not.toContain('###');
  expect(text).not.toContain('**');
  // singleTilde:false — a lone `~` is "approximately" or a home path, never a strikethrough.
  await expect(notes.locator('del')).toHaveCount(0);
  expect(text).toContain('~1.2s');
  expect(text).toContain('~/.config');
});

test('every heading level normalizes to h3 under the dialog title', async ({ page }) => {
  await openDialog(page, [1, 2, 3, 4, 5, 6].map((n) => `${'#'.repeat(n)} Level ${n}`).join('\n\n'));

  const levels = await notesRegion(page).evaluate((el) =>
    [...el.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => h.tagName)
  );

  // DialogTitle is the h2; no release body may outrank it, at any depth.
  expect(levels).toEqual(['H3', 'H3', 'H3', 'H3', 'H3', 'H3']);
});

test('plain text keeps its own line breaks and cannot widen the dialog', async ({ page }) => {
  await openDialog(page, `first line\nsecond line\n\nSecond para TOKEN${'x'.repeat(90)}END`);

  const shape = await notesRegion(page).evaluate((el) => ({
    // innerText reflects rendering, so a newline here proves the break survived.
    firstParaText: (el.querySelector('p') as HTMLElement).innerText,
    overflowWrap: getComputedStyle(el).overflowWrap,
    horizontalOverflow: el.scrollWidth - el.clientWidth,
    popupWidth: document.querySelector('[data-slot="dialog-content"]')!.getBoundingClientRect().width,
  }));

  expect(shape.firstParaText).toBe('first line\nsecond line');
  // break-word alone leaves min-content at the token's full width and stretches the popup.
  expect(shape.overflowWrap).toBe('anywhere');
  expect(shape.horizontalOverflow).toBe(0);
  expect(shape.popupWidth).toBeLessThanOrEqual(384);
});

test('an absent or whitespace-only release body keeps the localized fallback', async ({ page }) => {
  for (const body of [null, '   \n\t  \n ']) {
    await setupUpdateAvailable(page, body);
    await page.goto('/');
    await expect(notesRegion(page)).toHaveText('A new version is available.');
    // Plain text, not Markdown output: the fallback is a sentence, not a document.
    await expect(notesRegion(page).locator('p')).toHaveCount(0);
  }
});

test('long release notes scroll inside the dialog while the actions stay usable', async ({ page }) => {
  await openDialog(page, LONG_NOTES);

  const notes = notesRegion(page);
  expect(await notes.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(0);
  expect(await notes.evaluate((el) => { el.scrollTop = el.scrollHeight; return el.scrollTop; })).toBeGreaterThan(0);

  await expect(page.getByRole('heading', { name: /Update available/ })).toBeVisible();
  await expect(dismiss(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update & restart' })).toBeVisible();
});

test('the notes region is a named region a keyboard can reach and page through', async ({ page }) => {
  await openDialog(page, LONG_NOTES);

  const notes = notesRegion(page);
  await expect(notes).toHaveAttribute('role', 'region');
  await expect(notes).toHaveAttribute('tabindex', '0');
  await expect(notes).toHaveAccessibleName('Update available');

  // press() focuses first, so a region that is not focusable scrolls nothing here.
  await notes.press('PageDown');
  await expect(notes).toBeFocused();
  // Polled: the key-driven scroll lands a frame after focus resolves.
  await expect.poll(() => notes.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test('the notes gutter is a persistent scrollbar driven by the line-strong token', async ({ page }) => {
  await openDialog(page, LONG_NOTES);

  const sb = await notesRegion(page).evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--line-strong)';
    document.body.append(probe);
    const token = getComputedStyle(probe).color;
    probe.remove();
    const cs = getComputedStyle(el);
    return { width: cs.scrollbarWidth, color: cs.scrollbarColor, token, thumbWidth: getComputedStyle(el, '::-webkit-scrollbar').width };
  });

  expect(sb.width).toBe('thin');
  // Thumb is the token, track is transparent — proves no raw colour was hardcoded.
  expect(sb.color).toBe(`${sb.token} rgba(0, 0, 0, 0)`);
  expect(sb.thumbWidth).toBe('6px');
});

test('the notes are the dialog description and nest no block content in a paragraph', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await openDialog(page, GENERATED_NOTES);

  // The region's own aria-label must not become the description: an aria-label on the
  // aria-describedby target replaces its text, which would announce the title instead of the notes.
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveAccessibleDescription(/Features/);

  const nesting = await page.evaluate(() => {
    const popup = document.querySelector('[data-slot="dialog-content"]');
    const id = popup?.getAttribute('aria-describedby') ?? '';
    return {
      describedText: (id ? document.getElementById(id) : null)?.textContent?.trim() ?? '',
      // A block element inside <p> is repaired by the parser, which silently moves the notes OUT
      // of the described element — a validity and an accessibility assertion at once.
      bad: [...(popup?.querySelectorAll('p div, p ul, p ol, p li, p h1, p h2, p h3, p h4, p h5, p h6, p p, p pre') ?? [])].map((el) => el.tagName),
    };
  });

  expect(nesting.describedText).toContain('Features');
  expect(nesting.describedText).toContain('Improve statement imports');
  expect(nesting.bad).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('the dialog opens at the top of the notes with focus on the dismiss action', async ({ page }) => {
  // A link below the fold is the case that regresses: Base UI focuses the first tabbable
  // descendant, and the browser scrolls it into view — taking the first heading off screen.
  await openDialog(page, `### Features\n\n${bullets(20)}\n- **deps:** Bump [everything](https://example.com) (a1b2c3d)`);

  // Focus must settle before scrollTop is read, or the assertion races Base UI.
  await expect(dismiss(page)).toBeFocused();

  const opened = await notesRegion(page).evaluate((el) => ({
    scrollTop: el.scrollTop,
    overflows: el.scrollHeight > el.clientHeight,
    focusInside: el.contains(document.activeElement),
  }));

  expect(opened.overflows).toBe(true);
  expect(opened.scrollTop).toBe(0);
  expect(opened.focusInside).toBe(false);
  await expect(notesRegion(page).getByRole('heading', { name: 'Features' })).toBeVisible();
});

test('"Not now" still dismisses the formatted dialog', async ({ page }) => {
  await openDialog(page, GENERATED_NOTES);

  await dismiss(page).click();

  await expect(page.getByRole('heading', { name: /Update available/ })).toBeHidden();
  await expect(notesRegion(page)).toHaveCount(0);
});

test('"Update & restart" still downloads, reports progress, and relaunches', async ({ page }) => {
  await openDialog(page, GENERATED_NOTES);
  const emit = (event: unknown) =>
    page.evaluate((e) => ((window as MockWindow).__MOCK_EMIT_DOWNLOAD_EVENT__ as (v: unknown) => void)(e), event);

  await page.getByRole('button', { name: 'Update & restart' }).click();

  await expect(page.getByRole('heading', { name: 'Downloading update...' })).toBeVisible();
  await emit({ event: 'Started', data: { contentLength: 1000 } });
  await emit({ event: 'Progress', data: { chunkLength: 400 } });

  await expect(page.getByRole('progressbar', { name: 'Downloading update...' })).toHaveAttribute('aria-valuenow', '40');
  await expect(page.getByText('40%')).toBeVisible();

  await emit({ event: 'Finished', data: {} });
  await page.evaluate(() => ((window as MockWindow).__MOCK_FINISH_DOWNLOAD__ as () => void)());

  await expect(page.getByRole('heading', { name: 'Restarting...' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => ((window as MockWindow).__MOCK_RESTARTS__ as number[]).length))
    .toBe(1);
});
