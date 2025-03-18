import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gvc from 'gi://Gvc';
import St from 'gi://St';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { type MediaMessage } from 'resource:///org/gnome/shell/ui/messageList.js';
import { MprisSource, type MprisPlayer } from 'resource:///org/gnome/shell/ui/mpris.js';
import { Ornament, PopupBaseMenuItem, PopupImageMenuItem, PopupMenuItem, PopupMenuSection } from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { QuickMenuToggle, QuickSlider, QuickToggle } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

import { get_pactl_path, spawn, wait_property } from "./utils.js";

const { MixerSinkInput, MixerSink } = Gvc;
// `_volumeOutput` is set in an async function, so we need to ensure that it's currently defined
const OutputStreamSlider = (await wait_property(Main.panel.statusArea.quickSettings, "_volumeOutput"))._output.constructor as (typeof Volume.OutputStreamSlider);
const StreamSlider = Object.getPrototypeOf(OutputStreamSlider) as (typeof Volume.StreamSlider);

export class SinkMixer {
    panel;

    private _sliders: Map<number, SinkVolumeSlider>;
    private _sliders_ordered: Clutter.Actor[];
    private _filter_mode: string
    private _filters: RegExp[];

    private _mixer_control: Gvc.MixerControl;
    private _sa_event_id: number;
    private _sr_event_id: number;

    constructor(panel, index: number, filter_mode: string, filters: string[]) {
        this.panel = panel;

        // Empty actor used to know where to place sliders
        const placeholder = new Clutter.Actor({ visible: false });
        panel._grid.insert_child_at_index(placeholder, index);

        this._sliders = new Map();
        this._sliders_ordered = [placeholder];
        this._filter_mode = filter_mode;
        this._filters = filters.map(f => new RegExp(f));

        this._mixer_control = Volume.getMixerControl();
        this._sa_event_id = this._mixer_control.connect("stream-added", this._stream_added.bind(this));
        this._sr_event_id = this._mixer_control.connect("stream-removed", this._stream_removed.bind(this));

        for (const stream of this._mixer_control.get_sinks()) {
            this._stream_added(this._mixer_control, stream.id);
        }
    }

    _stream_added(control: Gvc.MixerControl, id: number) {
        if (this._sliders.has(id)) return;

        const stream = control.lookup_stream_id(id);
        if (stream.is_event_stream || !(stream instanceof MixerSink)) {
            return;
        }

        var matched = false;
        for (const filter of this._filters) {
            if ((stream.name?.search(filter) > -1) || (stream.description.search(filter) > -1)) {
                if (this._filter_mode === 'blacklist') return;
                matched = true;
            }
        }
        if (!matched && this._filter_mode === 'whitelist') return;

        const slider = new SinkVolumeSlider(
            this._mixer_control,
            stream,
        );
        this._sliders.set(id, slider);

        this.panel.addItem(slider, 2);
        this.panel._grid.set_child_above_sibling(slider, this._sliders_ordered.at(-1));

        this._sliders_ordered.push(slider);
    }

    _stream_removed(_control: Gvc.MixerControl, id: number) {
        if (!this._sliders.has(id)) return;

        const slider = this._sliders.get(id);
        this.panel.removeItem(slider);
        this._sliders_ordered.splice(this._sliders_ordered.indexOf(slider), 1);
        slider.destroy();
        this._sliders.delete(id);
    }

    destroy() {
        for (const slider of this._sliders.values()) {
            this.panel.removeItem(slider);
            slider.destroy();
        }
        this._sliders = null;

        this._sliders_ordered[0].destroy();
        this._sliders_ordered = null;

        this._mixer_control.disconnect(this._sa_event_id);
        this._mixer_control.disconnect(this._sr_event_id);
    }
};

