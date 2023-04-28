build:
	gnome-extensions pack --extra-source=LICENSE --extra-source=libs --podir=po --force

install: build
	gnome-extensions install quick-settings-audio-panel@rayzeq.github.io.shell-extension.zip --force