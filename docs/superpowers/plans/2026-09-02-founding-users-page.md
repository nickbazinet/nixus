# Founding Users Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the existing `/beta` experience as the bilingual Nixus Founding Users Program and make `nixus@gmail.com` the single web contact address.

**Architecture:** Preserve the existing English and French beta routes, components, prerendering, and route paths. Put the contact address in one source module, consume it from every component/content/structured-data surface, and keep localized program copy in the existing locale files. The program remains email-driven: semantic `mailto:` anchors work without JavaScript and no form or backend is added.

**Tech Stack:** React 19, TypeScript 5.8 strict mode, TanStack Start/Router, i18next, Tailwind CSS 4, Vitest + Testing Library, Playwright.

## Global Constraints

- Keep `/beta` and `/fr/beta`; do not add `/founding-users` routes.
- Use `nixus@gmail.com` for every user-visible web contact and schema.org organization email.
- Preserve one-to-one English/French key parity and key ordering.
- Follow `_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md`: existing warm-paper tokens, hairlines, crisp radii, no new shadows or decorative gradients, and 44px marketing touch targets below 1024px.
- Keep the header destination visible on phones and label it `Founding` / `Fondateurs`.
- The primary program CTA is a real anchor to `mailto:nixus@gmail.com?subject=Nixus%20Founding%20User%20Program` in English and the localized equivalent subject in French.
- Do not add a form, CRM, API, database write, pricing offer, new dependency, desktop-app change, DNS/infrastructure change, or repository-documentation email update.
- Never edit `apps/web/src/routeTree.gen.ts` manually.
- New TypeScript must use named exports, strict types, no `any`, no assertions other than `as const`, no non-null assertions, and no suppression directives.
- Follow red → green → refactor for every behavior change.

## File Map

**Create**

- `apps/web/src/content/contact.ts` — canonical web contact address and mailto builder.

**Modify: contact consumers**

- `apps/web/src/content/limitations.ts` — remove the unrelated beta-email constant.
- `apps/web/src/content/faq.ts` — build the inline FAQ email link from the canonical address.
- `apps/web/src/components/{SiteFooter,DownloadBanner,FAQ,LegalPage}.tsx` — import the canonical address.
- `apps/web/src/components/{SiteFooter,DownloadBanner,FAQ,LegalPage}.test.tsx` — independently assert `nixus@gmail.com` behavior.
- `apps/web/src/lib/jsonLd.ts` and `apps/web/src/lib/jsonLd.test.ts` — expose and test the new organization email.

**Modify: Founding Users experience**

- `apps/web/src/locales/en.json` and `apps/web/src/locales/fr.json` — replace beta recruitment copy, metadata, CTA subjects, and visible email values in matching key order.
- `apps/web/src/components/BetaPage.tsx` — make program outreach the hero and feedback conversion action while retaining fit, proof, limitations, setup, and FAQ sections.
- `apps/web/src/components/BetaGetStarted.tsx` — turn the first/last conversion affordance into program contact rather than a second public download CTA.
- `apps/web/src/components/BetaSection.tsx` — present the short homepage program pitch and CTA.
- `apps/web/src/components/BetaPage.test.tsx` and `apps/web/src/components/BetaSection.test.tsx` — lock the bilingual program content and exact mailto behavior.
- `apps/web/src/components/SiteHeader.tsx` and `apps/web/src/components/SiteHeader.test.tsx` — change the destination label without changing route or mobile reachability.
- `apps/web/tests/e2e/conversion.spec.ts` — drive the Founding destination and inspect the program CTA without launching an external mail client.

**No structural change required**

- `apps/web/src/routes/beta.tsx`, `apps/web/src/routes/fr/beta.tsx`, `apps/web/src/content/betaPage.ts`, and `apps/web/tests/e2e/support/site.ts` already provide the correct routes, IDs, and route-wide checks.

---

### Task 1: Canonical web contact address

