/**
 * @typedef {Object} ObservableEventParams
 * @prop {string} type
 * @prop {Observable} initiator
 * @prop {Object=} data
 */

export default class ObservableEvent {
    breadcrumbs = [];
    /**
     * @param {ObservableEventParams} initParams
     */
    constructor (initParams = {}) {
        this.type = initParams.type;
        this.initiator = initParams.initiator;
        this.data = initParams.data;
        this.emitter = this.initiator;
    }
    get path () {
        let path = this.breadcrumbs.length ? this.breadcrumbs.join('.') : '';
        if (this.data && this.data.key) {
            path += path.length ? `.${this.data.key}` : this.data.key;
        }
        return path;
    }
}