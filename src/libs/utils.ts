import Gio from "gi://Gio";
import GioUnix from "gi://GioUnix";
import GLib from "gi://GLib";

export function get_pactl_path(settings: Gio.Settings): [string | null, boolean] {
	let pactl_path = GLib.find_program_in_path(settings.get_string("pactl-path"));
	let using_custom_path = true;

	if (pactl_path == null) {
		pactl_path = GLib.find_program_in_path("pactl");
		using_custom_path = false;
	}

	return [pactl_path, using_custom_path];
}

export function spawn(argv: string[]): Promise<string> {
	return new Promise((resolve, _reject) => {
		const [, , stdin_fd, stdout_fd, stderr_fd] = GLib.spawn_async_with_pipes(
			null,
			argv,
			null,
			GLib.SpawnFlags.SEARCH_PATH,
			null,
		);

		GLib.close(stdin_fd);
		GLib.close(stderr_fd);

		const stdout_stream = new GioUnix.InputStream({
			fd: stdout_fd,
			close_fd: true,
		});
		const stdout_reader = new Gio.DataInputStream({
			base_stream: stdout_stream,
		});
		const result_string: string[] = [];

		const readline_callback = (_: Gio.DataInputStream | null, result: Gio.AsyncResult) => {
			const [data, length] = stdout_reader.read_upto_finish(result);

			if (length > 0) {
				result_string.push(data);
				stdout_reader.read_upto_async("", 0, 0, null, readline_callback);
			} else {
				stdout_reader.close(null);
				resolve(result_string.join("\n"));
			}
		};
		stdout_reader.read_upto_async("", 0, 0, null, readline_callback);
	});
}

const idle_ids: number[] = [];
// biome-ignore lint/suspicious/noExplicitAny: works with any and not sure I can use something else
export function wait_property<T extends { [x: string]: any }, Name extends string>(
	object: T,
	name: Name,
): Promise<Exclude<T[Name], undefined>> {
	return new Promise((resolve, _reject) => {
		// very ugly hack
		const id_pointer = {} as { id: number };
		const id = GLib.idle_add(
			GLib.PRIORITY_DEFAULT_IDLE,
			wait_property_loop.bind(null, resolve, id_pointer),
		);
		id_pointer.id = id;
		idle_ids.push(id);
	});

	function wait_property_loop(
		resolve: (value: Exclude<T[Name], undefined>) => void,
		pointer: { id: number },
	) {
		if (object[name] !== undefined) {
			const index = idle_ids.indexOf(pointer.id);
			if (index !== -1) {
				idle_ids.splice(index, 1);
			}

			resolve(object[name]);
			return GLib.SOURCE_REMOVE;
		}
		return GLib.SOURCE_CONTINUE;
	}
}

export function cleanup_idle_ids() {
	for (const id of idle_ids) {
		GLib.Source.remove(id);
		console.warn(`[QSAP] Needed to clear an idle loop, this is likely a bug (id: ${id})`);
	}
	idle_ids.length = 0;
}

// Since GNOME 50, dragging a slider can also drag its libpanel panel off-screen
// (St.Slider now uses a PanGesture that no longer blocks the panel's DND gesture),
// so panel drags are disabled while a slider drag is in progress. Uses only public
// API: the slider's `drag-begin`/`drag-end` signals and the draggable's `startGesture`.
const _saved_dnd_manual_mode = new Map<object, boolean>();

// DND gestures of the libpanel panels (v1 and v2) containing `actor`, if any.
// biome-ignore lint/suspicious/noExplicitAny: libpanel internals aren't typed
function _containing_dnd_gestures(actor: any): any[] {
	// biome-ignore lint/suspicious/noExplicitAny: libpanel internals aren't typed
	const gestures: any[] = [];
	// biome-ignore lint/suspicious/noExplicitAny: libpanel internals aren't typed
	let parent: any = actor?.get_parent?.();
	while (parent) {
		const gesture = (parent.draggable ?? parent._drag_handle)?.startGesture;
		if (gesture && !gestures.includes(gesture)) gestures.push(gesture);
		parent = parent.get_parent?.();
	}
	return gestures;
}

// Call once per slider row: dragging it won't move the containing panel.
// biome-ignore lint/suspicious/noExplicitAny: sliders are untyped GNOME objects
export function track_slider_dnd(slider_item: any): void {
	const slider = slider_item?.slider;
	if (!slider?.connect || slider_item._qsap_dnd_tracked) return;
	slider_item._qsap_dnd_tracked = true;

	let dragging = false;
	slider.connect("drag-begin", () => {
		dragging = true;
		for (const gesture of _containing_dnd_gestures(slider_item)) {
			if (!_saved_dnd_manual_mode.has(gesture)) {
				// biome-ignore lint/suspicious/noExplicitAny: libpanel internals aren't typed
				_saved_dnd_manual_mode.set(gesture, (gesture as any).manual_mode);
			}
			// biome-ignore lint/suspicious/noExplicitAny: libpanel internals aren't typed
			(gesture as any).manual_mode = true;
		}
	});
	const end_drag = () => {
		if (!dragging) return;
		dragging = false;
		for (const [gesture, manual_mode] of _saved_dnd_manual_mode) {
			try {
				// biome-ignore lint/suspicious/noExplicitAny: libpanel internals aren't typed
				(gesture as any).manual_mode = manual_mode;
			} catch {
				// The panel was destroyed meanwhile, nothing to restore.
			}
		}
		_saved_dnd_manual_mode.clear();
	};
	slider.connect("drag-end", end_drag);
	if (slider_item.connect) slider_item.connect("destroy", end_drag);
}
