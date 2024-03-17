import ObservableEvent from './ObservableEvent.js';
import SafeBinder from './SafeBinder.js';

/**
 * @callback EmitCallback
 * @param {string} event
 * @param {ObservableEvent} data
 */

export default class Observable extends SafeBinder {
    /**
     * @type {Map<string, Set<EmitCallback>>}
     */
    $handlers = new Map();

    /**
     * @type {Set<EmitCallback>}
     */
    $observers = new Set();

    /**
     * @param {string} event
     * @param {EmitCallback} callback
     */
    on (event, callback) {
        if (!this.$handlers.has(event)) this.$handlers.set(event, new Set());
        this.$handlers.get(event).add(callback);
    }

    /**
     * @param {string} event
     * @param {EmitCallback} callback
     */
    off (event, callback) {
        if (!this.$handlers.has(event)) return;
        this.$handlers.get(event).delete(callback);
    }

    /**
     * @param {EmitCallback} callback
     */
    observe (callback) {
        this.$observers.add(callback);
    }

    /**
     * @param {EmitCallback} callback
     */
    stopObserving (callback) {
        this.$observers.delete(callback);
    }

    /**
     * @param {(ObservableEventParams|ObservableEvent)[]} events
     */
    emit (events) {
        events = events.map(e => e instanceof ObservableEvent ? e : new ObservableEvent({data: e.data, type: e.type, initiator: this}));

        for (let observer of this.$observers) {
            observer(events);
        }

        for (let event of events) {
            if (!this.$handlers.has(event.type)) return;

            for (let handler of this.$handlers.get(event.type)) {
                handler([event]);
            }
        }
    }

    dispose () {
        this.emit([new ObservableEvent({
            type: 'dispose',
            initiator: this
        })])
        this.$handlers = new Map();
        this.$observers = new Set();
        super.dispose();
    }
}