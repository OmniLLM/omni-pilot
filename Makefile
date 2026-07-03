PACKAGE_NAME := omni-pilot
VERSION := $(shell node -p "require('./package.json').version")
ZIP_FILE := $(PACKAGE_NAME)-$(VERSION).zip

# Files that must exist before we can package.
BUILD_OUTPUTS := \
	dist/background.js \
	dist/content.js \
	dist/options.html dist/options.js \
	dist/popup.html dist/popup.js \
	dist/sidepanel.html dist/sidepanel.js \
	dist/styles.css

.PHONY: build package clean-package clean

# `make package` produces omni-pilot-<version>.zip ready for Chrome Web Store
# upload or `Load unpacked`. Runs a clean build first so dist/ is fresh.
package: $(ZIP_FILE)

$(ZIP_FILE): build pack.mjs manifest.json $(wildcard icons/*)
	node pack.mjs $@

build:
	npm run build

clean-package:
	rm -f $(PACKAGE_NAME)-*.zip

clean: clean-package
	rm -rf dist
