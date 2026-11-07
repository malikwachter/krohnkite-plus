PROJECT_NAME = krohnkite
PROJECT_VER  = $(shell git describe --tags --abbrev=0)
PROJECT_REV  = $(shell git rev-parse HEAD | cut -b-7)

KWINPKG_FILE = $(PROJECT_NAME)-$(PROJECT_VER).kwinscript
EFFECT_FILE  = $(PROJECT_NAME)-smooth-$(PROJECT_VER).zip
EFFECT_DIR   = pkg-effect
KWINPKG_DIR  = pkg

KWIN_META    = $(KWINPKG_DIR)/metadata.json
KWIN_QML     = $(KWINPKG_DIR)/contents/ui/main.qml
NODE_SCRIPT  = $(PROJECT_NAME).js
NODE_FILES   = $(NODE_SCRIPT) package-lock.json

SRC = $(shell find src -name "*.ts")

all: $(KWINPKG_DIR)

clean:
	@rm -rvf $(KWINPKG_DIR) $(EFFECT_DIR)
	@rm -vf $(NODE_FILES)

install: package
	kpackagetool6 -t KWin/Script -s $(PROJECT_NAME) \
		&& kpackagetool6 -t KWin/Script -u $(KWINPKG_FILE) \
		|| kpackagetool6 -t KWin/Script -i $(KWINPKG_FILE)
	python3 tools/install-icons.py

# Reinstall and load a complete fresh-path bundle; no KWin restart/logout needed.
reload: install
	python3 tools/reload-script.py "$(KWINPKG_DIR)"

uninstall:
	kpackagetool6 -t kwinscript -r $(PROJECT_NAME)
	python3 tools/install-icons.py --uninstall

package: $(KWINPKG_FILE) $(EFFECT_FILE) package_json

# companion desktop effect "Krohnkite Smooth" (animations)
effect: $(EFFECT_FILE)

$(EFFECT_FILE): effect/metadata.json effect/contents/code/main.js effect/contents/config/main.xml
	@rm -rf "$(EFFECT_DIR)" "$(EFFECT_FILE)"
	@mkdir -p "$(EFFECT_DIR)"
	@cp -r effect/contents "$(EFFECT_DIR)/"
	@sed "s/\$$VER/$(PROJECT_VER)/" effect/metadata.json > "$(EFFECT_DIR)/metadata.json"
	@cd "$(EFFECT_DIR)" && zip -qr "../$(EFFECT_FILE)" .

test:
	npm run check

# run/stop load pkg under the krohnkite-test plugin name through a local
# bin/load-script.sh, which is not tracked; reload installs and reloads the real
# krohnkite plugin instead.
run: $(KWINPKG_DIR)
	bin/load-script.sh "$(KWIN_QML)" "$(PROJECT_NAME)-test"
	@find "$(KWINPKG_DIR)" '(' -name "*.qmlc" -o -name "*.jsc" ')' -delete

stop:
	bin/load-script.sh "unload" "$(PROJECT_NAME)-test"

$(KWINPKG_FILE): $(KWINPKG_DIR)
	@rm -f "$(KWINPKG_FILE)"
	@if command -v 7z >/dev/null; then 7z a -tzip $(KWINPKG_FILE) ./$(KWINPKG_DIR)/*; else cd $(KWINPKG_DIR) && zip -qr ../$(KWINPKG_FILE) .; fi

$(KWINPKG_DIR): remove_meta
$(KWINPKG_DIR): $(KWIN_META)
$(KWINPKG_DIR): $(KWIN_QML)
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/ui/config.ui
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/ui/dbus.qml
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/ui/popup.qml
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/ui/droppreview.qml
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/ui/droppreview-window.qml
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/ui/shellrunner.qml
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/ui/layoutchooser.qml
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/ui/iconinstaller.qml
$(KWINPKG_DIR): $(patsubst res/%,$(KWINPKG_DIR)/contents/ui/%,$(wildcard res/layouts/*.svg) $(wildcard res/appicon/*.svg))
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/code/install-icons.py
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/code/collect-diagnostics.py
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/ui/dragpreview.qml
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/ui/shortcuts.qml
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/code/main.js
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/code/script.js
$(KWINPKG_DIR): $(KWINPKG_DIR)/contents/config/main.xml
	@touch $@

$(KWIN_META): res/metadata.json
	@mkdir -vp `dirname $(KWIN_META)`
	@touch "$(KWIN_META)"
	sed "s/\$$VER/$(PROJECT_VER)/" $< \
		| sed "s/\$$REV/$(PROJECT_REV)/" \
		> $(KWIN_META)

remove_meta:
	@rm -f "$(KWIN_META)"

$(KWIN_QML): res/main.qml

$(KWINPKG_DIR)/contents/ui/config.ui: res/config.ui
$(KWINPKG_DIR)/contents/ui/dbus.qml: res/dbus.qml
$(KWINPKG_DIR)/contents/ui/popup.qml: res/popup.qml
$(KWINPKG_DIR)/contents/ui/droppreview.qml: res/droppreview.qml
$(KWINPKG_DIR)/contents/ui/droppreview-window.qml: res/droppreview-window.qml
$(KWINPKG_DIR)/contents/ui/shellrunner.qml: res/shellrunner.qml
$(KWINPKG_DIR)/contents/ui/layoutchooser.qml: res/layoutchooser.qml
$(KWINPKG_DIR)/contents/ui/iconinstaller.qml: res/iconinstaller.qml
$(KWINPKG_DIR)/contents/ui/layouts/%.svg: res/layouts/%.svg
	@mkdir -p $(dir $@)
	@cp $< $@
$(KWINPKG_DIR)/contents/ui/appicon/%.svg: res/appicon/%.svg
	@mkdir -p $(dir $@)
	@cp $< $@
$(KWINPKG_DIR)/contents/code/install-icons.py: tools/install-icons.py
$(KWINPKG_DIR)/contents/code/collect-diagnostics.py: tools/collect-diagnostics.py
$(KWINPKG_DIR)/contents/ui/dragpreview.qml: res/dragpreview.qml
$(KWINPKG_DIR)/contents/ui/shortcuts.qml: res/shortcuts.qml
$(KWINPKG_DIR)/contents/code/script.js: $(NODE_SCRIPT)
$(KWINPKG_DIR)/contents/code/main.js: res/main.js
$(KWINPKG_DIR)/contents/config/main.xml: res/config.xml
$(KWINPKG_DIR)/%:
	@mkdir -vp `dirname $@`
	@cp -v $< $@

$(NODE_SCRIPT): $(SRC)
	npm install --save-dev
	npm run tsc --

package_json: package.json
	sed -i 's/"version": [^,]*/"version": "$(PROJECT_VER)"/' package.json

.PHONY: all clean install reload package effect test run stop package_json
