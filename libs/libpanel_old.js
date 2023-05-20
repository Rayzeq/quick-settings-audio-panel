const { GObject, GLib, Graphene, Meta, Clutter, St } = imports.gi;

const { PopupMenu } = imports.ui.popupMenu;
const Main = imports.ui.main;

const DIM_BRIGHTNESS = -0.4;
const POPUP_ANIMATION_TIME = 400;

// m=Main.panel.statusArea.quickSettings._menu_backup
// m.actor.first_child.last_child.first_child.style_class

// Main.panel.statusArea.quickSettings.menu.box.first_child.first_child
// imports.ui.main.panel.statusArea.quickSettings._bluetooth.quickSettingsItems[0]._placeholderItem
const Layout = Main.panel.statusArea.quickSettings.menu._grid.layout_manager.constructor;
var Panel = GObject.registerClass(class LibPanel_Panel extends St.Widget {
	constructor(nColumns = 1) {
		super({
			reactive: true,
			layout_manager: new Clutter.BinLayout(),
			style_class: 'popup-menu-content quick-settings'
		});

		// Overlay layer for sub-popups
		this._overlay = new Clutter.Actor({
			layout_manager: new Clutter.BinLayout(),
		});

		// Placeholder to make empty space when opening a sub-popup
		const placeholder = new Clutter.Actor({
			constraints: new Clutter.BindConstraint({
				coordinate: Clutter.BindCoordinate.HEIGHT,
				source: this._overlay,
			}),
		});

		this._grid = new St.Widget({
			style_class: 'quick-settings-grid',
			layout_manager: new Layout(placeholder, {
				nColumns,
			}),
		});
		this._grid.add_child(placeholder);
		this.add_child(this._grid);
		this._dimEffect = new Clutter.BrightnessContrastEffect({
			enabled: false,
		});
		this._grid.add_effect_with_name('dim', this._dimEffect);

		this._overlay.add_constraint(new Clutter.BindConstraint({
			coordinate: Clutter.BindCoordinate.Y,
			source: this._grid,
		}));
		this._overlay.add_constraint(new Clutter.BindConstraint({
			coordinate: Clutter.BindCoordinate.X,
			source: this,
		}));

		const constraint = new Clutter.BindConstraint({
			coordinate: Clutter.BindCoordinate.WIDTH,
			source: this._grid, // we need to use this._grid instead of just `this` because the size of `this` will be changed by popups
		})
		this._show_callback_id = this.connect("show", () => {
			const css = this.get_theme_node();
			constraint.offset = css.get_padding(St.Side.RIGHT) + // which mean we need to acknowledge for the internal padding of `this`
				css.get_padding(St.Side.LEFT)
		});
		this._overlay.add_constraint(constraint);
		this.add_child(this._overlay);
	}

	addItem(item, colSpan = 1) {
		this._grid.add_child(item);
		this._grid.layout_manager.child_set_property(
			this._grid, item, 'column-span', colSpan);

		if (item.menu) {
			this._overlay.add_child(item.menu.actor);

			item._libpanel_callback = item.menu.connect('open-state-changed', (m, isOpen) => {
				this._setDimmed(isOpen);
				this._activeMenu = isOpen ? item.menu : null;
			});
		}
	}

	getItems() {
		return this._grid.get_children().filter(i => i != this._grid.layout_manager._overlay);
	}

	removeItem(item) {
		this._grid.remove_child(item);
		if (item.menu) {
			this._overlay.remove_child(item.menu.actor);
			item.menu.disconnect(item._libpanel_callback);
		}
	}

	getColumnSpan(item) {
		const value = new GObject.Value();
		this._grid.layout_manager.child_get_property(this._grid, item, 'column-span', value);
		const column_span = value.get_int();
		value.unset();
		return column_span;
	}

	setColumnSpan(item, colSpan) {
		this._grid.layout_manager.child_set_property(
			this._grid, item, 'column-span', colSpan);
	}

	_close() {
		this._activeMenu?.close(animate);
	}

	_setDimmed(dim) {
		const val = 127 * (1 + (dim ? 1 : 0) * DIM_BRIGHTNESS);
		const color = Clutter.Color.new(val, val, val, 255);

		this._grid.ease_property('@effects.dim.brightness', color, {
			mode: Clutter.AnimationMode.LINEAR,
			duration: POPUP_ANIMATION_TIME,
			onStopped: () => (this._dimEffect.enabled = dim),
		});
		this._dimEffect.enabled = true;
	}

	/*destroy() {

		this.disconnect(this._show_callback_id);
		for(const item of this.getItems()) {
			this.removeItem(item)
		}
		this.remove_child(this._grid);
		global._grid = this._grid;

		super.destroy()
	}*/
});