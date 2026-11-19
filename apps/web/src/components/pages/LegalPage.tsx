import { Link } from "@tanstack/react-router";

import { CONTACT_EMAIL, contactMailto } from "@/content/contact";
import { LEGAL_LAST_UPDATED, type LegalDocument } from "@/content/legal";

/** Terms and Privacy Policy share one renderer so neither drifts in layout (AD-13). */
export function LegalPage({ doc }: { doc: LegalDocument }) {
  return (
    <article className="nx-container nx-section max-w-[48rem]">
      <h1 className="text-display-m font-semibold">{doc.heading}</h1>
      <p className="mt-3 text-sm text-ink-muted">{LEGAL_LAST_UPDATED}</p>
      <p className="mt-8 text-lead text-ink-soft">{doc.intro}</p>

      {doc.sections.map((section) => (
        <section key={section.heading} className="mt-10">
          <h2 className="text-xl font-semibold">{section.heading}</h2>
          {section.paragraphs.map((paragraph, index) => (
            <p key={index} className="mt-4 leading-relaxed text-ink-soft">
              {paragraph}
            </p>
          ))}
        </section>
      ))}

      <section className="mt-10">
        <h2 className="text-xl font-semibold">{doc.contactHeading}</h2>
        <p className="mt-4 break-words leading-relaxed text-ink-soft">
          {doc.contactBody}{" "}
          <a href={contactMailto()} className="nx-focus rounded-sm font-bold text-brand underline underline-offset-4">
            {CONTACT_EMAIL}
          </a>
        </p>
      </section>

      <p className="mt-12">
        <Link to="/" className="nx-focus rounded-sm text-sm font-bold text-brand underline underline-offset-4">
          Back to home
        </Link>
      </p>
    </article>
  );
}