**Files:**
- Create: `apps/web/src/content/contact.ts`
- Modify: `apps/web/src/content/limitations.ts:19`
- Modify: `apps/web/src/content/faq.ts:53-65`
- Modify: `apps/web/src/components/SiteFooter.tsx:4-8,73-78`
- Modify: `apps/web/src/components/DownloadBanner.tsx:5-8,37-45`
- Modify: `apps/web/src/components/FAQ.tsx:11-15,117-124`
- Modify: `apps/web/src/components/LegalPage.tsx:3-17,70-82`
- Modify: `apps/web/src/lib/jsonLd.ts:12-14,76-83`
- Test: `apps/web/src/components/SiteFooter.test.tsx:8,21-27`
- Test: `apps/web/src/components/DownloadBanner.test.tsx:130-139`
- Test: `apps/web/src/components/FAQ.test.tsx:17,133-174`
- Test: `apps/web/src/components/LegalPage.test.tsx`
- Test: `apps/web/src/lib/jsonLd.test.ts:21-102`

**Interfaces:**
- Produces: `CONTACT_EMAIL: "nixus@gmail.com"` and `contactMailto(subject?: string): string` from `@/content/contact`.
- Consumes: no earlier task.

- [ ] **Step 1: Change contact assertions first**

Update the existing constants/assertions in the footer and FAQ tests to the independent literal:

```ts
const CONTACT_EMAIL = "nixus@gmail.com";
```

Update `DownloadBanner.test.tsx`:

```ts
expect(help).toHaveAttribute("href", "mailto:nixus@gmail.com");
expect(help).toHaveTextContent("nixus@gmail.com");
```

Add to `LegalPage.test.tsx` inside a new `describe("contact address", ...)` block:

```tsx
it("uses the canonical contact address on legal pages", () => {
  const { getByRole } = renderWithProviders(<TermsPage locale="en" />);
  expect(getByRole("link", { name: "nixus@gmail.com" })).toHaveAttribute(
    "href",
    "mailto:nixus@gmail.com",
  );
});
```

Add to `jsonLd.test.ts`:

```ts
it("publishes the canonical contact address", () => {
  expect(siteGraph("en")["@graph"][1].email).toBe("nixus@gmail.com");
});
```

- [ ] **Step 2: Run the focused tests and confirm red**

Run:

```bash
pnpm --filter @nixus/web test -- src/components/SiteFooter.test.tsx src/components/DownloadBanner.test.tsx src/components/FAQ.test.tsx src/components/LegalPage.test.tsx src/lib/jsonLd.test.ts
```

Expected: failures show the old `support@nixus.nicolasbazinet.net` href/text/schema value.

- [ ] **Step 3: Add the canonical contact module**

Create `apps/web/src/content/contact.ts`:

```ts
export const CONTACT_EMAIL = "nixus@gmail.com";

export function contactMailto(subject?: string): string {
  if (subject === undefined) return `mailto:${CONTACT_EMAIL}`;
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
```

- [ ] **Step 4: Replace every source literal**

Delete `BETA_SUPPORT_EMAIL` from `content/limitations.ts`.

In `content/faq.ts`, import `contactMailto` and set the `whoBuilt` email link to:

```ts
href: contactMailto(),
```

In `SiteFooter.tsx`, `DownloadBanner.tsx`, `FAQ.tsx`, and `LegalPage.tsx`, delete their local email constants, import `CONTACT_EMAIL, contactMailto` from `@/content/contact`, render `CONTACT_EMAIL`, and use `contactMailto()` for href values.

In `jsonLd.ts`, replace the `BETA_SUPPORT_EMAIL` import/value with `CONTACT_EMAIL`.

- [ ] **Step 5: Run the focused tests and confirm green**

Run the command from Step 2.

Expected: all five focused test files pass.

- [ ] **Step 6: Commit the contact seam with its tests**

```bash
git add apps/web/src/content/contact.ts apps/web/src/content/limitations.ts apps/web/src/content/faq.ts apps/web/src/components/SiteFooter.tsx apps/web/src/components/SiteFooter.test.tsx apps/web/src/components/DownloadBanner.tsx apps/web/src/components/DownloadBanner.test.tsx apps/web/src/components/FAQ.tsx apps/web/src/components/FAQ.test.tsx apps/web/src/components/LegalPage.tsx apps/web/src/components/LegalPage.test.tsx apps/web/src/lib/jsonLd.ts apps/web/src/lib/jsonLd.test.ts
git commit -m "fix(web): centralize the public contact address"
```

---

### Task 2: Founding Users page and homepage conversion copy

