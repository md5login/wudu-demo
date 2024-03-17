import Observable from './Observable.js';
import ObservableEvent from './ObservableEvent.js';

class DataModifiedEvent extends ObservableEvent {
    constructor () {
        super();
    }
}

export class Data extends Observable {
    constructor (data) {
        super();

        const proxy = Proxy.revocable(this, {});

        return proxy.proxy;
    }

    export () {}

    toJSON () {}

    dispose () {
        super.dispose();
    }
}