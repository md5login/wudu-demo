import Observable from "./Observable.js";

export default class Controller extends Observable {
    async activate () {
        return true;
    }
    async updateState () {
        return true;
    }
    async deactivate () {
        return true;
    }
}