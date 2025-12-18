import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { gettext as _, ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { get_settings, get_stack, rsplit, split, type Constructor } from '@libpanel/utils.js';
import { update_settings } from "./libs/preferences.js";
import { get_pactl_path } from "./libs/utils.js";

export default class QSAPPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window: Adw.PreferencesWindow) {
        const settings = this.getSettings();
        update_settings(settings);

        window.add(this.makeExtensionSettingsPage(settings));

        // we remove the 'file://' and the filename at the end
        const parent_folder = '/' + split(rsplit(get_stack()[0].file, '/', 1)[0], '/', 3)[3];
        const libpanel_settings = get_settings(`${parent_folder}/libs/libpanel/org.gnome.shell.extensions.libpanel.gschema.xml`);
        window.add(this.makeLibpanelSettingsPage(libpanel_settings));
    }

    makeExtensionSettingsPage(settings: Gio.Settings): Adw.PreferencesPage {
        const page = new Adw.PreferencesPage({ title: "Extension settings", icon_name: "preferences-system-symbolic" });

        // ====================================== Main group ======================================
        const main_group = new PreferencesGroup(settings);
        main_group.add_combobox("panel-type",
            {
                title: _("Where the panel should be"),
                fields: [
                    ["independent-panel", _("Independent panel")],
                    ["merged-panel", _("In the main panel")],
                    ["separate-indicator", _("In a separate indicator")],
                ],
                use_markup: true
            }
        );
        const merged_panel_position = main_group.add_combobox("merged-panel-position",
            {
                title: _("Panel position"),
                subtitle: _("Where the new panel should be located relative to the main panel"),
                fields: [
                    ["top", _("Top")],
                    ["bottom", _("Bottom")]
                ]
            }
        );
        settings.connect("changed::panel-type", (_self, _key) => {
            merged_panel_position.visible = settings.get_string("panel-type") === "merged-panel";
        });
        settings.emit("changed::panel-type", "panel-type");

        main_group.add_switch("always-show-input-volume-slider",
            {
                title: _("Always show microphone volume slider"),
                subtitle: _("Show even when there is no application recording audio")
            }
        );
        const ignore_virtual_capture_streams = main_group.add_switch("ignore-virtual-capture-streams",
            {
                title: _("Don't show the microphone indicator when there is only virtual captures")
            }
        );
        main_group.add_switch("remove-output-volume-slider",
            {
                title: _("Remove the main output volume slider"),
                subtitle: _("This is useful if you enabled the per-device volume sliders")
            }
        );
        main_group.add_switch("master-volume-sliders-show-current-device",
            {
                title: _("Show the currently selected device for the main volume sliders"),
            }
        );
        main_group.add_switch("add-button-applications-output-reset-to-default",
            {
                title: _("Add a button to reset all applications to the default output"),
                subtitle: _("This button can be found in the device chooser of the main output slider")
            }
        );

        main_group.add_switch("ignore-css",
            {
                title: _("Do not apply custom CSS"),
                subtitle: _("Disable the CSS in this extension that could override your theme")
            }
        );
        const pactl_path = main_group.add_file_chooser("pactl-path",
            {
                title: _("Path to the <tt>pactl</tt> executable"),
            }
        );

        // =============================== Widget ordering subgroups ==============================
        const profile_switcher_group = new ListBox(settings);
        profile_switcher_group.add_switch("autohide-profile-switcher",
            {
                title: _("Auto-hide"),
                subtitle: _("Hide the profile switcher when the current device only has one profile")
            }
        );

        const perdevice_volume_sliders_group = new ListBox(settings);
        perdevice_volume_sliders_group.add_switch("perdevice-volume-sliders-change-button",
            {
                title: _("Add a 'set as active' button"),
                subtitle: _(`This button, added on each device slider, has the same effect as clicking on that device in the main volume slider menu`)
            }
        );
        const perdevice_volume_sliders_change_menu = perdevice_volume_sliders_group.add_switch("perdevice-volume-sliders-change-menu",
            {
                title: _("Replace the 'set as active' button with a submenu"),
                subtitle: _(`For devices which have multiple ports, the button will be replaced by a submenu to choose which port will be active`)
            }
        );
        settings.bind("perdevice-volume-sliders-change-button", perdevice_volume_sliders_change_menu, "sensitive", Gio.SettingsBindFlags.DEFAULT);

        const mpris_controllers_group = new ListBox(settings);
        mpris_controllers_group.add_switch("mpris-controllers-are-moved",
            {
                title: _("Move media controls"),
                subtitle: _(`Move the media controls from the notifications panel instead of creating a new one`)
            }
        );

        const applications_volume_sliders_group = new ListBox(settings);
        applications_volume_sliders_group.add_switch("group-applications-volume-sliders",
            {
                title: _("Put the sliders in submenu"),
                subtitle: _('<span color="darkorange" weight="bold">This will disable the ability to change the output device per application</span>')
            }
        );
        applications_volume_sliders_group.add_switch("applications-volume-sliders-allow-automatic-pactl",
            {
                title: _("Allow automatic execution of <tt>pactl</tt>"),
                subtitle: _('This feature might cause some minor lag, but it\'s necessary to get the real name of Chromium applications and detect the application\'s current output device')
            }
        );

        // ================================= Widget ordering group ================================
        const widgets_order_group = new ReorderablePreferencesGroup(settings, "widgets-order", {
            title: _("Elements order"),
            description: _("Reorder elements in the new panel")
        });

        widgets_order_group
            .add_reorderable("profile-switcher", {
                title: _("Profile switcher"),
                subtitle: _("Allows you to quickly change the audio profile of the current device")
            })
            .add_switch("create-profile-switcher")
            .add_subgroup(profile_switcher_group);
        widgets_order_group
            .add_reorderable("output-volume-slider", { title: _("Speaker / Headphone volume slider") })
            .add_switch("move-output-volume-slider");
        widgets_order_group
            .add_reorderable("perdevice-volume-sliders", { title: _("Per-device volume sliders") })
            .add_switch("create-perdevice-volume-sliders")
            .add_subgroup(perdevice_volume_sliders_group);
        const balance_slider = widgets_order_group
            .add_reorderable("balance-slider", { title: _("Audio balance slider") })
            .add_switch("create-balance-slider");
        widgets_order_group
            .add_reorderable("input-volume-slider", { title: _("Microphone volume slider") })
            .add_switch("move-input-volume-slider");
        widgets_order_group
            .add_reorderable("mpris-controllers", { title: _("Media controls") })
            .add_switch("create-mpris-controllers")
            .add_subgroup(mpris_controllers_group);
        const applications_volume_sliders = widgets_order_group
            .add_reorderable("applications-volume-sliders", { title: _("Applications mixer") })
            .add_switch("create-applications-volume-sliders")
            .add_subgroup(applications_volume_sliders_group);

        // ==================================== patcl checking ====================================
        const pactl_callbacks = [
            (found: boolean) => {
                let subtitle = _("The same sliders you can find in pavucontrol or in the sound settings");
                if (!found) {
                    subtitle += "\n" + _('<span color="darkorange" weight="bold"><tt>pactl</tt> was not found, you won\'t be able to change the output device per application</span>');
                }
                applications_volume_sliders.subtitle = subtitle;
            },
            (found: boolean) => {
                let subtitle = _("This slider allows you to change the balance of the current audio output");
                if (found) {
                    balance_slider.switch!.sensitive = true;
                } else {
                    subtitle += "\n" + _('<span color="red" weight="bold">This feature needs <tt>pactl</tt></span>');
                    balance_slider.switch!.sensitive = false;
                }
                balance_slider.subtitle = subtitle;
            },
            (found: boolean) => {
                let subtitle = _("This include for example the echo cancellation module");
                if (found) {
                    ignore_virtual_capture_streams.sensitive = true;
                } else {
                    subtitle += "\n" + _('<span color="red" weight="bold">This feature needs <tt>pactl</tt></span>');
                    ignore_virtual_capture_streams.sensitive = false;
                }
                ignore_virtual_capture_streams.subtitle = subtitle;
            }
        ];

        const update_pactl_status = (): [boolean, boolean] => {
            let [pactl_path, found_using_custom_path] = get_pactl_path(settings);

            for (const callback of pactl_callbacks) {
                callback(pactl_path !== null);
            }

            return [pactl_path !== null, found_using_custom_path];
        };
        const [found_pactl, found_pactl_using_path] = update_pactl_status();
        settings.connect("changed::pactl-path", () => update_pactl_status());
        pactl_path.visible = found_pactl_using_path || !found_pactl;

        // ======================== Perdevice volume sliders filters group ========================
        const perdevice_volume_sliders_filters_group = new FilterPreferencesGroup(settings, "perdevice-volume-sliders-filters", "perdevice-volume-sliders-filter-mode",
            {
                title: _("Per-device sliders filtering"),
                description: _("Allows you to filter the per-device volume sliders. The content of the filters are <b>regexes</b> and are applied to the device's display name and pulseaudio name."),
                placeholder: _("Device name"),
            }
        );

        // ======================= Applications volume sliders filters group ======================
        const applications_volume_sliders_filters_group = new FilterPreferencesGroup(settings, "applications-volume-sliders-filters", "applications-volume-sliders-filter-mode",
            {
                title: _("Application mixer filtering"),
                description: _("Allows you to filter the applications that show up in the application mixer <b>using regexes</b>"),
                placeholder: _("Application name"),
            }
        );

        page.add(main_group);
        page.add(widgets_order_group);
        page.add(perdevice_volume_sliders_filters_group);
        page.add(applications_volume_sliders_filters_group);
        page.add(this.make_profile_renamer(settings));
        return page;
    }

    private make_profile_renamer(settings: Gio.Settings): PreferencesGroup {
        const group = new PreferencesGroup(settings, {
            title: _("Profile renamer"),
            description: _("Allows you to rename profiles of audio devices (only effective in the profile switcher)")
        });

        // Can't use Gvc in prefs, we have to rely on infos saved by the extension.
        const renames: Record<string, Record<string, [string, string]>> = settings.get_value("profiles-renames").recursiveUnpack();

        for (const [card, profiles] of Object.entries(renames)) {
            if (Object.keys(profiles).length === 0) continue;
            const card_row = new Adw.ExpanderRow({ title: card });

            for (const [profile, [original_name, display_name]] of Object.entries(profiles)) {
                const row = new Adw.EntryRow({ title: original_name, text: display_name, show_apply_button: true });
                row.connect("apply", () => {
                    const renames: Record<string, Record<string, [string, string]>> = settings.get_value("profiles-renames").recursiveUnpack();
                    renames[card][profile] = [original_name, row.text];
                    settings.set_value("profiles-renames", new GLib.Variant("a{sa{s(ss)}}", renames));
                });

                const reset_button = new Gtk.Button({
                    icon_name: "view-refresh-symbolic",
                    has_frame: false,
                    tooltip_text: _("Restore original name"),
                });
                reset_button.connect("clicked", () => {
                    row.text = original_name;
                    row.emit("apply");
                });
                row.add_suffix(reset_button);

                card_row.add_row(row);
            }

            group.add(card_row);
        }

        return group;
    }

    makeLibpanelSettingsPage(settings: Gio.Settings): Adw.PreferencesPage {
        const page = new Adw.PreferencesPage({
            title: "Libpanel settings",
            icon_name: "view-grid-symbolic"
        });
        const group = new PreferencesGroup(settings, {
            title: _("LibPanel settings"),
            description: _("These settings are not specific to this extension, they apply to every panel"),
        });

        group.add_switch("single-column",
            {
                title: _("Single-column mode"),
                subtitle: _("Only one column of panels will be allowed. Also prevents the panel from being put at the left/right of the screen by libpanel.")
            }
        );
        group.add_combobox("alignment",
            {
                title: _("Panel alignment"),
                fields: [
                    ["left", _("Left")],
                    ["right", _("Right")],
                ]
            }
        );
        group.add_switch_spin("padding-enabled", "padding",
            {
                title: _("Padding"),
                subtitle: _("Use this to override the default padding of the panels")
            }, 0, 100
        );
        group.add_switch_spin("row-spacing-enabled", "row-spacing",
            {
                title: _("Row spacing"),
                subtitle: _("Use this to override the default row spacing of the panels")
            }, 0, 100
        );
        group.add_switch_spin("column-spacing-enabled", "column-spacing",
            {
                title: _("Column spacing"),
                subtitle: _("Use this to override the default column spacing of the panels")
            }, 0, 100
        );

        page.add(group);
        return page;
    }
}

