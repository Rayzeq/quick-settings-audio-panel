build:
	xgettext --from-code=UTF-8 --output=po/example.pot *.js
	glib-compile-schemas libs/libpanel/
	gnome-extensions pack --extra-source=LICENSE --extra-source=libs --podir=po --force
	zip -d quick-settings-audio-panel@rayzeq.github.io.shell-extension.zip "./libs/libpanel/.git" "./libs/libpanel/org.gnome.shell.extensions.libpanel.gschema.xml"

install: build
	gnome-extensions install quick-settings-audio-panel@rayzeq.github.io.shell-extension.zip --force

test: install
	clear
	SHELL_DEBUG=backtrace-warnings dbus-run-session -- gnome-shell --nested --wayland