const SinkVolumeSlider = GObject.registerClass(class SinkVolumeSlider extends StreamSlider {
    private _hasHeadphones: boolean;
    private _setup_timeout?: GLib.Source;
    private _name_binding?: GObject.Binding;

    constructor(control: Gvc.MixerControl, stream: Gvc.MixerSink) {
        super(control);

        this._icons = [
            'audio-volume-muted-symbolic',
            'audio-volume-low-symbolic',
            'audio-volume-medium-symbolic',
            'audio-volume-high-symbolic',
            'audio-volume-overamplified-symbolic',
        ];
        this._hasHeadphones = OutputStreamSlider.prototype._findHeadphones(stream);
        this.stream = stream;

        this._iconButton.y_expand = false;
        this._iconButton.y_align = Clutter.ActorAlign.CENTER;

        const box = this.child;
        const sliderBin = box.get_children()[1];
        box.remove_child(sliderBin);
        box.remove_child(this._menuButton);

        const vbox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true });
        box.insert_child_at_index(vbox, 1);

        const label = new St.Label({ natural_width: 0 });
        label.style_class = "QSAP-application-volume-slider-label";

        const setup = () => {
            clearTimeout(this._setup_timeout);
            if (!control.lookup_device_from_stream(stream)) {
                this._setup_timeout = setTimeout(setup, 50);
            } else {
                this._setup_timeout = undefined;
                const updater = () => {
                    const device = control.lookup_device_from_stream(stream);
                    if (this._name_binding) this._name_binding.unbind();
                    // using the text from the output switcher of the master slider to allow compatibility with extensions
                    // that changes it (like Quick Settings Audio Device Renamer)
                    const deviceItem = Main.panel.statusArea.quickSettings._volumeOutput._output._deviceItems.get(device.get_id());
                    if (deviceItem) this._name_binding = deviceItem.label.bind_property('text', label, 'text', GObject.BindingFlags.SYNC_CREATE);
                };
                let signal = stream.connect("notify::port", updater);
                updater();
                label.connect("destroy", () => {
                    stream.disconnect(signal);

                    if (this._name_binding) {
                        this._name_binding.unbind();
                        this._name_binding = undefined;
                    }
                });
            }
        };
        // using a timeout loop because `control.lookup_device_from_stream` won't work right away
        this._setup_timeout = setTimeout(setup, 0);

        vbox.add_child(label);
        vbox.add_child(sliderBin);
    }

    _updateIcon() {
        this.iconName = this._hasHeadphones
            ? 'audio-headphones-symbolic'
            : this.getIcon();
    }

    destroy() {
        if (this._setup_timeout) {
            clearTimeout(this._setup_timeout);
        }
        super.destroy();
    }
});
type SinkVolumeSlider = InstanceType<typeof SinkVolumeSlider>;

export const BalanceSlider = GObject.registerClass(class BalanceSlider extends QuickSlider {
    stream?: Gvc.MixerStream;

    private _pactl_path?: string | null;
    private _pactl_path_changed_id: number;
    private _sliderChangedId: number;
    private _control: Gvc.MixerControl;
    private _default_sink_changed_signal: number;

    private _volumeCancellable?: Gio.Cancellable;

    constructor(settings: Gio.Settings) {
        super();

        this._pactl_path_changed_id = settings.connect("changed::pactl-path", () => {
            this._pactl_path = get_pactl_path(settings)[0];
        });
        this.connect("destroy", () => settings.disconnect(this._pactl_path_changed_id));
        this._pactl_path = get_pactl_path(settings)[0];

        this._sliderChangedId = this.slider.connect('notify::value', () => this._sliderChanged());
        this.slider.connect('drag-end', () => {
            this._notifyVolumeChange();
        });

        this._control = Volume.getMixerControl();
        this._update_sink(this._control.get_default_sink());
        this._default_sink_changed_signal = this._control.connect("default-sink-changed", (_, stream_id) => {
            this._update_sink(this._control.lookup_stream_id(stream_id))
        });

        const box = this.child;
        box.remove_child(this._menuButton);
        box.remove_child(this._iconButton);
        delete this._iconButton;
        delete this._menuButton;

        const slider = box.first_child;
        box.remove_child(slider);

        const title = new St.Label({ text: "Audio balance" });
        title.style_class = "QSAP-application-volume-slider-label";

        const leftLabel = new St.Label({ text: "L" });
        const rightLabel = new St.Label({ text: "R" });
        leftLabel.y_align = Clutter.ActorAlign.CENTER;
        rightLabel.y_align = Clutter.ActorAlign.CENTER;

        const hbox = new St.BoxLayout();
        hbox.add_child(leftLabel);
        hbox.add_child(slider);
        hbox.add_child(rightLabel);

        // creating an additional vbox instead of setting `box` as vertical is necessary
        // because the second solution will add some spacing between the title and the slider
        // and I don't know how to remove it
        const vbox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true });
        vbox.add_child(title);
        vbox.add_child(hbox);

        box.add_child(vbox);
    }

    _update_sink(stream: Gvc.MixerStream | null) {
        if (stream === null)
            return;
        this.stream = stream;

        // this command doesn't have a json output :(
        spawn([this._pactl_path, "get-sink-volume", stream.name]).then(stdout => {
            // let's hope this regex don't break
            const balance_index = stdout.search(/balance (-?\d+.\d+)/);

            if (balance_index !== -1) {
                const balance_str = stdout.substring(balance_index + 8).trim();
                const balance = parseFloat(balance_str);

                this.slider.block_signal_handler(this._sliderChangedId);
                this.slider.value = (balance + 1.) / 2.;
                this.slider.unblock_signal_handler(this._sliderChangedId);
            }
        });
    }

    _sliderChanged() {
        const balance = this.slider.value * 2. - 1.;

        let left = 0;
        let right = 0;
        if (balance < 0.) {
            left = this.stream.volume;
            right = Math.round(this.stream.volume * (1 + balance));
        } else {
            left = Math.round(this.stream.volume * (1 - balance));
            right = this.stream.volume;
        }

        GLib.spawn_command_line_async(`${this._pactl_path} set-sink-volume ${this.stream.name} ${left} ${right}`);
    }

    _notifyVolumeChange() {
        if (this._volumeCancellable)
            this._volumeCancellable.cancel();
        this._volumeCancellable = undefined;

        if (this.stream.state === Gvc.MixerStreamState.RUNNING)
            return; // feedback not necessary while playing

        this._volumeCancellable = new Gio.Cancellable();
        let player = global.display.get_sound_player();
        player.play_from_theme('audio-volume-change',
            _('Volume changed'), this._volumeCancellable);
    }

    destroy() {
        this._control.disconnect(this._default_sink_changed_signal);
    }
});

