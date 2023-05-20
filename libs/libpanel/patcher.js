const Self = global._libpanel_importer;

//const utils = Self.utils;

/*var Patcher = class Patcher {
	constructor() {
		this.patchs = [];
		this.object_patchs = [];
	}

	patch(object, patcher, unpatcher) {
		if (unpatcher === undefined) {
			const user_data = object();
			this.patchs.push([patcher, user_data]);
		} else {
			const user_data = patcher(object);
			this.object_patchs.push([object, unpatcher, user_data]);
		}
	}

	unpatch_all() {
		for (const [unpatcher, user_data] of this.patchs) {
			unpatcher(user_data);
		}
		this.patchs = [];
		for (const [object, unpatcher, user_data] of this.object_patchs) {
			unpatcher(object, user_data);
		}
		this.object_patchs = [];
	}
}*/