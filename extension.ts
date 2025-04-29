/* extension.js
 *
 * Copyright (C) 2024 Zacharie DUBRULLE
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of
 * the GNU General Public License as published by the Free Software Foundation, either version 3
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY;
 * without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with this program.
 * If not, see <https://www.gnu.org/licenses/>. 
 */

import Clutter from 'gi://Clutter';
import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gvc from 'gi://Gvc';
import St from 'gi://St';

import { gettext as _, Extension, InjectionManager } from 'resource:///org/gnome/shell/extensions/extension.js';
import { type Console } from "resource:///org/gnome/shell/extensions/sharedInternals.js";
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import { QuickSettingsMenu } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import { LibPanel, Panel } from './libs/libpanel/main.js';
import { update_settings } from './libs/preferences.js';
import { cleanup_idle_ids, get_pactl_path, spawn, wait_property } from './libs/utils.js';
import { ApplicationsMixer, ApplicationsMixerToggle, AudioProfileSwitcher, BalanceSlider, MprisList, SinkMixer } from './libs/widgets.js';

const DateMenu = Main.panel.statusArea.dateMenu;
const QuickSettings = Main.panel.statusArea.quickSettings;

const CalendarMessageList = DateMenu._messageList;
const MessageView_DateMenu = CalendarMessageList._messageView;

const SystemItem = QuickSettings._system._systemItem;
// _volumeOutput is always defined here because `./libs/widgets.js` wait on it
const OutputVolumeSlider = QuickSettings._volumeOutput._output;

export default class QSAP extends Extension {
    settings!: Gio.Settings;

    async enable() {
        this.InputVolumeIndicator = await wait_property(QuickSettings, '_volumeInput');
        this.InputVolumeSlider = this.InputVolumeIndicator._input;

        this.settings = this.getSettings();
        update_settings(this.settings);

        this._extension_controller = new ExtensionController(this.settings, this.getLogger(), this.InputVolumeIndicator);

        this._scscd_callback = this.settings.connect(
            'changed::master-volume-sliders-show-current-device',
            () => {
                if (this.settings.get_boolean('master-volume-sliders-show-current-device')) {
                    this._patch_show_current_device(OutputVolumeSlider);
                    this._patch_show_current_device(this.InputVolumeSlider);

                } else {
                    this._unpatch_show_current_device(OutputVolumeSlider);
                    this._unpatch_show_current_device(this.InputVolumeSlider);
                }
            }
        );
        this.settings.emit('changed::master-volume-sliders-show-current-device', 'master-volume-sliders-show-current-device');

        this._scabaortd_callback = this.settings.connect(
            'changed::add-button-applications-output-reset-to-default',
            () => {
                if (this.settings.get_boolean('add-button-applications-output-reset-to-default')) {
                    this._add_reset_applications_output();
                } else {
                    this._remove_reset_applications_output();
                }
            }
        );
        this.settings.emit('changed::add-button-applications-output-reset-to-default', 'add-button-applications-output-reset-to-default');

        this._master_volumes = [];
        this._sc_callback = this.settings.connect('changed', (_, name) => {
            if (
                name !== "autohide-profile-switcher" &&
                name !== "ignore-virtual-capture-streams" &&
                name !== "always-show-input-volume-slider"
            ) {
                this._refresh_panel();
            }
        });
        this._refresh_panel();
    }

    disable() {
        this.settings.disconnect(this._scscd_callback);
        this._unpatch_show_current_device(OutputVolumeSlider);
        this._unpatch_show_current_device(this.InputVolumeSlider);

        this.settings.disconnect(this._scabaortd_callback);
        this._remove_reset_applications_output();

        this.settings.disconnect(this._sc_callback);
        cleanup_idle_ids();

        this._cleanup_panel();

        this._extension_controller.destroy();
        this._extension_controller = undefined;

        this.settings = null;
    }