export const AudioProfileSwitcher = GObject.registerClass(class AudioProfileSwitcher extends QuickMenuToggle {
    private _settings: Gio.Settings;
    private _mixer_control: Gvc.MixerControl;
    private _profileItems: Map<string, PopupMenuItem>;
    private _device?: Gvc.MixerUIDevice;

    private _active_output_update_signal: number;
    private _autohide_changed_signal: number;

    constructor(settings: Gio.Settings) {
        super();

        this.title = "Audio profile";
        this._settings = settings;
        this._profileItems = new Map();

        this._mixer_control = Volume.getMixerControl();
        this._active_output_update_signal = this._mixer_control.connect("active-output-update", (_, id) => {
            this._set_device(this._mixer_control.lookup_output_id(id));
        });

        // We're not a toggle anymore
        this._box.first_child.reactive = false;
        // Prevent being displayed as a disabled toggle
        this._box.first_child.pseudo_class = "";

        const default_sink = this._mixer_control.get_default_sink();
        if (default_sink != null) {
            this._set_device(this._mixer_control.lookup_device_from_stream(default_sink));
        }

        this._autohide_changed_signal = this._settings.connect("changed::autohide-profile-switcher", () => {
            this._change_visibility_if_neccesary();
        });
        this._settings.emit('changed::autohide-profile-switcher', 'autohide-profile-switcher');
    }

    _set_device(device: Gvc.MixerUIDevice) {
        this.menu.removeAll();
        this._profileItems.clear();
        this._device = device;

        for (const profile of device.get_profiles()) {
            const item = new PopupMenuItem(profile.human_profile);

            const profile_name = profile.profile;
            item.connect("activate", () => {
                this._mixer_control.change_profile_on_selected_device(device, profile_name);
                this._sync_active_profile();
            });

            this._profileItems.set(profile_name, item);
            this.menu.addMenuItem(item);
        }

        this._sync_active_profile();
        this._change_visibility_if_neccesary();
    }

    _sync_active_profile() {
        const active_profile = this._device.get_active_profile();

        for (const [name, item] of this._profileItems) {
            item.setOrnament(name == active_profile ? Ornament.CHECK : Ornament.NONE);

            if (name == active_profile) {
                this.subtitle = item.label.text;
            }
        }
    }

    _change_visibility_if_neccesary() {
        const autohide = this._settings.get_boolean('autohide-profile-switcher');

        if (this.menu.numMenuItems <= 1 && autohide) {
            this.visible = false;
        } else {
            this.visible = true;
        }
    }

    destroy() {
        this._mixer_control.disconnect(this._active_output_update_signal);
        this._settings.disconnect(this._autohide_changed_signal);
    }
});

class ApplicationsMixerManager {
    private _settings: Gio.Settings;
    private _mixer_control: Gvc.MixerControl;

