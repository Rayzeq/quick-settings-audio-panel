import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gvc from 'gi://Gvc';
import St from 'gi://St';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { QuickSlider } from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Volume from 'resource:///org/gnome/shell/ui/status/volume.js';

export function waitProperty(object, name) {
    if (!waitProperty.idle_ids) {
        waitProperty.idle_ids = [];
    }

    return new Promise((resolve, _reject) => {
        // very ugly hack
        const id_pointer = {};
        const id = GLib.idle_add(GLib.PRIORITY_DEFAULT, waitPropertyLoop.bind(this, resolve, id_pointer));
        id_pointer.id = id;
        waitProperty.idle_ids.push(id);
    });

    function waitPropertyLoop(resolve, pointer) {
        if (object[name]) {
            const index = waitProperty.idle_ids.indexOf(pointer.id);
            if (index !== -1) {
                waitProperty.idle_ids.splice(index, 1);
            }

            resolve(object[name]);
            return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
    }
}

const { MixerSinkInput, MixerSink } = Gvc;
// `_volumeOutput` is set in an async function, so we need to ensure that it's currently defined
const OutputStreamSlider = (await waitProperty(Main.panel.statusArea.quickSettings, '_volumeOutput'))._output.constructor;
const StreamSlider = Object.getPrototypeOf(OutputStreamSlider);

export class SinkMixer {
    constructor(panel, index, filter_mode, filters) {
        this.panel = panel;

        // Empty actor used to know where to place sliders
        const placeholder = new Clutter.Actor({ visible: false });
        panel._grid.insert_child_at_index(placeholder, index);

        this._sliders = {};
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

    _stream_added(control, id) {
        if (id in this._sliders) return;

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
        this._sliders[id] = slider;

        this.panel.addItem(slider, 2);
        this.panel._grid.set_child_above_sibling(slider, this._sliders_ordered.at(-1));

        this._sliders_ordered.push(slider);
    }

    _stream_removed(_control, id) {
        if (!(id in this._sliders)) return;

        this.panel.removeItem(this._sliders[id]);
        this._sliders_ordered.splice(this._sliders_ordered.indexOf(this._sliders[id]), 1);
        this._sliders[id].destroy();
        delete this._sliders[id];
    }

    destroy() {
        for (const slider of Object.values(this._sliders)) {
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
    constructor(control, stream) {
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

        const vbox = new St.BoxLayout({ vertical: true, x_expand: true });
        box.insert_child_at_index(vbox, 1);

        const label = new St.Label({ natural_width: 0 });
        label.style_class = "QSAP-application-volume-slider-label";

        const card = control.lookup_card_id(stream.card_index);
        if (card) {
            const updater = () => {
                const card_name = card.name;
                const port_name = card.get_ports().find(port => port.port == stream.port)?.human_port;
                label.text = port_name
                    ? `${port_name} - ${card_name}`
                    : card_name;
            };
            let name_signal = card.connect("notify::name", updater);
            let port_signal = stream.connect("notify::port", updater);
            updater();
            label.connect("destroy", () => {
                card.disconnect(name_signal);
                stream.disconnect(port_signal);
            });
        } else {
            stream.bind_property_full('description', label, 'text',
                GObject.BindingFlags.SYNC_CREATE,
                (_binding, value) => {
                    return [true, value];
                },
                null
            );
        }
        
        vbox.add_child(label);
        vbox.add_child(sliderBin);
    }

    _updateIcon() {
        this.iconName = this._hasHeadphones
            ? 'audio-headphones-symbolic'
            : this.getIcon();
    }
});

export const BalanceSlider = GObject.registerClass(class BalanceSlider extends QuickSlider {
    constructor(settings) {
        super();

        const updatePactl = () => {
            try {
                GLib.spawn_command_line_sync('pactl');
                this._pactl_path = "pactl";
            } catch (e) {
                try {
                    let custom_path = settings.get_string("pactl-path");
                    GLib.spawn_command_line_sync(custom_path);
                    this._pactl_path = custom_path;
                } catch (e) {
                    this._pactl_path = null;
                }
            }
        };
        updatePactl();
        settings.connect("changed::pactl-path", () => updatePactl());

        this._sliderChangedId = this.slider.connect('notify::value', () => this._sliderChanged());
        this.slider.connect('drag-end', () => {
            this._notifyVolumeChange();
        });

        this._control = Volume.getMixerControl();
        this._update_sink(this._control.get_default_sink());
        this._control.connect("default-sink-changed", (_, stream_id) => {
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
        const vbox = new St.BoxLayout({ vertical: true, x_expand: true });
        vbox.add_child(title);
        vbox.add_child(hbox);

        box.add_child(vbox);
    }

    _update_sink(stream) {
        if (stream === null)
            return;
        this.stream = stream;

        // this command doesn't have a json output :(
        let [, stdout, ,] = GLib.spawn_command_line_sync(`${this._pactl_path} get-sink-volume ${stream.name}`);
        if (stdout instanceof Uint8Array)
            stdout = new TextDecoder().decode(stdout);
        // let's hope this regex don't break
        const balance_index = stdout.search(/balance (-?\d+.\d+)/);
        const balance_str = stdout.substring(balance_index + 8).trim();
        const balance = parseFloat(balance_str);

        this.slider.block_signal_handler(this._sliderChangedId);
        this.slider.value = (balance + 1.) / 2.;
        this.slider.unblock_signal_handler(this._sliderChangedId);
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

        GLib.spawn_command_line_sync(`${this._pactl_path} set-sink-volume ${this.stream.name} ${left} ${right}`);
    }

    _notifyVolumeChange() {
        if (this._volumeCancellable)
            this._volumeCancellable.cancel();
        this._volumeCancellable = null;

        if (this.stream.state === Gvc.MixerStreamState.RUNNING)
            return; // feedback not necessary while playing

        this._volumeCancellable = new Gio.Cancellable();
        let player = global.display.get_sound_player();
        player.play_from_theme('audio-volume-change',
            _('Volume changed'), this._volumeCancellable);
    }
});

export class ApplicationsMixer {
    constructor(panel, index, filter_mode, filters, settings) {
        this.panel = panel;

        // Empty actor used to know where to place sliders
        const placeholder = new Clutter.Actor({ visible: false });
        panel._grid.insert_child_at_index(placeholder, index);

        this._sliders = {};
        this._sliders_ordered = [placeholder];
        this._filter_mode = filter_mode;
        this._filters = filters.map(f => new RegExp(f));
        this._settings = settings;

        this._mixer_control = Volume.getMixerControl();
        this._sa_event_id = this._mixer_control.connect("stream-added", this._stream_added.bind(this));
        this._sr_event_id = this._mixer_control.connect("stream-removed", this._stream_removed.bind(this));

        for (const stream of this._mixer_control.get_streams()) {
            this._stream_added(this._mixer_control, stream.id);
        }
    }

    _stream_added(control, id) {
        if (id in this._sliders) return;

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
        this._sliders[id] = slider;

        this.panel.addItem(slider, 2);
        this.panel._grid.set_child_above_sibling(slider, this._sliders_ordered.at(-1));

        this._sliders_ordered.push(slider);
    }

    _stream_removed(_control, id) {
        if (!(id in this._sliders)) return;

        this.panel.removeItem(this._sliders[id]);
        this._sliders_ordered.splice(this._sliders_ordered.indexOf(this._sliders[id]), 1);
        this._sliders[id].destroy();
        delete this._sliders[id];
    }

    destroy() {
        for (const slider of Object.values(this._sliders)) {
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

const ApplicationVolumeSlider = GObject.registerClass(class ApplicationVolumeSlider extends StreamSlider {
    constructor(control, stream, settings) {
        super(control);
        this.menu.setHeader('audio-headphones-symbolic', _('Output Device'));

        const updatePactl = () => {
            try {
                GLib.spawn_command_line_sync('pactl');
                this._pactl_path = "pactl";
            } catch (e) {
                try {
                    let custom_path = settings.get_string("pactl-path");
                    GLib.spawn_command_line_sync(custom_path);
                    this._pactl_path = custom_path;
                } catch (e) {
                    this._pactl_path = null;
                }
            }
        };
        updatePactl();
        settings.connect("changed::pactl-path", () => updatePactl());

        if (this._pactl_path) {
            this._control.connectObject(
                'output-added', (_control, id) => this._addDevice(id),
                'output-removed', (_control, id) => this._removeDevice(id),
                'active-output-update', (_control, _id) => this._checkUsedSink(),
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

        const vbox = new St.BoxLayout({ vertical: true, x_expand: true });
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
            (_binding, _value) => {
                return [true, this._get_label_text(stream)];
            },
            null
        );

        vbox.add_child(label);
        vbox.add_child(hbox);
    }

    _get_label_text(stream) {
        const { name, description } = stream;
        return name === null ? description : `${name} - ${description}`;
    }

    _checkUsedSink() {
        let [, stdout, ,] = GLib.spawn_command_line_sync(`${this._pactl_path} -f json list sink-inputs`);
        if (stdout instanceof Uint8Array)
            stdout = new TextDecoder().decode(stdout);
        stdout = JSON.parse(stdout);

        for (const sink_input of stdout) {
            if (sink_input.index === this.stream.index) {
                const sink_id = this._control.lookup_device_from_stream(this._control.get_sinks().find(s => s.index === sink_input.sink))?.get_id();
                if (sink_id) {
                    this._setActiveDevice(sink_id);
                }
            }
        }
    }

    _lookupDevice(id) {
        return this._control.lookup_output_id(id);
    }

    _activateDevice(device) {
        GLib.spawn_command_line_async(`${this._pactl_path} move-sink-input ${this.stream.index} ${this._control.lookup_stream_id(device.stream_id).index}`);
        this._setActiveDevice(device.get_id());
    }
});
