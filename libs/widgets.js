const { St, GObject } = imports.gi;
const { MixerSinkInput } = imports.gi.Gvc;

const PopupMenu = imports.ui.popupMenu; // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/popupMenu.js
const Volume = imports.ui.status.volume; // https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/status/volume.js

// According to Qwreey, this was necessary in gnome 43, is it still in gnome 44 ? 
while(!Volume.StreamSlider) {};
const StreamSlider = Volume.StreamSlider;

var QuickSettingsPanel = GObject.registerClass(
    class QuickSettingsPanel extends St.BoxLayout {
        constructor(options) {
            super({
                vertical: true,
                style_class: "popup-menu-content quick-settings QSAP-panel",
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
        for(const [id, slider] of Object.entries(this._sliders)) {
            slider.destroy();
            delete this._sliders[id];
        }

        this._mixer_control.disconnect(this._sa_event_id);
        this._mixer_control.disconnect(this._sr_event_id);

        super.destroy();
    }
}

var ApplicationVolumeSlider = GObject.registerClass(
    class ApplicationVolumeSlider extends StreamSlider {
        constructor(control, stream) {
            super(control);

            // This need to be BEFORE this.stream assignement, note that icons can't be found anyway
            this._icons = [stream.get_icon_name()];
            this.stream = stream;

            this._vbox = new St.BoxLayout({ vertical: true });

            const hbox = this.first_child; // this is the only child
            const slider = hbox.get_children()[1];
            hbox.remove_child(slider);
            hbox.insert_child_at_index(this._vbox, 1);

            this._label = new St.Label({ x_expand: true });
            this._label.style_class = "QSV-application-volume-slider-label";
            this._label.text = `${stream.get_name()} - ${stream.get_description()}`;

            this._vbox.add(this._label);
            this._vbox.add(slider);
        }
    }
)