    private _sliders: Map<number, ApplicationVolumeSlider>;
    private _filter_mode: string;
    private _filters: RegExp[];

    private _sa_event_id: number;
    private _sr_event_id: number;

    public on_slider_added: (slider: ApplicationVolumeSlider) => void;
    public on_slider_removed: (slider: ApplicationVolumeSlider) => void;

    constructor(
        settings: Gio.Settings,
        filter_mode: string,
        filters: string[],
        on_slider_added: (slider: ApplicationVolumeSlider) => void,
        on_slider_removed: (slider: ApplicationVolumeSlider) => void
    ) {
        this._settings = settings;
        this._mixer_control = Volume.getMixerControl();
        this.on_slider_added = on_slider_added;
        this.on_slider_removed = on_slider_removed;

        this._sliders = new Map();
        this._filter_mode = filter_mode;
        this._filters = filters.map(f => new RegExp(f));

        this._sa_event_id = this._mixer_control.connect("stream-added", this._stream_added.bind(this));
        this._sr_event_id = this._mixer_control.connect("stream-removed", this._stream_removed.bind(this));

        for (const stream of this._mixer_control.get_streams()) {
            this._stream_added(this._mixer_control, stream.id);
        }
    }

    private _stream_added(control: Gvc.MixerControl, id: number) {
        if (this._sliders.has(id)) return;

        const stream = control.lookup_stream_id(id);
        if (stream.is_event_stream || !(stream instanceof MixerSinkInput)) {
            return;
        }

        var matched = false;
        for (const filter of this._filters) {
            if ((stream.name?.search(filter) > -1) || (stream.description.search(filter) > -1)) {
                if (this._filter_mode === 'blacklist') return;
                matched = true;
            }
        }
        if (!matched && this._filter_mode === 'whitelist') return;

        const slider = new ApplicationVolumeSlider(
            this._mixer_control,
            stream,
            this._settings
        );
        this._sliders.set(id, slider);

        this.on_slider_added(slider);
    }

    private _stream_removed(_control: Gvc.MixerControl, id: number) {
        const slider = this._sliders.get(id);
        if (slider === undefined) return;

        this.on_slider_removed(slider);
        this._sliders.delete(id);
        slider.destroy();
    }

    get sliders(): Iterable<ApplicationVolumeSlider> {
        return this._sliders.values();
    }

    destroy() {
        for (const slider of this._sliders.values()) {
            slider.destroy();
        }
        this._sliders.clear();

        this._mixer_control.disconnect(this._sa_event_id);
        this._mixer_control.disconnect(this._sr_event_id);
    }
}

export class ApplicationsMixer {
    panel;

    private _slider_manager: ApplicationsMixerManager;
    private _sliders_ordered: Clutter.Actor[];

    constructor(panel, index: number, filter_mode: string, filters: string[], settings: Gio.Settings) {
        this.panel = panel;

        // Empty actor used to know where to place sliders
        const placeholder = new Clutter.Actor({ visible: false });
        panel._grid.insert_child_at_index(placeholder, index);

        this._sliders_ordered = [placeholder];

        this._slider_manager = new ApplicationsMixerManager(
            settings,
            filter_mode,
            filters,
            this._slider_added.bind(this),
            this._slider_removed.bind(this)
        );
    }

    _slider_added(slider: ApplicationVolumeSlider) {
        this.panel.addItem(slider, 2);
        this.panel._grid.set_child_above_sibling(slider, this._sliders_ordered.at(-1));

        this._sliders_ordered.push(slider);
    }

    _slider_removed(slider: ApplicationVolumeSlider) {
        this.panel.removeItem(slider);
        this._sliders_ordered.splice(this._sliders_ordered.indexOf(slider), 1);
    }

    destroy() {
        for (const slider of this._slider_manager.sliders) {
            this.panel.removeItem(slider);
        }
        this._slider_manager.destroy();

        this._sliders_ordered[0].destroy();
        this._sliders_ordered = null;
    }
};