    _refresh_panel() {
        this._cleanup_panel();

        const panel_type = this.settings.get_string("panel-type");
        const merged_panel_position = this.settings.get_string("merged-panel-position");

        const remove_output_volume_slider = this.settings.get_boolean("remove-output-volume-slider");

        const move_output_volume_slider = this.settings.get_boolean('move-output-volume-slider');
        const move_input_volume_slider = this.settings.get_boolean('move-input-volume-slider');
        const create_mpris_controllers = this.settings.get_boolean("create-mpris-controllers");

        const create_applications_volume_sliders = this.settings.get_boolean('create-applications-volume-sliders');
        const create_perdevice_volume_sliders = this.settings.get_boolean('create-perdevice-volume-sliders');
        const create_balance_slider = this.settings.get_boolean('create-balance-slider');
        const create_profile_switcher = this.settings.get_boolean('create-profile-switcher');
        const widgets_order = this.settings.get_strv('widgets-order');

        if (move_output_volume_slider || move_input_volume_slider || create_mpris_controllers || create_applications_volume_sliders || create_perdevice_volume_sliders || remove_output_volume_slider || create_balance_slider || create_profile_switcher) {
            if (panel_type === "independent-panel")
                LibPanel.enable();

            this._panel = LibPanel.main_panel;
            let index = -1;

            if (panel_type === "separate-indicator") {
                this._indicator = new PanelMenu.Button(0.0, "Audio panel", true);
                this._indicator.add_child(new St.Icon({ style_class: 'system-status-icon', icon_name: 'audio-x-generic-symbolic' }));

                this._panel = new QuickSettingsMenu(this._indicator, 2);
                // Since the panel contains no element that have a minimal width (like QuickToggle)
                // we need to force it to take the same with as a normal panel
                this._panel.box.add_constraint(new Clutter.BindConstraint({
                    coordinate: Clutter.BindCoordinate.WIDTH,
                    source: LibPanel.main_panel._boxPointer || LibPanel.main_panel,
                }));

                // Hide the indicator when empty
                const update_visibility = () => {
                    for (const child of this._panel._grid.get_children()) {
                        if (child != this._panel._grid.layout_manager._overlay && child.visible) {
                            this._indicator.show();
                            return;
                        }
                    }
                    this._indicator.hide();
                }
                this._panel._grid.connect("child-added", (_self, child) => {
                    child._qsap_vis_changed_callback = child.connect("notify::visible", () => {
                        update_visibility();
                    });
                    update_visibility();
                });
                this._panel._grid.connect("child-removed", (_self, child) => {
                    child.disconnect(child._qsap_vis_changed_callback);
                    delete child._qsap_vis_changed_callback;

                    update_visibility();
                });

                this._indicator.setMenu(this._panel);

                Main.panel.addToStatusArea(this.uuid, this._indicator);
            } else if (panel_type === "independent-panel") {
                this._panel = new Panel('main');
                // Since the panel contains no element that have a minimal width (like QuickToggle)
                // we need to force it to take the same with as a normal panel
                this._panel.add_constraint(new Clutter.BindConstraint({
                    coordinate: Clutter.BindCoordinate.WIDTH,
                    source: LibPanel.main_panel,
                }));

                LibPanel.addPanel(this._panel);

            }
            if (panel_type === "merged-panel" && merged_panel_position === 'top') {
                widgets_order.reverse();
                index = this._panel.getItems().indexOf(SystemItem) + 2;
            }

            for (const widget of widgets_order) {
                if (widget === 'output-volume-slider' && move_output_volume_slider) {
                    this._move_slider(index, OutputVolumeSlider);
                } else if (widget === 'input-volume-slider' && move_input_volume_slider) {
                    this._move_slider(index, this.InputVolumeSlider);
                } else if (widget === 'mpris-controllers' && create_mpris_controllers) {
                    this._create_media_controls(index);
                    if (this.settings.get_boolean("mpris-controllers-are-moved")) {
                        this._remove_base_media_controls();
                    }
                } else if (widget === 'applications-volume-sliders' && create_applications_volume_sliders) {
                    this._create_app_mixer(index, this.settings.get_boolean("group-applications-volume-sliders"), this.settings.get_string("applications-volume-sliders-filter-mode"), this.settings.get_strv("applications-volume-sliders-filters"));
                } else if (widget === "perdevice-volume-sliders" && create_perdevice_volume_sliders) {
                    this._create_sink_mixer(index, this.settings.get_string("perdevice-volume-sliders-filter-mode"), this.settings.get_strv("perdevice-volume-sliders-filters"));
                } else if (widget === "balance-slider" && create_balance_slider) {
                    this._create_balance_slider(index);
                } else if (widget === "profile-switcher" && create_profile_switcher) {
                    this._create_profile_switcher(index);
                }
            }

            if (remove_output_volume_slider) {
                OutputVolumeSlider.visible = false;
            }
        }
    }

