# Makefile for ailock - Release Automation
# This Makefile provides automated release workflows for npm publishing and GitHub releases

# Shell configuration for safety
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help

# Variables
PACKAGE_NAME = $(shell node -p "require('./package.json').name")
PACKAGE_VERSION = $(shell node -p "require('./package.json').version")
GIT_BRANCH = $(shell git rev-parse --abbrev-ref HEAD)
GIT_REMOTE = origin
MAIN_BRANCH = main
BUILD_DIR = dist
NODE_BIN = ./node_modules/.bin

# Color codes for output
CYAN = \033[36m
GREEN = \033[32m
YELLOW = \033[33m
RED = \033[31m
RESET = \033[0m

# Helper function for colored output
define print_header
	@echo ""
	@echo "$(CYAN)==> $(1)$(RESET)"
	@echo ""
endef

# Default target - show help
.PHONY: help
help: ## Show this help message
	@echo "$(CYAN)ailock Release Automation$(RESET)"
	@echo ""
	@echo "$(GREEN)Available targets:$(RESET)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-20s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)Quick start:$(RESET)"
	@echo "  make release-patch    # Release a patch version (bug fixes)"
	@echo "  make release-minor    # Release a minor version (new features)"
	@echo "  make release-major    # Release a major version (breaking changes)"
	@echo ""
	@echo "$(YELLOW)Current version:$(RESET) $(PACKAGE_VERSION)"

# Development targets
.PHONY: install
install: ## Install dependencies
	$(call print_header,Installing dependencies)
	npm ci

.PHONY: dev
dev: ## Run in development mode
	$(call print_header,Running in development mode)
	npm run dev

.PHONY: build
build: ## Build the project
	$(call print_header,Building project)
	npm run build

.PHONY: test
test: ## Run tests
	$(call print_header,Running tests)
	npm run test:run

.PHONY: clean
clean: ## Clean build artifacts
	$(call print_header,Cleaning build artifacts)
	@rm -rf $(BUILD_DIR)
	@rm -f *.tgz
	@echo "$(GREEN)✓ Build artifacts cleaned$(RESET)"

# Version information
.PHONY: version
version: ## Show current version and npm info
	@echo "$(CYAN)Package Information:$(RESET)"
	@echo "  Name:    $(PACKAGE_NAME)"
	@echo "  Version: $(PACKAGE_VERSION)"
	@echo "  Branch:  $(GIT_BRANCH)"
	@echo ""
	@echo "$(CYAN)Latest npm version:$(RESET)"
	@npm view $(PACKAGE_NAME) version 2>/dev/null || echo "  Not published yet"
	@echo ""
	@echo "$(CYAN)Latest git tag:$(RESET)"
	@git describe --tags --abbrev=0 2>/dev/null || echo "  No tags yet"

# Comprehensive status
.PHONY: status
status: ## Show comprehensive release status
	@echo "$(CYAN)═══════════════════════════════════════════════════════════$(RESET)"
	@echo "$(CYAN)                    RELEASE STATUS REPORT$(RESET)"
	@echo "$(CYAN)═══════════════════════════════════════════════════════════$(RESET)"
	@echo ""
	@echo "$(GREEN)📦 Package Information$(RESET)"
	@echo "  Name:            $(PACKAGE_NAME)"
	@echo "  Current Version: $(PACKAGE_VERSION)"
	@echo "  Registry:        https://www.npmjs.com/package/$(PACKAGE_NAME)"
	@echo ""
	@echo "$(GREEN)🌐 NPM Registry$(RESET)"
	@NPM_VERSION=$$(npm view $(PACKAGE_NAME) version 2>/dev/null); \
	if [ -n "$$NPM_VERSION" ]; then \
		echo "  Published Version: $$NPM_VERSION"; \
		if [ "$$NPM_VERSION" = "$(PACKAGE_VERSION)" ]; then \
			echo "  Status: $(GREEN)✓ Up to date$(RESET)"; \
		else \
			echo "  Status: $(YELLOW)⚠ Local version differs from npm$(RESET)"; \
		fi; \
		echo "  Downloads: $$(npm view $(PACKAGE_NAME) downloads.lastMonth 2>/dev/null || echo 'N/A') (last month)"; \
	else \
		echo "  Status: $(YELLOW)Not published yet$(RESET)"; \
	fi
	@echo ""
	@echo "$(GREEN)🔧 Git Repository$(RESET)"
	@echo "  Current Branch: $(GIT_BRANCH)"
	@echo "  Remote: $$(git remote get-url origin 2>/dev/null || echo 'No remote')"
	@LATEST_TAG=$$(git describe --tags --abbrev=0 2>/dev/null); \
	if [ -n "$$LATEST_TAG" ]; then \
		echo "  Latest Tag: $$LATEST_TAG"; \
		TAG_VERSION=$${LATEST_TAG#v}; \
		if [ "$$TAG_VERSION" = "$(PACKAGE_VERSION)" ]; then \
			echo "  Tag Status: $(GREEN)✓ Matches package.json$(RESET)"; \
		else \
			echo "  Tag Status: $(YELLOW)⚠ Tag differs from package.json$(RESET)"; \
		fi; \
	else \
		echo "  Latest Tag: No tags yet"; \
	fi
	@echo "  Commits since tag: $$(git rev-list --count $$(git describe --tags --abbrev=0 2>/dev/null)..HEAD 2>/dev/null || echo '0')"
	@echo ""
	@echo "$(GREEN)🚀 GitHub Releases$(RESET)"
	@LATEST_RELEASE=$$(gh release view --json tagName,publishedAt,isDraft,isPrerelease 2>/dev/null); \
	if [ -n "$$LATEST_RELEASE" ]; then \
		echo "$$LATEST_RELEASE" | jq -r '"  Latest Release: \(.tagName)"'; \
		echo "$$LATEST_RELEASE" | jq -r '"  Published: \(.publishedAt | split("T")[0])"'; \
		RELEASE_STATUS=$$(echo "$$LATEST_RELEASE" | jq -r 'if .isDraft then "Draft" elif .isPrerelease then "Pre-release" else "Published" end'); \
		if [ "$$RELEASE_STATUS" = "Draft" ]; then \
			echo "  Status: $(YELLOW)$$RELEASE_STATUS$(RESET)"; \
		elif [ "$$RELEASE_STATUS" = "Pre-release" ]; then \
			echo "  Status: $(YELLOW)$$RELEASE_STATUS$(RESET)"; \
		else \
			echo "  Status: $(GREEN)$$RELEASE_STATUS$(RESET)"; \
		fi; \
	else \
		echo "  Latest Release: $(YELLOW)No releases yet$(RESET)"; \
	fi
	@echo "  View releases: https://github.com/daymade/ailock/releases"
	@echo ""
	@echo "$(GREEN)✅ Environment Checks$(RESET)"
	@echo -n "  Working Directory: "; \
	if [ -z "$$(git status --porcelain)" ]; then \
		echo "$(GREEN)Clean$(RESET)"; \
	else \
		echo "$(YELLOW)Has uncommitted changes$(RESET)"; \
		git status --short | head -3 | sed 's/^/    /'; \
		CHANGES=$$(git status --porcelain | wc -l | xargs); \
		if [ "$$CHANGES" -gt "3" ]; then \
			echo "    ... and $$(($$CHANGES - 3)) more files"; \
		fi; \
	fi
	@echo -n "  NPM Auth: "; \
	npm whoami >/dev/null 2>&1 && echo "$(GREEN)✓ Logged in as $$(npm whoami)$(RESET)" || echo "$(RED)✗ Not authenticated$(RESET)"
	@echo -n "  GitHub CLI: "; \
	gh auth status >/dev/null 2>&1 && echo "$(GREEN)✓ Authenticated$(RESET)" || echo "$(RED)✗ Not authenticated$(RESET)"
	@echo -n "  Remote Sync: "; \
	NO_PROXY=* git fetch $(GIT_REMOTE) $(MAIN_BRANCH) >/dev/null 2>&1; \
	if [ "$$(git rev-parse HEAD)" = "$$(git rev-parse $(GIT_REMOTE)/$(MAIN_BRANCH) 2>/dev/null)" ]; then \
		echo "$(GREEN)✓ Up to date with origin/main$(RESET)"; \
	else \
		BEHIND=$$(git rev-list --count HEAD..$(GIT_REMOTE)/$(MAIN_BRANCH) 2>/dev/null || echo "0"); \
		AHEAD=$$(git rev-list --count $(GIT_REMOTE)/$(MAIN_BRANCH)..HEAD 2>/dev/null || echo "0"); \
		if [ "$$BEHIND" -gt "0" ] && [ "$$AHEAD" -gt "0" ]; then \
			echo "$(YELLOW)⚠ Diverged ($$AHEAD ahead, $$BEHIND behind)$(RESET)"; \
		elif [ "$$BEHIND" -gt "0" ]; then \
			echo "$(YELLOW)⚠ Behind by $$BEHIND commits$(RESET)"; \
		elif [ "$$AHEAD" -gt "0" ]; then \
			echo "$(YELLOW)⚠ Ahead by $$AHEAD commits$(RESET)"; \
		else \
			echo "$(YELLOW)⚠ Cannot determine sync status$(RESET)"; \
		fi; \
	fi
	@echo ""
	@echo "$(GREEN)📈 Next Versions$(RESET)"
	@echo "  Patch: $(PACKAGE_VERSION) → $$(npx semver $(PACKAGE_VERSION) -i patch 2>/dev/null || echo 'N/A')"
	@echo "  Minor: $(PACKAGE_VERSION) → $$(npx semver $(PACKAGE_VERSION) -i minor 2>/dev/null || echo 'N/A')"
	@echo "  Major: $(PACKAGE_VERSION) → $$(npx semver $(PACKAGE_VERSION) -i major 2>/dev/null || echo 'N/A')"
	@echo ""
	@echo "$(CYAN)═══════════════════════════════════════════════════════════$(RESET)"
	@echo "$(YELLOW)Ready to release? Use:$(RESET) make release-patch | release-minor | release-major"
	@echo "$(CYAN)═══════════════════════════════════════════════════════════$(RESET)"

# Safety checks
.PHONY: check-clean
check-clean: ## Verify working directory is clean
	@if [ -n "$$(git status --porcelain)" ]; then \
		echo "$(RED)✗ Working directory is not clean$(RESET)"; \
		echo ""; \
		git status --short; \
		echo ""; \
		echo "$(YELLOW)Please commit or stash your changes before releasing$(RESET)"; \
		exit 1; \
	else \
		echo "$(GREEN)✓ Working directory is clean$(RESET)"; \
	fi

.PHONY: check-branch
check-branch: ## Verify on main branch
	@if [ "$(GIT_BRANCH)" != "$(MAIN_BRANCH)" ]; then \
		echo "$(RED)✗ Not on $(MAIN_BRANCH) branch (current: $(GIT_BRANCH))$(RESET)"; \
		echo "$(YELLOW)Please switch to $(MAIN_BRANCH) branch before releasing$(RESET)"; \
		exit 1; \
	else \
		echo "$(GREEN)✓ On $(MAIN_BRANCH) branch$(RESET)"; \
	fi

.PHONY: check-auth
check-auth: ## Verify npm authentication
	@npm whoami >/dev/null 2>&1 || (echo "$(RED)✗ Not logged in to npm$(RESET)" && echo "$(YELLOW)Run 'npm login' first$(RESET)" && exit 1)
	@echo "$(GREEN)✓ Authenticated to npm as $$(npm whoami)$(RESET)"

.PHONY: check-gh
check-gh: ## Verify GitHub CLI is installed and authenticated
	@which gh >/dev/null 2>&1 || (echo "$(RED)✗ GitHub CLI (gh) not installed$(RESET)" && echo "$(YELLOW)Install from: https://cli.github.com$(RESET)" && exit 1)
	@gh auth status >/dev/null 2>&1 || (echo "$(RED)✗ Not authenticated to GitHub$(RESET)" && echo "$(YELLOW)Run 'gh auth login' first$(RESET)" && exit 1)
	@echo "$(GREEN)✓ GitHub CLI authenticated$(RESET)"

.PHONY: check-remote
check-remote: ## Verify git remote is up to date
	$(call print_header,Checking remote status)
	@NO_PROXY=* git fetch $(GIT_REMOTE) $(MAIN_BRANCH)
	@if [ "$$(git rev-parse HEAD)" != "$$(git rev-parse $(GIT_REMOTE)/$(MAIN_BRANCH))" ]; then \
		echo "$(RED)✗ Local branch is not up to date with $(GIT_REMOTE)/$(MAIN_BRANCH)$(RESET)"; \
		echo "$(YELLOW)Run 'git pull' to update$(RESET)"; \
		exit 1; \
	else \
		echo "$(GREEN)✓ Local branch is up to date$(RESET)"; \
	fi

.PHONY: pre-release
pre-release: check-clean check-branch check-remote check-auth check-gh test build ## Run all pre-release checks
	$(call print_header,Pre-release checks completed successfully)

# Release targets
.PHONY: bump-patch
bump-patch: pre-release ## Bump patch version (internal use)
	$(call print_header,Bumping patch version)
	npm version patch -m "chore: release v%s"
	@echo "$(GREEN)✓ Version bumped to $$(node -p "require('./package.json').version")$(RESET)"

.PHONY: bump-minor
bump-minor: pre-release ## Bump minor version (internal use)
	$(call print_header,Bumping minor version)
	npm version minor -m "chore: release v%s"
	@echo "$(GREEN)✓ Version bumped to $$(node -p "require('./package.json').version")$(RESET)"

.PHONY: bump-major
bump-major: pre-release ## Bump major version (internal use)
	$(call print_header,Bumping major version)
	npm version major -m "chore: release v%s"
	@echo "$(GREEN)✓ Version bumped to $$(node -p "require('./package.json').version")$(RESET)"

.PHONY: push-tags
push-tags: ## Push commits and tags to remote
	$(call print_header,Pushing to remote)
	git push $(GIT_REMOTE) $(MAIN_BRANCH) --follow-tags
	@echo "$(GREEN)✓ Pushed commits and tags to $(GIT_REMOTE)$(RESET)"

.PHONY: publish-npm
publish-npm: ## Publish package to npm
	$(call print_header,Publishing to npm)
	npm publish --access public
	@echo "$(GREEN)✓ Published $(PACKAGE_NAME)@$$(node -p "require('./package.json').version") to npm$(RESET)"

.PHONY: create-github-release
create-github-release: ## Create GitHub release from latest tag
	$(call print_header,Creating GitHub release)
	@TAG="v$$(node -p "require('./package.json').version")"; \
	echo "Creating release for tag $$TAG..."; \
	gh release create $$TAG \
		--title "$$TAG" \
		--generate-notes \
		--verify-tag || echo "$(YELLOW)⚠ Release might already exist$(RESET)"
	@echo "$(GREEN)✓ GitHub release created$(RESET)"
	@echo "$(CYAN)View at: https://github.com/daymade/ailock/releases/tag/v$$(node -p "require('./package.json').version")$(RESET)"

# Main release workflows
.PHONY: release-patch
release-patch: ## Release a patch version (bug fixes)
	$(call print_header,Releasing patch version)
	@echo "$(YELLOW)This will:$(RESET)"
	@echo "  1. Run tests and build"
	@echo "  2. Bump patch version"
	@echo "  3. Push to git"
	@echo "  4. Publish to npm"
	@echo "  5. Create GitHub release"
	@echo ""
	@read -p "Continue? [y/N] " -r; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		$(MAKE) bump-patch && \
		$(MAKE) push-tags && \
		$(MAKE) publish-npm && \
		$(MAKE) create-github-release && \
		echo "" && \
		echo "$(GREEN)🎉 Patch release completed successfully!$(RESET)" && \
		echo "$(YELLOW)Don't forget to update CHANGELOG.md$(RESET)"; \
	else \
		echo "$(YELLOW)Release cancelled$(RESET)"; \
	fi

.PHONY: release-minor
release-minor: ## Release a minor version (new features)
	$(call print_header,Releasing minor version)
	@echo "$(YELLOW)This will:$(RESET)"
	@echo "  1. Run tests and build"
	@echo "  2. Bump minor version"
	@echo "  3. Push to git"
	@echo "  4. Publish to npm"
	@echo "  5. Create GitHub release"
	@echo ""
	@read -p "Continue? [y/N] " -r; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		$(MAKE) bump-minor && \
		$(MAKE) push-tags && \
		$(MAKE) publish-npm && \
		$(MAKE) create-github-release && \
		echo "" && \
		echo "$(GREEN)🎉 Minor release completed successfully!$(RESET)" && \
		echo "$(YELLOW)Don't forget to update CHANGELOG.md$(RESET)"; \
	else \
		echo "$(YELLOW)Release cancelled$(RESET)"; \
	fi

.PHONY: release-major
release-major: ## Release a major version (breaking changes)
	$(call print_header,Releasing major version)
	@echo "$(RED)⚠ WARNING: Major version bump indicates breaking changes$(RESET)"
	@echo ""
	@echo "$(YELLOW)This will:$(RESET)"
	@echo "  1. Run tests and build"
	@echo "  2. Bump major version"
	@echo "  3. Push to git"
	@echo "  4. Publish to npm"
	@echo "  5. Create GitHub release"
	@echo ""
	@read -p "Are you sure? Type 'major' to confirm: " -r; \
	if [[ $$REPLY == "major" ]]; then \
		$(MAKE) bump-major && \
		$(MAKE) push-tags && \
		$(MAKE) publish-npm && \
		$(MAKE) create-github-release && \
		echo "" && \
		echo "$(GREEN)🎉 Major release completed successfully!$(RESET)" && \
		echo "$(YELLOW)Don't forget to update CHANGELOG.md with breaking changes$(RESET)"; \
	else \
		echo "$(YELLOW)Release cancelled$(RESET)"; \
	fi

# Utility targets
.PHONY: dry-run
dry-run: ## Show what would be released (dry run)
	$(call print_header,Dry run - no changes will be made)
	@$(MAKE) pre-release
	@echo ""
	@echo "$(CYAN)Would release:$(RESET)"
	@echo "  Current version: $(PACKAGE_VERSION)"
	@echo "  Next patch:      $$(npx semver $(PACKAGE_VERSION) -i patch)"
	@echo "  Next minor:      $$(npx semver $(PACKAGE_VERSION) -i minor)"
	@echo "  Next major:      $$(npx semver $(PACKAGE_VERSION) -i major)"
	@echo ""
	@echo "$(GREEN)✓ Dry run completed - no changes made$(RESET)"

.PHONY: rollback
rollback: ## Rollback last version bump (if not pushed)
	$(call print_header,Rolling back last version bump)
	@if git diff HEAD~1 --name-only | grep -q "package.json"; then \
		git reset --hard HEAD~1 && \
		echo "$(GREEN)✓ Rolled back to previous version$(RESET)"; \
	else \
		echo "$(YELLOW)No recent version bump found$(RESET)"; \
	fi

.PHONY: changelog
changelog: ## Open CHANGELOG.md for editing
	$(call print_header,Opening CHANGELOG.md)
	@$${EDITOR:-nano} CHANGELOG.md

# CI/CD helpers
.PHONY: ci-test
ci-test: install test build ## Run CI tests
	$(call print_header,CI tests completed)

.PHONY: ci-release
ci-release: ## Automated release for CI (requires env vars)
	@if [ -z "$${CI}" ]; then \
		echo "$(RED)✗ This target is only for CI environments$(RESET)"; \
		exit 1; \
	fi
	@$(MAKE) pre-release
	@$(MAKE) publish-npm
	@$(MAKE) create-github-release