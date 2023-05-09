const { St, GObject } = imports.gi;
const { MixerSinkInput } = imports.gi.Gvc;

const PopupMenu = imports.ui.popupMenu; // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/popupMenu.js
const Volume = imports.ui.status.volume; // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/status/volume.js

const StreamSlider = imports.ui.main.panel.statusArea.quickSettings._volume._output.constructor;

var QuickSettingsPanel = GObject.registerClass(
    class QuickSettingsPanel extends St.BoxLayout {
        constructor(options) {
            const separated = options.separated;
            delete options.separated;

            super({
                vertical: true,
                style_class: separated ? " popup-menu-content quick-settings QSAP-panel-separated" : " QSAP-panel-merged",
                ...options
            });
        }
    }
)

// This class is a modified version of VolumeMixer from quick-settings-tweaks@qwreey
var ApplicationsMixer = class ApplicationsMixer extends PopupMenu.PopupMenuSection {
    constructor() {
        super();

        this._sliders = {};

        this._mixer_control = Volume.getMixerControl();
        this._sa_event_id = this._mixer_control.connect("stream-added", this._stream_added.bind(this));
        this._sr_event_id = this._mixer_control.connect("stream-removed", this._stream_removed.bind(this));

        for(const stream of this._mixer_control.get_streams()) {
            this._stream_added(this._mixer_control, stream.get_id());
        }
    }

    _stream_added(control, id) {
        if(id in this._sliders) return;

        const stream = control.lookup_stream_id(id);
        if(stream.is_event_stream || !(stream instanceof MixerSinkInput)) {
            return;
        }

        const slider = new ApplicationVolumeSlider(
            this._mixer_control,
            stream
        );
        this._sliders[id] = slider;
        this.actor.add(slider);
    }

    _stream_removed(control, id) {
        if(id in this._sliders) {
            this._sliders[id].destroy();
            delete this._sliders[id];
        }
    }

    destroy() {
        this._sliders = null;

        this._mixer_control.disconnect(this._sa_event_id);
        this._mixer_control.disconnect(this._sr_event_id);

        super.destroy();
    }
}

var ApplicationVolumeSlider = GObject.registerClass(
    class ApplicationVolumeSlider extends StreamSlider {
        constructor(control, stream) {
            super(control);

            // This line need to be BEFORE this.stream assignement to prevent an error from appearing in the logs.
            // Note that icons can't be found anyway
            this._icons = [stream.get_icon_name()];
            this.stream = stream;

            const vbox = new St.BoxLayout({ vertical: true });

            const hbox = this.first_child; // this is the only child
            const slider = hbox.get_children()[1];
            hbox.remove_child(slider);
            hbox.insert_child_at_index(vbox, 1);

            const label = new St.Label({ natural_width: 0 });
            label.style_class = "QSAP-application-volume-slider-label";
            label.text = `${stream.get_name()} - ${stream.get_description()}`;

            vbox.add(label);
            vbox.add(slider);
        }
    }
)