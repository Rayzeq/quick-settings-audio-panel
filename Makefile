NAME=quick-settings-audio-panel
DOMAIN=rayzeq.github.io
OUTPUT_DIR=dist

TS_FILES=$(shell find src/ -type f -name '*.ts')
COMPILABLE_TS_FILES=$(shell find src/ -type f -name '*.ts' -not -name '*.d.ts')
JS_FILES=$(COMPILABLE_TS_FILES:src/%.ts=$(OUTPUT_DIR)/%.js)
RESOURCES=$(shell find resources/ -type f)
RESOURCES_TARGET=$(RESOURCES:resources/%=$(OUTPUT_DIR)/%)

TARGET=$(OUTPUT_DIR)/$(NAME)@$(DOMAIN).shell-extension.zip

.PHONY: all pack install test clean

all: pack

node_modules: package.json
	npm install
	# npm install doesn't seem to update the date on the folder
	touch node_modules

resources/po/example.pot: $(JS_FILES)
	xgettext --from-code=UTF-8 --output=$@ $(OUTPUT_DIR)/*.js

$(JS_FILES): node_modules $(TS_FILES)
	-npx tsc
	touch $(OUTPUT_DIR)/libs

$(OUTPUT_DIR)/libs/libpanel/gschemas.compiled: src/libs/libpanel/*.gschema.xml
	mkdir -p  $(OUTPUT_DIR)/libs/libpanel/
	glib-compile-schemas src/libs/libpanel/ --targetdir=$(OUTPUT_DIR)/libs/libpanel/

$(RESOURCES_TARGET): $(RESOURCES)
	cp -r resources/* $(OUTPUT_DIR)

pack: $(OUTPUT_DIR)/libs/libpanel/gschemas.compiled $(JS_FILES) $(RESOURCES_TARGET)
	cp src/libs/libpanel/LICENSE $(OUTPUT_DIR)/libs/libpanel/
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
