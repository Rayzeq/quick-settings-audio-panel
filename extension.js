/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

const { GObject, Clutter, St } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Gettext = imports.gettext;

const Self = ExtensionUtils.getCurrentExtension();
const Domain = Gettext.domain(Self.metadata.uuid);
const _ = Domain.gettext;
const ngettext = Domain.ngettext;

const Main = imports.ui.main;

const QuickSettings = Main.panel.statusArea.quickSettings;
const QuickSettingsBox = QuickSettings.menu.box;
const QuickSettingsGrid = QuickSettings.menu._grid;

const DateMenu = Main.panel.statusArea.dateMenu;
const DateMenuBox = DateMenu.menu.box;
const DateMenuHolder = DateMenu.menu.box.first_child.first_child;
const DateMenuNotifications = DateMenuHolder.get_children().find(item => item.constructor.name === "CalendarMessageList");
const DateMenuMediaControlHolder = DateMenuNotifications.last_child.first_child.last_child;
const DateMenuMediaControl = DateMenuMediaControlHolder.first_child;

const OutputVolumeSlider = QuickSettings._volume._output;
const InputVolumeSlider = QuickSettings._volume._input;
const InputVolumeIndicator = QuickSettings._volume._inputIndicator;

const { QuickSettingsPanel, ApplicationsMixer } = Self.imports.libs.widgets;
const { LibPanel, Panel, PanelGroup } = Self.imports.libs.libpanel.main;

// QuickSettingsMenu.actor (QuickSettings.menu.actor / StWidget.panel-menu)
// ├─ Gjs_Boxpointer
// │  ├─ StDrawingArea
// │  └─ StBin
// │     └─ QuickSettingsMenu.box (StBoxLayout)
// │        ├─ QuickSettingsMenu._grid (StWidget.quick-settings-grid)
// │        │  ╠═ layout_manager: QuickSettingsLayout
// │        │  └─ Items of the panel
// │        └─ this._panel (QuickSettingsPanel)
// └─ QuickSettingsMenu._overlay / QuickSettingsLayout._overlay (ClutterActor)
//    └─ Popups from quick settings

class Extension {
    constructor() {
        this._qsb_backup_class = null;
        this._qsg_backup_class = null;
        this._panel = null;
        this._master_volumes = [];
        this._dmmc_backup_class = null;
        this._media_section = null;
        this._applications_mixer = null;
        this._qsglm_backup_ncolumns = null;
        this._qsglm_backup_header_colspan = null;
        this._qsb_backup_vertical = null;
        this._ivssa_callback = null;
        this._ivssr_callback = null;
        this._qsphc_backup = null;
    }