**Files:**
- Modify: `apps/web/src/components/BetaPage.test.tsx`
- Modify: `apps/web/src/components/BetaSection.test.tsx`
- Modify: `apps/web/src/components/BetaPage.tsx:10-45,70-104`
- Modify: `apps/web/src/components/BetaGetStarted.tsx:3-7,46-52`
- Modify: `apps/web/src/components/BetaSection.tsx:3-11,35-59`
- Modify: `apps/web/src/locales/en.json:29-85,126,143,167,185`
- Modify: `apps/web/src/locales/fr.json:29-85,126,143,167,185`

**Interfaces:**
- Consumes: `CONTACT_EMAIL` and `contactMailto(subject?: string)` from Task 1.
- Produces: the retained `BetaPage`, `BetaSection`, and `/beta` route contract with Founding Users copy and program mailto CTAs.

- [ ] **Step 1: Write failing English page and homepage tests**

Replace the beta-only CTA test in `BetaPage.test.tsx` with exact behavior:

```tsx
it("invites qualified visitors to become Founding Users", () => {
  renderWithProviders(<BetaPage />);

  expect(
    screen.getByRole("heading", { level: 1, name: "Help shape Nixus" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Excel or Google Sheets/i)).toBeInTheDocument();
  expect(screen.getByText(/honest feedback—not just praise/i)).toBeInTheDocument();
});

it("links both program CTAs to the canonical address and subject", () => {
  renderWithProviders(<BetaPage />);
  const expected =
    "mailto:nixus@gmail.com?subject=Nixus%20Founding%20User%20Program";

  expect(screen.getByTestId("beta-hero-cta")).toHaveAttribute("href", expected);
  expect(screen.getByTestId("beta-feedback-cta")).toHaveAttribute("href", expected);
});
```

Update `BetaSection.test.tsx`:

```tsx
it("presents the Founding Users invitation", () => {
  renderWithProviders(<BetaSection />);
  expect(screen.getByRole("heading", { name: "Help shape Nixus" })).toBeInTheDocument();
  expect(screen.getByText(/Founding User/i)).toBeInTheDocument();
});

it("links the program CTA to the canonical address and subject", () => {
  renderWithProviders(<BetaSection />);
  expect(screen.getByTestId("beta-invite-cta")).toHaveAttribute(
    "href",
    "mailto:nixus@gmail.com?subject=Nixus%20Founding%20User%20Program",
  );
});
```

- [ ] **Step 2: Add a failing French program test**

In `BetaPage.test.tsx`, import `act` and the i18n singleton, then add:

```tsx
it("renders the Founding Users program in French", async () => {
  await act(async () => i18n.changeLanguage("fr"));
  try {
    renderWithProviders(<BetaPage />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Aidez à façonner Nixus" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Excel ou Google Sheets/i)).toBeInTheDocument();
    expect(screen.getByTestId("beta-hero-cta")).toHaveAttribute(
      "href",
      "mailto:nixus@gmail.com?subject=Programme%20des%20utilisateurs%20fondateurs%20Nixus",
    );
  } finally {
    await act(async () => i18n.changeLanguage("en"));
  }
});
```

- [ ] **Step 3: Run the page tests and confirm red**

Run:

```bash
pnpm --filter @nixus/web test -- src/components/BetaPage.test.tsx src/components/BetaSection.test.tsx
```

Expected: failures for missing Founding Users copy, missing `beta-hero-cta`, and old subjects/address.

- [ ] **Step 4: Replace the English recruitment copy**

Keep all current keys but assign these values in `en.json`:

