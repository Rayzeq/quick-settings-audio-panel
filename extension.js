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
    }

    enable() {
        this.settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.quick-settings-audio-panel');
        const move_master_volume = this.settings.get_boolean("move-master-volume");
        const media_control_action = this.settings.get_string("media-control");
        const create_mixer_sliders = this.settings.get_boolean("create-mixer-sliders");
        const widgets_ordering = this.settings.get_strv("ordering");

        // By default, QuickSettingsBox is the visual box you see, and QuickSettingsGrid is an invisible layout widget.
        // This extension make so that QuickSettingsBox is invisible and QuickSettingsGrid is the visual box,
        // in that way we can add siblings to QuickSettingsGrid to make new panels
        this._qsb_backup_class = QuickSettingsBox.style_class;
        QuickSettingsBox.style_class = "";
        this._qsg_backup_class = QuickSettingsGrid.style_class;
        QuickSettingsGrid.style_class += " popup-menu-content quick-settings QSAP-panel";

        if(move_master_volume || media_control_action !== "none" || create_mixer_sliders) {
            this._panel = new QuickSettingsPanel();

            for(const widget of widgets_ordering) {
                if(widget === "volume" && move_master_volume) {
                    this._move_master_volume();
                } else if(widget === "media" && media_control_action === "move") {
                    this._move_media_controls();
                } else if(widget === "media" && media_control_action === "duplicate") {
                    this._create_media_controls();
                } else if(widget === "mixer" && create_mixer_sliders) {
                    this._create_app_mixer();
                }
            }

            QuickSettingsBox.add_child(this._panel);
        }
    }

    _move_master_volume() {
        this._master_volumes = [];
        for(const [index, quick_setting] of QuickSettingsGrid.get_children().entries()) {
            if(quick_setting.hasOwnProperty("_notifyVolumeChangeId")) {
                QuickSettingsGrid.remove_child(quick_setting);
                this._panel.add_child(quick_setting);
                this._master_volumes.push([quick_setting, index]);
            }
        }
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

    _create_app_mixer() {
        this._applications_mixer = new ApplicationsMixer();
        this._panel.add_child(this._applications_mixer.actor);
    }

    disable() {
        if(this._applications_mixer) {
            this._applications_mixer.destroy();
            this._applications_mixer = null;
        }
        if(this._media_section) {
            this._panel.remove_child(this._media_section);
            this._media_section = null;
        }
        if(this._dmmc_backup_class) {
            this._panel.remove_child(DateMenuMediaControl);
            DateMenuMediaControlHolder.insert_child_at_index(DateMenuMediaControl, 0);

            DateMenuMediaControl.style_class = this._dmmc_backup_class;
            this._dmmc_backup_class = null;
        }
        for(const [slider, index] of this._master_volumes) {
            this._panel.remove_child(slider);
            QuickSettingsGrid.insert_child_at_index(slider, index);
        }
        if(this._panel) {
            this._panel.destroy();
            this._panel = null;
        }
        if(this._qsb_backup_class) {
            QuickSettingsBox.style_class = this._qsb_backup_class;
            this._qsb_backup_class = null;
        }
        if(this._qsg_backup_class) {
            QuickSettingsGrid.style_class = this._qsg_backup_class;
            this._qsg_backup_class = null;
        }
    }
}

function init() {
    ExtensionUtils.initTranslations(Self.metadata.uuid);

    return new Extension();
}
