import Observable from '../Observable.js';
import ObservableEvent from '../ObservableEvent.js';
import WuduData from './WuduData.js';

const inEmitProcess = new WeakMap();
const optionsCache = new Map();
const valueKeyMap = Symbol();
const watchers = Symbol();
const bound = Symbol();

const createOptions = function (wuduObject) {
    const constructor = wuduObject.constructor;
    if (optionsCache.has(constructor)) return optionsCache.get(constructor);

    const options = {
        struct: constructor.$struct,
        state: constructor.$state,
        combined: {...constructor.$state, ...constructor.$struct},
        emitAsync: constructor.$emitAsync
    };
    options.bound = {};
    for (let [key, value] of Object.entries(options.combined)) {
        if (!value.bind) continue;
        if (!(value.bind instanceof Array)) value.bind = [value.bind];
        for (let bkey of value.bind) {
            if (!options.bound[bkey]) options.bound[bkey] = [];
            options.bound[bkey].push(key);
        }
    }
    optionsCache.set(constructor, options);
    return options;
}

const deepSet = (obj, key, value) => {
    if (obj[key] === value) return;
    if (value && typeof value === 'object') {
        if (!obj[key]) {
            obj[key] = value;
            return;
        }

        for (let [k, v] of Object.entries(value)) {
            deepSet(obj[key], k, v);
        }
        return;
    }
    obj[key] = value;
};

export default class WuduObject extends WuduData {
    static $emitAsync = false;
    [valueKeyMap] = new WeakMap();
    [watchers] = new Map();
    [bound];

    /**
     * @constructor
     * @returns {Proxy}
     */
    constructor (initData = {}) {
        super();
        const options = createOptions(this);
        this[bound] = options.bound;
        const vkMap = this[valueKeyMap];
        const keys = new Set();
        const revProxy = Proxy.revocable(this, {
            get (target, p) {
                if (p === 'dispose') {
                    return function () {
                        target.dispose();
                        revProxy.revoke();
                    }
                }
                if (p === '$options') {
                    return options;
                }
                let value = target[p];
                if (typeof value === 'function') return value.bind(revProxy.proxy);
                if (options.combined[p]) {
                    if (options.combined[p].get) {
                        value = options.combined[p].get.call(revProxy.proxy, value);
                    }
                    if (value === undefined) value = options.combined[p].default;
                }
                return value;
            },
            set (target, p, value) {
                if (p === 'dispose') throw new Error(`overriding ${p} is forbidden`);
                const previous = target[p];
                if (previous === value) return true;
                if (previous instanceof Observable) previous.stopObserving(revProxy.proxy.createSafeCallback(revProxy.proxy.onEvent));
                const opts = options.combined[p];
                if (opts) {
                    if (opts.set) {
                        value = options.combined[p].set.call(revProxy.proxy, value);
                    }
                    if (opts.type) {
                        switch (opts.type) {
                            case 'string':
                                value = value + '';
                                break;
                            case 'number':
                                value = value !== '' && value !== '-' ? +value : value;
                                break;
                            case 'boolean':
                                value = !!value;
                                break;
                            default:
                                if (!(value instanceof opts.type) && value) value = new opts.type(value);
                        }
                    }
                }
                if (previous === value) return true;
                if (value instanceof Observable) {
                    value.observe(revProxy.proxy.createSafeCallback(revProxy.proxy.onEvent));
                }
                if (value && typeof value === 'object') {
                    vkMap.set(value, p);
                }
                target[p] = value;
                keys.add(p);
                revProxy.proxy.emit([new ObservableEvent({
                    type: 'modified',
                    data: {key: p, previous, current: value},
                    initiator: revProxy.proxy
                })]);
                return true;
            },
            has (target, p) {
            },
            ownKeys(target) {
                return Reflect.ownKeys(target);
            },
            deleteProperty (target, p) {
                const previous = target[p];
                if (previous instanceof Observable) {
                    previous.stopObserving(revProxy.proxy.createSafeCallback(target.onEvent));
                }
                keys.delete(p);
                revProxy.proxy.emit([new ObservableEvent({
                    type: 'modified',
                    data: {key: p, previous, current: null},
                    initiator: revProxy.proxy
                })]);
                return true;
            },
            getOwnPropertyDescriptor(target, key) {
                return {
                    value: this.get(target, key),
                    enumerable: true,
                    configurable: true
                };
            }
        });
        revProxy.proxy.applyData(initData);
        return revProxy.proxy;
    }

    applyData (data) {
        if (!data) return;
        for (let [key, value] of Object.entries(data)) {
            this[key] = value;
        }
    }

    deepSet (data) {
        for (let [key, value] of Object.entries(data)) {
            deepSet(this, key, value);
        }
    }

    /**
     *
     * @param {(ObservableEvent)[]} events
     */
    onEvent (events) {
        events = events.map(event => {
            let newEvent = event;
            if (event instanceof ObservableEvent && this[valueKeyMap].has(event.emitter)) {
                newEvent = new ObservableEvent(event);
                newEvent.breadcrumbs = [this[valueKeyMap].get(event.emitter), ...event.breadcrumbs];
                newEvent.emitter = this;
            }
            return newEvent;
        });
        this.emit(events);
    }
    triggerRelated (events) {
        for (let event of events) {
            const path = event.path;
            if (this[bound][path]) {
                for (let key of this[bound][path]) {
                    let event = new ObservableEvent({
                        initiator: this,
                        type: 'modified',
                        data: {
                            key
                        }
                    });
                    this.emit([event]);
                }
            }
            if (!this[watchers].has(path)) continue;
            for (let watcher of this[watchers].get(path)) {
                watcher(event.data?.current);
            }
        }
    }
    emit (events) {
        if (!this.$options.emitAsync) {
            this.triggerRelated(events);
            super.emit(events);
            return;
        }
        if (inEmitProcess.has(this)) {
            inEmitProcess.get(this).push(...events);
            return;
        }
        const superEmit = this.createSafeCallback(super.emit);
        inEmitProcess.set(this, events);
        setTimeout(this.createSafeCallback(function () {
            const events = inEmitProcess.get(this);
            superEmit(events);
            this.triggerRelated(events);
            inEmitProcess.delete(this);
        }), 0);
    }
    watch (keys, callback, omitFirst) {
        if (!(keys instanceof Array)) keys = [keys];
        for (let key of keys) {
            if (!this[watchers].has(key)) this[watchers].set(key, new Set());
            this[watchers].get(key).add(callback);
            if (!omitFirst) callback(this[key]);
        }
    }
    unwatch (keys, callback) {
        if (!(keys instanceof Array)) keys = [keys];
        for (let key of keys) {
            if (!this[watchers].has(key)) continue;
            this[watchers].get(key).delete(callback);
        }
    }

    /**
     * Returns an object that contains only the fields defined in $struct
     * @returns {{}}
     */
    export () {
        const result = {};
        for (let key of Object.keys(this.$options.struct)) {
            result[key] = typeof this[key]?.export === 'function' ? this[key].export() : this[key];
        }
        return result;
    }

    /**
     * Returns the fields defined in both $struct and $state
     * @returns {{}}
     */
    toJSON () {
        const result = {};
        for (let key of Object.keys(this.$options.combined)) {
            result[key] = typeof this[key]?.toJSON === 'function' ? this[key].toJSON() : this[key];
        }
        return result;
    }
    dispose () {
        this[valueKeyMap] = new WeakMap();
        this[watchers] = new Map();
        super.dispose();
    }
}