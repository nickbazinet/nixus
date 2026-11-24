import { copyFor, fill } from "@/content/index";
import { cn } from "@/lib/cn";
import { LANG_TAG, LOCALES, type Locale } from "@/lib/locale";
import { switchLocalePath } from "@/lib/routes";

/**
 * EN ⇄ FR, as a two-option segmented control.
 *
 * Plain `<a href>` rather than a router `<Link>`, and deliberately so: the two
 * languages are two prerendered documents, and only a full navigation makes the
 * browser fetch the other one. A client-side route change would re-render this
 * bundle under the new URL — same result on screen, but it bypasses the
 * document the crawler and the first paint actually depend on.
 *
 * There is no automatic redirect by `Accept-Language` anywhere on the site:
 * every URL must answer with the language it advertises, or the `hreflang`
 * cluster and the prerendered HTML both become lies.
 */
export function LanguageSwitcher({
  locale,
  pathname,
  className,
}: {
  locale: Locale;
  pathname: string;
  className?: string;
}) {
  const copy = copyFor(locale).shell.language;

  return (
    <nav
      aria-label={copy.label}
      className={cn(
        "flex items-center gap-0.5 rounded-full border border-line bg-white p-0.5",
        className,
      )}
    >
      {LOCALES.map((option) => {
        const active = option === locale;
        return (
          <a
            key={option}
            href={switchLocalePath(pathname, option)}
            hrefLang={LANG_TAG[option]}
            aria-current={active ? "true" : undefined}
            aria-label={
              active ? copy.name[option] : fill(copy.switchTo, { language: copy.name[option] })
            }
            className={cn(
              "nx-focus grid min-h-9 min-w-10 place-items-center rounded-full px-2 text-xs font-bold tracking-wide transition-colors",
              active
                ? "bg-brand-soft text-brand"
                : "text-ink-soft hover:bg-tint hover:text-ink",
            )}
          >
            {copy.short[option]}
          </a>
        );
      })}
    </nav>
  );
}
