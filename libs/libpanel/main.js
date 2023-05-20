//! The code for libpanel
//! Exports:
//!   - LibPanel: a global and unique instance of the library
//!   - Panel: a class to make new panels
//!   - PanelGroup: a class to merge multiple panels into one

//! TODO: movable panels, make README (forward issues, enhancement proposal, incompatibilities)
//! warning on win+r (don't come from this._show_callback_id)
//busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s '(new imports.ui.runDialog.RunDialog()).open()'
// Refactor: use Patcher to connect/constraints/add methods to classes/css classes (but remove usage in LibPanel_Class), EVERY connect must be saved (also constraints)
//           APIs, document everything, set all arguments in connect, make everything available as LibPanel._PanelColumn
//           method parity between libpanel_panel and gnome_panel, merge nested panel groups, add remove_from_parent to clutter.actor


const VERSION = 1;

if (global._libpanel) {
	var LibPanel = global._libpanel;
	var Panel = global._libpanel.Panel;
	var PanelGroup = global._libpanel.PanelGroup;

	if (LibPanel.VERSION != VERSION) {
		const Self = imports.misc.extensionUtils.getCurrentExtension();
		console.warn(`${Self.uuid} depends on libpanel ${VERSION} but libpanel ${LibPanel.VERSION} is loaded`);
	}
} else {
	const { GObject, Gio, GLib, Meta, Clutter, St } = imports.gi;

	const Config = imports.misc.config;

	const { PopupMenu } = imports.ui.popupMenu;
	const { BoxPointer } = imports.ui.boxpointer;
	const Main = imports.ui.main;
	const DND = imports.ui.dnd;

	const QuickSettings = Main.panel.statusArea.quickSettings;
	const QuickSettingsLayout = QuickSettings.menu._grid.layout_manager.constructor;
	const MenuManager = Main.panel.menuManager;

	// Cannot put this in utils.js because we can't import it before creating the importer
	// for explanations https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/misc/extensionUtils.js#:~:text=function-,installImporter,-(extension)
	function create_importer(path) {
		let oldSearchPath = imports.searchPath.slice();
		imports.searchPath = [path];
		importer = imports.libpanel;
		imports.searchPath = oldSearchPath;
		return importer;
	}

	String.prototype.pysplit = function (sep, maxsplit) {
		const split = this.split(sep);
		return maxsplit ? split.slice(0, maxsplit).concat([split.slice(maxsplit).join(sep)]) : split;
	};
	String.prototype.pyrsplit = function (sep, maxsplit) {
		const split = this.split(sep);
		return maxsplit ? [split.slice(0, -maxsplit).join(sep)].concat(split.slice(-maxsplit)) : split;
	};
	/// Try to remove an item from this array. Return true if the item was successfully removed
	/// and false if it wasn't present.
	Array.prototype.remove = function (item) {
		const index = this.indexOf(item);
		if (index > -1) {
			this.splice(index, 1);
			return true;
		}
		return false;
	};
	Array.prototype.insert = function (index, ...items) {
		this.splice(index, 0, ...items);
	};

	const Self = function () {
		const libpanel_path = new Error().stack.split('\n')[0].pysplit('@', 1)[1].pyrsplit('/', 1)[0] + '/';
		const parent_path = libpanel_path.pyrsplit('/', 2)[0];
		const Self = create_importer(parent_path);

		const handler = {
			get(obj, name) {
				if (name in obj) {
					return obj[name];
				}
				return Self[name];
			},
		};

		return new Proxy({ path: libpanel_path }, handler);
	}();
	global._libpanel_importer = Self;

	Self.utils.get_stack();

	// Create a settings object from a path to the folder containing the schema, and the id of the schema
	function create_settings(path, id) {
		const source = Gio.SettingsSchemaSource.new_from_directory(path,
			Gio.SettingsSchemaSource.get_default(),
			false
		);
		return new Gio.Settings({ settings_schema: source.lookup(id, true) });
	}

	// TODO: move to enable and disable
	DND._Draggable.prototype.__grabActor = DND._Draggable.prototype._grabActor;
	DND._Draggable.prototype._grabActor = function (device, touchSequence) {
		if (this._disabled) return;
		this.__grabActor(device, touchSequence);
	};

	const [major, minor] = Config.PACKAGE_VERSION.split('.').map(s => Number(s));
	if (major <= 44) {
		// Backport from https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/2770
		// This prevent a bug when the extension is disabled
		DND._Draggable.prototype._updateDragHover = function () {
			this._updateHoverId = 0;
			let target = this._pickTargetActor();

			let dragEvent = {
				x: this._dragX,
				y: this._dragY,
				dragActor: this._dragActor,
				source: this.actor._delegate,
				targetActor: target,
			};

			let targetActorDestroyHandlerId;
			let handleTargetActorDestroyClosure;
			handleTargetActorDestroyClosure = () => {
				target = this._pickTargetActor();
				dragEvent.targetActor = target;
				targetActorDestroyHandlerId =
					target.connect('destroy', handleTargetActorDestroyClosure);
			};
			targetActorDestroyHandlerId =
				target.connect('destroy', handleTargetActorDestroyClosure);

			for (let i = 0; i < DND.dragMonitors.length; i++) {
				let motionFunc = DND.dragMonitors[i].dragMotion;
				if (motionFunc) {
					let result = motionFunc(dragEvent);
					if (result != DND.DragMotionResult.CONTINUE) {
						global.display.set_cursor(DND.DRAG_CURSOR_MAP[result]);
						dragEvent.targetActor.disconnect(targetActorDestroyHandlerId);
						return GLib.SOURCE_REMOVE;
					}
				}
			}
			dragEvent.targetActor.disconnect(targetActorDestroyHandlerId);

			while (target) {
				if (target._delegate && target._delegate.handleDragOver) {
					let [r_, targX, targY] = target.transform_stage_point(this._dragX, this._dragY);
					// We currently loop through all parents on drag-over even if one of the children has handled it.
					// We can check the return value of the function and break the loop if it's true if we don't want
					// to continue checking the parents.
					let result = target._delegate.handleDragOver(this.actor._delegate,
						this._dragActor,
						targX,
						targY,
						0);
					if (result != DND.DragMotionResult.CONTINUE) {
						global.display.set_cursor(DND.DRAG_CURSOR_MAP[result]);
						return GLib.SOURCE_REMOVE;
					}
				}
				target = target.get_parent();
			}
			global.display.set_cursor(Meta.Cursor.DND_IN_DRAG);
			return GLib.SOURCE_REMOVE;
		}
	}

	// Find the panel that a widget is a child of, null if the widget isn't inside a panel
	function find_panel(widget) {
		if (widget instanceof Panel) {
			const parent = widget.get_parent();
			return parent instanceof PanelGroup ? parent : widget;
		}

		while ((widget = widget.get_parent()) != null) {
			if (widget instanceof Panel) {
				const parent = widget.get_parent();
				return parent instanceof PanelGroup ? parent : widget;
			}
		}

		return null;
	}

	// Get the uuid of the current extension (not necessarily the one that loaded libpanel first)
	function get_extension_name() {
		const stack = new Error().stack.split('\n');
		for (const line of stack.reverse()) {
			if (line.includes('/gnome-shell/extensions/')) {
				const [left, right] = line.split('@').slice(-2);
				return `${left.split('/').at(-1)}@${right.split('/')[0]}`;
			}
		}
		
		return undefined;
	}

	// copied from https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/quickSettings.js
	const DIM_BRIGHTNESS = -0.4;
	const POPUP_ANIMATION_TIME = 400;

	const DropZone = GObject.registerClass(class LibPanel_DropZone extends St.Widget {
		constructor(source) {
			super({ style_class: 'popup-menu-content quick-settings', opacity: 127 });
			this._delegate = this;

			this.add_constraint(new Clutter.BindConstraint({
				coordinate: Clutter.BindCoordinate.WIDTH,
				source: source,
			}));
			this.add_constraint(new Clutter.BindConstraint({
				coordinate: Clutter.BindCoordinate.HEIGHT,
				source: source,
			}));
		}

		acceptDrop(source, actor, x, y, time) {    
			source.get_parent().remove_child(source);

			const column = this.get_parent();
			column.replace_child(this, source);

			const grid = column.get_parent();
			var last_column;
			while ((last_column = grid.last_child).get_children().length === 0) {
				// This line is necessary to prevent use-after-destroy errors
				// Because column.get_next_sibling() would return last_column even though it's being deleted
				last_column.get_parent().remove_child(last_column);
				last_column.destroy();
			};

			global._libpanel._save_layout();
			return true;
		}
	});

	var Panel = GObject.registerClass(class LibPanel_Panel extends St.Widget {
		constructor(name, nColumns = 2) {
			super({
				// Enable this so the menu block any click event from propagating through
				reactive: true,
				// If we don't set any layout, padding won't get applied
				layout_manager: new Clutter.BinLayout(),
				style_class: 'popup-menu-content quick-settings'
			});
			this._delegate = this;
			this.hide();
			this._name = `${get_extension_name()}/${name}`;

			// Overlay layer that will hold sub-popups
			this._overlay = new Clutter.Actor({ layout_manager: new Clutter.BinLayout() });

			// Placeholder to make empty space when opening a sub-popup
			const placeholder = new Clutter.Actor({
				// The placeholder have the same height as the overlay, which means
				// it have the same height as the opened sub-popup
				constraints: new Clutter.BindConstraint({
					coordinate: Clutter.BindCoordinate.HEIGHT,
					source: this._overlay,
				}),
			});

			// The grid holding every element
			this._grid = new St.Widget({
				style_class: 'quick-settings-grid',
				layout_manager: new QuickSettingsLayout(placeholder, { nColumns }),
			});
			this.add_child(this._grid);
			this._grid.add_child(placeholder);

			this._dimEffect = new Clutter.BrightnessContrastEffect({ enabled: false });
			this._grid.add_effect_with_name('dim', this._dimEffect);

			// Don't know why, but by default the overlay isn't placed a the same coordinates as the grid
			// so we force it into position. The difference between `this._grid` and `this` is intentional
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
				source: this._grid, // we need to use `this._grid` instead of just `this` because the size of `this` will be changed by popups
				//                     since they are indirect children if `this`
			})
			this._show_callback_id = this.connect("stage-views-changed", () => {
				const css = this.get_theme_node();
				constraint.offset = css.get_padding(St.Side.RIGHT) + // which mean we need to acknowledge for the internal padding of `this`
					css.get_padding(St.Side.LEFT)
			});
			this._overlay.add_constraint(constraint);
			this.add_child(this._overlay);

			this._make_draggable();
		}

		addItem(item, colSpan = 1) {
			this._grid.add_child(item);
			this.setColumnSpan(item, colSpan);

			item._libpanel_visible_callback = item.connect_after('notify::visible', this._update_visibility.bind(this));
			if (item.visible) {
				this.show();
			}

			if (item.menu) {
				this._overlay.add_child(item.menu.actor);

				item._libpanel_open_callback = item.menu.connect('open-state-changed', (_, isOpen) => {
					this._setDimmed(isOpen);
					this._activeMenu = isOpen ? item.menu : null;
				});
			}
		}

		getItems() {
			// Every child except the placeholder
			return this._grid.get_children().filter(item => item != this._grid.layout_manager._overlay);
		}

		removeItem(item) {
			item.disconnect(item._libpanel_visible_callback);
			this._grid.remove_child(item);
			if (item.menu) {
				item.menu.disconnect(item._libpanel_open_callback);
				this._overlay.remove_child(item.menu.actor);
			}
			this._update_visibility();
		}

		getColumnSpan(item) {
			const value = new GObject.Value();
			this._grid.layout_manager.child_get_property(this._grid, item, 'column-span', value);
			const column_span = value.get_int();
			value.unset();
			return column_span;
		}

		setColumnSpan(item, colSpan) {
			this._grid.layout_manager.child_set_property(this._grid, item, 'column-span', colSpan);
		}

		_update_visibility() {
			for (const item of this.getItems()) {
				if (item.visible) {
					this.show();
					return;
				}
			}

			this.hide();
		}

		_make_draggable() {
			if (this._draggable) return;

			this._draggable = DND.makeDraggable(this);
			this._drag_begin_callback = this._draggable.connect("drag-begin", () => {
				QuickSettings.menu.transparent = false;
				QuickSettings.menu._fill_columns?.();
				this._drag_monitor = {
					dragMotion: this._on_drag_motion.bind(this),
				};
				DND.addDragMonitor(this._drag_monitor);

				this._dnd_placeholder?.destroy();
				this._dnd_placeholder = new DropZone(this);
			});
			this._drag_end_callback = this._draggable.connect("drag-end", () => {
				QuickSettings.menu.transparent = true;
				this._dnd_placeholder.destroy();
				this._dnd_placeholder = null;
				DND.removeDragMonitor(this._drag_monitor);
				this._drag_monitor = null;
			});
			this._destroy_callback = this.connect("destroy", () => {
				QuickSettings.menu.transparent = true;
				this._dnd_placeholder?.destroy();
				this._dnd_placeholder = null;
				DND.removeDragMonitor(this._drag_monitor);
				this._drag_monitor = null;
			});
		}

		_on_drag_motion(drag_event) {
			if (drag_event.source !== this) return DND.DragMotionResult.NO_DROP;
			if (drag_event.targetActor === this._dnd_placeholder) return DND.DragMotionResult.COPY_DROP;

			const panel = find_panel(drag_event.targetActor);
			if (panel !== null && panel.get_previous_sibling() !== this._dnd_placeholder) {
				const column = panel.get_parent();
				this._dnd_placeholder.get_parent()?.remove_child(this._dnd_placeholder);
				column.insert_child_below(this._dnd_placeholder, panel);
			} else if (drag_event.targetActor instanceof PanelColumn) {
				this._dnd_placeholder.get_parent()?.remove_child(this._dnd_placeholder);
				drag_event.targetActor.add_child(this._dnd_placeholder);
			} else {
				this._dnd_placeholder.get_parent()?.remove_child(this._dnd_placeholder);
			}

			return DND.DragMotionResult.NO_DROP;
		}

		_close(animate) {
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
	});

	var PanelGroup = GObject.registerClass(class LibPanel_PanelGroup extends St.BoxLayout {
		constructor(name, { panels = [], vertical = true } = {}) {
			super({
				// Enable this so the group block any click event from propagating through
				reactive: true,
				style_class: 'popup-menu-content quick-settings',
				style: 'spacing: 10px',
				vertical
			});
			this._delegate = this;
			this.hide();
			this._make_draggable();
			this._name = `${get_extension_name()}/${name}`;

			for (const panel of panels) {
				this.addPanel(panel);
			}
		}

		_make_draggable() {
			if (this._draggable) return;

			this._draggable = DND.makeDraggable(this);
			this._drag_begin_callback = this._draggable.connect("drag-begin", () => {
				QuickSettings.menu.transparent = false;
				QuickSettings.menu._fill_columns?.();
				this._drag_monitor = {
					dragMotion: this._on_drag_motion.bind(this),
				};
				DND.addDragMonitor(this._drag_monitor);

				this._dnd_placeholder?.destroy();
				this._dnd_placeholder = new DropZone(this);
			});
			this._drag_end_callback = this._draggable.connect("drag-end", () => {
				QuickSettings.menu.transparent = true;
				this._dnd_placeholder.destroy();
				this._dnd_placeholder = null;
				DND.removeDragMonitor(this._drag_monitor);
				this._drag_monitor = null;
			});
			this._destroy_callback = this.connect("destroy", () => {
				QuickSettings.menu.transparent = true;
				this._dnd_placeholder?.destroy();
				this._dnd_placeholder = null;
				DND.removeDragMonitor(this._drag_monitor);
				this._drag_monitor = null;
			});
		}

		_on_drag_motion(drag_event) {
			if (drag_event.source !== this) return DND.DragMotionResult.NO_DROP;
			if (drag_event.targetActor === this._dnd_placeholder) return DND.DragMotionResult.COPY_DROP;

			const panel = find_panel(drag_event.targetActor);
			if (panel !== null && panel.get_previous_sibling() !== this._dnd_placeholder) {
				const column = panel.get_parent();
				this._dnd_placeholder.get_parent()?.remove_child(this._dnd_placeholder);
				column.insert_child_below(this._dnd_placeholder, panel);
			} else if (drag_event.targetActor instanceof PanelColumn) {
				this._dnd_placeholder.get_parent()?.remove_child(this._dnd_placeholder);
				drag_event.targetActor.add_child(this._dnd_placeholder);
			} else {
				this._dnd_placeholder.get_parent()?.remove_child(this._dnd_placeholder);
			}

			return DND.DragMotionResult.NO_DROP;
		}

		addPanel(panel, index) {
			panel.style_class = '';
			panel._libpanel_visible_callback = panel.connect_after('notify::visible', this._update_visibility.bind(this));
			if (panel.visible) {
				this.show();
			}

			if (index === undefined) {
				this.add_child(panel);
			} else {
				this.insert_child_at_index(panel, index);
			}

			panel._draggable._disabled = true;
		}

		removePanel(panel) {
			panel.style_class = 'popup-menu-content quick-settings';
			panel.disconnect(panel._libpanel_visible_callback);
			this.remove_child(panel);
			this._update_visibility();
			panel._draggable._disabled = false;
		}

		_add_panel = this.addPanel;
		_remove_panel = this.removePanel;

		_update_visibility() {
			for (const panel of this.get_children()) {
				if (panel.visible) {
					this.show();
					return;
				}
			}

			this.hide();
		}

		_close(animate) {
			for (const panel of this.get_children()) {
				panel._close(animate);
			}
		}
	});

	class LibPanel_Class {
		VERSION = VERSION;
		Panel = Panel;
		PanelGroup = PanelGroup;

		constructor() {
			this.main_panel = QuickSettings.menu; // make the main panel available whether it's the gnome one or the libpanel one

			this.enablers = [];
			this.grid = null;
		}

		enable(name) {
			if (this.enablers.length === 0) {
				this._enable();
			}
			this.enablers.push(name);
		}

		disable(name) {
			const index = this.enablers.indexOf(name);
			if (index !== -1) this.enablers.splice(index, 1);
			if (this.enablers.length === 0) {
				this._disable();
			}
		}

		get enabled() {
			return this.enablers.length !== 0;
		}

		_enable() {
			this.grid = new PanelGrid(QuickSettings);
			this.settings = create_settings(Self.path, 'org.gnome.shell.extensions.libpanel');

			for (const column of this.settings.get_value("layout").recursiveUnpack().reverse()) {
				this.grid._add_column(column);
			}

			this.old_menu = QuickSettings.menu;

			QuickSettings.menu = null; // prevent old_menu from being explicitly destroyed
			QuickSettings.setMenu(this.grid);
			MenuManager.removeMenu(this.old_menu);
			this.old_menu.actor.get_parent().remove_child(this.old_menu.actor); // make sure the old menu is orphan (prevent errors in the logs)

			// The new panel that will hold the quick settings
			const new_menu = new Panel('', 2);
			new_menu._name = 'gnome@main';
			for (const child of this.old_menu._grid.get_children()) {
				if (child === this.old_menu._grid.layout_manager._overlay) continue;
				this._move_quick_setting(this.old_menu, new_menu, child);
			}
			this.addPanel(new_menu);
			this.main_panel = new_menu;

			// ====== Compatibility code =======
			//this.grid.box = new_menu.box; // this would override existing properties
			//this.grid.actor =  = new_menu.actor;
			this.grid._dimEffect = new_menu._dimEffect;
			this.grid._grid = new_menu._grid;
			this.grid._overlay = new_menu._overlay;
			this.grid._setDimmed = new_menu._setDimmed.bind(new_menu);
			this.grid.addItem = new_menu.addItem.bind(new_menu);
			// =================================
		}

		_disable() {
			this.grid = null;
			this.settings = null;

			for (const item of this.main_panel.getItems()) {
				const column_span = this.main_panel.getColumnSpan(item);
				const visible = item.visible;

				this.main_panel.removeItem(item);
				this.old_menu.addItem(item, column_span);
				item.visible = visible; // force reset of visibility
			}
			this.removePanel(this.main_panel);

			this.main_panel.destroy(); // this fix an error when destroying this.grid (originating from new_menu._grid), but I have no idea why
			QuickSettings.setMenu(this.old_menu); // this will destroy this.grid
			MenuManager.addMenu(this.old_menu);

			this.main_panel = this.old_menu;
			this.old_menu = null;
		}

		_move_quick_setting(old_menu, new_menu, item) {
			const column_span = this._get_column_span(old_menu._grid, item);
			const visible = item.visible;

			old_menu._grid.remove_child(item);

			if (item.menu) {
				old_menu._overlay.remove_child(item.menu.actor);

				for (const id of item.menu._signalConnectionsByName["open-state-changed"]) {
					if (item.menu._signalConnections[id].callback.toString().includes("this._setDimmed")) {
						item.menu.disconnect(id);
					}
				}
			}

			new_menu.addItem(item, column_span);
			item.visible = visible; // force reset of visibility
		}

		_get_column_span(grid, item) {
			const value = new GObject.Value();
			grid.layout_manager.child_get_property(grid, item, 'column-span', value);
			const column_span = value.get_int();
			value.unset();
			return column_span;
		}

		addPanel(panel) {
			this.grid._add_panel(panel);
		}

		removePanel(panel) {
			panel.get_parent()?._remove_panel(panel);
		}

		_save_layout() {
			const layout = this.grid._get_panel_layout();
			// Remove leading empty columns
			while (layout[0]?.length === 0) {
				layout.shift();
			}
			this.settings.set_value(
				"layout",
				GLib.Variant.new_array(
					GLib.VariantType.new('as'),
					layout.map(column => GLib.Variant.new_strv(column))
				)
			);
		}
	}

	// A BoxPointer that let pointer events pass through its blank spaces
	const TransparentBoxPointer = GObject.registerClass({
		Properties: {
			'transparent': GObject.ParamSpec.boolean(
				'transparent',
				'Transparent',
				'Whether this widget let pointer events pass through',
				GObject.ParamFlags.READWRITE,
				true
			),
		},
	}, class LibPanel_TransparentBoxPointer extends BoxPointer {
		get transparent() {
			if (this._transparent === undefined)
				this._transparent = true;

			return this._transparent;
		}

		set transparent(value) {
			this._transparent = value;
			this.notify('transparent');
		}

		vfunc_pick(context) {
			if (!this.transparent) {
				super.vfunc_pick(context);
			}
			for (const child of this.get_children()) {
				child.pick(context);
			}
		}
	});

	class PanelGrid extends PopupMenu {
		constructor(sourceActor) {
			super(sourceActor, 0, St.Side.TOP);

			// ======= We replace the BoxPointer with our own ======
			this._boxPointer.bin.remove_child(this.box);
			global.focus_manager.remove_group(this.actor);

			// Copied from https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/popupMenu.js#:~:text=this._boxPointer,802
			this._boxPointer = new TransparentBoxPointer(St.Side.TOP);
			this.actor = this._boxPointer;
			this.actor._delegate = this;
			this.actor.style_class = 'popup-menu-boxpointer';
			this.actor.y_expand = true;
			// Force the popup to take all the screen to allow drag and drop to empty spaces
			this.actor.connect_after('parent-set', () => {
				if (this._height_constraint) this.actor.remove_constraint(this._height_constraint);
				this._height_constraint = new Clutter.BindConstraint({
					coordinate: Clutter.BindCoordinate.HEIGHT,
					source: this.actor.get_parent(),
				});
				this.actor.add_constraint(this._height_constraint);
			});

			this._boxPointer.bin.set_child(this.box);
			this.actor.add_style_class_name('popup-menu');

			global.focus_manager.add_group(this.actor);
			this.actor.reactive = true;
			// =====================================================

			this.box.vertical = false;
			this.box.x_expand = false;
			this.box.y_expand = true;
			this.box.style_class = ''; // remove the defaut class which make a visible panel
			this.box.style = 'spacing: 5px';
		}

		get transparent() {
			return this.actor.transparent;
		}

		set transparent(value) {
			this.actor.transparent = value;
		}

		_get_column_height(column) {
			return column.get_children().reduce((acc, widget) => acc + widget.height, 0);
		}

		_add_panel(panel) {
			if (!this.box.get_children().length)
				this._add_column([]);

			for (const column of this.box.get_children()) {
				if (column._panel_layout.indexOf(panel._name) > -1) {
					column._add_panel(panel);
					return;
				}
			}

			// Everything here is really approximated because we can't have the allocations boxes at this point
			const max_height = this.actor.height;
			var column;
			for (const children of this.box.get_children().reverse()) {
				if (this._get_column_height(children) < max_height) {
					column = children;
					break;
				}
			}
			if (!column) column = this.box.first_child;
			if (this._get_column_height(column) > max_height) {
				column = this._add_column([]);
			}
			column._add_panel(panel);
		}

		// Fill the columns so they cover the whole screen
		// Can only be called when the grid is displayed
		_fill_columns() {
			while (this.actor.get_allocation_box().x1 > 0) {
				this._add_column([]);
			}
		}

		_add_column(layout) {
			const column = new PanelColumn(layout, this.box.first_child);
			this.actor.bind_property('transparent', column, 'transparent', GObject.BindingFlags.SYNC_CREATE);
			this.box.insert_child_at_index(column, 0);
			return column;
		}

		_get_panel_layout() {
			return this.box.get_children().map(column => column._panel_layout);
		}

		close(animate) {
			for (const column of this.box.get_children()) {
				column._close?.(animate);
			}
			super.close(animate);
		}
	}

	const PanelColumn = GObject.registerClass({
		Properties: {
			'transparent': GObject.ParamSpec.boolean(
				'transparent',
				'Transparent',
				'Whether this widget let pointer events pass through',
				GObject.ParamFlags.READWRITE,
				true
			),
		},
	}, class LibPanel_PanelColumn extends St.BoxLayout {
		constructor(layout, neighbour) {
			super({
				vertical: true,
				style: 'spacing: 5px',
				reactive: true,
				y_expand: true
			});
			this._delegate = this;
			this._panel_layout = layout;

			this._set_neighbour(neighbour);
			this._children_added_id = this.connect_after("actor-added", (container, actor) => {
				if (!(actor instanceof DropZone) && (this._panel_layout.indexOf(actor._name) < 0)) {
					var prev_sibling = actor.get_previous_sibling();
					var index = -1;
					while (prev_sibling && (index = this._panel_layout.indexOf(prev_sibling._name)) < 0) {
						prev_sibling = prev_sibling.get_previous_sibling();
					}
					index += 1;
					if (index < 0) index = 0;
					this._panel_layout.insert(index, actor._name);
				}
				this._update_visibility();
			});
			this._children_remove_id = this.connect_after("actor-removed", (container, actor) => {
				if (!(actor instanceof DropZone)) {
					this._panel_layout.remove(actor._name);
				}
				this._update_visibility();
			});
		}

		get transparent() {
			if (this._transparent === undefined)
				this._transparent = true;

			return this._transparent;
		}

		set transparent(value) {
			this._transparent = value;
			this.notify('transparent');
		}

		// Make the empty space of the column transparent to pointer events
		vfunc_pick(context) {
			if (!this.transparent) {
				super.vfunc_pick(context);
			}
			for (const child of this.get_children()) {
				child.pick(context);
			}
		}

		_update_visibility() {
			if (this.get_children().length === 0) {
				this._set_neighbour(this._neighbour);
			} else {
				this._set_neighbour(null);
			}
		}

		_set_neighbour(neighbour) {
			if (this._neighbour && this._width_changed_id) {
				this._neighbour.disconnect(this._width_changed_id);
				this.width = -1;
			}

			if (neighbour) {
				if (this._neighbour && this._destroyed_id) this._neighbour.disconnect(this._destroyed_id);
				this._neighbour = neighbour;
				this._width_changed_id = this._neighbour.connect("notify::allocation", () => {
					this.width = this._neighbour.allocation.get_width();
				});
				this._destroyed_id = this._neighbour.connect("destroy", () => {
					this._neighbour = null;
					this._width_changed_id = null;
					this._destroyed_id = null;
					this._set_neighbour(this.get_next_sibling());
				});
			} else {
				this._width_changed_id = null;
				this._destroyed_id = null;
			}
		}

		_add_panel(panel) {
			const layout_index = this._panel_layout.indexOf(panel._name);
			if (layout_index > -1) {
				const panels = this.get_children().map(children => children._name);
				for (const panel_name of this._panel_layout.slice(0, layout_index).reverse()) {
					const children_index = panels.indexOf(panel_name);
					if (children_index > -1) {
						this.insert_child_at_index(panel, children_index + 1);
						return;
					}
				}
				this.insert_child_at_index(panel, 0);
			} else {
				this.add_child(panel);
			}
		}

		_remove_panel(panel) {
			this.remove_child(panel);
		}

		_close(animate) {
			for (const panel of this.get_children()) {
				panel._close?.(animate);
			}
		}
	});

	var LibPanel = new LibPanel_Class();
	global._libpanel = LibPanel;
}