```json
"beta.eyebrow": "Founding Users Program",
"beta.limitations.heading": "Help shape Nixus",
"beta.limitations.intro": "Nixus is looking for a small group of early users who actively manage their personal finances and want to help shape the product.",
"beta.invite.heading": "Become a Nixus Founding User",
"beta.invite.body": "If you use Excel or Google Sheets to manage expenses, budgets, net worth, investments, savings, or financial goals, your experience can directly influence what Nixus becomes. You'll get early access; in return, I'm looking for honest feedback—not just praise.",
"beta.invite.cta": "Join the Founding Users Program",
"beta.invite.emailSubject": "Nixus Founding User Program",
"beta.fullGuideLink": "Learn about the program →",
"betaPage.meta.title": "Become a Nixus Founding User",
"betaPage.meta.description": "Get early access to Nixus and help shape a local-first personal finance app built for spreadsheet users.",
"betaPage.eyebrow": "Founding Users Program",
"betaPage.hero.heading": "Help shape Nixus",
"betaPage.hero.lead": "Nixus is looking for a small group of early users who actively manage their personal finances and want to help shape the product.",
"betaPage.fit.heading": "Who we're looking for",
"betaPage.fit.good.heading": "A strong fit if you…",
"betaPage.fit.good.spreadsheet": "Use Excel or Google Sheets for expenses, budgets, net worth, investments, savings, or financial goals",
"betaPage.fit.good.roughEdges": "Will share candid feedback about what is confusing, missing, or broken",
"betaPage.fit.bad.polished": "Expect finished, fully supported software today",
"betaPage.getStarted.heading": "How the program works",
"betaPage.getStarted.download.title": "Reach out",
"betaPage.getStarted.download.body": "Email me about becoming a Founding User and tell me briefly how you manage your finances today.",
"betaPage.feedback.heading": "Early access for honest feedback",
"betaPage.feedback.body": "As a Founding User, you'll get early access to Nixus and the opportunity to directly influence the product.",
"betaPage.feedback.prompt": "The most useful feedback is honest friction: what confused you, what felt wrong, and what almost made you stop using it.",
"betaPage.feedback.detail": "I'm not asking for promotion or praise. Short, direct emails are enough, and I read everything personally.",
"betaPage.feedback.cta": "Join the Founding Users Program",
"betaPage.feedback.emailSubject": "Nixus Founding User Program"
```

Retain the existing screenshots, limitations, install details, first-open details, and quick FAQ values.

- [ ] **Step 5: Add meaning-equivalent French copy in matching key order**

Use these corresponding values in `fr.json`:

```json
"beta.eyebrow": "Programme des utilisateurs fondateurs",
"beta.limitations.heading": "Aidez à façonner Nixus",
"beta.limitations.intro": "Nixus cherche un petit groupe de premiers utilisateurs qui gèrent activement leurs finances personnelles et souhaitent contribuer à façonner le produit.",
"beta.invite.heading": "Devenez un utilisateur fondateur de Nixus",
"beta.invite.body": "Si vous utilisez Excel ou Google Sheets pour gérer vos dépenses, votre budget, votre avoir net, vos placements, votre épargne ou vos objectifs financiers, votre expérience peut influencer directement l'évolution de Nixus. Vous aurez un accès anticipé; en retour, je cherche des commentaires honnêtes — pas seulement des éloges.",
"beta.invite.cta": "Rejoindre le programme",
"beta.invite.emailSubject": "Programme des utilisateurs fondateurs Nixus",
"beta.fullGuideLink": "Découvrir le programme →",
"betaPage.meta.title": "Devenez un utilisateur fondateur de Nixus",
"betaPage.meta.description": "Obtenez un accès anticipé à Nixus et contribuez à façonner une application de finances personnelles locale conçue pour les utilisateurs de tableurs.",
"betaPage.eyebrow": "Programme des utilisateurs fondateurs",
"betaPage.hero.heading": "Aidez à façonner Nixus",
"betaPage.hero.lead": "Nixus cherche un petit groupe de premiers utilisateurs qui gèrent activement leurs finances personnelles et souhaitent contribuer à façonner le produit.",
"betaPage.fit.heading": "Les profils recherchés",
"betaPage.fit.good.heading": "Un bon profil si vous…",
"betaPage.fit.good.spreadsheet": "Utilisez Excel ou Google Sheets pour vos dépenses, votre budget, votre avoir net, vos placements, votre épargne ou vos objectifs financiers",
"betaPage.fit.good.roughEdges": "Partagerez franchement ce qui est confus, incomplet ou brisé",
"betaPage.fit.bad.polished": "Attendez un logiciel fini et entièrement pris en charge dès aujourd'hui",
"betaPage.getStarted.heading": "Fonctionnement du programme",
"betaPage.getStarted.download.title": "Écrivez-moi",
"betaPage.getStarted.download.body": "Écrivez-moi pour devenir un utilisateur fondateur et décrivez brièvement comment vous gérez vos finances aujourd'hui.",
"betaPage.feedback.heading": "Un accès anticipé en échange de commentaires honnêtes",
"betaPage.feedback.body": "Comme utilisateur fondateur, vous aurez un accès anticipé à Nixus et pourrez influencer directement le produit.",
"betaPage.feedback.prompt": "Les commentaires les plus utiles décrivent les vrais irritants : ce qui vous a dérouté, ce qui semblait inadéquat et ce qui a presque interrompu votre utilisation.",
"betaPage.feedback.detail": "Je ne demande ni promotion ni éloges. Des courriels courts et directs suffisent, et je lis tout personnellement.",
"betaPage.feedback.cta": "Rejoindre le programme",
"betaPage.feedback.emailSubject": "Programme des utilisateurs fondateurs Nixus"
```

