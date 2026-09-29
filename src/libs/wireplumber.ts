import GLib from "gi://GLib";

// biome-ignore lint/suspicious/noExplicitAny: there are no type definitions for WirePlumber
type WpAny = any;

let Wp: WpAny = null;
try {
	// @ts-expect-error: there are no type definitions for WirePlumber
	Wp = (await import("gi://Wp?version=0.5")).default;
	Wp.init(Wp.InitFlags.PIPEWIRE | Wp.InitFlags.SPA_TYPES);
} catch (_e) {
	Wp = null;
}

export function create_stream_watcher(): StreamWatcher | null {
	return Wp ? new StreamWatcher() : null;
}

export class StreamWatcher {
	available: boolean;
	object_manager: WpAny;
	private _core: WpAny;

	constructor() {
		this._core = new Wp.Core();
		this.object_manager = new Wp.ObjectManager();
		this.object_manager.add_interest_full(Wp.ObjectInterest.new_type(Wp.Node.$gtype));
		this.object_manager.add_interest_full(Wp.ObjectInterest.new_type(Wp.Link.$gtype));
		this.object_manager.request_object_features(
			Wp.GlobalProxy.$gtype,
			Wp.ProxyFeatures.PIPEWIRE_OBJECT_FEATURE_INFO,
		);
		this._core.connect_object("disconnected", () => (this.available = false), this);
		this.available = this._core.connect();
		this._core.install_object_manager(this.object_manager);
	}

	private _lookup(type: WpAny, constraint: WpAny, key: string, value: GLib.Variant) {
		const interest = Wp.ObjectInterest.new_type(type);
		interest.add_constraint(constraint, key, Wp.ConstraintVerb.EQUALS, value);
		return this.object_manager.lookup_full(interest);
	}

	private _lookup_stream(stream_index: number) {
		return this._lookup(
			Wp.Node.$gtype,
			Wp.ConstraintType.PW_PROPERTY,
			"object.serial",
			GLib.Variant.new_string(String(stream_index)),
		);
	}

	get_stream_property(stream_index: number, key: string): string | null {
		return this._lookup_stream(stream_index)?.get_properties()?.get(key) ?? null;
	}

	get_sink_index(stream_index: number): number | null {
		const stream = this._lookup_stream(stream_index);
		if (!stream) return null;

		const link = this._lookup(
			Wp.Link.$gtype,
			Wp.ConstraintType.PW_PROPERTY,
			"link.output.node",
			GLib.Variant.new_string(String(stream.get_bound_id())),
		);
		if (!link) return null;

		const [, , sink_id] = link.get_linked_object_ids();
		const sink = this._lookup(
			Wp.Node.$gtype,
			Wp.ConstraintType.G_PROPERTY,
			"bound-id",
			GLib.Variant.new_uint32(sink_id),
		);
		const serial = sink?.get_properties()?.get("object.serial");
		return serial ? Number(serial) : null;
	}

	destroy() {
		this._core.disconnect_object(this);
		this._core.disconnect();
	}
}