interface BasePreferencesRowList {
    settings: Gio.Settings;
    add: (row: Adw.PreferencesRow) => void;
}

function PreferencesRowList<T extends Constructor<BasePreferencesRowList & GObject.Object>>(Base: T) {
    return GObject.registerClass({ GTypeName: `PreferencesRowList_${Base.name}` }, class extends Base {
        add_switch(
            key: string,
            properties: Partial<Adw.SwitchRow.ConstructorProps>
        ): Adw.SwitchRow {
            const row = new Adw.SwitchRow(properties);
            this.settings.bind(
                key,
                row,
                "active",
                Gio.SettingsBindFlags.DEFAULT
            );

            this.add(row);
            return row;
        }

        add_combobox(
            key: string,
            properties: Partial<Adw.ComboRow.ConstructorProps> & { fields: [string, string][]; }
        ): Adw.ComboRow {
            const { fields, ...props } = properties;

            const model = Gtk.StringList.new(fields.map(x => x[1]));
            const row = new Adw.ComboRow({
                model: model,
                selected: fields.map(x => x[0]).indexOf(this.settings.get_string(key)),
                ...props
            });

            row.connect("notify::selected", () => {
                this.settings.set_string(key, fields[row.selected][0]);
            });

            this.add(row);
            return row;
        }

        add_switch_spin(
            switch_key: string,
            spin_key: string,
            properties: { title: string, subtitle: string; },
            lower: number = 0,
            higher: number = 0
        ): Adw.SpinRow {
            const row = Adw.SpinRow.new_with_range(lower, higher, 1);
            row.title = properties.title;
            row.subtitle = properties.subtitle;

            const switch_ = new Gtk.Switch({ valign: Gtk.Align.CENTER });
            this.settings.bind(
                switch_key,
                switch_,
                'active',
                Gio.SettingsBindFlags.DEFAULT
            );
            row.add_prefix(switch_);
            row.activatable_widget = switch_;

            this.settings.bind(
                spin_key,
                row,
                'value',
                Gio.SettingsBindFlags.DEFAULT
            );

            this.add(row);
            return row;
        }

        add_file_chooser(
            key: string,
            properties: Partial<Adw.EntryRow.ConstructorProps>
        ): Adw.EntryRow {
            const row = new Adw.EntryRow({ ...properties, show_apply_button: false });
            this.settings.bind(
                key,
                row,
                "text",
                Gio.SettingsBindFlags.DEFAULT
            );

            const chooser_button = new Gtk.Button({ label: "Choose file...", has_frame: false });
            chooser_button.connect("clicked", () => {
                const dialog = new Gtk.FileDialog();
                dialog.set_initial_file(Gio.File.new_for_path(row.text));
                dialog.open(null, null, (_, result) => {
                    let path = dialog.open_finish(result)?.get_path();
                    if (path !== null && path !== undefined)
                        row.text = path;
                });
            });
            row.add_suffix(chooser_button);

            this.add(row);
            return row;
        }
    });
}