    enable() {
        // Main.panel.statusArea.quickSettings.menu._grid.get_children()[9].visible
        /*this._menu_backup = QuickSettings.menu;
        QuickSettings._menu_backup = this._menu_backup; // for lg access: m=Main.panel.statusArea.quickSettings.menu
        QuickSettings.menu = null; // prevent old menu from being destroyed
        Main.panel.menuManager.removeMenu(this._menu_backup);

        QuickSettings.setMenu(grid);

        QuickSettings.setMenu(this._menu_backup)
        Main.panel.menuManager.addMenu(this._menu_backup);*/

        LibPanel.enable("quick-settings-audio-panel");

        const panel = new Panel('test-1', 2);

        /*const a = QuickSettingsGrid.get_children()[1];
        const b = QuickSettingsGrid.get_children()[5];
        const c = QuickSettingsGrid.get_children()[6];
        a.get_parent().remove_child(a);
        b.get_parent().remove_child(b);
        c.get_parent().remove_child(c);
        panel.addItem(a, 2);
        panel.addItem(b);
        panel.addItem(c);*/

        const label = St.Label.new("0, 0 aaa");
        label.style_class = "quick-settings-system-item";
        panel.addItem(label);

        const panel2 = new Panel('test-2', 2);
        const label1 = St.Label.new("dfhfdkjgfkfyyu");
        label1.style_class = "quick-settings-system-item";
        panel2.addItem(label1);
        const label2 = St.Label.new("dfhfdkjgfkfyyu");
        label2.style_class = "quick-settings-system-item";
        panel2.addItem(label2);
        const label3 = St.Label.new("dfhfdkjgfkfyyu");
        label3.style_class = "quick-settings-system-item";
        panel2.addItem(label3);
        const label4 = St.Label.new("dfhfdkjgfkfyyu");
        label4.style_class = "quick-settings-system-item";
        panel2.addItem(label4);
        const label5 = St.Label.new("dfhfdkjgfkfyyu");
        label5.style_class = "quick-settings-system-item";
        panel2.addItem(label5);
        const label6 = St.Label.new("dfhfdkjgfkfyyu");
        label6.style_class = "quick-settings-system-item";
        panel2.addItem(label6);
        const label7 = St.Label.new("dfhfdkjgfkfyyu");
        label7.style_class = "quick-settings-system-item";
        panel2.addItem(label7);
        const label8 = St.Label.new("dfhfdkjgfkfyyu\ngfdgggerg_ ge\nefgergerger\negregerge\nefezdf\nsfregte");
        label8.style_class = "quick-settings-system-item";
        panel2.addItem(label8);
        const button = new imports.ui.quickSettings.QuickToggle({ title: "aaaaaaaaa" });
        panel2.addItem(button);
        const label9 = St.Label.new("dfhfdkjgfkfyyu\ngfdgggerg_ ge\nefgergerger\negregerge\nefezdf\nsfregte");
        label9.style_class = "quick-settings-system-item";
        panel2.addItem(label9);
        const label10 = St.Label.new("dfhfdkjgfkfyyu\ngfdgggerg_ ge\nefgergerger\negregerge\nefezdf\nsfregte");
        label10.style_class = "quick-settings-system-item";
        panel2.addItem(label10);

        LibPanel.addPanel(panel2);
        LibPanel.addPanel(new PanelGroup('test-group', { panels: [panel] }));

        /*Main.layoutManager.disconnectObject(Main.panel.statusArea.quickSettings._menu_backup)
        const [_, signal_id, signal_detail] = GObject.signal_parse_name('system-modal-opened', Main.layoutManager.constructor.$gtype, false);
        GObject.signal_handlers_block_matched(Main.layoutManager, { data: Main.panel.statusArea.quickSettings._menu_backup, detail: signal_detail, signal_id: signal_id })
        for(const signal of GObject.signal_list_ids(Main.layoutManager)) {
            log(GObject.signal_query(signal))
            GObject.signal_handler_block(Main.layoutManager, signal)
        }*/

        //Main.uiGroup.remove_child(Main.panel.statusArea.quickSettings._menu_backup)
        //https://gitlab.freedesktop.org/pipewire/pipewire/-/wikis/Virtual-devices?version_id=2366658e8c18457f3dc400b14f46789cba2eddcc#create-a-sink
        /*this.settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.quick-settings-audio-panel');
        const move_master_volume = this.settings.get_boolean("move-master-volume");
        const always_show_input = this.settings.get_boolean("always-show-input-slider");
        const media_control_action = this.settings.get_string("media-control");
        const create_mixer_sliders = this.settings.get_boolean("create-mixer-sliders");
        const merge_panel = this.settings.get_boolean("merge-panel");
        const panel_position = this.settings.get_string("panel-position");
        const fix_popups = this.settings.get_boolean("fix-popups");
        const widgets_ordering = this.settings.get_strv("ordering");

        if (!merge_panel) {
            // By default, QuickSettingsBox is the visual box you see, and QuickSettingsGrid is an invisible layout widget.
            // This extension make so that QuickSettingsBox is invisible and QuickSettingsGrid is the visual box,
            // in that way we can add siblings to QuickSettingsGrid to make new panels
            this._qsb_backup_class = QuickSettingsBox.style_class;
            QuickSettingsBox.style_class = "";
            this._qsg_backup_class = QuickSettingsGrid.style_class;
            QuickSettingsGrid.style_class += " popup-menu-content quick-settings QSAP-panel-separated";
        }

        if (move_master_volume || media_control_action !== "none" || create_mixer_sliders) {
            this._panel = new QuickSettingsPanel(QuickSettings.menu.sourceActor, !merge_panel, 2);

            if (merge_panel) {
                if (panel_position === "left" || panel_position === "right") {
                    this._qsglm_backup_ncolumns = QuickSettingsGrid.layout_manager.n_columns;
                    QuickSettingsGrid.layout_manager.n_columns = 4;

                    // Why getting a property is so complicated ??
                    const value = new GObject.Value();
                    QuickSettingsGrid.layout_manager.child_get_property(QuickSettingsGrid, QuickSettingsGrid.get_children()[1], 'column-span', value);
                    this._qsglm_backup_header_colspan = value.get_int();
                    value.unset();
                    // Make the 'header' take all the width
                    QuickSettingsGrid.layout_manager.child_set_property(QuickSettingsGrid, QuickSettingsGrid.get_children()[1], 'column-span', 4);
                }
                if (panel_position === "left" || panel_position === "top") {
                    QuickSettingsGrid.insert_child_at_index(this._panel.actor, 2);
                } else {
                    QuickSettingsGrid.add_child(this._panel.actor);
                }
                QuickSettingsGrid.layout_manager.child_set_property(QuickSettingsGrid, this._panel.actor, 'column-span', 2);
            } else {
                if (panel_position === "left" || panel_position === "right") {
                    this._qsb_backup_vertical = QuickSettingsBox.vertical;
                    QuickSettingsBox.vertical = false;
                    this._panel.actor.width = QuickSettingsBox.get_children()[0].width;
                }
                if (panel_position === "left" || panel_position === "top") {
                    QuickSettingsBox.insert_child_at_index(this._panel.actor, 0);
                } else {
                    QuickSettings.menu.actor.add_child(this._panel.actor);
                }
            }

            for (const widget of widgets_ordering) {
                if (widget === "volume-output" && move_master_volume) {
                    this._move_slider(OutputVolumeSlider);
                } else if (widget === "volume-input" && move_master_volume) {
                    this._move_slider(InputVolumeSlider);
                } else if (widget === "media" && media_control_action === "move") {
                    this._move_media_controls();
                } else if (widget === "media" && media_control_action === "duplicate") {
                    this._create_media_controls();
                } else if (widget === "mixer" && create_mixer_sliders) {
                    this._create_app_mixer();
                }
            }
        }

        if (always_show_input) {
            this._ivssa_callback = InputVolumeSlider._control.connect("stream-added", () => {
                InputVolumeSlider.visible = true;
                InputVolumeIndicator.visible = InputVolumeSlider._shouldBeVisible();
            });
            this._ivssr_callback = InputVolumeSlider._control.connect("stream-removed", () => {
                InputVolumeSlider.visible = true;
                InputVolumeIndicator.visible = InputVolumeSlider._shouldBeVisible();
            });
            InputVolumeSlider.visible = true;
            InputVolumeIndicator.visible = InputVolumeSlider._shouldBeVisible();
        }

        if (fix_popups) {
            const placeholder = QuickSettings.menu._grid.layout_manager._overlay;
            this._qsphc_backup = placeholder.get_constraints()[0];
            placeholder.remove_constraint(this._qsphc_backup);
        }*/
    }

