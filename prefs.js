"use strict";

import Adw from 'gi://Adw';
import GObject from 'gi://GObject';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import { get_settings, get_stack, rsplit, split } from './libs/libpanel/utils.js';

export default class QSAPPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        window.add(page);

        // ====================================== Main group ======================================
        const main_group = new Adw.PreferencesGroup();
        page.add(main_group);

        main_group.add(create_switch(
            settings, 'move-master-volume',
            {
                title: _("Move master volume sliders"),
                subtitle: _("Thoses are the speaker / headphone and microphone volume sliders")
            }
        ));
        main_group.add(create_switch(
            settings, 'always-show-input-slider',
            {
                title: _("Always show microphone volume slider"),
                subtitle: _("Show even when there is no application recording audio")
            }
        ));
        main_group.add(create_dropdown(
            settings, 'media-control',
            {
                title: _("Media controls"),
                subtitle: _("What should we do with media controls ?"),
                fields: [
                    ['none', _("Leave as is")],
                    ['move', _("Move into new panel")],
                    ['duplicate', _("Duplicate into new panel")]
                ]
            }
        ));
        if (settings.get_strv('ordering').length != 5) {
            settings.set_strv('ordering', ['volume-output', 'sink-mixer', 'volume-input', 'media', 'mixer']);
        }
        main_group.add(create_switch(
            settings, 'create-mixer-sliders',
            {
                title: _("Create applications mixer"),
                subtitle: _("Thoses sliders are the same you can find in pavucontrol or in the sound settings")
            }
        ));
        main_group.add(create_switch(
            settings, 'create-sink-mixer',
            {
                title: _("Create per-device volume sliders"),
            }
        ));
        main_group.add(create_switch(
            settings, 'remove-output-slider',
            {
                title: _("Remove the output slider"),
                subtitle: _("This is useful if you enabled the per-device volume sliders")
            }
        ));
        main_group.add(create_switch(
            settings, 'merge-panel',
            {
                title: _("Merge the new panel into the main one"),
                subtitle: _("The new panel will not be separated from the main one")
            }
        ));
        const position_dropdown = create_dropdown(
            settings, 'panel-position',
            {
                title: _("Panel position"),
                subtitle: _("Where the new panel should be located relative to the main panel"),
                fields: [
                    ['top', _("Top")],
                    ['bottom', _("Bottom")]
                ]
            }
        );
        settings.bind('merge-panel', position_dropdown, 'visible', Gio.SettingsBindFlags.GET);
        main_group.add(position_dropdown);

        // ================================= Widget ordering group ================================
        const widgets_order_group = new ReorderablePreferencesGroup(settings, 'ordering', {
            title: _("Elements order"),
            description: _("Reorder elements in the new panel (disabled elments will just be ignored)")
        });
        page.add(widgets_order_group);

        widgets_order_group.add(new DraggableRow('volume-output', { title: _("Speaker / Headphone volume slider") }));
        widgets_order_group.add(new DraggableRow('sink-mixer', { title: _("Per-device volume sliders") }));
        widgets_order_group.add(new DraggableRow('volume-input', { title: _("Microphone volume slider") }));
        widgets_order_group.add(new DraggableRow('media', { title: _("Media controls") }));
        widgets_order_group.add(new DraggableRow('mixer', { title: _("Applications mixer") }));

        // ================================== Mixer filter group ==================================
        const add_filter_button = new Gtk.Button({ icon_name: 'list-add', has_frame: false });
        const mixer_filter_group = new Adw.PreferencesGroup({
            title: _("Mixer filtering"),
            description: _("Allow you to filter the streams that show up in the application mixer **using regexes**"),
            header_suffix: add_filter_button
        });
        mixer_filter_group.add(create_dropdown(
            settings, 'filter-mode',
            {
                title: _("Filtering mode"),
                subtitle: _("On blacklist mode, matching elements are removed from the list. On whitelist mode, only matching elements will be shown"),
                fields: [
                    ['blacklist', _("Blacklist")],
                    ['whitelist', _("Whitelist")],
                ]
            }
        ));
        page.add(mixer_filter_group);

        const filters = [];
        const create_filter_row = (text) => {
            const new_row = new Adw.EntryRow({ 'title': _("Stream name") });
            if (text != undefined) new_row.text = text;

            const delete_button = new Gtk.Button({ icon_name: 'user-trash-symbolic', has_frame: false });
            delete_button.connect('clicked', () => {
                mixer_filter_group.remove(new_row);
                filters.splice(filters.indexOf(new_row), 1);
                save_filters(settings, filters);
            });
            new_row.add_suffix(delete_button);

            new_row.connect('changed', () => save_filters(settings, filters));

            filters.push(new_row);
            mixer_filter_group.add(new_row);
        };
        add_filter_button.connect('clicked', () => {
            create_filter_row();
        });

        for (const filter of settings.get_strv('filters')) {
            create_filter_row(filter);
        }

        // ================================ Sink mixer filter group ===============================
        const sink_add_filter_button = new Gtk.Button({ icon_name: 'list-add', has_frame: false });
        const sink_mixer_filter_group = new Adw.PreferencesGroup({
            title: _("Output sliders filtering"),
            description: _("Allow you to filter the per-device volume sliders. The content of the filters are regexes and are applied to the device's display name and pulseaudio name."),
            header_suffix: sink_add_filter_button
        });
        sink_mixer_filter_group.add(create_dropdown(
            settings, 'sink-filter-mode',
            {
                title: _("Filtering mode"),
                subtitle: _("On blacklist mode, matching elements are removed from the list. On whitelist mode, only matching elements will be shown"),
                fields: [
                    ['blacklist', _("Blacklist")],
                    ['whitelist', _("Whitelist")],
                ]
            }
        ));
        page.add(sink_mixer_filter_group);

        const sink_filters = [];
        const sink_create_filter_row = (text) => {
            const new_row = new Adw.EntryRow({ 'title': _("Device name") });
            if (text != undefined) new_row.text = text;

            const delete_button = new Gtk.Button({ icon_name: 'user-trash-symbolic', has_frame: false });
            delete_button.connect('clicked', () => {
                sink_mixer_filter_group.remove(new_row);
                sink_filters.splice(sink_filters.indexOf(new_row), 1);
                sink_save_filters(settings, sink_filters);
            });
            new_row.add_suffix(delete_button);

            new_row.connect('changed', () => sink_save_filters(settings, sink_filters));

            sink_filters.push(new_row);
            sink_mixer_filter_group.add(new_row);
        };
        sink_add_filter_button.connect('clicked', () => {
            sink_create_filter_row();
        });

        for (const filter of settings.get_strv('sink-filters')) {
            sink_create_filter_row(filter);
        }

        // ==================================== LibPanel group ====================================
        // we remove the 'file://' and the filename at the end
        const parent_folder = '/' + split(rsplit(get_stack()[0].file, '/', 1)[0], '/', 3)[3];
        const libpanel_settings = get_settings(`${parent_folder}/libs/libpanel/org.gnome.shell.extensions.libpanel.gschema.xml`);
        const libpanel_group = new Adw.PreferencesGroup({
            title: _("LibPanel settings"),
            description: _("Those settings are not specific to this extension, they apply to every panels"),
        });
        page.add(libpanel_group);

        libpanel_group.add(create_switch_spin(
            libpanel_settings, 'padding-enabled', 'padding',
            {
                title: _("Padding"),
                subtitle: _("Use this to override the default padding of the panels")
            }, 0, 100
        ));
        libpanel_group.add(create_switch_spin(
            libpanel_settings, 'row-spacing-enabled', 'row-spacing',
            {
                title: _("Row spacing"),
                subtitle: _("Use this to override the default row spacing of the panels")
            }, 0, 100
        ));
        libpanel_group.add(create_switch_spin(
            libpanel_settings, 'column-spacing-enabled', 'column-spacing',
            {
                title: _("Column spacing"),
                subtitle: _("Use this to override the default column spacing of the panels")
            }, 0, 100
        ));
    }
}


