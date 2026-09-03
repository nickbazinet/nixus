# Founding Users Page Design

## Goal

Turn the existing beta-recruitment experience into a clear Founding Users Program that invites financially engaged spreadsheet users to contact Nixus for early access and candid product feedback.

## Scope

- Keep the existing `/beta` and `/fr/beta` routes so published links remain valid.
- Reframe the beta page and homepage recruitment section around Founding Users.
- Update every user-visible contact email in the web application to `nixus@gmail.com`.
- Preserve English and French coverage.
- Do not change mail DNS, deployment infrastructure, the desktop application, or repository-only documentation.

## Information Architecture

The existing `/beta` page becomes the Founding Users destination rather than adding a competing recruitment route. The header destination uses the concise label “Founding” so it remains viable in the constrained mobile header described by the Nixus design spine.

The page follows this decision path:

1. **Hook — Help shape Nixus.** Explain that Nixus is recruiting a small group of early users who actively manage their finances.
2. **Qualify — Who the program is for.** Call out people using Excel or Google Sheets for expenses and budgets, net worth, investments, savings, or financial goals.
3. **Exchange — What each side gives.** Founding Users receive early access and direct product influence; Nixus asks for honest feedback rather than praise or promotion.
4. **Prove — What exists today.** Retain selected product screenshots and concise practical limitations from the current beta page.
5. **Convert — Join the program.** A primary email link opens `mailto:nixus@gmail.com` with the subject `Nixus Founding User Program`.
6. **Resolve — Supporting details.** Keep only setup guidance and FAQ content that helps a prospective Founding User decide whether to contact Nixus.

The homepage “Help shape Nixus” section becomes a shorter version of the same proposition and links directly to the same email CTA and full `/beta` page.

## Content Direction

The approved core message is:

> Help shape Nixus
>
> Nixus is looking for a small group of early users who actively manage their personal finances and want to help shape the product.
>
> We’re particularly interested in people who currently use Excel or Google Sheets to manage expenses and budgets, net worth, investments, savings, or financial goals.
>
> As a Founding User, you’ll get early access to Nixus and the opportunity to directly influence the product.
>
> In return, we’re looking for honest feedback—not just praise.

The primary CTA is **Join the Founding Users Program**. Supporting language should remain personal and direct, consistent with a founder-led pre-alpha product rather than a broad marketing campaign.

French copy must communicate the same meaning naturally rather than translating mechanically. “Founding User” terminology may remain recognizably tied to the named program while the surrounding copy is idiomatic French.

## Visual and Interaction Design

Follow the existing Nixus “Quiet Ledger” design spine at `_bmad-output/planning-artifacts/ux-designs/ux-nixus-2026-08-01/DESIGN.md`.

- Use the established warm-paper background, card tonal separation, hairline borders, crisp radii, and brand action color.
- Do not introduce new visual tokens, shadows, decorative gradients, or a separate landing-page aesthetic.
- Keep one primary action per section.
- Use the existing responsive marketing type, gutter, and section-spacing tokens.
- Maintain 44 × 44 CSS-pixel touch targets below 1024px.
- Preserve visible focus treatment, semantic landmarks and headings, dark mode, reduced-motion behavior, and forced-color compatibility.
- The CTA must be a real anchor with a `mailto:` URL so it works without client-side JavaScript.

## Components and Data Flow

The existing beta route and component structure remains authoritative. The implementation should modify the current page instead of creating a parallel Founding Users route tree.

User-visible strings remain in `apps/web/src/locales/en.json` and `apps/web/src/locales/fr.json`. The route continues to set locale and prerender metadata through the existing TanStack Start pattern.

The web contact address becomes a single exported constant with the value `nixus@gmail.com`. Components, structured data, and content definitions must consume that constant rather than maintaining independent literals. Locale values that visibly print the address must also be updated in both languages.

Email activation is delegated to the visitor’s mail client. There is no form submission, API call, database write, success state, or application error state.

## SEO and Navigation

- Preserve `/beta` and `/fr/beta` canonical paths and locale alternates.
- Update page title and description metadata to describe the Founding Users Program.
- Update the header destination label and active-state behavior without changing route semantics.
- Update organization structured data to use `nixus@gmail.com`.
- Ensure the prerendered sitemap continues to include both beta paths.

## Testing and Verification

Unit coverage must verify:

- Founding Users headline and qualification content render in English and French.
- The primary CTA targets `nixus@gmail.com` with the program subject.
- The homepage recruitment section uses the same program positioning.
- Header and footer navigation/contact behavior remains correct.
- FAQ, download help, legal contact, and structured data use the new address.

Existing Playwright route coverage continues to exercise `/beta` and `/fr/beta` for accessibility modes, touch targets, and conversion behavior.

Completion requires one pass of each applicable gate:

- Web typecheck
- Web unit tests
- Web Playwright tests
- Production web build and prerender verification
- Browser QA at 375px, 768px, and 1280px in light and dark modes
- CTA activation inspection and browser-console check

## Out of Scope

- A new `/founding-users` route
- An application form or CRM integration
- Pricing or a founding-member discount
- Changes to desktop contact surfaces
- Mailbox provisioning, DNS, or CloudFront infrastructure
- Updating repository-only contact references in `README.md`, `CONTRIBUTING.md`, or infrastructure documentation
