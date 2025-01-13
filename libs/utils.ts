import Gio from "gi://Gio";
import GioUnix from 'gi://GioUnix';
import GLib from "gi://GLib";

export type Constructor<T> = new (...args: any[]) => T;

export function get_pactl_path(settings: Gio.Settings): [string | null, boolean] {
	let pactl_path = GLib.find_program_in_path(settings.get_string("pactl-path"));
	let using_custom_path = true;

	if (pactl_path == null) {
		pactl_path = GLib.find_program_in_path('pactl');
		using_custom_path = false;
	}

	return [pactl_path, using_custom_path];
}

export function spawn(argv: string[]): Promise<string> {
	return new Promise((resolve, _reject) => {
		const [, , , stdout,] = GLib.spawn_async_with_pipes(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
		const stdout_reader = new Gio.DataInputStream({
			base_stream: new GioUnix.InputStream({ fd: stdout })
		});
		const result_string: string[] = [];

		const readline_callback = (_: Gio.DataInputStream | null, result: Gio.AsyncResult) => {
			const [stdout, length] = stdout_reader.read_upto_finish(result);

			if (length > 0) {
				result_string.push(stdout);
				stdout_reader.read_upto_async("", 0, 0, null, readline_callback);
			} else {
				resolve(result_string.join("\n"));
			}
		};
		stdout_reader.read_upto_async("", 0, 0, null, readline_callback);
	});
}