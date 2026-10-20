# Release workflow for Flowly (the Paseo plugin). Run `make help`.
#
#   make release VERSION=1.1.0     check an already merged version, tag, push; GitHub Actions publishes
#   make release VERSION=1.1.0 DRY_RUN=1    print every outward step instead of running it
#
# Every local outward step asks first; pass YES=1 to skip the questions.
# Normal publication uses release.yml with npm OIDC. publish/github-release are recovery targets.
# npm credentials: put NPM_TOKEN (a granular token that bypasses 2FA) in .env, which is git-ignored
# (copy .env.example), or export it, or rely on `npm login`. NPM_OTP=123456 supplies a one-time code.
# The token is only written to a temporary file while npm runs, never printed.

SHELL := /bin/bash

# Local secrets (git-ignored): NPM_TOKEN and optionally NPM_OTP.
-include .env
export NPM_TOKEN NPM_OTP
.DEFAULT_GOAL := help

PKG    := $(shell node -p "require('./package.json').name")
CUR    := $(shell node -p "require('./package.json').version")
BRANCH := main
# With DRY_RUN=1 outward commands are printed, not run.
RUN    := $(if $(DRY_RUN),echo [dry-run],)
Q      := $(if $(DRY_RUN),@,)
# The version being released; a dry run shows the requested VERSION even though nothing is bumped.
REL    := $(if $(DRY_RUN),$(or $(VERSION),$(CUR)),$(CUR))

# $(call confirm,question)
define confirm
@if [ -z "$(YES)" ] && [ -z "$(DRY_RUN)" ]; then read -r -p "$(1) [y/N] " a; [ "$$a" = y ] || { echo "aborted"; exit 1; }; fi
endef

.PHONY: help npm-whoami check pack verify-clean bump tag push publish wait-npm github-release release registry install-local reload

help: ## Show this help
	@echo "Flowly release workflow (package $(PKG)@$(CUR))"; echo
	@grep -E '^[a-z-]+:.*## ' $(firstword $(MAKEFILE_LIST)) | awk 'BEGIN {FS = ":.*## "} {printf "  make %-15s %s\n", $$1, $$2}'

check: ## Typecheck and run the tests
	npm run typecheck
	npm test

pack: ## Validate and smoke-install the release tarball (nothing is published)
	npm run ci:package

verify-clean: ## Fail unless on main, with a clean tree, in sync with origin
	@test "$$(git branch --show-current)" = "$(BRANCH)" || { echo "not on $(BRANCH)"; exit 1; }
	@test -z "$$(git status --porcelain)" || { echo "working tree is not clean:"; git status --short; exit 1; }
	@git fetch -q origin
	@test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/$(BRANCH))" || { echo "HEAD differs from origin/$(BRANCH): push or pull first"; exit 1; }

bump: ## Set the version in package.json and the lockfile (VERSION=x.y.z)
	@test -n "$(VERSION)" || { echo "usage: make bump VERSION=x.y.z"; exit 1; }
	@echo "$(VERSION)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$$' || { echo "VERSION must look like 1.2.3"; exit 1; }
	@if git rev-parse -q --verify "refs/tags/v$(VERSION)" >/dev/null; then echo "tag v$(VERSION) already exists"; exit 1; fi
	npm version "$(VERSION)" --no-git-tag-version --ignore-scripts

tag: ## Annotate the already committed current version (merge the bump PR first)
	git tag -a "v$(CUR)" -m "Flowly v$(CUR): the agent-native workflow for Paseo"

push: ## Push the tag for the current version to origin
	$(call confirm,Push v$(REL) to origin?)
	$(Q)$(RUN) git push origin "v$(REL)"

publish: pack ## Recovery only: publish the validated tarball locally, then wait until live
	$(call confirm,Publish $(PKG)@$(REL) to npm?)
	@set -e; t=$$(mktemp); trap 'rm -f "$$t"' EXIT; \
	if [ -n "$$NPM_TOKEN" ]; then printf '//registry.npmjs.org/:_authToken=%s\n' "$$NPM_TOKEN" > "$$t"; export NPM_CONFIG_USERCONFIG="$$t"; fi; \
	$(RUN) npm publish "dist/npm/$(PKG)-$(CUR).tgz" --ignore-scripts $${NPM_OTP:+--otp=$$NPM_OTP}
	@if [ -z "$(DRY_RUN)" ]; then $(MAKE) --no-print-directory wait-npm; fi

npm-whoami: ## Show which npm account the token in .env (or your npm login) belongs to
	@set -e; t=$$(mktemp); trap 'rm -f "$$t"' EXIT; \
	if [ -n "$$NPM_TOKEN" ]; then printf '//registry.npmjs.org/:_authToken=%s\n' "$$NPM_TOKEN" > "$$t"; export NPM_CONFIG_USERCONFIG="$$t"; fi; \
	npm whoami

wait-npm: ## Wait until npm shows the current version (new versions can take a few minutes)
	@for i in $$(seq 1 30); do \
	  v=$$(npm view "$(PKG)@$(CUR)" version 2>/dev/null || true); \
	  if [ "$$v" = "$(CUR)" ]; then echo "$(PKG)@$(CUR) is live on npm"; exit 0; fi; \
	  echo "waiting for npm ($$i/30)..."; sleep 10; \
	done; echo "not visible on npm yet: check https://www.npmjs.com/package/$(PKG)"; exit 1

github-release: ## Create the GitHub release for the current tag (generated notes)
	$(call confirm,Create GitHub release v$(REL)?)
	$(Q)$(RUN) gh release create "v$(REL)" --verify-tag --title "Flowly v$(REL)" --generate-notes

release: ## Validate the merged version and push its tag; GitHub Actions publishes (DRY_RUN=1 previews)
	@test -n "$(VERSION)" || { echo "usage: make release VERSION=x.y.z"; exit 1; }
	@$(MAKE) --no-print-directory verify-clean
	@$(MAKE) --no-print-directory check
	@if [ -z "$(DRY_RUN)" ] && [ "$(VERSION)" != "$(CUR)" ]; then echo "Merge a version-bump PR first: make bump VERSION=$(VERSION)"; exit 1; fi
	@$(RUN) make tag
	@$(MAKE) --no-print-directory push
	@echo "GitHub Actions owns npm and GitHub publication: https://github.com/JasprW/flowly/actions/workflows/release.yml"
	@$(MAKE) --no-print-directory registry

registry: ## Print how to update the Paseo registry listing (Git updates there are manual)
	@echo
	@echo "The Paseo plugin registry pins a commit and does not follow new releases by itself."
	@echo "To list this one, open a new submission: https://github.com/getpaseo/plugins/issues/new/choose"
	@echo "  Source: https://github.com/JasprW/flowly   Commit: $$(git rev-parse HEAD)"

install-local: ## Install this checkout as the local plugin (development)
	paseo plugin install "$$PWD" --id flowly

reload: ## Reload the local plugin after changes (typechecks first)
	npm run typecheck
	paseo plugin reload flowly
