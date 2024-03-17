import WuduObject from './WuduObject.js';
import ObservableEvent from '../ObservableEvent.js';
import WuduData from './WuduData.js';
import Observable from "../Observable.js";

/**
 * @param {WuduArray} wuduArray
 * @return {*}
 */
const getType = function (wuduArray) {
    return wuduArray.constructor.$type;
}

const convert = function (instance, ...items) {
    const type = Object.getPrototypeOf(instance).constructor.$type;
    return items.map(item => {
        switch (type) {
            case 'string':
                return item + '';
            case 'boolean':
                return !!item;
            case 'number':
                return parseFloat(item);
            default:
                if (!(item instanceof type)) item = new type(item);
                if (item instanceof Observable) item.observe(instance.createSafeCallback(instance.onEvent));
                return item;
        }
    });
}

const data = Symbol();

export default class WuduArray extends WuduData {
    static $type = WuduObject;
    static from (type) {
        return class extends WuduArray {
            static $type = type;
        }
    };

    [data] = [];

    /**
     * @param {any[]} items
     */
    constructor (items = []) {
        super();
        const type = getType(this);
        const revProxy = Proxy.revocable(this, {
            get (target, key) {
                if (typeof key === 'symbol' || +key !== +key) {
                    if (typeof target[key] === 'function') {
                        return target[key].bind(revProxy.proxy);
                    } else if (typeof target[data][key] === 'function') {
                        return target[data][key].bind(target[data]);
                    }
                    return target[key] || target[data][key];
                }

                return target[data][key];
            },
            set (target, key, value) {
                if (+key !== +key) throw new Error(`setting ${key} is forbidden, only index keys allowed`);
                switch (type) {
                    case 'string':
                        value = value + '';
                        break;
                    case 'boolean':
                        value = !!value;
                        break;
                    case 'number':
                        value = parseFloat(value);
                        break;
                    default:
                        if (!(value instanceof type)) value = new type(value);
                        if (value instanceof Observable) {
                            value.observe(revProxy.proxy.createSafeCallback(target.onEvent));
                        }
                }
                const oldValue = target[data][key];
                if (oldValue instanceof Observable) oldValue.stopObserving(revProxy.proxy.createSafeCallback(target.onEvent));
                target[data][key] = value;
                revProxy.proxy.emit([new ObservableEvent({
                    initiator: revProxy.proxy,
                    data: {
                        index: key,
                        current: value,
                        previous: oldValue
                    },
                    type: 'modified'
                })]);
                return true;
            },
            ownKeys (target) {
                return target[data].keys();
            }
        });
        revProxy.proxy.applyData(items);
        return revProxy.proxy;
    }

    onEvent (events) {
        const ownEvents = [];
        for (let event of events) {
            const e = new ObservableEvent({
                data: event.data,
                initiator: event.initiator,
                emitter: this,
                type: event.type
            });
            e.breadcrumbs = [this.indexOf(event.emitter), ...event.breadcrumbs];
            e.emitter = this;
            ownEvents.push(e);
        }
        this.emit(ownEvents);
    }

    [Symbol.iterator] = function* () {
        let nextIndex = 0;
        while (nextIndex < this[data].length) {
            yield this[data][nextIndex++];
        }
    }

    copyWithin (target, start = 0, end = this[data].length) {
        Array.prototype.copyWithin.call(this[data], target, start, end);
        this.emit([new ObservableEvent({
            data: {
                target,
                start: start < 0 ? this[data].length + start : start,
                end: end < 0 ? this[data.length] + end : end
            },
            initiator: this,
            type: 'recalcindex'
        })])
    }

    fill (value, start = 0, end = this[data].length) {

    }

    pop () {
        const popped = this[data].pop();
        if (popped instanceof Observable) {
            popped.stopObserving(this.createSafeCallback(this.onEvent));
        }
        this.emit([new ObservableEvent({
            data: {
                count: 1,
                index: this[data].length - 1,
                items: popped
            },
            initiator: this,
            type: 'shrink'
        }), new ObservableEvent({
            type: 'modified',
            initiator: this,
            data: {
                key: 'length'
            }
        })]);
        return popped;
    }