    _cleanup_panel() {
        OutputVolumeSlider.visible = true;

        if (!this._panel) return;

        if (this._profile_switcher) {
            this._panel.removeItem(this._profile_switcher);
            this._profile_switcher.destroy();
            this._profile_switcher = null;
        }

        if (this._balance_slider) {
            this._panel.removeItem(this._balance_slider);
            this._balance_slider.destroy();
            this._balance_slider = null;
        }

        if (this._sink_mixer) {
            this._sink_mixer.destroy();
            this._sink_mixer = null;
        }

        if (this._applications_mixer) {
            this._applications_mixer.destroy();
            this._applications_mixer = null;
        }

        if (this._applications_mixer_combined) {
            this._panel.removeItem(this._applications_mixer_combined);
            this._applications_mixer_combined.destroy();
            this._applications_mixer_combined = null;
        }

        if (this._media_section) {
            this._panel.removeItem(this._media_section);
            this._media_section = null;
        }
        if (MessageView_DateMenu._qsap_media_removed) {
            MessageView_DateMenu._setupMpris();
            delete MessageView_DateMenu._qsap_media_removed;
        }

        this._master_volumes.reverse();
        for (const [slider, index] of this._master_volumes) {
            this._panel.removeItem(slider);
            LibPanel.main_panel.addItem(slider, 2);
            LibPanel.main_panel._grid.set_child_at_index(slider, index);
        }
        this._master_volumes = [];

        if (this._indicator) {
            this._indicator.destroy(); // also destroys `this._panel``
            delete this._indicator;
        } else if (this._panel !== LibPanel.main_panel) {
            LibPanel.removePanel(this._panel); // prevent the panel's position being forgotten
            this._panel.destroy();
        };
        this._panel = null;

        LibPanel.disable();
    }

    _move_slider(index: number, slider) {
        const old_index = slider.get_parent().get_children().indexOf(slider);

        LibPanel.main_panel.removeItem(slider);
        this._panel.addItem(slider, 2);
        this._panel._grid.set_child_at_index(slider, index);

        this._master_volumes.push([slider, old_index]);
    }

    _create_media_controls(index: number) {
        this._media_section = new MprisList();
        this._media_section.add_style_class_name('QSAP-media-section');
        if (!this.settings.get_boolean('ignore-css')) {
            this._media_section.add_style_class_name('QSAP-media-section-optional');
        }

        this._panel.addItem(this._media_section, 2);
        this._panel._grid.set_child_at_index(this._media_section, index);
    }

    _remove_base_media_controls() {
        MessageView_DateMenu._mediaSource.disconnectObject(MessageView_DateMenu);
        for (const player of MessageView_DateMenu._mediaSource.players) {
            MessageView_DateMenu._removePlayer(player);
        }
        MessageView_DateMenu._qsap_media_removed = true;
    }

    _create_app_mixer(index: number, type, filter_mode, filters) {
        if (type === "combined") {
            this._applications_mixer_combined = new ApplicationsMixerToggle(this.settings, filter_mode, filters);
            this._panel.addItem(this._applications_mixer_combined, 2);
            this._panel._grid.set_child_at_index(this._applications_mixer_combined, index);
        } else {
            this._applications_mixer = new ApplicationsMixer(this._panel, index, filter_mode, filters, this.settings);
        }
    }

