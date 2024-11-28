import type Gio from "gi://Gio";
import GLib from "gi://GLib";

export function get_pactl_path(settings: Gio.Settings): [string | null, boolean] {
	let pactl_path = GLib.find_program_in_path(settings.get_string("pactl-path"));
	let using_custom_path = true;

	if (pactl_path == null) {
		pactl_path = GLib.find_program_in_path('pactl');
		using_custom_path = false;
	}

	return [pactl_path, using_custom_path];
}