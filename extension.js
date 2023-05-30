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

const { GObject, Clutter } = imports.gi;
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

const OutputVolumeSlider = imports.ui.main.panel.statusArea.quickSettings._volume._output;
const InputVolumeSlider = imports.ui.main.panel.statusArea.quickSettings._volume._input;
const InputVolumeIndicator = imports.ui.main.panel.statusArea.quickSettings._volume._inputIndicator;

const { QuickSettingsPanel, ApplicationsMixer } = Self.imports.libs.widgets;

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
        this.settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.quick-settings-audio-panel');
        const move_master_volume = this.settings.get_boolean("move-master-volume");
        const always_show_input = this.settings.get_boolean("always-show-input-slider");
        const media_control_action = this.settings.get_string("media-control");
        const create_mixer_sliders = this.settings.get_boolean("create-mixer-sliders");
        const merge_panel = this.settings.get_boolean("merge-panel");
        const panel_position = this.settings.get_string("panel-position");
        const fix_popups = this.settings.get_boolean("fix-popups");
        const widgets_ordering = this.settings.get_strv("ordering");

        const filter_mode = this.settings.get_string("filter-mode");
        const filters = this.settings.get_strv("filters");

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
            this._panel = new QuickSettingsPanel({ separated: !merge_panel });

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
                    QuickSettingsGrid.insert_child_at_index(this._panel, 2);
                } else {
                    QuickSettingsGrid.add_child(this._panel);
                }
                QuickSettingsGrid.layout_manager.child_set_property(QuickSettingsGrid, this._panel, 'column-span', 2);
            } else {
                if (panel_position === "left" || panel_position === "right") {
                    this._qsb_backup_vertical = QuickSettingsBox.vertical;
                    QuickSettingsBox.vertical = false;
                    this._panel.width = QuickSettingsBox.get_children()[0].width;
                }
                if (panel_position === "left" || panel_position === "top") {
                    QuickSettingsBox.insert_child_at_index(this._panel, 0);
                } else {
                    QuickSettingsBox.add_child(this._panel);
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
                    this._create_app_mixer(filter_mode, filters);
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
        }
    }

    _move_slider(slider) {
        const parent = slider.get_parent();
        const index = parent.get_children().indexOf(slider);

        parent.remove_child(slider);
        this._panel.add_child(slider);

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
        const constraint_binding = slider.bind_property_full(
            'height',
            new_constraint, 'offset',
            GObject.BindingFlags.SYNC_CREATE,
            (binding, value) => {
                return [true, this._panel.allocation.y1 + value];
            }, null
        );
        slider.menu.actor.add_constraint(new_constraint);

        this._master_volumes.push([slider, index, parent, menu_constraint, new_constraint, constraint_binding, callback]);
    }

    _move_media_controls() {
        DateMenuMediaControlHolder.remove_child(DateMenuMediaControl);
        this._panel.add_child(DateMenuMediaControl);
        this._dmmc_backup_class = DateMenuMediaControl.style_class;
        DateMenuMediaControl.style_class += " QSAP-media-section";
    }

    _create_media_controls() {
        const datemenu_widget = new imports.ui.dateMenu.DateMenuButton();

        this._media_section = datemenu_widget._messageList._mediaSection;
        this._media_section.get_parent().remove_child(this._media_section);
        this._media_section.style_class += " QSAP-media-section";
        this._panel.add_child(this._media_section);

        datemenu_widget.destroy();
    }

    _create_app_mixer(filter_mode, filters) {
        this._applications_mixer = new ApplicationsMixer(filter_mode, filters);
        this._panel.add_child(this._applications_mixer.actor);
    }

    disable() {
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
        for (const [slider, index, parent, backup_constraint, current_constraint, constraint_binding, callback] of this._master_volumes) {
            this._panel.remove_child(slider);
            parent.insert_child_at_index(slider, index);

            constraint_binding.unbind();
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
