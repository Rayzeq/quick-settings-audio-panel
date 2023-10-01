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

import Clutter from 'gi://Clutter';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { MediaSection } from 'resource:///org/gnome/shell/ui/mpris.js';

import { LibPanel, Panel } from './libs/libpanel/main.js';
import { ApplicationsMixer, waitProperty } from './libs/widgets.js';

const DateMenu = Main.panel.statusArea.dateMenu;
const QuickSettings = Main.panel.statusArea.quickSettings;

const CalendarMessageList = DateMenu._messageList;
const MediaSection_DateMenu = CalendarMessageList._mediaSection;

const SystemItem = QuickSettings._system._systemItem;
const InputVolumeIndicator = await waitProperty(QuickSettings, '_volumeInput');
// _volumeOutput is defined here because `./libs/widgets.js` wait on it
const OutputVolumeSlider = QuickSettings._volumeOutput._output;
const InputVolumeSlider = InputVolumeIndicator._input;


export default class QSAP extends Extension {
    enable() {
        this.settings = this.getSettings();

        this._scasis_callback = this.settings.connect(
            'changed::always-show-input-slider',
            () => this._set_always_show_input(this.settings.get_boolean('always-show-input-slider'))
        );
        this.settings.emit('changed::always-show-input-slider', 'always-show-input-slider');

        this._master_volumes = [];
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
            this._applications_mixer.destroy();
            this._applications_mixer = null;
        }

        if (this._media_section) {
            this._panel.removeItem(this._media_section);
            this._media_section = null;
        }
        if (MediaSection_DateMenu.has_style_class_name('QSAP-media-section')) {
            this._panel.removeItem(MediaSection_DateMenu);
            CalendarMessageList._sectionList.insert_child_at_index(MediaSection_DateMenu, 0);
            MediaSection_DateMenu.remove_style_class_name('QSAP-media-section');
        }

        this._master_volumes.reverse();
        for (const [slider, index] of this._master_volumes) {
            this._panel.removeItem(slider);
            LibPanel.main_panel.addItem(slider, 2);
            LibPanel.main_panel._grid.set_child_at_index(slider, index);
        }
        this._master_volumes = [];

        if (this._panel !== LibPanel.main_panel) {
            LibPanel.removePanel(this._panel); // prevent the panel's position being forgotten
            this._panel.destroy();
        };
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
        CalendarMessageList._sectionList.remove_child(MediaSection_DateMenu);

        this._panel.addItem(MediaSection_DateMenu, 2);
        this._panel._grid.set_child_at_index(MediaSection_DateMenu, index);

        MediaSection_DateMenu.add_style_class_name('QSAP-media-section');
    }

    _create_media_controls(index) {
        this._media_section = new MediaSection();
        this._media_section.add_style_class_name('QSAP-media-section');

        this._panel.addItem(this._media_section, 2);
        this._panel._grid.set_child_at_index(this._media_section, index);
    }

    _create_app_mixer(index, filter_mode, filters) {
        this._applications_mixer = new ApplicationsMixer(this._panel, index, filter_mode, filters);
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