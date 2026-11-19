# SAM build for the billing Lambda.
#
# BuildMethod is `makefile` rather than `esbuild` because SAM's esbuild builder
# copies package.json into a scratch directory and runs `npm install` there, and
# npm cannot resolve pnpm's `workspace:*` protocol used by @nixus/shared. Bundling
# here instead uses the real workspace resolution and installs nothing. This is
# the same reason apps/api-bedrock and apps/api-account build this way.
#
# The emitted package.json pins `"type": "commonjs"`. Without it, a `.js` CJS
# bundle is interpreted as ESM by any Node that resolves this package's own
# `"type": "module"` up the directory tree, and the handler then exports nothing.
#
# Nothing is marked `--external`: the `stripe` SDK and the AWS SDK clients are
# bundled into the one artifact, so the Lambda has no runtime resolution step and
# no dependency on what the managed runtime happens to ship.
#
# The AWS SDK client versions in package.json are PINNED rather than caret-ranged
# for a build reason, not a style one: `@aws-sdk/client-{kms,ssm,cloudwatch}` and
# `@aws-sdk/client-dynamodb` share `@aws-sdk/core`, and a caret range let the
# first three float to a minor whose `@aws-sdk/core` the fourth's did not satisfy
# - which esbuild reports as a missing export rather than as a version conflict.

ENTRY_POINT := src/functions/api.ts
ESBUILD := node_modules/.bin/esbuild

.PHONY: build-BillingFunction

build-BillingFunction:
	$(ESBUILD) $(ENTRY_POINT) \
		--bundle \
		--platform=node \
		--target=node24 \
		--format=cjs \
		--main-fields=module,main \
		--log-level=warning \
		--outfile=$(ARTIFACTS_DIR)/api.js
	printf '{"type":"commonjs"}' > $(ARTIFACTS_DIR)/package.json
	node -e "const m=require('$(ARTIFACTS_DIR)/api.js'); if (typeof m.handler !== 'function') { throw new Error('bundled artifact exports no handler'); }"
	node -e "const m=require('$(ARTIFACTS_DIR)/api.js'); if (typeof m.dispatch !== 'function') { throw new Error('bundled artifact exports no dispatcher'); }"