    _move_slider(slider) {
        const parent = slider.get_parent();
        const index = parent.get_children().indexOf(slider);

        const menu = slider.menu.actor;
        const menu_parent = menu.get_parent();

        parent.remove_child(slider);
        menu_parent.remove_child(menu);
        this._panel.addItem(slider, 2);

        // Move menu to change input / output
        const menu_constraint = slider.menu.actor.get_constraints()[0];
        slider.menu.actor.remove_constraint(menu_constraint);

        const new_constraint = new Clutter.BindConstraint({
            coordinate: Clutter.BindCoordinate.Y,
            source: slider,
        });
        const callback = this._panel.connect(
            'notify::allocation',
            () => { new_constraint.offset = this._panel.allocation.y1 + slider.height; }
        );
        slider.bind_property_full(
            'height',
            new_constraint, 'offset',
            GObject.BindingFlags.SYNC_CREATE,
            (binding, value) => {
                return [true, this._panel.allocation.y1 + value];
            }, null
        );
        slider.menu.actor.add_constraint(new_constraint);

        this._master_volumes.push([slider, index, parent, menu_constraint, new_constraint, callback]);
    }

    _move_media_controls() {
        DateMenuMediaControlHolder.remove_child(DateMenuMediaControl);
        this._panel.addItem(DateMenuMediaControl, 2);
        this._dmmc_backup_class = DateMenuMediaControl.style_class;
        DateMenuMediaControl.style_class += " QSAP-media-section";
    }

