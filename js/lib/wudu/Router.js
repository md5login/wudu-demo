class Route {
    static #ACTIVE = true;
    static #INACTIVE = false;
    static #CONTROLLER_IDLE = 0;
    static #CONTROLLER_LOADING = 1;
    static #CONTROLLER_LOADED = 2;
    static #CONTROLLER_ERROR = 3;
    static #CONTROLLER_ACTIVATING = 4;
    static #CONTROLLER_ACTIVE = 5;
    static #CONTROLLER_INACTIVE = 6;
    static #CONTROLLER_DEACTIVATING = 7;

    /** @private {string} controllerPath */
    #controllerPath;
    /** @private {Controller} controller */
    #controller;
    /** @private {string} path */
    #path;
    /** @private {RegExp} pattern */
    #pattern;
    /** @private {string} name */
    #name;
    /** @private {string[]} matchingGroup */
    #matchingGroups;
    /** @private {Object} data */
    #data;
    /** @private {boolean} state */
    #state = Route.#INACTIVE;
    /** @private {int} controllerState - indicates the state of controller loading */
    #controllerState = Route.#CONTROLLER_IDLE;

    /**
     *
     * @param {Object} config
     * @param {string} config.name - name of the controller
     * @param {string=} config.controllerPath - path to class that extends Controller
     * @param {Controller=} config.controller - path to class that extends Controller
     * @param {string} [config.path] - strict path to match
     * @param {RegExp} [config.pattern] - regexp pattern to match
     * @param {string[]} [config.matchingGroups] - array of names of regexp matching groups
     */
    constructor (config) {
        this.#path = config.path;
        this.#pattern = config.pattern;
        this.#name = config.name;
        this.#controllerPath = config.controllerPath;
        this.#controller = config.controller;
        this.#matchingGroups = config.matchingGroups;
    }

    #applyState = () => {
        this.#controller.updateState(this.#data);
        for (let listener of Router.listeners) {
            listener();
        }
    }

    #activate = async () => {
        // console.log(`activating ${this.#name}, state: ${this.#controllerState}`);
        this.#state = Route.#ACTIVE;
        switch (this.#controllerState) {
            case Route.#CONTROLLER_IDLE:
                this.#controllerState = Route.#CONTROLLER_LOADING;
                if (this.#controllerPath) {
                    let controller = await import(this.#controllerPath)
                        .catch(e => {
                            console.log(e);
                            this.#controllerState = Route.#CONTROLLER_ERROR
                        });
                    if (!controller || !controller.default) throw new Error('bad controller');
                    this.#controller = new controller.default();
                } else if (this.#controller) {
                    this.#controller = new this.#controller();
                }
                this.#controllerState = Route.#CONTROLLER_LOADED;
                // our state could change while loading the controller
                if (this.#state === Route.#ACTIVE) {
                    this.#controllerState = Route.#CONTROLLER_ACTIVATING;
                    let active = await this.#controller.activate(this.#data).catch(e => console.log(e));
                    // state could change while activating the controller
                    if (this.#controllerState === Route.#CONTROLLER_INACTIVE || this.#controllerState === Route.#CONTROLLER_DEACTIVATING) return this.#deactivate();
                    else this.#controllerState = active ? Route.#CONTROLLER_ACTIVE : Route.#CONTROLLER_ERROR;
                } else {
                    this.#controllerState = Route.#CONTROLLER_INACTIVE;
                }
                break;
            case Route.#CONTROLLER_INACTIVE:
            case Route.#CONTROLLER_DEACTIVATING:
                this.#controllerState = Route.#CONTROLLER_ACTIVATING;
                let active = await this.#controller.activate(this.#data).catch(e => console.log(e));
                if (this.#controllerState === Route.#CONTROLLER_INACTIVE || this.#controllerState === Route.#CONTROLLER_DEACTIVATING) return this.#deactivate();
                this.#controllerState = active ? Route.#CONTROLLER_ACTIVE : Route.#CONTROLLER_ERROR;
                break;
        }
        if (this.#controllerState === Route.#CONTROLLER_ACTIVE) this.#applyState();
    };

    #deactivate = () => {
        // console.log(`deactivating ${this.#name}, state: ${this.#controllerState}`);
        this.#state = Route.#INACTIVE;
        switch (this.#controllerState) {
            case Route.#CONTROLLER_ACTIVE:
            case Route.#CONTROLLER_ACTIVATING:
                this.#controllerState = Route.#CONTROLLER_DEACTIVATING;
                this.#controller.deactivate();
                this.#controllerState = Route.#CONTROLLER_INACTIVE;
                // console.log(`deactivated ${this.#name}, state: ${this.#controllerState}`);
                break;
        }
    };

    /**
     *
     * @param {string} path
     * @returns {boolean}
     */
    match (path) {
        this.#data = {};
        let hasMatch = false;
        if (this.#path) hasMatch = path.startsWith(this.#path);
        else if (this.#pattern) {
            let match = this.#pattern.exec(path);
            hasMatch = match !== null;
            if (hasMatch && this.#matchingGroups) {
                match.slice(1).forEach((word, i) => {
                    this.#data[this.#matchingGroups[i]] = word;
                });
            }
        }
        if (hasMatch) {
            this.#activate(this.#data).catch(e => console.error(e));
        } else if (this.#state === Route.#ACTIVE) {
            this.#deactivate();
        }
        return hasMatch;
    }

    get controller () {
        return this.#controller;
    }
}

export default class Router {
    /**
     * @type {Set<Function>}
     */
    static listeners = new Set();

    static init (routes) {
        routes.forEach(route => Router.addRoute(route));
        window.addEventListener('popstate', () => {
            Router.handleNavigation();
        });
        Router.handleNavigation();
    }

    /** @private {Map<Route>]} */
    static #routes = new Map();
    /** @private {Set<Route>} */
    static #activeRoutes = new Set();

    static #queue = [];
    static #working = false;

    /**
     * This function is triggered on history state change.
     */
    static handleNavigation = () => {
        Router.#working = true;
        let path = location.pathname;
        for (let [name, route] of Router.#routes) {
            if (route.match(path)) Router.#activeRoutes.add(route);
        }
        Router.#scanQueue();
    };

    static addRoute (routeConfig) {
        Router.#routes.set(routeConfig.name, new Route(routeConfig));
    }

    static getController (name) {
        return Router.#routes.has(name) ? Router.#routes.get(name).controller : null;
    }

    static go(url, data = {}, title = '') {
        if (location.pathname === url) return;
        Router.#queue.push({url, data, title});
        if (Router.#working) return;
        Router.#scanQueue();
    }

    static #scanQueue () {
        if (!Router.#queue.length) {
            Router.#working = false;
            return;
        }
        // console.log('router started working');
        const {data, title, url} = Router.#queue.shift();
        history.pushState(data, title, url);
        Router.handleNavigation();
    }

    static onStateChange (callback) {
        Router.listeners.add(callback);
    }

    static offStateChange (callback) {
        Router.listeners.delete(callback);
    }
}