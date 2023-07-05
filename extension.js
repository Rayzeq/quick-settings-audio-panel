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
const { MediaSection } = imports.ui.mpris;

const QuickSettings = Main.panel.statusArea.quickSettings;
const QuickSettingsBox = QuickSettings.menu.box;
const QuickSettingsGrid = QuickSettings.menu._grid;

const DateMenu = Main.panel.statusArea.dateMenu;
const DateMenuBox = DateMenu.menu.box;
const DateMenuHolder = DateMenu.menu.box.first_child.first_child;
const DateMenuNotifications = DateMenuHolder.get_children().find(item => item.constructor.name === 'CalendarMessageList');
const DateMenuMediaControlHolder = DateMenuNotifications.last_child.first_child.last_child;
const DateMenuMediaControl = DateMenuMediaControlHolder.first_child;

const SystemItem = QuickSettings._system._systemItem;
const OutputVolumeSlider = QuickSettings._volume._output;
const InputVolumeSlider = QuickSettings._volume._input;
const InputVolumeIndicator = QuickSettings._volume._inputIndicator;

const { QuickSettingsPanel, ApplicationsMixer } = Self.imports.libs.widgets;
const { LibPanel, Panel } = Self.imports.libs.libpanel.main;


class Extension {
    constructor() {
        this._ivssa_callback = null;
        this._ivssr_callback = null;

        this._panel = null;
        this._master_volumes = [];
        this._media_section = null;
        this._applications_mixer = null;
    }

    enable() {
        this.settings = ExtensionUtils.getSettings();

        this._scasis_callback = this.settings.connect(
            'changed::always-show-input-slider',
            () => this._set_always_show_input(this.settings.get_boolean('always-show-input-slider'))
        );
        this.settings.emit('changed::always-show-input-slider', 'always-show-input-slider');

        this._sc_callback = this.settings.connect('changed', () => this._refresh_panel());
        this._refresh_panel();
    }

    disable() {
        this.settings.disconnect(this._scasis_callback);
        this.settings.disconnect(this._sc_callback);

        this._set_always_show_input(false);
        this._cleanup_panel();

        this.settings = null;
    }

    _refresh_panel() {
        this._cleanup_panel();

        const move_master_volume = this.settings.get_boolean('move-master-volume');
        const media_control_action = this.settings.get_string('media-control');
        const create_mixer_sliders = this.settings.get_boolean('create-mixer-sliders');
        const merge_panel = this.settings.get_boolean('merge-panel');
        const panel_position = this.settings.get_string("panel-position");
        const widgets_ordering = this.settings.get_strv('ordering');

        const filter_mode = this.settings.get_string('filter-mode');
        const filters = this.settings.get_strv('filters');

        if (move_master_volume || media_control_action !== 'none' || create_mixer_sliders) {
            LibPanel.enable();

            this._panel = LibPanel.main_panel;
            let index = -1;

            if (!merge_panel) {
                this._panel = new Panel('main');
                // Since the panel contains no element that have a minimal width (like QuickToggle)
                // we need to force it to take the same with as a normal panel
                this._panel.add_constraint(new Clutter.BindConstraint({
                    coordinate: Clutter.BindCoordinate.WIDTH,
                    source: LibPanel.main_panel,
                }));

                LibPanel.addPanel(this._panel);

            }
            if (merge_panel && panel_position === 'top') {
                widgets_ordering.reverse();
                index = this._panel.getItems().indexOf(SystemItem) + 2;
            }

            for (const widget of widgets_ordering) {
                if (widget === 'volume-output' && move_master_volume) {
                    this._move_slider(index, OutputVolumeSlider);
                } else if (widget === 'volume-input' && move_master_volume) {
                    this._move_slider(index, InputVolumeSlider);
                } else if (widget === 'media' && media_control_action === 'move') {
                    this._move_media_controls(index);
                } else if (widget === 'media' && media_control_action === 'duplicate') {
                    this._create_media_controls(index);
                } else if (widget === 'mixer' && create_mixer_sliders) {
                    this._create_app_mixer(index, filter_mode, filters);
                }
            }
        }
    }