const PreferencesGroup = PreferencesRowList(GObject.registerClass(class PreferencesGroup extends Adw.PreferencesGroup {
    settings: Gio.Settings;

    constructor(settings: Gio.Settings, properties?: Partial<Adw.PreferencesGroup.ConstructorProps>) {
        super(properties);
        this.settings = settings;
    }
}));
type PreferencesGroup = InstanceType<typeof PreferencesGroup>;

const ListBox = PreferencesRowList(GObject.registerClass(class ListBox extends Gtk.ListBox {
    settings: Gio.Settings;

    constructor(settings: Gio.Settings, properties?: Partial<Gtk.ListBox.ConstructorProps>) {
        super(properties);
        this.settings = settings;
    }

    add(row: Adw.PreferencesRow) {
        this.append(row);
    }
}));
type ListBox = InstanceType<typeof ListBox>;

const FilterPreferencesGroup = GObject.registerClass(class FilterPreferencesGroup extends PreferencesGroup {
    private _key: string;
    private _placeholder: string;
    private _rows: Adw.EntryRow[];

    constructor(settings: Gio.Settings, key: string, mode_key: string, properties: Partial<Adw.PreferencesGroup.ConstructorProps> & { placeholder: string; }) {
        const { placeholder, ...props } = properties;

        const add_filter_button = new Gtk.Button({ icon_name: "list-add", has_frame: false });
        super(settings, { ...props, header_suffix: add_filter_button });

        this.add_combobox(mode_key,
            {
                title: _("Filtering mode"),
                subtitle: _("On blocklist mode, matching elements are removed from the list. On allowlist mode, only matching elements will be shown"),
                fields: [
                    ['blacklist', _("Blocklist")],
                    ['whitelist', _("Allowlist")],
                ]
            }
        );
        this._key = key;
        this._placeholder = placeholder;
        this._rows = [];

        add_filter_button.connect("clicked", () => this._create_row());
        for (const filter of settings.get_strv(key)) {
            this._create_row(filter);
        }
    }

    private _create_row(content?: string) {
        const new_row = new Adw.EntryRow({ "title": this._placeholder });
        if (content !== undefined) new_row.text = content;

        const delete_button = new Gtk.Button({ icon_name: "user-trash-symbolic", has_frame: false });
        delete_button.connect("clicked", () => {
            this.remove(new_row);
            this._rows.splice(this._rows.indexOf(new_row), 1);
            this._save();
        });
        new_row.add_suffix(delete_button);

        new_row.connect("changed", () => {
            try {
                new RegExp(new_row.text);
            } catch (e) {
                new_row.title = "<span color=\"red\" weight=\"bold\">Invalid regex (filters were not saved)</span>";
                return;
            }
            new_row.title = this._placeholder;
            this._save();
        });

        this._rows.push(new_row);
        this.add(new_row);
    }

    private _save() {
        this.settings.set_strv(this._key, this._rows.map(row => row.text));
    }
});

