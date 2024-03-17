import ModifierManager, { DomModifier, RenderModifier } from './Modifiers.js';
import ScopeManager from './ScopeManager.js';

const nextId = (function* idGen () {
    let index = 111;
    while (true) {
        yield (index++).toString(16);
    }
})();

const domRef = Symbol();

class DomTaskManager {
    static stack = new Set();
    static running = false;
    static taskRunner () {
        for (let task of DomTaskManager.stack) {
            task();
            DomTaskManager.stack.delete(task);
        }
    }
    static addTask (task) {
        DomTaskManager.stack.add(task);
        if (!DomTaskManager.running) {
            DomTaskManager.running = true;
            requestAnimationFrame(function () {
                DomTaskManager.taskRunner();
                DomTaskManager.running = false;
            });
        }
    }
}

export default class DomManager {
    /**
     *
     * @type {Map<string, {render: Set<Modifier>, dom: Set<Modifier>}>}
     */
    nodeModifiers = new Map();
    domNodes = new Map();
    renderNodes = new Map();
    appliedModifiers = new WeakMap();
    roots = [];
    domParent = null;

    get nextId () {
        return nextId.next().value;
    }

    constructor (html, view) {
        this.id = this.nextId;
        this.view = view;
        this.originalHTML = html;
        this.parseHTML(html);
    }

    runWhenIdle (task) {
        DomTaskManager.addTask(task);
    }

    parseHTML (html) {
        this.template = document.createElement('template');
        this.template.innerHTML = html;

        for (let child of this.template.content.children) {
            this.attachId(child);
            this.processNode(child);
        }
    }

    attachId (node) {
        node.setAttribute('w', `${this.id}.${this.nextId}`);

        for (let child of node.children) {
            this.attachId(child);
        }
    }

    processNode (node) {
        for (let [key, modifier] of ModifierManager.modifiers) {
            let wName = `wudu-${key}`;
            if (!node.hasAttribute(wName)) continue;
            let attr = node.getAttribute(wName);
            node.removeAttribute(wName);

            modifier = this.attachModifier(node.getAttribute('w'), modifier);
            modifier.process(node, attr);
        }

        for (let child of node.children) {
            this.processNode(child);
        }
    }

    attachModifier (nodeId, modifier) {
        modifier = new modifier();

        if (!this.nodeModifiers.has(nodeId)) this.nodeModifiers.set(nodeId, {dom: new Set(), render: new Set()});
        if (modifier instanceof RenderModifier) {
            this.nodeModifiers.get(nodeId).render.add(modifier);
            return modifier;
        }
        this.nodeModifiers.get(nodeId).dom.add(modifier);

        return modifier;
    }

    apply (data) {
        this.removeRoots();
        this.df = document.createDocumentFragment()
        this.df.append(...[...this.template.content.children].map(n => n.cloneNode(true)));

        for (let child of this.df.children) {
            // ScopeManager.inheritScope(child, child);
            ScopeManager.markRootScope(child);
            child[domRef] = new WeakRef(this);
            this.applyOnNode(child, data);
        }

        this.roots = [...this.df.children];

        return this.df;
    }

    applyOnNode (node, data) {
        const nodeId = this.getNodeId(node);
        if (this.nodeModifiers.has(nodeId)) {
            const renderModifiers = this.nodeModifiers.get(nodeId).render;
            const domModifiers = this.nodeModifiers.get(nodeId).dom;

            const params = {
                data,
                node,
                document: this.df || document,
                manager: this
            };

            if (renderModifiers) {
                for (let modifier of renderModifiers) {
                    modifier.apply(params);
                }
                if (!node.isConnected && this.df.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_DISCONNECTED) {
                    return;
                }
            }

            if (domModifiers) {
                for (let modifier of domModifiers) {
                    modifier.apply(params);
                }
            }
        }

        for (let child of [...node.children]) {
            if (child[domRef] && child[domRef].deref()) {
                const manager = child[domRef].deref();
                if (manager !== this) {
                    manager.applyOnNode(child, manager.view.model);
                    continue;
                }
            }

            this.applyOnNode(child, data);
        }
    }

    getNodeModifiers (node) {
        const nodeId = this.getNodeId(node);
        if (!this.nodeModifiers.has(nodeId)) {
            return {};
        }

        return this.nodeModifiers.get(nodeId);
    }

    applyModifierOnNode (modifier, node, data, expression, event) {
        modifier.apply({
            node,
            data,
            document: this.df || document,
            manager: this,
            expression,
            event
        });

        if (modifier instanceof DomModifier ||
            (modifier instanceof RenderModifier && node.isConnected)) {
            for (let child of node.children) {
                this.applyOnNode(child, data);
            }
        }
    }