    _create_media_controls() {
        const datemenu_widget = new imports.ui.dateMenu.DateMenuButton();

        this._media_section = datemenu_widget._messageList._mediaSection;
        this._media_section.get_parent().remove_child(this._media_section);
        this._media_section.style_class += " QSAP-media-section";
        this._panel.addItem(this._media_section, 2);

        datemenu_widget.destroy();
    }

    _create_app_mixer() {
        this._applications_mixer = new ApplicationsMixer();
        this._panel.addItem(this._applications_mixer.actor, 2);
    }

    disable() {
        LibPanel.disable("quick-settings-audio-panel");
        if (this._qsphc_backup) {
            QuickSettings.menu._grid.layout_manager._overlay.add_constraint(this._qsphc_backup);
            this._qsphc_backup = null;
        }
        if (this._ivssr_callback) {
            InputVolumeSlider.disconnect(this._ivssr_callback);
            this._ivssr_callback = null;
        }
        if (this._ivssa_callback) {
            InputVolumeSlider.disconnect(this._ivssa_callback);
            this._ivssa_callback = null;
        }
        InputVolumeSlider.visible = InputVolumeSlider._shouldBeVisible();
        InputVolumeIndicator.visible = InputVolumeSlider._shouldBeVisible();

        if (this._qsb_backup_vertical) {
            QuickSettingsBox.vertical = this._qsb_backup_vertical;
            this._qsb_backup_vertical = null;
        }
        if (this._qsglm_backup_header_colspan) {
            QuickSettingsGrid.layout_manager.child_set_property(QuickSettingsGrid, QuickSettingsGrid.get_children()[1], 'column-span', this._qsglm_backup_header_colspan);
            this._qsglm_backup_header_colspan = null;
        }
        if (this._qsglm_backup_ncolumns) {
            QuickSettingsGrid.layout_manager.n_columns = this._qsglm_backup_ncolumns;
            this._qsglm_backup_ncolumns = null;
        }

        if (this._applications_mixer) {
            // Needs explicit destroy because it's `this._applications_mixer.actor` which is added to `self._panel`
            // and not directly `this._applications_mixer`
            this._applications_mixer.destroy();
            this._applications_mixer = null;
        }

        this._media_section = null;
        if (this._dmmc_backup_class && this._panel) {
            this._panel.remove_child(DateMenuMediaControl);
            DateMenuMediaControlHolder.insert_child_at_index(DateMenuMediaControl, 0);

            DateMenuMediaControl.style_class = this._dmmc_backup_class;
            this._dmmc_backup_class = null;
        }

        this._master_volumes.reverse();
        for (const [slider, index, parent, backup_constraint, current_constraint, callback] of this._master_volumes) {
            this._panel.remove_child(slider);
            parent.insert_child_at_index(slider, index);

            slider.menu.actor.remove_constraint(current_constraint);
            slider.menu.actor.add_constraint(backup_constraint);
            this._panel.disconnect(callback);
        }
        this._master_volumes = [];

        if (this._panel) {
            this._panel.destroy();
            this._panel = null;
        }
        if (this._qsb_backup_class) {
            QuickSettingsBox.style_class = this._qsb_backup_class;
            this._qsb_backup_class = null;
        }
        if (this._qsg_backup_class) {
            QuickSettingsGrid.style_class = this._qsg_backup_class;
            this._qsg_backup_class = null;
        }
        this.settings = null;
    }
}

function init() {
    ExtensionUtils.initTranslations(Self.metadata.uuid);

    return new Extension();
}