    _cleanup_panel() {
        if (!this._panel) return;

        if (this._applications_mixer) {
            // Needs explicit destroy because it's `this._applications_mixer.actor` which is added to `self._panel`
            // and not directly `this._applications_mixer`
            this._panel.removeItem(this._applications_mixer.actor);
            this._applications_mixer.destroy();
            this._applications_mixer = null;
        }

        if (this._media_section) {
            this._panel.removeItem(this._media_section);
            this._media_section = null;
        }
        if (DateMenuMediaControl.has_style_class_name('QSAP-media-section')) {
            this._panel.removeItem(DateMenuMediaControl);
            DateMenuMediaControlHolder.insert_child_at_index(DateMenuMediaControl, 0);
            DateMenuMediaControl.remove_style_class_name('QSAP-media-section');
        }

        this._master_volumes.reverse();
        for (const [slider, index] of this._master_volumes) {
            this._panel.removeItem(slider);
            LibPanel.main_panel.addItem(slider, 2);
            LibPanel.main_panel._grid.set_child_at_index(slider, index);
        }
        this._master_volumes = [];

        if (this._panel !== LibPanel.main_panel) this._panel.destroy();
        this._panel = null;

        LibPanel.disable();
    }

    _move_slider(index, slider) {
        const old_index = slider.get_parent().get_children().indexOf(slider);

        LibPanel.main_panel.removeItem(slider);
        this._panel.addItem(slider, 2);
        this._panel._grid.set_child_at_index(slider, index);

        this._master_volumes.push([slider, old_index]);
    }

    _move_media_controls(index) {
        DateMenuMediaControlHolder.remove_child(DateMenuMediaControl);
        this._panel.addItem(DateMenuMediaControl, 2);
        this._panel._grid.set_child_at_index(DateMenuMediaControl, index);
        DateMenuMediaControl.add_style_class_name('QSAP-media-section');
    }

    _create_media_controls(index) {
        this._media_section = new MediaSection();
        this._media_section.style_class += " QSAP-media-section";
        this._panel.addItem(this._media_section, 2);
        this._panel._grid.set_child_at_index(this._media_section, index);
    }

    _create_app_mixer(index, filter_mode, filters) {
        this._applications_mixer = new ApplicationsMixer(filter_mode, filters);
        this._panel.addItem(this._applications_mixer.actor, 2);
        this._panel._grid.set_child_at_index(this._applications_mixer.actor, index);
    }

    _set_always_show_input(enabled) {
        if (enabled) {
            this._ivssa_callback = InputVolumeSlider._control.connect('stream-added', () => {
                InputVolumeSlider.visible = true;
                InputVolumeIndicator.visible = InputVolumeSlider._shouldBeVisible();
            });
            this._ivssr_callback = InputVolumeSlider._control.connect('stream-removed', () => {
                InputVolumeSlider.visible = true;
                InputVolumeIndicator.visible = InputVolumeSlider._shouldBeVisible();
            });
            InputVolumeSlider.visible = true;
            InputVolumeIndicator.visible = InputVolumeSlider._shouldBeVisible();
        } else {
            if (this._ivssr_callback) InputVolumeSlider._control.disconnect(this._ivssr_callback);
            if (this._ivssa_callback) InputVolumeSlider._control.disconnect(this._ivssa_callback);
            this._ivssr_callback = null;
            this._ivssa_callback = null;
            InputVolumeSlider.visible = InputVolumeSlider._shouldBeVisible();
            InputVolumeIndicator.visible = InputVolumeSlider._shouldBeVisible();
        }
    }
}

function init() {
    ExtensionUtils.initTranslations(Self.metadata.uuid);

    return new Extension();
}
