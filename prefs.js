"use strict";

const { Adw, Gio, Gtk, Gdk, GObject } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Gettext = imports.gettext;

const Self = ExtensionUtils.getCurrentExtension();
const Domain = Gettext.domain(Self.metadata.uuid);
const _ = Domain.gettext;
const ngettext = Domain.ngettext;

function init() {
    ExtensionUtils.initTranslations(Self.metadata.uuid);
}

function fillPreferencesWindow(window) {
    const settings = ExtensionUtils.getSettings("org.gnome.shell.extensions.quick-settings-audio-panel");
    
    const page = new Adw.PreferencesPage();
    const main_group = new Adw.PreferencesGroup();

    main_group.add(create_switch(
        settings, "move-master-volume",
        {
            title: _("Move master volume sliders"),
            subtitle: _("Thoses are the speaker / headphone and microphone volume sliders")
        }
    ));
    main_group.add(create_switch(
        settings, "always-show-input-slider",
        {
            title: _("Always show microphone volume slider"),
            subtitle: _("Show even when there is no application recording audio")
        }
    ));
    main_group.add(create_dropdown(
        settings, "media-control",
        {
            title: _("Media controls"),
            subtitle: _("What should we do with media controls ?"),
            fields: [
                ["none", _("Leave as is")],
                ["move", _("Move into new panel")],
                ["duplicate", _("Duplicate into new panel")]
            ]
        }
    ));
    if(settings.get_strv("ordering").length != 4) {
        settings.set_strv("ordering", ["volume-output", "volume-input", "media", "mixer"]);
    }
    main_group.add(create_switch(
        settings, "create-mixer-sliders",
        {
            title: _("Create applications mixer"),
            subtitle: _("Thoses sliders are the same you can find in pavucontrol or in the sound settings")
        }
    ));

    const widgets_order_group = new ReorderablePreferencesGroup(settings, "ordering", {
        title: _("Elements order"),
        description: _("Reorder elements in the new panel, disabled elments will just be ignored")
    });
    widgets_order_group.add(new DraggableRow("volume-output", { title: _("Speaker / Headphone volume slider") }));
    widgets_order_group.add(new DraggableRow("volume-input", { title: _("Microphone volume slider") }));
    widgets_order_group.add(new DraggableRow("media", { title: _("Media controls") }));
    widgets_order_group.add(new DraggableRow("mixer", { title: _("Applications mixer") }));

    page.add(main_group);
    page.add(widgets_order_group);
    window.add(page);
}

function create_switch(settings, id, options) {
    const row = new Adw.ActionRow(options);

    const toggle = new Gtk.Switch({
        active: settings.get_boolean(id),
        valign: Gtk.Align.CENTER,
    });
    settings.bind(
        id,
        toggle,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );

    row.add_suffix(toggle);
    row.activatable_widget = toggle;

    return row;
}

function create_dropdown(settings, id, options) {
    const fields = options.fields;
    delete options.fields;

    const model = new Gtk.StringList({ strings: fields.map(x => x[1]) });
    const row = new Adw.ComboRow({
        model: model,
        selected: fields.map(x => x[0]).indexOf(settings.get_string(id)),
        ...options
    });

    row.connect('notify::selected', () => {
        settings.set_string(id, fields[row.selected][0]);
    })

    return row;
}

// From this point, the code is mostly a reimplementation of this:
// https://gitlab.gnome.org/GNOME/gnome-control-center/-/tree/main/panels/search

const ReorderablePreferencesGroup = GObject.registerClass(
    class ReorderablePreferencesGroup extends Adw.PreferencesGroup {
        constructor(settings, key, options) {
            super(options);
            this._settings = settings;
            this._key = key;

            this._list_box = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
            this._list_box.add_css_class("boxed-list");
            this._list_box.set_sort_func((a, b) => {
                const data = settings.get_strv(key);
                const index_a = data.indexOf(a.id);
                const index_b = data.indexOf(b.id);
                return index_a < index_b ? -1 : 1;
            });
            super.add(this._list_box);
        }

        add(row) {
            this._list_box.set_valign(Gtk.Align.FILL);
            row.connect("move-row", (source, target) => {
                this.selected_row = source;
                const data = this._settings.get_strv(this._key);
                const source_index = data.indexOf(source.id);
                const target_index = data.indexOf(target.id);
                if(target_index < source_index) {
                    data.splice(source_index, 1); // remove 1 element at source_index
                    data.splice(target_index, 0, source.id) // insert source.id at target_index
                } else {
                    data.splice(target_index + 1, 0, source.id) // insert source.id at target_index
                    data.splice(source_index, 1); // remove 1 element at source_index
                }
                this._settings.set_strv(this._key, data);
                this._list_box.invalidate_sort();
            })
            this._list_box.append(row);
        }
    }
);

class DraggableRowClass extends Adw.ActionRow {
        constructor(id, options) {
            super(options);

            this.id = id;

            const drag_handle = new Gtk.Image({ icon_name: "list-drag-handle-symbolic" });
            // css don't work
            drag_handle.add_css_class("drag-handle");
            this.add_prefix(drag_handle);

            const drag_source = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE });
            drag_source.connect("prepare", (source, x, y) => {
                this._drag_x = x;
                this._drag_y = y;
                return Gdk.ContentProvider.new_for_value(this);
            });
            drag_source.connect("drag-begin", (source, drag) => {
                this._drag_widget = new Gtk.ListBox();
                this._drag_widget.set_size_request(this.get_allocated_width(), this.get_allocated_height());

                const row_copy = new DraggableRow("", options);
                this._drag_widget.append(row_copy);
                this._drag_widget.drag_highlight_row(row_copy);

                Gtk.DragIcon.get_for_drag(drag).set_child(this._drag_widget);
                drag.set_hotspot(this._drag_x, this._drag_y);
            });
            this.add_controller(drag_source);

            const drop_target = Gtk.DropTarget.new(DraggableRow, Gdk.DragAction.MOVE);
            drop_target.preload = true;
            drop_target.connect("drop", (target, value, x, y) => {
                const source = value;
                source.emit("move-row", this);

                return true;
            });
            this.add_controller(drop_target);
        }
    }

const DraggableRow = GObject.registerClass({
    Signals: {
        flags: GObject.SignalFlags.RUN_LAST,
        "move-row": {
            param_types: [DraggableRowClass],
        }
    },
}, DraggableRowClass);