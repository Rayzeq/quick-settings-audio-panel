//! The code for libpanel
//! Exports:
//!   - LibPanel: a global and unique instance of the library
//!   - Panel: a class to make new panels
//!   - PanelGroup: a class to merge multiple panels into one

//! TODO: movable panels, make README (forward issues, enhancement proposal, incompatibilities)
//! warning on win+r (don't come from this._show_callback_id)
//busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s '(new imports.ui.runDialog.RunDialog()).open()'
// Refactor: use Patcher to connect/constraints/add methods to classes/css classes, EVERY connect must be saved (also constraints)
//           APIs, document everything, set all arguments in connect, make everything available as LibPanel._PanelColumn
//           method parity between libpanel_panel and gnome_panel, merge nested panel groups


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
	const { GLib, GObject, Clutter, Meta, St } = imports.gi;

	const DND = imports.ui.dnd;
	const Main = imports.ui.main;
	const { PopupMenu } = imports.ui.popupMenu;
	const { BoxPointer } = imports.ui.boxpointer;

	const MenuManager = Main.panel.menuManager;
	const QuickSettings = Main.panel.statusArea.quickSettings;
	const QuickSettingsLayout = QuickSettings.menu._grid.layout_manager.constructor;

	const Self = function () {
		// See this link for explanations: https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/misc/extensionUtils.js#:~:text=function-,installImporter,-(extension)
		function create_importer(path) {
			path = path.split('/');
			if (path.at(-1) === '') path.pop();
			const name = path.pop();
			path = path.join('/');

			const oldSearchPath = imports.searchPath.slice();
			imports.searchPath = [path];
			importer = imports[name];
			imports.searchPath = oldSearchPath;
			return importer;
		}

		const libpanel_path = new Error().stack.split('\n')[0] // first line of the call stack
			.split('@').slice(1).join('@') // the first @ separate the function name and the file path
			.split('/').slice(0, -1).join('/') + '/'; // the last item of the path is the current file, so we take the one just before
		const Self = create_importer(libpanel_path);

		const handler = {
			get(target, name) {
				if (name in target) {
					return target[name];
				}
				return Self[name];
			},
		};

		return new Proxy({ path: libpanel_path }, handler);
	}();
	const { Patcher } = Self.patcher;
	const {
		array_remove, array_insert,
		get_extension_uuid, get_shell_version,
		add_named_connections, find_panel, get_settings
	} = Self.utils;

	// The spacing between elements of the grid in pixels.
	const GRID_SPACING = 5;

	const AutoHidable = superclass => {
		// We need to cache the created classes or else we would register the same class name multiple times
		if (AutoHidable.cache === undefined) AutoHidable.cache = {};
		if (AutoHidable.cache[superclass.name] !== undefined) return AutoHidable.cache[superclass.name];

		const klass = GObject.registerClass({
			GTypeName: `LibPanel_AutoHidable_${superclass.name}`,
		}, class extends superclass {
			constructor(...args) {
				const container = args.at(-1).container;
				delete args.at(-1).container;
				super(...args);

				// We need to accept `null` as valid value here
				// which is why we don't do `container || this`
				this.container = container === undefined ? this : container;
			}

			get container() {
				return this._lpah_container;
			}

			set container(value) {
				if (this._lpah_container !== undefined) this.disconnect_named(this._lpah_container);
				if (value !== null) {
					this._lpah_container = value;
					this.connect_named(this._lpah_container, 'actor-added', (_container, children) => {
						this.connect_named(children, 'notify::visible', this._update_visibility.bind(this));
						this._update_visibility();
					});
					this.connect_named(this._lpah_container, 'actor-removed', (_container, children) => {
						this.disconnect_named(children);
						this._update_visibility();
					});
					this._update_visibility();
				}
			}

			_get_ah_children() {
				return this._lpah_container.get_children();
			}

			_update_visibility() {
				for (const child of this._get_ah_children()) {
					if (child.visible) {
						this.show();
						return;
					}
				}

				this.hide();
				// Force the widget to take no space when hidden (this fixes some bugs but I don't know why)
				this.queue_relayout();
			}
		});
		AutoHidable.cache[superclass.name] = klass;
		return klass;
	};

	const Semitransparent = superclass => {
		// We need to cache the created classes or else we would register the same class name multiple times
		if (Semitransparent.cache === undefined) Semitransparent.cache = {};
		if (Semitransparent.cache[superclass.name] !== undefined) return Semitransparent.cache[superclass.name];

		const klass = GObject.registerClass({
			GTypeName: `LibPanel_Semitransparent_${superclass.name}`,
			Properties: {
				'transparent': GObject.ParamSpec.boolean(
					'transparent',
					'Transparent',
					'Whether this widget is transparent to pointer events',
					GObject.ParamFlags.READWRITE,
					true
				),
			},
		}, class extends superclass {
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
		Semitransparent.cache[superclass.name] = klass;
		return klass;
	};

	const GridItem = superclass => {
		// We need to cache the created classes or else we would register the same class name multiple times
		if (GridItem.cache === undefined) GridItem.cache = {};
		if (GridItem.cache[superclass.name] !== undefined) return GridItem.cache[superclass.name];

		const klass = GObject.registerClass({
			GTypeName: `LibPanel_GridItem_${superclass.name}`,
			Properties: {
				'draggable': GObject.ParamSpec.boolean(
					'draggable',
					'draggable',
					'Whether this widget can be dragged',
					GObject.ParamFlags.READWRITE,
					true
				),
			},
		}, class extends superclass {
			constructor(name, ...args) {
				super(...args);

				this.is_grid_item = true;
				this.name = name;

				this._drag_handle = DND.makeDraggable(this);
				this.connect_named(this._drag_handle, 'drag-begin', () => {
					QuickSettings.menu.transparent = false;

					// Prevent the first column from disapearing if it only contains `this`
					const column = this.get_parent();
					this._source_column = column;
					if (column.get_next_sibling() === null && column.get_children().length === 1) {
						column._width_constraint.source = this;
						column._inhibit_constraint_update = true;
					}

					this._dnd_placeholder?.destroy();
					this._dnd_placeholder = new DropZone(this);

					this._drag_monitor = {
						dragMotion: this._on_drag_motion.bind(this),
					};
					DND.addDragMonitor(this._drag_monitor);

					this._drag_orig_index = this.get_parent().get_children().indexOf(this);
				});
				// This is emited BEFORE drag-end, which means that this._dnd_placeholder is still available
				this.connect_named(this._drag_handle, 'drag-cancelled', () => {
					// This stop the dnd system from doing anything with `this`, we want to manage ourselves what to do.
					this._drag_handle._dragState = DND.DragState.CANCELLED;

					if (this._dnd_placeholder.get_parent() !== null) {
						this._dnd_placeholder.acceptDrop(this);
					} else { // We manually reset the position of the panel because the dnd system will set it at the end of the column
						this.get_parent().remove_child(this);
						this._drag_handle._dragOrigParent.insert_child_at_index(this, this._drag_orig_index);
					}
				});
				// This is called when the drag ends with a drop and when it's cancelled
				this.connect_named(this._drag_handle, 'drag-end', (_drag_handle, _time, _cancelled) => {
					QuickSettings.menu.transparent = true;

					if (this._drag_monitor !== undefined) {
						DND.removeDragMonitor(this._drag_monitor);
						this._drag_monitor = undefined;
					}

					this._dnd_placeholder?.destroy();
					this._dnd_placeholder = null;

					const column = this._source_column;
					if (!column._is_destroyed && column._width_constraint.source == this) {
						column._width_constraint.source = column.get_next_sibling();
						column._inhibit_constraint_update = false;
					}
				});
				this.connect_named(this, 'destroy', () => {
					if (this._drag_monitor !== undefined) {
						DND.removeDragMonitor(this._drag_monitor);
						this._drag_monitor = undefined;
					}
				});
			}

			get draggable() {
				return this._drag_handle._disabled || false;
			}
	
			set draggable(value) {
				this._drag_handle._disabled = value;
				this.notify('draggable');
			}

			_on_drag_motion(event) {
				if (event.source !== this) return DND.DragMotionResult.CONTINUE;
				if (event.targetActor === this._dnd_placeholder) return DND.DragMotionResult.COPY_DROP;

				const panel = find_panel(event.targetActor);

				const previous_sibling = panel?.get_previous_sibling();
				const target_pos = panel?.get_transformed_position();
				const self_size = this.get_transformed_size();

				this._dnd_placeholder.get_parent()?.remove_child(this._dnd_placeholder);

				if (event.targetActor instanceof PanelColumn) {
					event.targetActor.add_child(this._dnd_placeholder);
				} else if (panel !== undefined) {
					const column = panel.get_parent();
					if (previous_sibling === this._dnd_placeholder || event.y > (target_pos[1] + self_size[1])) {
						column.insert_child_above(this._dnd_placeholder, panel);
					} else {
						column.insert_child_below(this._dnd_placeholder, panel);
					}
				}

				return DND.DragMotionResult.NO_DROP;
			}
		});
		GridItem.cache[superclass.name] = klass;
		return klass;
	};

	const DropZone = GObject.registerClass(class LibPanel_DropZone extends St.Widget {
		constructor(source) {
			super({ style_class: source.style_class, opacity: 127 });
			this._delegate = this;

			this._height_constraint = new Clutter.BindConstraint({
				coordinate: Clutter.BindCoordinate.WIDTH,
				source: source,
			});
			this._width_constraint = new Clutter.BindConstraint({
				coordinate: Clutter.BindCoordinate.HEIGHT,
				source: source,
			});
			this.add_constraint(this._height_constraint);
			this.add_constraint(this._width_constraint);
		}

		acceptDrop(source, _actor, _x, _y, _time) {
			if (!source.is_grid_item) return false;

			source.get_parent().remove_child(source);

			const column = this.get_parent();
			column.replace_child(this, source);

			column.get_parent()._delegate._cleanup();
			global._libpanel._save_layout();
			return true;
		}
	});

	// copied from https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/quickSettings.js
	const DIM_BRIGHTNESS = -0.4;
	const POPUP_ANIMATION_TIME = 400;

	var Panel = GObject.registerClass(class LibPanel_Panel extends GridItem(AutoHidable(St.Widget)) {
		constructor(name, nColumns = 2) {
			super(`${get_extension_uuid()}/${name}`, {
				// Enable this so the menu block any click event from propagating through
				reactive: true,
				// If we don't set any layout, padding won't get applied
				layout_manager: new Clutter.BinLayout(),
				style_class: 'popup-menu-content quick-settings',
				// We want to set this later
				container: null
			});
			this._delegate = this;

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
			this.container = this._grid;
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
			});
			this._show_callback_id = this.connect("stage-views-changed", () => {
				const css = this.get_theme_node();
				constraint.offset = css.get_padding(St.Side.RIGHT) + // which mean we need to acknowledge for the internal padding of `this`
					css.get_padding(St.Side.LEFT);
			});
			this._overlay.add_constraint(constraint);
			this.add_child(this._overlay);
		}

		addItem(item, colSpan = 1) {
			this._grid.add_child(item);
			this.setColumnSpan(item, colSpan);

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
			item.get_parent().remove_child(item);
			if (item.menu) {
				if (item._libpanel_open_callback) item.menu.disconnect(item._libpanel_open_callback); // TODO: patch connect / disconnect to use Patcher, and add try_disconnect()
				item.menu.actor.get_parent().remove_child(item.menu.actor);
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
			this._grid.layout_manager.child_set_property(this._grid, item, 'column-span', colSpan);
		}

		_get_ah_children() {
			return this.getItems();
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

	var PanelGroup = GObject.registerClass(class LibPanel_PanelGroup extends GridItem(St.BoxLayout) {
		constructor(name, { panels = [], vertical = true } = {}) {
			super(`${get_extension_uuid()}/${name}`, {
				// Enable this so the group block any click event from propagating through
				reactive: true,
				style_class: 'popup-menu-content quick-settings',
				style: 'spacing: 10px',
				vertical
			});
			this._delegate = this;

			this.connect_after_named(this, 'actor-added', (_self, actor) => {
				if (!actor.is_grid_item) return;

				actor._style_class_backup = actor.style_class;
				actor.style_class = '';
				actor._drag_handle._disabled = true;
			});
			this.connect_after_named(this, 'actor-removed', (_self, actor) => {
				if (!actor.is_grid_item) return;

				actor.style_class = actor._style_class_backup;
				actor._style_class_backup = undefined;
				actor._drag_handle._disabled = false;
			});

			for (const panel of panels) {
				this.addPanel(panel);
			}
		}

		addPanel(panel, index) {
			//panel.style_class = '';

			if (index === undefined) {
				this.add_child(panel);
			} else {
				this.insert_child_at_index(panel, index);
			}

			//panel._drag_handle._disabled = true;
		}

		removePanel(panel) {
			//panel.style_class = 'popup-menu-content quick-settings';
			this.remove_child(panel);
			//panel._drag_handle._disabled = false;
		}

		/*_add_panel = this.addPanel;
		_remove_panel = this.removePanel;*/

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

		enable() {
			if (this.enablers.length === 0) this._enable();

			const uuid = get_extension_uuid();
			if (this.enablers.indexOf(uuid) < 0) this.enablers.push(uuid);
		}

		disable() {
			const index = this.enablers.indexOf(get_extension_uuid());
			if (index > -1) this.enablers.splice(index, 1);

			if (this.enablers.length === 0) this._disable();
		}

		get enabled() {
			return this.enablers.length !== 0;
		}

		_enable() {
			this.patcher = new Patcher();
			// Permit disabling widget dragging
			this.patcher.replace_method(DND._Draggable, function _grabActor(wrapped, device, touchSequence) {
				if (this._disabled) return;
				wrapped(device, touchSequence);
			});
			// Backport from https://gitlab.gnome.org/GNOME/gnome-shell/-/merge_requests/2770
			if (get_shell_version().major <= 44) {
				this.patcher.replace_method(DND._Draggable, function _updateDragHover(_wrapped) {
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
				});
			}
			// Named connections
			add_named_connections(this.patcher, GObject.Object);

			this.grid = new PanelGrid(QuickSettings);
			this.settings = get_settings(`${Self.path}/org.gnome.shell.extensions.libpanel.gschema.xml`);

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
			new_menu.name = 'gnome@main';
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
			for (const item of this.main_panel.getItems()) {
				const column_span = this.main_panel.getColumnSpan(item);
				const visible = item.visible;

				this.main_panel.removeItem(item);
				this.old_menu.addItem(item, column_span);
				item.visible = visible; // force reset of visibility
			}
			this.removePanel(this.main_panel);

			this.main_panel.destroy(); // this fix an error when destroying this.grid (originating from new_menu._grid), but I have no idea why
			/*for (const column of this.grid.get_children())  // this fix an error in 
				column.get_parent().remove_child(column)*/
			QuickSettings.setMenu(this.old_menu); // this will destroy this.grid
			MenuManager.addMenu(this.old_menu);

			this.main_panel = this.old_menu;
			this.old_menu = null;

			this.patcher.unpatch_all();

			this.grid = null;
			this.settings = null;
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
			this._save_layout();
		}

		removePanel(panel) {
			//panel.get_parent()?._remove_panel(panel);
			panel.get_parent()?.remove_child(panel);
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

	class PanelGrid extends PopupMenu {
		constructor(sourceActor) {
			super(sourceActor, 0, St.Side.TOP);

			// ==== We replace the BoxPointer with our own because we want to make it transparent ====
			// The majority of this code has been copied from here:
			// https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/main/js/ui/popupMenu.js#L801
			this._boxPointer.bin.remove_child(this.box);
			global.focus_manager.remove_group(this.actor);

			// We want to make the actor transparent
			this._boxPointer = new (Semitransparent(BoxPointer))(this._arrowSide);
			this.actor = this._boxPointer;
			this.actor._delegate = this;
			this.actor.style_class = 'popup-menu-boxpointer';
			// Force the popup to take all the screen to allow drag and drop to empty spaces
			this.actor.connect_after('parent-set', () => {
				if (this._height_constraint) this.actor.remove_constraint(this._height_constraint);
				const parent = this.actor.get_parent();
				if (parent === null) {
					this._height_constraint = undefined;
				} else {
					this._height_constraint = new Clutter.BindConstraint({
						coordinate: Clutter.BindCoordinate.HEIGHT,
						source: parent,
					});
					this.actor.add_constraint(this._height_constraint);
				}
			});
			// And manually add the bottom margin. This is useless as the grid is invisible,
			// but in case something make it visible it looks nice
			this.actor.connect_after('stage-views-changed', () => {
				if (this.actor.get_stage() === null || this._height_constraint === undefined) return;
				this._height_constraint.offset = -this.actor.getArrowHeight();
			});

			this._boxPointer.bin.set_child(this.box);
			this.actor.add_style_class_name('popup-menu');

			global.focus_manager.add_group(this.actor);
			this.actor.reactive = true;
			// =======================================================================================

			this.box._delegate = this;
			this.box.vertical = false;
			this._panel_style_class = this.box.style_class; // we save the style class that's used to make a nice panel
			this.box.style_class = ''; // and we remove it so it's invisible
			this.box.style = 'spacing: 5px';

			this.actor.connect('notify::allocation', () => {
				if (this.actor.x > 0) setTimeout(this._add_column.bind(this), 0);
			});
		}

		get transparent() {
			return this.actor.transparent;
		}

		set transparent(value) {
			this.actor.transparent = value;
		}

		_cleanup() {
			while (this.box.last_child.get_children().length === 0) this.box.last_child.destroy();
		}

		_get_column_height(column) {
			return column.get_children().reduce((acc, widget) => acc + widget.height, 0);
		}

		_add_panel(panel) {
			if (!this.box.get_children().length)
				this._add_column();

			for (const column of this.box.get_children()) {
				if (column._panel_layout.indexOf(panel.name) > -1) {
					column._add_panel(panel);
					return;
				}
			}

			// Everything here is really approximated because we can't have the allocations boxes at this point
			const max_height = this.actor.height;
			let column;
			for (const children of this.box.get_children().reverse()) {
				if (this._get_column_height(children) < max_height) {
					column = children;
					break;
				}
			}
			if (!column) column = this.box.first_child;
			if (this._get_column_height(column) > max_height) {
				column = this._add_column();
			}
			column._add_panel(panel);
		}

		_add_column(layout = []) {
			const column = new PanelColumn(layout);
			this.actor.bind_property('transparent', column, 'transparent', GObject.BindingFlags.SYNC_CREATE);
			this.box.insert_child_at_index(column, 0);
			return column;
		}

		_get_panel_layout() {
			return this.box.get_children().map(column => column._panel_layout);
		}
	}

	const PanelColumn = GObject.registerClass(class LibPanel_PanelColumn extends Semitransparent(St.BoxLayout) {
		constructor(layout = []) {
			super({ vertical: true, style: `spacing: ${GRID_SPACING}px` });
			this._panel_layout = layout;

			this._inhibit_constraint_update = false;
			this._width_constraint = new Clutter.BindConstraint({
				coordinate: Clutter.BindCoordinate.WIDTH,
				source: null,
			});
			this.add_constraint(this._width_constraint);

			this.connect_after_named(this, 'actor-added', (_self, actor) => {
				if (this.get_children().length === 1) this.remove_constraint(this._width_constraint);
				if (!actor.is_grid_item) return;

				const prev_index = this._panel_layout.indexOf(actor.get_previous_sibling()?.name);
				const index = this._panel_layout.indexOf(actor.name);
				const next_index = this._panel_layout.indexOf(actor.get_next_sibling()?.name);
				// `actor` is in the layout but is misplaced
				if (index > -1 && ((prev_index > -1 && index < prev_index) || (next_index > -1 && next_index < index))) {
					array_remove(this._panel_layout, actor.name);
					index = -1;
				}
				if (index < 0) { // `actor` is not in the layout
					if (prev_index > -1)
						array_insert(this._panel_layout, prev_index + 1, actor.name);
					else if (next_index > 0)
						array_insert(this._panel_layout, next_index - 1, actor.name);
					else
						array_insert(this._panel_layout, 0, actor.name);
				}
			});
			this.connect_after_named(this, 'actor-removed', (_self, actor) => {
				if (this.get_children().length === 0) this.add_constraint(this._width_constraint);
				if (!actor.is_grid_item) return;

				array_remove(this._panel_layout, actor.name);
			});

			this.connect("destroy", () => this._is_destroyed = true);
			this.connect_after_named(this, 'parent-set', (_self, old_parent) => {
				if (old_parent !== null) this.disconnect_named(old_parent);

				const parent = this.get_parent();
				if (parent === null) return;
				const update_source = (_parent, _actor) => {
					// clutter is being dumb and emit this signal even though `_parent` and `this` are destroyed
					// this fix it
					if (this._is_destroyed || this._inhibit_constraint_update) return;
					this._width_constraint.source = this.get_next_sibling();
				};
				this.connect_after_named(parent, 'actor-added', update_source);
				this.connect_after_named(parent, 'actor-removed', update_source);

				update_source();
			});
		}

		_add_panel(panel) {
			const index = this._panel_layout.indexOf(panel.name);
			if (index > -1) {
				const panels = this.get_children().map(children => children.name);
				for (const panel_name of this._panel_layout.slice(0, index).reverse()) {
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
	});

	var LibPanel = new LibPanel_Class();
	global._libpanel = LibPanel;
}