import GLib from "gi://GLib";
import Gio from "gi://Gio";

// Allows getting settings without a schema.
//
// Used to migrate settings.
class RawSettings {
    private settings: Gio.Settings;

    constructor(settings: Gio.Settings) {
        this.settings = settings;
    }

    private get_value(key: string, expected_type: GLib.VariantType): GLib.Variant | null {
        return this.settings.backend.vfunc_read_user_value(this.settings.path + key, expected_type);
    }

    pop_boolean(key: string): boolean | undefined {
        const value = this.get_value(key, GLib.VariantType.new("b"))?.get_boolean();
        this.delete(key);
        return value;
    }

    pop_string(key: string): string | undefined {
        const value = this.get_value(key, GLib.VariantType.new("s"))?.get_string()[0];
        this.delete(key);
        return value;
    }

    pop_strv(key: string): string[] | undefined {
        const value = this.get_value(key, GLib.VariantType.new("as"))?.get_strv();
        this.delete(key);
        return value;
    }

    delete(_key: string) {
        // don't work because it's apparently not implemented, except it is here:
        // https://gitlab.gnome.org/GNOME/dconf/-/blob/main/gsettings/dconfsettingsbackend.c#L113
        // this.settings.backend.vfunc_reset(key);
    }
}

export function update_settings(settings: Gio.Settings) {
    const raw = new RawSettings(settings);

    if (settings.get_int("version") == 1) {
        const widget_name_map: { [index: string]: string } = {
            "profile-switcher": "profile-switcher",
            "volume-output": "output-volume-slider",
            "sink-mixer": "perdevice-volume-sliders",
            "balance-slider": "balance-slider",
            "volume-input": "input-volume-slider",
            "media": "mpris-controllers",
            "mixer": "applications-volume-sliders"
        }
        let value: undefined | boolean | string | string[];

        if ((value = raw.pop_boolean("merge-panel")) === true) {
            settings.set_string("panel-type", "merged-panel")
        }
        if ((value = raw.pop_boolean("separate-indicator")) === true) {
            settings.set_string("panel-type", "separate-indicator")
        }

        if ((value = raw.pop_string("panel-position")) != undefined) {
            settings.set_string("merged-panel-position", value);
        }

        if ((value = raw.pop_boolean("always-show-input-slider")) != undefined) {
            settings.set_boolean("always-show-input-volume-slider", value);
        }

        if ((value = raw.pop_boolean("remove-output-slider")) != undefined) {
            settings.set_boolean("remove-output-volume-slider", value);
        }

        if ((value = raw.pop_boolean("show-current-device")) != undefined) {
            settings.set_boolean("master-volume-sliders-show-current-device", value);
        }

        if ((value = raw.pop_strv("ordering")) != undefined) {
            if (value.length < 5) value = ["volume-output", "sink-mixer", "volume-input", "media", "mixer"];
            if (value.length < 6) value.push("balance-slider");
            if (value.length < 7) value.push("profile-switcher");

            settings.set_strv("widgets-order", value.map(widget => widget_name_map[widget]));
        }

        if ((value = raw.pop_boolean("move-master-volume")) != undefined) {
            settings.set_boolean("move-output-volume-slider", value);
            settings.set_boolean("move-input-volume-slider", value);
        }

        if ((value = raw.pop_boolean("create-sink-mixer")) != undefined) {
            settings.set_boolean("create-perdevice-volume-sliders", value);
        }

        if ((value = raw.pop_string("sink-filter-mode")) != undefined) {
            settings.set_string("perdevice-volume-sliders-filter-mode", value);
        }

        if ((value = raw.pop_strv("sink-filters")) != undefined) {
            settings.set_strv("perdevice-volume-sliders-filters", value);
        }

        if ((value = raw.pop_string("media-control")) != undefined) {
            if (value == "none") {
                settings.set_boolean("create-mpris-controllers", false);
            } else if (value == "move") {
                settings.set_boolean("create-mpris-controllers", true);
                settings.set_boolean("mpris-controllers-are-moved", true);
            } else {
                settings.set_boolean("create-mpris-controllers", true);
                settings.set_boolean("mpris-controllers-are-moved", false);
            }
        }

        if ((value = raw.pop_boolean("create-mixer-sliders")) != undefined) {
            settings.set_boolean("create-applications-volume-sliders", value);
        }

        if ((value = raw.pop_string("mixer-sliders-type")) != undefined) {
            settings.set_boolean("group-applications-volume-sliders", value == "combined");
        }

        if ((value = raw.pop_string("filter-mode")) != undefined) {
            settings.set_string("applications-volume-sliders-filter-mode", value);
        }

        if ((value = raw.pop_strv("filters")) != undefined) {
            settings.set_strv("applications-volume-sliders-filters", value);
        }

        settings.set_int("version", 2);
    }
}