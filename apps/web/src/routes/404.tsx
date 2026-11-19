import { createFileRoute } from "@tanstack/react-router";

import { ButtonLink } from "@/components/ui";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/404")({
  head: () =>
    buildMeta({
      path: "/404",
      title: "Page not found — Nixus",
      description: "This page does not exist.",
      noindex: true,
    }),
  component: NotFoundPage,
});

function NotFoundPage() {
  return (
    <section className="nx-container nx-section flex min-h-[60vh] flex-col items-center justify-center text-center">
      <p className="nx-gradient-text font-display text-7xl font-semibold">404</p>
      <h1 className="mt-4 text-display-s font-semibold">This page went missing</h1>
      <p className="mt-3 text-ink-soft">It may have moved when the site was redesigned.</p>
      <ButtonLink to="/" className="mt-8">
        Back to home
      </ButtonLink>
    </section>
  );
}
