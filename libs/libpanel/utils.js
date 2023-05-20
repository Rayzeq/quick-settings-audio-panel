function get_stack() {
	return new Error().stack.split('\n').map(line => {
		console.log("trace", line);
	});
}