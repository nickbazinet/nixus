# CloudFront edge configuration — Nixus marketing site

Versioned edge artifacts for the `nixusapp.com` distribution, plus the operator
runbook for the live changes this repository deliberately **cannot** make.

| File | Purpose |
| ---- | ------- |
| `spa-index-rewrite.js` | Viewer-request CloudFront Function. Maps extensionless routes onto the prerendered `index.html` object. Deployed verbatim. |
| `loadRewriteHandler.ts` | Test/verification seam. Evaluates the artifact above so tests and `verify:routes` exercise the exact deployed source. |
| `spa-index-rewrite.test.ts` | Unit contract for the function (`pnpm --filter @nixus/web test`). |

Offline proof that the function resolves every public route to a real object:

```bash
pnpm --filter @nixus/web build
pnpm --filter @nixus/web verify:routes
```

---

## Current live state (what is wrong)

The distribution has **no viewer-request function**. Instead, a custom error
response maps origin 403/404 to `/index.html` with **HTTP 200**. Consequences:

- Every unknown URL returns the homepage with a `200`, so crawlers index
  unlimited soft-404 duplicates of the homepage.
- Deep routes only work because the error handler swallows the miss, not because
  the edge resolves them.

## Target live state

1. `spa-index-rewrite.js` associated as a **viewer request** function, so real
   routes resolve to their own object.
2. Custom error responses returning the **real 404 object with status 404**, so
   unknown URLs stop answering `200`.
3. The retired `nixus.nicolasbazinet.net` distribution issuing a
   **path-preserving 301** to `https://nixusapp.com`, so accumulated link equity
   transfers instead of dying on a duplicate host.

**The order matters.** Removing the 200 fallback before the function is
associated takes every deep route offline. Redirecting the old host before the
new host serves correct HTML moves crawlers onto a broken site.

---

## Rollout

Prerequisites: `verify:routes` and `verify:prerender` green on the commit being
deployed; the S3 bucket already synced with that build.

### Step 1 — publish and associate the function

```bash
# Create (first time only). --function-code must point at the versioned artifact.
aws cloudfront create-function \
  --name nixus-spa-index-rewrite \
  --function-config 'Comment=Map extensionless routes to prerendered index.html,Runtime=cloudfront-js-2.0' \
  --function-code fileb://apps/web/infra/cloudfront/spa-index-rewrite.js

# Subsequent updates: update-function with the ETag from get-function, then:
aws cloudfront publish-function --name nixus-spa-index-rewrite --if-match <ETag>
```

Associate it on the default cache behaviour as `EventType=viewer-request`
(`FunctionARN` from `publish-function`), via `get-distribution-config` →
edit → `update-distribution --if-match <ETag>`.

**Verify before continuing.** With the 200 fallback still in place, a wrong
function silently looks fine, so check the object actually served:

```bash
for path in / /fr/ /beta /fr/beta /og-image.png /robots.txt; do
  curl -sS -o /dev/null -w "%{http_code} %{url_effective}\n" "https://nixusapp.com$path"
done
# Expect 200 on all six.

curl -sS https://nixusapp.com/fr/beta | grep -o '<html lang="[a-z]*"'   # expect lang="fr"
curl -sS https://nixusapp.com/beta    | grep -o '<html lang="[a-z]*"'   # expect lang="en"
```

If any deep route regresses, **remove the function association** — that alone
restores the previous behaviour.

### Step 2 — return true 404s

Only after Step 1 is verified. Replace the custom error responses that map
403/404 → `/index.html` with `200` by:

- `ErrorCode=404`, `ResponsePagePath=/404/index.html`, `ResponseCode=404`
- `ErrorCode=403`, `ResponsePagePath=/404/index.html`, `ResponseCode=404`

(403 is included because S3 returns it for missing keys when the bucket policy
hides existence.)

Verify:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://nixusapp.com/definitely-not-a-page  # expect 404
curl -sS -o /dev/null -w "%{http_code}\n" https://nixusapp.com/                        # expect 200
curl -sS -o /dev/null -w "%{http_code}\n" https://nixusapp.com/beta                    # expect 200
```

Then invalidate: `aws cloudfront create-invalidation --distribution-id <id> --paths "/*"`.

### Step 3 — retire the old hostname

Only after Steps 1–2 are verified on `nixusapp.com`.

Point `nixus.nicolasbazinet.net` at a redirect that **preserves the path** and
returns `301`: `https://nixus.nicolasbazinet.net/beta` →
`https://nixusapp.com/beta`. A blanket redirect to the root discards the equity
this step exists to transfer.

Do **not** change the `support@nixus.nicolasbazinet.net` mail records. The email
domain stays; only the website identity moves.

Verify:

```bash
curl -sSI https://nixus.nicolasbazinet.net/beta | grep -i '^location:'
# expect: location: https://nixusapp.com/beta
```

### Step 4 — Search Console

- Add and verify the `nixusapp.com` property.
- Submit `https://nixusapp.com/sitemap.xml`.
- Keep the old property until the redirect has been recrawled; use its Change of
  Address tool rather than deleting it.

---

## Rollback

| Symptom | Action |
| ------- | ------ |
| Deep routes 404 or serve the wrong object after Step 1 | Remove the viewer-request function association from the cache behaviour. No other change needed. |
| Legitimate pages return 404 after Step 2 | Restore the `403/404 → /index.html` custom error responses with `ResponseCode=200`, then invalidate `/*`. |
| Old-host traffic broken after Step 3 | Remove the redirect and serve the old distribution again; it is a separate distribution, so Steps 1–2 are unaffected. |

Every step is independently reversible, and none of them require a redeploy of
the site build.

---

## Not automated on purpose

The deploy workflow (`.github/workflows/web-ci.yml`) syncs S3 and invalidates
CloudFront. It does **not** create/publish functions, edit distribution config,
touch DNS, or mutate Search Console. Those are one-time, verify-in-between
changes where a scripted mistake takes the public site down; they stay manual
and gated on the checks above.