    _create_sink_mixer(index: number, filter_mode, filters) {
        this._sink_mixer = new SinkMixer(this._panel, index, filter_mode, filters);
    }

    _create_balance_slider(index: number) {
        this._balance_slider = new BalanceSlider(this.settings);

        this._panel.addItem(this._balance_slider, 2);
        this._panel._grid.set_child_at_index(this._balance_slider, index);
    }

    _create_profile_switcher(index: number) {
        this._profile_switcher = new AudioProfileSwitcher(this.settings);

        this._panel.addItem(this._profile_switcher, 1);
        this._panel._grid.set_child_at_index(this._profile_switcher, index);
    }


    // Base slider
    // slider: OutputStreamSlider
    //   box: StBoxLayout
    //     slider._iconButton: StButton
    //     sliderBin: StBin
    //     slider._menuButton: StButton
    //     
    // Modified slider
    // slider: OutputStreamSlider
    //   box: StBoxLayout
    //     slider._iconButton: StButton
    //     vbox: StBoxLayout (NEW)
    //       label: StLabel (NEW)
    //       hbox: StBoxLayout (NEW)
    //         sliderBin: StBin
    //         slider._menuButton: StButton

    _patch_show_current_device(slider) {
        if (slider._qsap_callback) return;

        slider._iconButton._qsap_y_expand = slider._iconButton.y_expand;
        slider._iconButton._qsap_y_align = slider._iconButton.y_align;
        slider._iconButton.y_expand = false;
        slider._iconButton.y_align = Clutter.ActorAlign.CENTER;

        const box = slider.child;
        const sliderBin = box.get_children()[1];
        box.remove_child(sliderBin);
        const menu_button_visible = slider._menuButton.visible;
        box.remove_child(slider._menuButton);

        const vbox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true });
        box.insert_child_at_index(vbox, 1);

        const hbox = new St.BoxLayout();
        hbox.add_child(sliderBin);
        hbox.add_child(slider._menuButton);
        slider._menuButton.visible = menu_button_visible; // we need to reset `actor.visible` when changing parent
        // this prevent the tall panel bug when the button is shown
        slider._menuButton._qsap_y_expand = slider._menuButton.y_expand;
        slider._menuButton.y_expand = false;

        const label = new St.Label({ natural_width: 0 });
        label.style_class = "QSAP-application-volume-slider-label";

        const signal_name = slider == OutputVolumeSlider ? "active-output-update" : "active-input-update";
        slider._qsap_callback = slider._control.connect(signal_name, () => {
            const device_id = slider._control.lookup_device_from_stream(slider._stream).get_id();
            // using the item's text allow for compatibility with extensions that changes it, let's hope this won't break
            slider._deviceItems.get(device_id).label.bind_property('text', label, 'text', GObject.BindingFlags.SYNC_CREATE);
        });

        if (slider._stream) {
            const device_id = slider._control.lookup_device_from_stream(slider._stream).get_id();
            slider._deviceItems.get(device_id).label.bind_property('text', label, 'text', GObject.BindingFlags.SYNC_CREATE);
        };

        vbox.add_child(label);
        vbox.add_child(hbox);
    }

    _unpatch_show_current_device(slider) {
        if (!slider._qsap_callback) return;
        slider._control.disconnect(slider._qsap_callback);
    
        slider._iconButton.y_expand = slider._iconButton._qsap_y_expand;
        slider._iconButton.y_align = slider._iconButton._qsap_y_align;

        const menu_button_visible = slider._menuButton.visible;

        const box = slider.child;
        const vbox = box.get_children()[1];
        const hbox = vbox.get_children()[1];
        const sliderBin = hbox.get_children()[0];

        box.remove_child(vbox);
        hbox.remove_child(sliderBin);
        hbox.remove_child(slider._menuButton);

        box.add_child(sliderBin);
        box.add_child(slider._menuButton);

        // we need to reset `actor.visible` when changing parent
        slider._menuButton.visible = menu_button_visible;
        slider._menuButton.y_expand = slider._menuButton._qsap_y_expand;

        delete slider._qsap_callback;
        delete slider._iconButton._qsap_y_expand;
        delete slider._iconButton._qsap_y_align;
        delete slider._menuButton._qsap_y_expand;
    }

    _add_reset_applications_output() {
        this._action_application_reset_output = OutputVolumeSlider.menu.addAction(_("Reset all applications to default output"), () => {
            const control = Volume.getMixerControl();

            for (const stream of control.get_streams()) {
                if (stream.is_event_stream || !(stream instanceof Gvc.MixerSinkInput)) {
                    continue;
                }

                GLib.spawn_command_line_async(`${get_pactl_path(this.settings)[0]} move-sink-input ${stream.index} @DEFAULT_SINK@`);
            }

            if (this._applications_mixer) {
                for (const slider of this._applications_mixer._slider_manager._sliders.values()) {
                    slider._checkUsedSink()
                }
            }
        });
    }

    _remove_reset_applications_output() {
        if (this._action_application_reset_output) {
            this._action_application_reset_output.destroy();
        }
        delete this._action_application_reset_output;
    }
}

