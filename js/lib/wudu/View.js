import Observable from './Observable.js';
import DomManager from './dom/DomManager.js';
import ObservableEvent from './ObservableEvent.js';
import WuduData from './data/WuduData.js';
import WuduObject from './data/WuduObject.js';

const loadedTemplates = new Map();
const loadedStyles = new Map();

/**
 * @callback TemplatePipe
 * @param {string} template - original template
 * @return {string} parsed template
 */

/**
 * @typedef {Object} ViewOptions
 * @prop {string}           [template]              - template url/string to load/parse into DOM
 * @prop {string}           [css]                   - CSS url/string to load as style
 * @prop {string}           [resolvePath?]          - if given, template and css urls will be resolve through path
 * @prop {string | Element} [parent]                - the selector/element to append the parsed DOM to
 * @prop {Object}           [modelType]             - the.model to bound to the DOM
 * @prop {boolean}          [awaitParent]           - whether to continuously check if parent exists in dom before appending
 * @prop {DomManager}       [domManager]            - dom manager that implements the DomManager interface
 * @prop {number}           [parentCheckInterval]   - interval in ms to check whether parent exists
 * @prop {number}           [parentCheckMaxIter]    - max iterations to check whether parent existing. Aborts rendering after that. -1 - infinity
 * @prop {boolean}          [renderOnReady]         - render the DOM once template and style are ready
 * @prop {Array[TemplatePipe]}  [templateParsers]   - array of functions to modify the template before it is parsed into DOM
 */

/**
 * @type {ViewOptions}
 */
const viewOptions = {
    parent: null,
    modelType: null,
    awaitParent: true,
    parentCheckInterval: 100,
    parentCheckMaxIter: 10,
    renderOnReady: true
};

/**
 * @param {string} template - url or markup of the template to load
 * @param {string} resolvePath
 * @return {Promise<string>}
 */
export async function loadTemplate (template) {
    if (loadedTemplates.has(template)) return loadedTemplates.get(template);

    let src = template;
    if (template.endsWith('.html')) {
        src = await fetch(template).then(r => r.text());
        loadedTemplates.set(template, src);
    }

    return src;
}

export async function loadStyle (style) {
    if (!style) return;
    let el;
    if (loadedStyles.has(style)) return loadedStyles.get(style);

    if (style.endsWith('.css')) {
        await new Promise((resolve, reject) => {
            let link = document.createElement('link');
            link.rel = 'stylesheet';
            link.type = 'text/css';
            link.onload = resolve;
            link.onerror = reject;
            link.href = style;
            document.head.appendChild(link);
            el = link;
        });
    } else {
        const styleEl = document.createElement('style');
        styleEl.textContent = style;
        document.head.appendChild(styleEl);
        el = styleEl;
    }

    loadedStyles.set(style, el);

    return el;
}

function resolvePaths (path) {
    return [`${path}/template.html`, `${path}/style.css`];
}

/**
 * @param {View} view
 * @param {ViewOptions} options
 * @return {ViewOptions}
 */
function createViewOptions (view, options) {
    const constructor = view.constructor;
    const classDefined = {
        template: constructor.$template,
        css: constructor.$css,
        parent: constructor.$parent ?? viewOptions.parent,
        modelType: constructor.$modelType ?? viewOptions.modelType,
        renderOnReady: constructor.$renderOnReady ?? viewOptions.renderOnReady,
        domManager: constructor.$domManager,
        resolvePath: constructor.$resolvePath,
        templateParsers: constructor.$templateParsers
    };
    return {
        ...viewOptions,
        ...classDefined,
        ...options
    }
}

/**
 * @typedef {function} Interrupt
 * @returns {boolean}
 */

/**
 *
 * @param {Object} params
 * @param {string} params.selector - the parent selector to wait for
 * @param {number} params.interval
 * @param {number} params.maxIterCount
 * @param {number} [params.currentCount]
 * @param {Interrupt} [params.interrupt] - function that should return a boolean to indicate whether appending should stop
 * @param {function} [params.callback] - callback after successful appending
 */
function onElementReady (params) {
    const {selector, interval, maxIterCount, currentCount = 0, interrupt, callback} = params;
    if (interrupt && interrupt()) return;
    if (maxIterCount && maxIterCount <= currentCount) return;

    const parent = document.querySelector(selector);
    if (!parent) {
        params.currentCount++;
        Ticker.timeout(() => {
            onElementReady(params);
        }, interval);
        return;
    }
    callback && callback();
}

