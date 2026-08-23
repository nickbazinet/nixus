/**
 * CloudFront Functions viewer-request handler: map extensionless marketing
 * routes onto the prerendered `index.html` object they were built into.
 *
 * Deployed as-is to a CloudFront Function (JavaScript runtime 2.0). The runtime
 * invokes a `handler` declared in global scope, so this file deliberately has
 * no `import`/`export` — `loadRewriteHandler.ts` is the seam tests and the
 * route verifier use to exercise this exact source.
 *
 * An unknown extensionless route is rewritten to an object that does not exist,
 * so CloudFront answers with a real 404 instead of the homepage.
 */

function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
    return request;
  }

  // Only the last segment decides asset-ness: a version-like directory such as
  // `/v1.2/beta` is a route, not a file.
  var lastSegment = uri.slice(uri.lastIndexOf("/") + 1);
  var hasFileExtension = lastSegment.indexOf(".") !== -1;
  if (hasFileExtension) {
    return request;
  }

  request.uri = uri + "/index.html";
  return request;
}
