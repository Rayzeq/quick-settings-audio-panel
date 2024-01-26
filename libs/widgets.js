const { GLib, GObject, Clutter, St } = imports.gi;
const { MixerSinkInput, MixerSink } = imports.gi.Gvc;
const ByteArray = imports.byteArray;
const Config = imports.misc.config;

const PopupMenu = imports.ui.popupMenu; // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/popupMenu.js
const Volume = imports.ui.status.volume; // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/status/volume.js

const OutputStreamSlider = imports.ui.main.panel.statusArea.quickSettings._volume._output.constructor;
const StreamSlider = Object.getPrototypeOf(OutputStreamSlider);

var ApplicationsMixer = class {
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

var SinkMixer = class {
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

var SinkVolumeSlider = GObject.registerClass(class extends StreamSlider {
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

        const [major, _] = Config.PACKAGE_VERSION.split('.').map(s => Number(s));
        if (major > 43) {
            this._iconButton.y_expand = false;
            this._iconButton.y_align = Clutter.ActorAlign.CENTER;
        }

        const box = this.child;
        const sliderBin = box.get_children()[1];
        box.remove_child(sliderBin);
        box.remove_child(this._menuButton);

        const vbox = new St.BoxLayout({ vertical: true, x_expand: true });
        box.insert_child_at_index(vbox, 1);

        const label = new St.Label({ natural_width: 0 });
        label.style_class = "QSAP-application-volume-slider-label";
        stream.bind_property_full('description', label, 'text',
            GObject.BindingFlags.SYNC_CREATE,
            (_binding, value) => {
                return [true, value];
            },
            null
        );

        vbox.add_child(label);
        vbox.add_child(sliderBin);
    }

    _updateIcon() {
        this.iconName = this._hasHeadphones
            ? 'audio-headphones-symbolic'
            : this.getIcon();
    }
});


var ApplicationVolumeSlider = GObject.registerClass(class ApplicationVolumeSlider extends StreamSlider {
    constructor(control, stream) {
        super(control);
        this.menu.setHeader('audio-headphones-symbolic', _('Output Device'));

        try {
            GLib.spawn_command_line_sync('pactl');
        } catch (e) {
            this._disable_pactl = true;
        }

        if (!this._disable_pactl) {
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

        if (!this._disable_pactl) {
            this._checkUsedSink();
        }

        const [major, _] = Config.PACKAGE_VERSION.split('.').map(s => Number(s));
        if (major > 43) {
            this._iconButton.y_expand = false;
            this._iconButton.y_align = Clutter.ActorAlign.CENTER;
        }

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
        let [, stdout, ,] = GLib.spawn_command_line_sync('pactl -f json list sink-inputs');
        if (stdout instanceof Uint8Array)
            stdout = ByteArray.toString(stdout);
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
        GLib.spawn_command_line_async(`pactl move-sink-input ${this.stream.index} ${this._control.lookup_stream_id(device.stream_id).index}`);
        this._setActiveDevice(device.get_id());
    }
});