- [ ] **Step 6: Implement email-first conversion in `BetaPage` and `BetaGetStarted`**

In `BetaPage.tsx`, import `contactMailto`, compute one program href, remove the hero `DownloadCTA`, and render:

```tsx
const programMailto = contactMailto(t("betaPage.feedback.emailSubject"));
```

```tsx
<a
  href={programMailto}
  data-testid="beta-hero-cta"
  className="mkt-tap-cta inline-flex max-w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-primary/40"
>
  {t("betaPage.feedback.cta")}
</a>
```

Use the same `programMailto` for `beta-feedback-cta`. Pass it to `BetaGetStarted`:

```tsx
<BetaGetStarted faqHomeHref={faqHomeHref} programMailto={programMailto} />
```

Change `BetaGetStarted` props to:

```ts
type BetaGetStartedProps = {
  readonly faqHomeHref: string;
  readonly programMailto: string;
};
```

Remove its `DownloadCTA` import and replace the bottom affordance with a primary anchor using `programMailto` and `t("betaPage.feedback.cta")`. This keeps outreach—not an anonymous download—as the conversion path.

- [ ] **Step 7: Update the homepage invitation**

In `BetaSection.tsx`, import `contactMailto` and compute:

```ts
const mailtoHref = contactMailto(t("beta.invite.emailSubject"));
```

Keep its existing route link, IDs, structure, and design classes. The locale replacements supply the focused Founding Users message.

- [ ] **Step 8: Update every visible locale email value**

In both locale files, replace these four values with `nixus@gmail.com` while preserving key order:

```json
"faq.contactEmail": "nixus@gmail.com",
"faq.whoBuilt.linkEmail": "nixus@gmail.com",
"installInstructions.helpEmail": "nixus@gmail.com",
"footer.linkContact": "nixus@gmail.com"
```

- [ ] **Step 9: Run the focused page tests and confirm green**

Run the command from Step 3.

Expected: both files pass in English and French.

- [ ] **Step 10: Commit the program page and locale copy**

```bash
git add apps/web/src/components/BetaPage.tsx apps/web/src/components/BetaPage.test.tsx apps/web/src/components/BetaGetStarted.tsx apps/web/src/components/BetaSection.tsx apps/web/src/components/BetaSection.test.tsx apps/web/src/locales/en.json apps/web/src/locales/fr.json
git commit -m "feat(web): introduce the Founding Users program"
```

---

### Task 3: Navigation, metadata, and browser conversion contract

**Files:**
- Modify: `apps/web/src/components/SiteHeader.tsx:11-18,80-92`
- Modify: `apps/web/src/components/SiteHeader.test.tsx:18-25,61-65`
- Modify: `apps/web/tests/e2e/conversion.spec.ts:28-38`

**Interfaces:**
- Consumes: localized `header.beta`, `betaPage.meta.*`, and page CTA behavior from Task 2.
- Produces: unchanged `/beta` navigation with Founding labeling and a real-browser mailto contract.

- [ ] **Step 1: Write failing header expectations**

Update `SiteHeader.test.tsx`:

```tsx
it("renders the Founding nav link at the existing beta path", () => {
  renderWithProviders(<SiteHeader />);
  const link = screen.getByTestId("header-beta-link");
  expect(link).toHaveAttribute("href", "/beta");
  expect(link).toHaveTextContent("Founding");
});
```

Keep the existing mobile visibility test, renaming its description from “Beta destination” to “Founding destination.”

- [ ] **Step 2: Write the failing browser conversion assertion**

Replace the beta-destination test body in `conversion.spec.ts` with:

```ts
test("keeps the Founding destination reachable and email-driven", async ({ page }) => {
  await page.goto("/");
  const founding = page.getByTestId("header-beta-link");
  await expect(founding).toBeVisible();
  await expect(founding).toHaveText("Founding");
  await founding.click();
  await expect(page).toHaveURL(/\/beta$/);
  await expect(page.getByTestId("beta-page")).toBeVisible();
  await expect(page.getByTestId("header-beta-link")).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByTestId("beta-hero-cta")).toHaveAttribute(
    "href",
    "mailto:nixus@gmail.com?subject=Nixus%20Founding%20User%20Program",
  );
});
```