    /**
     * @param params
     * @param {string} params.path
     * @param {Node} params.node
     * @param {Modifier} params.modifier
     * @param {boolean=} params.keepDetached
     * @param {Expression=} params.expression
     * @param {boolean=} params.disposeOnDestroy
     */
    addDataTargetNode (params = {}) {
        const {path, node, modifier, expression, keepDetached, disposeOnDestroy} = params;
        if (!this.appliedModifiers.has(node)) {
            this.appliedModifiers.set(node, new WeakMap());
        }
        if (!this.appliedModifiers.get(node).has(modifier)) {
            this.appliedModifiers.get(node).set(modifier, new Set());
        }
        if (this.appliedModifiers.get(node).get(modifier).has(path)) return;
        this.appliedModifiers.get(node).get(modifier).add(path);

        let nodeRef = new WeakRef(node);
        const refObject = {
            nodeRef,
            modifier,
            expression,
            keepDetached,
            disposeOnDestroy
        };

        if (modifier instanceof RenderModifier) {
            this.addRenderTargetNode(path, refObject);
            return;
        }

        this.addDomTargetNode(path, refObject);
    }

    addRenderTargetNode (path, ref) {
        if (!this.renderNodes.has(path)) this.renderNodes.set(path, new Set());
        this.renderNodes.get(path).add(ref);
    }

    addDomTargetNode (path, ref) {
        if (!this.domNodes.has(path)) this.domNodes.set(path, new Set());
        this.domNodes.get(path).add(ref)
    }

    onDataChange (path, data, event) {
        this.#applyPathModifiers(this.renderNodes, path, data, event);
        this.#applyPathModifiers(this.domNodes, path, data, event);
    }

    #applyPathModifiers (sourceNodes, path, data, event) {
        const isRender = sourceNodes === this.renderNodes;
        // path = new RegExp(`^${path}(\\.|$)`);
        const refs = [...sourceNodes.keys()].filter(key => key.startsWith(path)).sort((a, b) => {
            if (a.length < b.length) return -1;
            if (b.length < a.length) return 1;
            return 0;
        });
        for (let ref of refs) {
            for (let refObject of sourceNodes.get(ref).values()) {
                let node = refObject.nodeRef.deref();
                if (!node) {
                    sourceNodes.get(ref).delete(refObject);
                    continue;
                }
                if (!node.isConnected && !refObject.keepDetached) {
                    // sourceNodes[ref].delete(refObject);
                    continue;
                }
                isRender ? this.applyOnNode(node, data) : this.applyModifierOnNode(refObject.modifier, node, data, refObject.expression, event);
            }
        }
    }

    getNodeClone (nodeId) {
        return this.template.content.querySelector(`[w='${nodeId}']`).cloneNode(true);
    }

    getNodeId (node) {
        const id = node.getAttribute('w');
        if (!id) return '';
        const [domManagerId, nodeId] = id.split('.');
        return `${domManagerId}.${nodeId}`;
    }

    parentProxy () {
        return {
            appendChild: el => {
                this.domParent && this.domParent.appendChild(el);
            },
            insertBefore: (el, sibling) => {
                this.domParent && this.domParent.insertBefore(el, sibling);
            }
        }
    }

    invokeViewMethod (method, event) {
        this.view?.[method] && this.view[method](event);
    }

    resolvePipe (pipe, ...args) {
        if (this.view[pipe]) return this.view[pipe](...args);
    }

    removeRoots () {
        for (let root of this.roots) {
            root[domRef] = null;
            root.parentElement.removeChild(root);
        }
        this.roots = [];
    }

    appendTo (parent) {
        this.domParent = parent;
        parent.appendChild(this.df);
    }

    /**
     * @param {string} selector
     * @return {Element}
     */
    _$ (selector) {
        return this.roots.map(root => root.querySelector(selector))[0];
    }

    _$$ (selector) {
        return this.roots.map(root => [...root.querySelectorAll(selector)]).flat();
    }

    /**
     * @param {string} selector
     * @return {Element}
     */
    $ (selector) {
        return this.domParent && this.domParent.querySelector(selector);
    }

    $$ (selector) {
        return this.domParent && this.domParent.querySelectorAll(selector);
    }

    getContainer () {
        if (this.roots?.[0]) return this.roots[0].parentElement;
    }

    destroy () {
        for (let [, refSet] of this.renderNodes.entries()) {
            for (let modRef of refSet) {
                if (modRef.disposeOnDestroy) {
                    modRef.modifier?.dispose?.(modRef);
                }
            }
        }
        this.view = null;
        this.originalHTML = '';
        this.nodeModifiers = new Map();
        this.domNodes = new Map();
        this.renderNodes = new Map();
        this.appliedModifiers = new WeakMap();
        this.removeRoots();
    }
}