class ExtensionController {
    private settings: Gio.Settings;
    private logger: Console;
    private injection_manager: InjectionManager;
    private handler_ids: Map<GObject.Object, Map<string, number>>;
    private active_patches: Map<string, boolean>;

    private pactl_path?: string;

    private input_volume_indicator: Volume.InputIndicator;
    private input_volume_slider: Volume.InputStreamSlider;
    private input_visibility: boolean;
    private input_is_recursing: boolean;

    constructor(settings: Gio.Settings, logger: Console, input_volume_indicator: Volume.InputIndicator) {
        this.settings = settings;
        this.logger = logger;
        this.injection_manager = new InjectionManager();
        this.handler_ids = new Map();
        this.active_patches = new Map();

        this.pactl_path = get_pactl_path(settings)[0] || undefined;

        this.input_volume_indicator = input_volume_indicator;
        this.input_volume_slider = input_volume_indicator._input;
        this.input_visibility = false;
        this.input_is_recursing = false;

        this.connect_setting("changed::pactl-path", () => {
            this.pactl_path = get_pactl_path(settings)[0] || undefined;
        });
        this.connect_setting("changed::always-show-input-volume-slider", () => {
            this.set_always_show_input_volume_slider(this.settings.get_boolean("always-show-input-volume-slider"));
        });
        this.connect_setting("changed::ignore-virtual-capture-streams", () => {
            this.set_ignore_virtual_capture_streams(this.settings.get_boolean("ignore-virtual-capture-streams"));
        });
    }

    private connect(object: GObject.Object, signal: string, callback: (...arg: any[]) => any) {
        let object_map = this.handler_ids.get(object);
        if (!object_map) {
            object_map = new Map();
            this.handler_ids.set(object, object_map);
        }

        if (object_map.has(signal)) {
            this.logger.error(`[BUG] Tried to connect ${signal} on ${object} two times`);
            return;
        }
        const handler_id = object.connect(signal, callback);
        object_map.set(signal, handler_id);
    }

    private connect_setting(signal: string, callback: (...arg: any[]) => any) {
        this.connect(this.settings, signal, callback);
        callback();
    }

    private disconnect(object: GObject.Object, signal: string) {
        const object_map = this.handler_ids.get(object);
        const handler_id = object_map?.get(signal);
        if (handler_id) {
            object_map!.delete(signal);
            object.disconnect(handler_id);
        }
    }

