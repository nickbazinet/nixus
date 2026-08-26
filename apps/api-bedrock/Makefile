# SAM build for the hosted-AI Lambda.
#
# BuildMethod is `makefile` rather than `esbuild` because SAM's esbuild builder
# copies package.json into a scratch directory and runs `npm install` there, and
# npm cannot resolve pnpm's `workspace:*` protocol used by @nixus/shared. Bundling
# here instead uses the real workspace resolution and installs nothing.
#
# The emitted package.json pins `"type": "commonjs"`. Without it, a `.js` CJS
# bundle is interpreted as ESM by any Node that resolves this package's own
# `"type": "module"` up the directory tree, and the handler then exports nothing.

ENTRY_POINT := src/functions/api.ts
ESBUILD := node_modules/.bin/esbuild

.PHONY: build-HostedAiFunction

build-HostedAiFunction:
	$(ESBUILD) $(ENTRY_POINT) \
		--bundle \
		--platform=node \
		--target=node22 \
		--format=cjs \
		--main-fields=module,main \
		--log-level=warning \
		--outfile=$(ARTIFACTS_DIR)/api.js
	printf '{"type":"commonjs"}' > $(ARTIFACTS_DIR)/package.json
	node -e "const m=require('$(ARTIFACTS_DIR)/api.js'); if (typeof m.handler !== 'function') { throw new Error('bundled artifact exports no handler'); }"