export default class View extends Observable {
    #model;
    /**
     * @static
     * @param $domManager;
     */
    static $domManager = DomManager;

    static $templateParsers = [];

    static $modelType = WuduObject;

    /**
     * @type ViewOptions
     */
    $options;

    $domManager;

    get model () {
        return this.#model;
    }

    set model (value) {
        if (this.model !== value && this.model instanceof Observable) {
            this.model.stopObserving(this.createSafeCallback(this.onEvents))
        }
        const type = this.$options.modelType || WuduObject;
        if (value instanceof type) {
            this.#model = value;
        } else {
            this.#model = new type(value);
        }
        if (this.#model instanceof Observable) {
            this.#model.observe(this.createSafeCallback(this.onEvents));
        }
    }

    /**
     * @param {ViewOptions} options
     * @param {any} initOptions - this param will be passed to init()
     */
    constructor (options = {}, initOptions) {
        super();
        this.$options = createViewOptions(this, options);

        this.model = {};

        const initResult = this.init && this.init(initOptions);

        if (!this.$options.renderOnReady) return;

        if (initResult?.then) {
            initResult.then(() => {
                if (this.$disposed) return;
                this.render();
                // loadDicts(this.constructor.$dicts).then(() => this.render());
            });
            return;
        }

        // loadDicts(this.constructor.$dicts).then(() => this.render());
        this.render();
    }

    init () {
    }

    onEvents (events) {
        const dataEvents = [], componentEvents = [];
        for (let event of events) {
            if (event.initiator instanceof WuduData) {
                dataEvents.push(event);
            } else if (event.initiator instanceof View) {
                componentEvents.push(event);
            }
        }

        this.onDataEvents(dataEvents);
        this.onComponentEvents(componentEvents);
    }

    onComponentEvents (events) {
    }

    onDataEvents (events) {
        if (this.$domManager) {
            for (let event of events) {
                if (/before|after/.test(event.type)) continue;
                this.$domManager.onDataChange(event.path || event.model.key, this.model, event);
            }
        }
    }

    /**
     *
     * @return {Promise<void>}
     */
    async render () {
        if (this.$disposed) return;

        let template, css;
        if (this.$options.resolvePath) {
            [template, css] = resolvePaths(this.$options.resolvePath);
        } else {
            template = this.$options.template;
            css = this.$options.css;
        }
        const tplLoader = loadTemplate(template);
        const cssLoader = loadStyle(css);

        this.$tpl = await tplLoader;

        if (this.$disposed) return;

        for (let parser of this.$options.templateParsers) {
            this.$tpl = await parser(this.$tpl, this);
        }

        if (this.$disposed) return;

        this.beforeRender();

        this.emit([new ObservableEvent({
            type: 'render:before',
            initiator: this
        })])

        this.$domManager = new this.$options.domManager(this.$tpl, this);

        this.emit([new ObservableEvent({
            type: 'append:before',
            initiator: this
        })])

        await cssLoader;
        if (this.$disposed) return;

        this.beforeAppend();

        this.#append();

        this.emit([new ObservableEvent({
            type: 'append:after',
            initiator: this
        })])
    }

    #append () {
        if (typeof this.$options.parent === 'string') {
            const parent = document.querySelector(this.$options.parent);
            if (parent) {
                this.$domManager.apply(this.model);
                this.$domManager.appendTo(parent);
                this.afterAppend();
                return;
            }

            if (!this.$options.awaitParent) throw new Error(`parent element ${parent} doesn't exist`);

            onElementReady({
                selector: this.$options.parent,
                interval: this.$options.parentCheckInterval,
                maxIterCount: this.$options.parentCheckMaxIter,
                callback: this.createSafeCallback(this.#append)
            });
        } else if (this.$options.parent instanceof HTMLElement) {
            this.$domManager.apply(this.model);
            this.$domManager.appendTo(this.$options.parent);
            this.afterAppend();
        }
    }

    beforeRender () {}
    beforeAppend () {}
    afterAppend () {}

    dispose () {
        if (this.$disposed) return;
        this.emit([new ObservableEvent({
            type: 'dispose:before',
            initiator: this
        })]);

        this.$tpl = '';
        this.$options = null;
        this?.$domManager?.destroy && this.$domManager.destroy();
        this.$domManager = null;

        super.dispose();
    }
}