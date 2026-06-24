PACKAGE_NAME := omni-pilot
VERSION := $(shell node -p "require('./package.json').version")
ZIP_FILE := $(PACKAGE_NAME)-$(VERSION).zip
EXTENSION_FILES := manifest.json background.js content.js i18n.js popup.html popup.js options.html options.js styles.css icons

.PHONY: package clean-package

package: $(ZIP_FILE)

$(ZIP_FILE): $(EXTENSION_FILES)
	git archive --format=zip --output=$@ HEAD $(EXTENSION_FILES)

clean-package:
	git clean -fX -- $(PACKAGE_NAME)-*.zip
