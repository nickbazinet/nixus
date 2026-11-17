import type { AuthFailureCode } from "./auth-flow.ts";

/**
 * The non-recoverable sign-in error page (AD-10).
 *
 * Served inline rather than through a redirect: a redirect would have to carry the
 * failure in the URL, and the whole point of the callback's refusals is that
 * nothing from the request is echoed back to the browser.
 *
 * Hand-built HTML, not a React route, because it has to render when the
 * authentication the app is built around has just failed — and it is served with
 * the failing status, which a route component cannot set.
 */

const COPY = {
  en: {
    lang: "en",
    title: "Sign-in could not be completed",
    body: "For your security, this sign-in attempt was refused. Start again from the Nixus account page.",
    retry: "Back to sign in",
    home: "/",
  },
  fr: {
    lang: "fr",
    title: "La connexion n'a pas pu être complétée",
    body: "Par mesure de sécurité, cette tentative de connexion a été refusée. Recommencez depuis la page de compte Nixus.",
    retry: "Retour à la connexion",
    home: "/fr/",
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

export function authFailurePage(input: {
  code: AuthFailureCode;
  status: number;
  language: "en" | "fr";
  setCookie: readonly string[];
}): Response {
  const copy = COPY[input.language];
  const html = `<!DOCTYPE html>
<html lang="${copy.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(copy.title)}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.6 system-ui,sans-serif;padding:2rem}
main{max-width:34rem;text-align:center}
h1{font-size:1.5rem;margin:0 0 .75rem}
a{display:inline-block;margin-top:1.5rem;font-weight:600}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(copy.title)}</h1>
<p>${escapeHtml(copy.body)}</p>
<a href="${copy.home}">${escapeHtml(copy.retry)}</a>
<!-- code: ${escapeHtml(input.code)} -->
</main>
</body>
</html>
`;

  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  for (const cookie of input.setCookie) headers.append("set-cookie", cookie);

  return new Response(html, { status: input.status, headers });
}