The test inspects the href and does not click the mailto link, avoiding environment-dependent mail-client launches.

- [ ] **Step 3: Run the focused tests and confirm red**

Run:

```bash
pnpm --filter @nixus/web test -- src/components/SiteHeader.test.tsx
pnpm --filter @nixus/web build
pnpm --filter @nixus/web test:e2e -- tests/e2e/conversion.spec.ts --project=phone-375
```

Expected: header unit test fails on `Beta`; after the production build, the browser test fails on the same old label or missing hero CTA until Tasks 2–3 are applied.

- [ ] **Step 4: Apply the navigation labels**

Set the locale values:

```json
// en.json
"header.beta": "Founding"

// fr.json
"header.beta": "Fondateurs"
```

Update the composition comment in `SiteHeader.tsx` from `[ Beta ]` to `[ Founding ]` and the related prose from “Beta destination” to “Founding destination.” Do not rename the route helper, test id, or active-state variable; they still accurately describe the retained `/beta` route and renaming them would add migration noise without behavior value.

- [ ] **Step 5: Run the focused unit and browser tests and confirm green**

Run the commands from Step 3.

Expected: both commands pass.

- [ ] **Step 6: Commit navigation and browser coverage**

```bash
git add apps/web/src/components/SiteHeader.tsx apps/web/src/components/SiteHeader.test.tsx apps/web/src/locales/en.json apps/web/src/locales/fr.json apps/web/tests/e2e/conversion.spec.ts
git commit -m "test(web): lock the Founding Users conversion path"
```

---

### Task 4: Full verification and rendered QA

**Files:**
- Verify only; modify a source/test file only if a gate reveals a defect caused by Tasks 1–3.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: build, test, prerender, accessibility, responsive, and browser evidence for the completed feature.

- [ ] **Step 1: Check TypeScript and lint**

Run:

```bash
pnpm --filter @nixus/web typecheck
pnpm --filter @nixus/web lint
```

Expected: both exit 0 with no warnings or errors.

- [ ] **Step 2: Run the complete web unit suite**

Run:

```bash
pnpm --filter @nixus/web test
```

Expected: all Vitest tests pass.

- [ ] **Step 3: Build and verify prerendered output**

Run:

```bash
pnpm --filter @nixus/web build
pnpm --filter @nixus/web verify:prerender
pnpm --filter @nixus/web verify:routes
```

Expected: build exits 0; verification confirms both `/beta` routes, locale markers, canonical URLs, alternates, sitemap, and JSON-LD.

- [ ] **Step 4: Run the complete Playwright suite once**

Run:

```bash
pnpm --filter @nixus/web test:e2e
```

Expected: all Playwright projects pass, including accessibility modes, conversion behavior, responsive layout, touch targets, and console capture.

- [ ] **Step 5: Run the mandatory browser visual QA**

Load `playwright` and `visual-qa`, serve the production build, and inspect `/beta` and `/fr/beta` at 375px, 768px, and 1280px in light and dark modes.

At every viewport verify:

- `Founding` / `Fondateurs` remains visible in sticky chrome without overlap.
- H1, spreadsheet qualification copy, and both program CTAs render without clipping.
- CTA hrefs use the correct localized subject and `nixus@gmail.com`.
- Fit cards, screenshots, limitations, program steps, feedback card, and FAQ retain coherent vertical rhythm.
- Focus states are visible, touch targets are at least 44px below 1024px, and no horizontal overflow appears.
- Browser console has no warnings, errors, page errors, or failed requests.

Expected: `/visual-qa` passes its responsive and design-system gates on fresh screenshots.

- [ ] **Step 6: Run the TypeScript no-excuse and file-size review**

Run the programming skill checker over changed TypeScript files and measure pure LOC. No changed source file may exceed 250 pure LOC; no `any`, assertion, non-null assertion, suppression, empty catch, or mutable export may be introduced.

- [ ] **Step 7: Record truthful completion evidence**

Report the exact commands run and their observed result. If any pre-existing failure remains, quote it and distinguish it from this change; do not claim the task passed that gate.

Do not create an extra verification commit unless Step 5 exposed and required a source/test correction. If it did, commit the correction with its regression test as one atomic change.