    private set_ignore_virtual_capture_streams(enable: boolean) {
        const was_active = !!this.active_patches.get("ignore-virtual-capture-streams");
        if (enable && !was_active) {
            const self = this;
            this.injection_manager.overrideMethod(
                this.input_volume_slider.constructor.prototype,
                "_shouldBeVisible",
                wrapped => function (this: Volume.InputStreamSlider): boolean {
                    // early return, so we check for virtual stream only if we would show
                    if (!wrapped.call(this)) return false;

                    if (self.pactl_path) {
                        spawn([self.pactl_path, "-f", "json", "list", "source-outputs"]).then(result => {
                            const data = JSON.parse(result);
                            for (const source_output of data) {
                                if (source_output["properties"]["node.virtual"] !== "true") {
                                    return true;
                                }
                            }
                            return false;
                        }).then(should_show => {
                            const old_value = this.visible;
                            this.visible = should_show;
                            if (should_show === old_value) {
                                // emit even when values are equal because in some cases (when
                                // both always-show-input-volume-slider and ignore-virtual-capture-streams
                                // are enabled), the indicator is hidden (and needs to be shown), while
                                // the slider is visible.
                                this.notify("visible");
                            }
                        }).catch(reason => self.logger.error(reason));

                        // dangerous ! if the virtual stream check crashes for some reason,
                        // the user as no way to know that the audio is being recorded.
                        // but returning `true` causes the indicator to flash briefly, 
                        // which is not very good
                        return false;
                    } 
                    return true;
                }
            );
            this.active_patches.set("ignore-virtual-capture-streams", true);
        } else if (was_active) {
            this.injection_manager.restoreMethod(this.input_volume_slider.constructor.prototype, "_shouldBeVisible");
            this.active_patches.set("ignore-virtual-capture-streams", false);
        }

        const visibility = this.input_volume_slider._shouldBeVisible();
        this.input_volume_slider.visible = visibility;
        this.input_volume_indicator.visible = visibility;
    }

    private set_always_show_input_volume_slider(enable: boolean) {
        const was_active = !!this.active_patches.get("always-show-input-volume-slider");
        if (enable && !was_active) {
            this.connect(this.input_volume_slider, "notify::visible", () => this.reset_input_volume_visibility());
            // make sure to check if the indicator should be shown when some events are fired.
            // we need this because we make the slider always visible, so notify::visible isn't
            // fired when gnome-shell tries to show it (because it was already visible)
            this.connect(this.input_volume_slider._control, "stream-added", () => this.reset_input_volume_visibility());
            this.connect(this.input_volume_slider._control, "stream-removed", () => this.reset_input_volume_visibility());
            this.connect(this.input_volume_slider._control, "default-source-changed", () => this.reset_input_volume_visibility());
            this.active_patches.set("always-show-input-volume-slider", true);
        } else if (was_active) {
            this.disconnect(this.input_volume_slider, "notify::visible");
            this.disconnect(this.input_volume_slider._control, "stream-added");
            this.disconnect(this.input_volume_slider._control, "stream-removed");
            this.disconnect(this.input_volume_slider._control, "default-source-changed");
            this.active_patches.set("always-show-input-volume-slider", false);
        }

        const visibility = this.input_volume_slider._shouldBeVisible();
        this.input_volume_slider.visible = visibility;
        this.input_volume_indicator.visible = visibility;
    }

    private reset_input_volume_visibility() {
        if (this.input_is_recursing) {
            // ensure the indicator has the correct visibility
            this.input_volume_indicator.visible = this.input_visibility;
            this.input_is_recursing = false;
        } else {
            this.input_visibility = this.input_volume_slider.visible;
            this.input_volume_indicator.visible = this.input_visibility;
            if (this.settings.get_boolean("always-show-input-volume-slider") && !this.input_volume_slider.visible) {
                this.input_is_recursing = true;
                this.input_volume_slider.visible = true;
            }
        }
    }

    destroy() {
        this.set_ignore_virtual_capture_streams(false);
        this.set_always_show_input_volume_slider(false);

        for (const [object, object_map] of this.handler_ids.entries()) {
            for (const handler_id of object_map.values()) {
                object.disconnect(handler_id);
            }
        }

        this.injection_manager.clear();
    }
}
