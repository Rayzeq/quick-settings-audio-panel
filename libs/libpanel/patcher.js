var Patcher = class Patcher {
	constructor() {
		this.patchs = {};
	}

	_check_name(name) {
		if (name in this.patchs) {
			console.error(
				`You tried to create a patch named \`${patch_name}\`, but another one already exists with the same name.`,
				"This is likely a bug in your extension, so the patch hasn't been applied."
			);
			return false;
		}
		return true;
	}

	replace_method(object, new_method, patch_name = undefined) {
		const name = new_method.name;

		if (patch_name === undefined) {
			patch_name = `${object.name}.${name}`;
			if (patch_name in this.patchs) {
				console.error(
					`It seems you tried to replace the same method twice with this patcher (${object.name}.${name}).`,
					"This is likely a bug in your extension, so the patch hasn't been applied.",
					"If it's not a bug, you must specify an explicit patch name."
				);
				return;
			};
		} else if (!this._check_name(patch_name)) return;

		const old_method = object.prototype[new_method.name];
		object.prototype[name] = function () {
			new_method.bind(this)(old_method?.bind(this), ...arguments);
		}

		this.patchs[patch_name] = { type: 'method_replace', object, name, original: old_method };
	}

	unpatch(name) {
		const patch = this.patchs[name];
		delete this.patchs[name];

		switch (patch.type) {
			case 'method_replace': {
				const { object, name, original } = patch;
				object.prototype[name] = original;
				break;
			}
			default:
				console.error(`Unknown patch type: ${patch.type}`);
		}
	}

	unpatch_all() {
		for (const name of Object.keys(this.patchs)) {
			this.unpatch(name);
		}
	}
};