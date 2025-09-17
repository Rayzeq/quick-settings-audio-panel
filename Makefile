NAME=quick-settings-audio-panel
DOMAIN=rayzeq.github.io
OUTPUT_DIR=dist

TS_FILES=extension.ts prefs.ts libs/*.ts
JS_FILES=$(TS_FILES:%.ts=$(OUTPUT_DIR)/%.js)

TARGET=$(OUTPUT_DIR)/$(NAME)@$(DOMAIN).shell-extension.zip

.PHONY: all pack install test clean

all: pack

node_modules: package.json
	npm install
	# npm install doesn't seems to necessarily update the date on the folder
	touch node_modules

po/example.pot: $(JS_FILES)
	xgettext --from-code=UTF-8 --output=po/example.pot $(OUTPUT_DIR)/*.js

$(JS_FILES): node_modules $(TS_FILES)
	-npm run build
	touch $(OUTPUT_DIR)/libs

pack: $(JS_FILES) po/example.pot
	cp -r stylesheet.css metadata.json LICENSE po/ schemas/ $(OUTPUT_DIR)
	# for some reason this prevents `gnome-extensions pack` from putting some empty files in the archive
	# (because of virtualbox ?)
	sleep 1
	cd $(OUTPUT_DIR)/ && gnome-extensions pack --extra-source=LICENSE --extra-source=libs --podir=po --force

install: pack
	gnome-extensions install $(TARGET) --force

test: install
	clear
	SHELL_DEBUG=backtrace-warnings env MUTTER_DEBUG_DUMMY_MODE_SPECS=1280x720 dbus-run-session -- gnome-shell --nested --wayland

test2: install
	clear
	SHELL_DEBUG=backtrace-warnings env MUTTER_DEBUG_NUM_DUMMY_MONITORS=2 MUTTER_DEBUG_DUMMY_MODE_SPECS=1024x768 dbus-run-session -- gnome-shell --nested --wayland

prefs: install
	clear
	gnome-extensions prefs quick-settings-audio-panel@rayzeq.github.io
	journalctl -f -o cat /usr/bin/gjs

clean:
	rm -r $(OUTPUT_DIR) node_modules