    shift () {
        const shifted = this[data].shift();
        if (shifted instanceof Observable) {
            shifted.stopObserving(this.createSafeCallback(this.onEvent));
        }
        this.emit([new ObservableEvent({
            data: {
                count: 1,
                index: 0,
                items: shifted
            },
            initiator: this,
            type: 'shrink'
        }), new ObservableEvent({
            type: 'recalcindex',
            data: null,
            initiator: this
        }), new ObservableEvent({
            type: 'modified',
            initiator: this,
            data: {
                key: 'length'
            }
        })]);
        return shifted;
    }

    push (...items) {
        const pushIndex = this.length;
        items = convert(this, ...items);
        Array.prototype.push.apply(this[data], items);
        this.emit([new ObservableEvent({
            data: {
                count: items.length,
                index: pushIndex,
                items: items
            },
            initiator: this,
            type: 'grow'
        }), new ObservableEvent({
            type: 'modified',
            initiator: this,
            data: {
                key: 'length'
            }
        })]);
    }

    unshift (...items) {
        items = convert(this, ...items);
        Array.prototype.unshift.apply(this[data], items);
        this.emit([new ObservableEvent({
            data: {
                count: items.length,
                index: 0,
                items: items
            },
            initiator: this,
            type: 'grow'
        }), new ObservableEvent({
            type: 'recalcindex',
            data: null,
            initiator: this
        }), new ObservableEvent({
            type: 'modified',
            initiator: this,
            data: {
                key: 'length'
            }
        })]);
    }

    slice (start = 0, end = this[data].length) {
        return new this.constructor(Array.prototype.slice.call(this[data], start, end));
    }

    splice (start, deleteCount, ...items) {
        const pushIndex = start;
        items = convert(this, ...items);
        const deleted = Array.prototype.splice.call(this[data], start, deleteCount, ...items);
        if (deleted.length) {
            for (let item of deleted) {
                item.stopObserving(this.createSafeCallback(this.onEvent));
            }
            this.emit([new ObservableEvent({
                data: {
                    count: deleted.length,
                    index: start,
                    items: deleted
                },
                type: 'shrink',
                initiator: this
            }), new ObservableEvent({
                type: 'modified',
                initiator: this,
                data: {
                    key: 'length'
                }
            })]);
        }
        if (items.length) {
            this.emit([new ObservableEvent({
                data: {
                    count: items.length,
                    index: start,
                    items
                },
                type: 'grow',
                initiator: this
            }), new ObservableEvent({
                type: 'modified',
                initiator: this,
                data: {
                    key: 'length'
                }
            })]);
        }
        return deleted;
    }

    sort (cmpFn) {
        Array.prototype.sort.call(this[data], cmpFn);
        this.emit([new ObservableEvent({
            initiator: this,
            data: {},
            type: 'recalcindex'
        })]);
    }

    reverse () {
        this[data].reverse();
        this.emit([new ObservableEvent({
            type: 'recalcindex',
            initiator: this,
            data: null
        })]);
        return this;
    }

    /**
     * @param {any[]} data
     */
    applyData (data) {
        if (!(data instanceof Array) && !(data instanceof WuduArray)) data = [data];
        this.push(...data);
    }

    export () {
        const result = [];

        for (let item of this) {
            result.push(item?.export?.() || item);
        }

        return result;
    }

    toJSON () {
        const result = [];

        for (let item of this) {
            result.push(item?.toJSON?.() || JSON.stringify(item));
        }

        return result;
    }
}

export class WuduStringArray extends WuduArray {
    static $type = 'string';

    toJSON () {
        return [...this];
    }
}

export class WuduNumberArray extends WuduArray {
    static $type = 'number';
}

export class WuduBooleanArray extends WuduArray {
    static $type = 'boolean';
}