// Note: lot of code taken from https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/status/backgroundApps.js?ref_type=heads#L137
export const ApplicationsMixerToggle = GObject.registerClass(class ApplicationsMixerToggle extends QuickToggle {
    private _slider_manager: ApplicationsMixerManager;
    private _slidersSection: PopupMenuSection;
    private _mosc_signal: number;
    private _sm_updated_signal: number;

    constructor(settings: Gio.Settings, filter_mode: string, filters: string[]) {
        super({
            visible: false, hasMenu: true,
            // The background apps toggle looks like a flat menu, but doesn't
            // have a separate menu button. Fake it with an arrow icon.
            iconName: "go-next-symbolic",
            title: "Applications emitting sound"
        });

        this.add_style_class_name("background-apps-quick-toggle");
        this._box.set_child_above_sibling(this._icon, null);

        this.menu.setHeader("audio-volume-high-symbolic", _("Applications volumes"));
        this._slidersSection = new PopupMenuSection();
        this.menu.addMenuItem(this._slidersSection);

        this.connect("popup-menu", () => this.menu.open(false));

        this._mosc_signal = this.menu.connect("open-state-changed", () => this._syncVisibility());
        this._sm_updated_signal = Main.sessionMode.connect("updated", () => this._syncVisibility());

        this._slider_manager = new ApplicationsMixerManager(
            settings,
            filter_mode,
            filters,
            this._slider_added.bind(this),
            this._slider_removed.bind(this)
        );
    }

    _syncVisibility() {
        const { isLocked } = Main.sessionMode;
        const nSliders = this._slidersSection.numMenuItems;
        // We cannot hide the quick toggle while the menu is open, otherwise
        // the menu position goes bogus. We can't show it in locked sessions
        // either
        this.visible = !isLocked && (this.menu.isOpen || nSliders > 0);
    }

    _slider_added(slider: ApplicationVolumeSlider) {
        let slider_item = new ApplicationVolumeSliderItem(slider);
        slider._item = slider_item;
        this._slidersSection.addMenuItem(slider_item);

        this._syncVisibility();
    }

    _slider_removed(slider: ApplicationVolumeSlider) {
        this._slidersSection.box.remove_child(slider._item);
        this._slidersSection.disconnect_object(slider._item);
        this._syncVisibility();
    }

    vfunc_clicked() {
        this.menu.open(true);
    }

    destroy() {
        this._slider_manager.destroy();
        this.menu.disconnect(this._mosc_signal);
        Main.sessionMode.disconnect(this._sm_updated_signal);

        super.destroy();
    }
});