// From this point onwards, the code is mostly a reimplementation of those:
// https://gitlab.gnome.org/GNOME/gnome-control-center/-/tree/main/panels/search
// https://gitlab.gnome.org/GNOME/libadwaita/-/blob/main/src/adw-expander-row.c

const ReorderablePreferencesGroup = GObject.registerClass(class ReorderablePreferencesGroup extends Adw.PreferencesGroup {
    private _settings: Gio.Settings;
    private _key: string;
    private _list_box: Gtk.ListBox;

    constructor(
        settings: Gio.Settings,
        key: string,
        properties: Partial<Adw.PreferencesGroup.ConstructorProps>
    ) {
        super(properties);
        this._settings = settings;
        this._key = key;

        this._list_box = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
        this._list_box.add_css_class("boxed-list");
        this._list_box.set_sort_func((a, b) => {
            if (!(a instanceof DraggableRow) || !(b instanceof DraggableRow)) {
                console.error(`Invalid row type: ${a.constructor.name} or ${b.constructor.name}`);
                return 0;
            }

            const data = settings.get_strv(key);
            const index_a = data.indexOf(a.key);
            const index_b = data.indexOf(b.key);
            return index_a < index_b ? -1 : 1;
        });
        super.add(this._list_box);
    }

    add_reorderable(key: string, properties: Partial<Adw.ActionRow.ConstructorProps>): DraggableRowClass {
        const row = new DraggableRow(this._settings, key, properties);

        this._list_box.set_valign(Gtk.Align.FILL);
        row.connect('move-row', (source: DraggableRowClass, target: DraggableRowClass) => {
            const data = this._settings.get_strv(this._key);
            const source_index = data.indexOf(source.key);
            const target_index = data.indexOf(target.key);
            if (target_index < source_index) {
                data.splice(source_index, 1); // remove 1 element at source_index
                data.splice(target_index, 0, source.key); // insert source.key at target_index
            } else {
                data.splice(target_index + 1, 0, source.key); // insert source.key at target_index
                data.splice(source_index, 1); // remove 1 element at source_index
            }
            this._settings.set_strv(this._key, data);
            this._list_box.invalidate_sort();
        });
        this._list_box.append(row);

        return row;
    }
});