function create_switch(settings, id, options) {
    const row = new Adw.SwitchRow(options);
    settings.bind(
        id,
        row,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    return row;
}

function create_dropdown(settings, id, options) {
    const fields = options.fields;
    delete options.fields;

    const model = Gtk.StringList.new(fields.map(x => x[1]));
    const row = new Adw.ComboRow({
        model: model,
        selected: fields.map(x => x[0]).indexOf(settings.get_string(id)),
        ...options
    });

    row.connect('notify::selected', () => {
        settings.set_string(id, fields[row.selected][0]);
    });

    return row;
}

function create_switch_spin(settings, switch_id, spin_id, options, lower = 0, higher = 100) {
    const row = Adw.SpinRow.new_with_range(lower, higher, 1);
    row.title = options.title;
    row.subtitle = options.subtitle;

    const switch_ = new Gtk.Switch({ valign: Gtk.Align.CENTER });
    settings.bind(
        switch_id,
        switch_,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    row.add_prefix(switch_);
    row.activatable_widget = switch_;

    settings.bind(
        spin_id,
        row,
        'value',
        Gio.SettingsBindFlags.DEFAULT
    );

    return row;
}

function save_filters(settings, filters) {
    settings.set_strv('filters', filters.map(filter => filter.text));
}

function sink_save_filters(settings, filters) {
    settings.set_strv('sink-filters', filters.map(filter => filter.text));
}

// From this point onwards, the code is mostly a reimplementation of this:
// https://gitlab.gnome.org/GNOME/gnome-control-center/-/tree/main/panels/search

const ReorderablePreferencesGroup = GObject.registerClass(class extends Adw.PreferencesGroup {
    constructor(settings, key, options) {
        super(options);
        this._settings = settings;
        this._key = key;

        this._list_box = new Gtk.ListBox({ selection_mode: Gtk.SelectionMode.NONE });
        this._list_box.add_css_class('boxed-list');
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
        row.connect('move-row', (source, target) => {
            this.selected_row = source;
            const data = this._settings.get_strv(this._key);
            const source_index = data.indexOf(source.id);
            const target_index = data.indexOf(target.id);
            if (target_index < source_index) {
                data.splice(source_index, 1); // remove 1 element at source_index
                data.splice(target_index, 0, source.id); // insert source.id at target_index
            } else {
                data.splice(target_index + 1, 0, source.id); // insert source.id at target_index
                data.splice(source_index, 1); // remove 1 element at source_index
            }
            this._settings.set_strv(this._key, data);
            this._list_box.invalidate_sort();
        });
        this._list_box.append(row);
    }
});

class DraggableRowClass extends Adw.ActionRow {
    constructor(id, options) {
        super(options);

        this.id = id;

        const drag_handle = new Gtk.Image({ icon_name: 'list-drag-handle-symbolic' });
        // css don't work
        drag_handle.add_css_class('drag-handle');
        this.add_prefix(drag_handle);

        const drag_source = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE });
        drag_source.connect('prepare', (source, x, y) => {
            this._drag_x = x;
            this._drag_y = y;
            return Gdk.ContentProvider.new_for_value(this);
        });
        drag_source.connect('drag-begin', (source, drag) => {
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
        drop_target.connect('drop', (target, source, x, y) => {
            source.emit('move-row', this);

            return true;
        });
        this.add_controller(drop_target);
    }
}

const DraggableRow = GObject.registerClass({
    Signals: {
        flags: GObject.SignalFlags.RUN_LAST,
        'move-row': {
            param_types: [DraggableRowClass],
        }
    },
}, DraggableRowClass);