const ApplicationVolumeSlider = GObject.registerClass(class ApplicationVolumeSlider extends StreamSlider {
    private _pactl_path: string | null;
    private _pactl_path_changed_id: number;

    constructor(control: Gvc.MixerControl, stream: Gvc.MixerStream, settings: Gio.Settings) {
        super(control);
        this.menu.setHeader('audio-headphones-symbolic', _('Output Device'));

        this._pactl_path_changed_id = settings.connect("changed::pactl-path", () => {
            this._pactl_path = get_pactl_path(settings)[0];
        });
        this.connect("destroy", () => settings.disconnect(this._pactl_path_changed_id));
        this._pactl_path = get_pactl_path(settings)[0];

        if (this._pactl_path) {
            this._control.connectObject(
                'output-added', (_control: Gvc.MixerControl, id: number) => this._addDevice(id),
                'output-removed', (_control: Gvc.MixerControl, id: number) => this._removeDevice(id),
                'active-output-update', (_control: Gvc.MixerControl, _id: number) => this._checkUsedSink(),
                this
            );
            // unfortunatly we don't have any signal to know that the active device changed
            //stream.connect('', () => this._setActiveDevice());
        
            for (const sink of control.get_sinks()) {
                // apparently it's possible that this function return null
                const device = this._control.lookup_device_from_stream(sink)?.get_id();
                if (device) {
                    this._addDevice(device);
                }
            }
        }

        // This line need to be BEFORE this.stream assignement to prevent an error from appearing in the logs.
        this._icons = [stream.name ? stream.name.toLowerCase() : stream.icon_name];
        this.stream = stream;
        // And this one need to be after this.stream assignement.
        this._icon.fallback_icon_name = stream.icon_name;

        if (this._pactl_path) {
            this._checkUsedSink();
        }

        this._iconButton.y_expand = false;
        this._iconButton.y_align = Clutter.ActorAlign.CENTER;

        const box = this.child;
        const sliderBin = box.get_children()[1];
        box.remove_child(sliderBin);
        const menu_button_visible = this._menuButton.visible;
        box.remove_child(this._menuButton);

        const vbox = new St.BoxLayout({ orientation: Clutter.Orientation.VERTICAL, x_expand: true });
        box.insert_child_at_index(vbox, 1);

        const hbox = new St.BoxLayout();
        hbox.add_child(sliderBin);
        hbox.add_child(this._menuButton);
        this._menuButton.visible = menu_button_visible; // we need to reset `actor.visible` when changing parent
        // this prevent the tall panel bug when the button is shown
        this._menuButton.y_expand = false;

        const label = new St.Label({ natural_width: 0 });
        label.style_class = "QSAP-application-volume-slider-label";
        stream.bind_property_full('description', label, 'text',
            GObject.BindingFlags.SYNC_CREATE,
            (_binding: GObject.Binding, _from: GObject.Value | any, _to: GObject.Value | any) => {
                return [true, this._get_label_text(stream)];
            },
            null
        );

        vbox.add_child(label);
        vbox.add_child(hbox);
    }

    _get_label_text(stream: Gvc.MixerStream) {
        const { name, description } = stream;
        return name === null ? description : `${name} - ${description}`;
    }

    _checkUsedSink() {
        spawn([this._pactl_path, "-f", "json", "list", "sink-inputs"]).then(stdout_str => {    
            const stdout = JSON.parse(stdout_str);
            for (const sink_input of stdout) {
                if (sink_input.index === this.stream.index) {
                    const sink_id = this._control.lookup_device_from_stream(this._control.get_sinks().find(s => s.index === sink_input.sink))?.get_id();
                    if (sink_id) {
                        this._setActiveDevice(sink_id);
                    }
                }
            }
        });
    }

    _addDevice(id: number) {
        if (this._deviceItems.has(id))
            return;

        const device = this._lookupDevice(id);
        if (!device)
            return;

        const item = new PopupImageMenuItem("", device.get_gicon());
        // using the text from the output switcher of the master slider to allow compatibility with extensions
        // that changes it (like Quick Settings Audio Device Renamer)
        const deviceItem = Main.panel.statusArea.quickSettings._volumeOutput._output._deviceItems.get(device.get_id());
        if (deviceItem) deviceItem.label.bind_property('text', item.label, 'text', GObject.BindingFlags.SYNC_CREATE);
        item.connect('activate', () => {
            const dev = this._lookupDevice(id);
            if (dev)
                this._activateDevice(dev);
            else
                console.warn(`Trying to activate invalid device ${id}`);
        });


        this._deviceSection.addMenuItem(item);
        this._deviceItems.set(id, item);

        this._sync();
    }

    _lookupDevice(id: number) {
        return this._control.lookup_output_id(id);
    }

    _activateDevice(device: Gvc.MixerUIDevice) {
        GLib.spawn_command_line_async(`${this._pactl_path} move-sink-input ${this.stream.index} ${this._control.lookup_stream_id(device.stream_id).index}`);
        this._setActiveDevice(device.get_id());
    }
});
type ApplicationVolumeSlider = InstanceType<typeof ApplicationVolumeSlider>;

const ApplicationVolumeSliderItem = GObject.registerClass(class ApplicationVolumeSliderItem extends PopupBaseMenuItem {
    constructor(slider: ApplicationVolumeSlider) {
        super();
        slider.x_expand = true;
        // since it uses a quick settings menu it will be broken if opened in
        // another menu
        slider._menuButton.get_parent().remove_child(slider._menuButton);
        this.add_child(slider);
    }
});

export const MprisList = GObject.registerClass(class MprisList extends St.BoxLayout {
    // MediaMessage isn't exported, gotta get creative
    private static MediaMessage = GObject.type_from_name("Gjs_ui_messageList_MediaMessage");

    private source: MprisSource;
    private messages: Map<MprisPlayer, MediaMessage>;

    constructor() {
        super({
            orientation: Clutter.Orientation.VERTICAL,
            style: 'spacing: 12px;',
        });

        this.messages = new Map();
        this.source = new MprisSource();

        this.source.connectObject(
            'player-added', (_, player) => this._add_player(player),
            'player-removed', (_, player) => this._remove_player(player),
            this
        );

        this.source.players.forEach(player => {
            this._add_player(player);
        });
    }

    _add_player(player: MprisPlayer) {
        if (!this.messages.has(player)) {
            const message = GObject.Object.new(MprisList.MediaMessage, player);
            this.add_child(message);
            this.messages.set(player, message);
        }
    }

    _remove_player(player: MprisPlayer) {
        const message = this.messages.get(player);
        if (message) {
            this.remove_child(message);
            this.messages.delete(player);
        }
    }
});