class DraggableRowClass extends Adw.PreferencesRow {
    key: string;
    private _settings: Gio.Settings;
    private _expanded: boolean;

    switch?: Gtk.Switch;
    private _box: Gtk.Box;
    private _header: Adw.ActionRow;

    private _drag_x?: number;
    private _drag_y?: number;
    private _drag_widget?: Gtk.ListBox;

    constructor(settings: Gio.Settings, key: string, properties: Partial<Adw.ActionRow.ConstructorProps>) {
        super({ css_classes: ["expander", "empty"], activatable: false });
        this.key = key;
        this._settings = settings;
        this._expanded = false;

        this._box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
        this.set_child(this._box);

        this._header = new Adw.ActionRow(properties);
        const list = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
        this._box.append(list);
        list.append(this._header);

        const drag_handle = new Gtk.Image({ icon_name: "list-drag-handle-symbolic" });
        // css don't work
        drag_handle.add_css_class("drag-handle");
        this._header.add_prefix(drag_handle);

        const drag_source = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE });
        drag_source.connect("prepare", (_source, x, y) => {
            this._drag_x = x;
            this._drag_y = y;
            return Gdk.ContentProvider.new_for_value(this);
        });
        drag_source.connect("drag-begin", (_source, drag) => {
            this._drag_widget = new Gtk.ListBox();
            this._drag_widget.set_size_request(this._header.get_allocated_width(), this._header.get_allocated_height());

            const row_copy = new DraggableRow(settings, "", { ...properties, title: this._header.title, subtitle: this._header.subtitle });
            this._drag_widget.append(row_copy);
            this._drag_widget.drag_highlight_row(row_copy);

            Gtk.DragIcon.get_for_drag(drag).set_child(this._drag_widget);
            // we know values are not undefined because `drag-begin` is sent after `prepare`
            drag.set_hotspot(this._drag_x!, this._drag_y!);
        });
        this.add_controller(drag_source);

        // @ts-expect-error: `GType` is a little goofy, so DraggableRow is not considered to be a GType
        const drop_target = Gtk.DropTarget.new(DraggableRow, Gdk.DragAction.MOVE);
        drop_target.preload = true;
        drop_target.connect("drop", (_self, source, _x, _y) => {
            if (source instanceof DraggableRowClass) {
                source.emit("move-row", this);
                return true;
            }
            return false;
        });
        this.add_controller(drop_target);
    }

    get subtitle(): string {
        return this._header.subtitle;
    }

    set subtitle(value: string) {
        this._header.subtitle = value;
    }

    add_switch(key: string): DraggableRowClass {
        this.switch = new Gtk.Switch({ valign: Gtk.Align.CENTER });
        this._settings.bind(
            key,
            this.switch,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        this._header.add_suffix(this.switch);
        this._header.activatable_widget = this.switch;

        return this;
    }

    add_subgroup(group: ListBox): DraggableRowClass {
        group.add_css_class("nested");
        group.selection_mode = Gtk.SelectionMode.NONE;

        const revealer = new Gtk.Revealer({ child: group, transition_type: Gtk.RevealerTransitionType.SLIDE_UP, reveal_child: false });
        this._box.append(revealer);

        const toggle_expand = () => {
            this._expanded = !this._expanded;
            revealer.reveal_child = this._expanded;
            if (this._expanded) {
                this.set_state_flags(Gtk.StateFlags.CHECKED, false);
            } else {
                this.unset_state_flags(Gtk.StateFlags.CHECKED);
            }
        };

        this._header.add_suffix(new Gtk.Image({ icon_name: "adw-expander-arrow-symbolic", css_classes: ["expander-row-arrow"] }));
        // @ts-expect-error: the typscript type likely is wrong, as the documentation says "The argument can be NULL."
        // https://gnome.pages.gitlab.gnome.org/libadwaita/doc/1.3/method.ActionRow.set_activatable_widget.html
        this._header.activatable_widget = null;
        this._header.connect("activated", toggle_expand);

        return this;
    }
}

const DraggableRow = GObject.registerClass({
    Signals: {
        "move-row": {
            flags: GObject.SignalFlags.RUN_LAST,
            // @ts-expect-error: `GType` is a little goofy, so DraggableRowClass is not considered to be a GType
            param_types: [DraggableRowClass],
        }
    },
}, DraggableRowClass);
