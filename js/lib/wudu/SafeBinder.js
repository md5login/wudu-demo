export default class SafeBinder {
    /**
     * @type {Map<function, EmitCallback>}
     */
    $safeCallbacks = new Map();

    $disposed = false;

    createSafeCallback (fn) {
        if (this.$disposed) return;
        if (this.$safeCallbacks.has(fn)) return this.$safeCallbacks.get(fn);

        const callback = function (...a) {
            if (this.$disposed) {
                this.$safeCallbacks.delete(fn);
                return;
            }
            return fn.call(this, ...a);
        }.bind(this);

        this.$safeCallbacks.set(fn, callback);

        return callback;
    }

    dispose () {
        this.$disposed = true;
        this.$safeCallbacks = new Map();
    }
}