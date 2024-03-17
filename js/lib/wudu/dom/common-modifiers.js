import ModifierManager, { DomModifier, Modifier, RenderModifier } from './Modifiers.js';
import { set } from './utils.js';
import ScopeManager from './ScopeManager.js';
import Expression from './Expression.js';
import View from '../View.js';

const whenDefined = (node, cb) => {
    if (node.matches(':not(:defined)')) {
        customElements.whenDefined(node.localName)
                      .then(cb);
    } else {
        cb();
    }
};

export class ClassModifier extends Modifier {
    process (node, attr) {
        this.exprs = Expression.parseMultiple(attr);
    }

    apply (params = {}) {
        const exprs = params.expression ? [params.expression] : this.exprs;
        for (let expr of exprs) {
            let {value, path} = expr.getData(params.node, params.data, params.manager);
            params.manager.addDataTargetNode({
                path,
                node: params.node,
                modifier: this,
                expression: expr
            });
            params.node.classList.toggle(expr.prop, !!value);
        }
    }
}

ModifierManager.registerModifier('class', ClassModifier);

export class AttributeModifier extends Modifier {
    process (node, attr) {
        this.exprs = Expression.parseMultiple(attr);
    }

    apply (params = {}) {
        const exprs = params.expression ? [params.expression] : this.exprs;
        for (let expr of exprs) {
            let {value, path} = expr.getData(params.node, params.data, params.manager);
            params.manager.addDataTargetNode({
                path,
                node: params.node,
                modifier: this,
                expression: expr
            });
            params.node.setAttribute(expr.prop, value);
        }
    }
}
ModifierManager.registerModifier('attr', AttributeModifier);

export class PropModifier extends Modifier {
    process (node, attr) {
        this.exprs = Expression.parseMultiple(attr);
    }

    apply (params = {}) {
        const exprs = params.expression ? [params.expression] : this.exprs;
        const node = params.node;
        for (let expr of exprs) {
            let {value, path} = expr.getData(node, params.data, params.manager);
            params.manager.addDataTargetNode({
                path,
                node,
                modifier: this,
                expression: expr
            });
            whenDefined(node, () => node[expr.prop] = value);
        }
    }
}
ModifierManager.registerModifier('prop', PropModifier);

export class StyleModifier extends Modifier {
    process (node, attr) {
        this.exprs = Expression.parseMultiple(attr);
    }

    apply (params = {}) {
        const exprs = params.expression ? [params.expression] : this.exprs;
        for (let expr of exprs) {
            let {value, path} = expr.getData(params.node, params.data, params.manager);
            params.manager.addDataTargetNode({
                path,
                node: params.node,
                modifier: this,
                expression: expr
            });
            params.node.style.setProperty(expr.prop, value);
        }
    }
}

ModifierManager.registerModifier('style', StyleModifier);

export class TextModifier extends Modifier {
    process (node, attr) {
        this.exprs = [];
        this.innerText = node.innerText.replace(/{{ ?(.+?) ?}}/g, (fm, v) => {
            this.exprs.push(new Expression(v));
            return `{{${v}}}`;
        });
    }

    apply (params = {}) {
        let node = params.node;
        if (!node) return;
        node.innerText = this.exprs.reduce((a, b) => {
            let {value, path} = b.getData(node, params.data, params.manager);
            if (/\{\{\s?[^}]+\s?}}/.test(value)) {
                path = value.replace(/{{ ?(.+?) ?}}/g, '$1');
                value = b.getValue(node, params.data, params.manager, path);
            }
            params.manager.addDataTargetNode({
                path,
                node,
                modifier: this
            });
            return a.replace(`{{${b.raw}}}`, value ?? '');
        }, this.innerText);
    }
}

ModifierManager.registerModifier('text', TextModifier);

export class HtmlModifier extends Modifier {
    process (node, attr) {
        this.exprs = [];
        this.innerHTML = node.innerHTML.replace(/{{ ?(.+?) ?}}/g, (fm, v) => {
            this.exprs.push(new Expression(v));
            return `{{${v}}}`;
        });
        this.change = {
            childNodes: [],
            parentNode: null
        };
        this.updateDOM = (params) => {
            if (!this.change.parentNode) return;
            const parent = this.change.parentNode;
            const manager = params.manager;
            const data = params.data;
            this.change.parentNode = null;
            const children = this.change.childNodes;
            // reset to avoid async tasks overlap
            this.change.childNodes = [];
            return () => {
                for (let child of children) {
                    parent.appendChild(child);
                    manager.applyOnNode(child, data);
                }
            }
        };
    }

    apply (params = {}) {
        let node = params.node;
        if (!node) return;
        this.change.parentNode = node;
        const div = document.createElement('div');
        div.innerHTML = this.exprs.reduce((a, b) => {
            let {value, path} = b.getData(params.node, params.data, params.manager);
            params.manager.addDataTargetNode({
                path,
                node,
                modifier: this
            });
            return a.replace(`{{${b.raw}}}`, value);
        }, this.innerHTML);
        for (let child of div.children) {
            params.manager.attachId(child);
            params.manager.processNode(child);
            this.change.childNodes.push(child);
        }
        node.innerHTML = '';
        params.manager.runWhenIdle(this.updateDOM(params));
    }
}

ModifierManager.registerModifier('html', HtmlModifier);

export class ArrayModifier extends DomModifier {
    process (node, attr) {
        const [item, of, ...items] = attr.trim().split(' ');
        node.innerHTML = node.innerHTML.replace(new RegExp(`(^| |\\.|["':!])(${item})($|\\.|[;"']| )`, 'g'), (fm, prefix, target, postfix) => {
            return `${prefix}${items}.#${postfix}`;
        });
        this.items = Expression.parseSingle(items.join(' '));
    }

    apply (params = {}) {
        if (!params.data) return;
        let parentNode = params.node;
        const event = params.event;
        let {value: items, path: itemsName} = this.items.getData(params.node, params.data, params.manager);
        params.manager.addDataTargetNode({
            path: itemsName,
            node: params.node,
            modifier: this
        });
        if (!items?.length) {
            params.node.innerHTML = '';
            return;
        }
        if (!this.origin) {
            this.origin = params.manager.getNodeClone(params.node.getAttribute('w')).firstElementChild;
            if (!this.origin) return;
        }
        if (!event) {
            this.addChildren(parentNode, 0, items.length, true);
            return;
        }
        if (event.type === 'modified') {
            // console.log('modified array');
            this.addChildren(parentNode, 0, items.length, true);
        } else if (event.type === 'grow') {
            // console.log('growing array');
            this.addChildren(parentNode, event.data.index, event.data.count);
        } else if (event.type === 'shrink') {
            // console.log('shrinking array');
            this.removeChildren(parentNode, event.data.index, event.data.count);
        } else if (event.type === 'recalcindex') {
            let wm = new WeakMap();
            let i = 0;
            for (let child of parentNode.children) {
                if (!wm.has(child)) {
                    wm.set(child, i);
                }
                ScopeManager.addScopeVar(child, `${itemsName}.#`, `${itemsName}.${wm.get(child)}`);
                i++;
            }
        }
    }

    addChildren (parentNode, index = 0, count, reset = false) {
        if (reset) parentNode.innerHTML = '';
        let df = document.createDocumentFragment();
        let itemsName = ScopeManager.resolvePathWithScope(parentNode, this.items.path);
        for (let i = 0; i < count; ++i) {
            let clone = this.origin.cloneNode(true);
            ScopeManager.addScopeVar(clone, `${this.items.path}.#`, `${itemsName}.${index + i}`);
            if (!reset) {
                parentNode.insertBefore(clone, parentNode.children.item(index + i));
                continue;
            }
            df.append(clone);
        }
        if (parentNode.children.length > count) {
            let current = index + count;
            let end = parentNode.children.length;
            for (current; current < end; ++current) {
                ScopeManager.addScopeVar(parentNode.children.item(current), `${this.items.path}.#`, `${itemsName}.${current}`);
            }
        }
        if (!reset) return;
        parentNode.appendChild(df);
    }

    removeChildren (parentNode, index, count) {
        let itemsName = ScopeManager.resolvePathWithScope(parentNode, this.items.path);
        let start = index;
        const end = index + count;
        for (start; start < end; ++start) {
            const child = parentNode.children.item(index);
            child && parentNode.removeChild(child);
        }
        for (index; index < parentNode.children.length; ++index) {
            ScopeManager.addScopeVar(parentNode.children.item(index), `${this.items.path}.#`, `${itemsName}.${index}`);
        }
    }
}

ModifierManager.registerModifier('array', ArrayModifier);

export class DisplayModifier extends Modifier {
    process (node, attr) {
        this.expr = Expression.parseMultiple(attr)[0];
    }

    apply (params = {}) {
        let path = ScopeManager.resolvePathWithScope(params.node, this.expr.path);
        let value = this.expr.getValue(params.node, params.data);
        params.manager.addDataTargetNode({
            path,
            node: params.node,
            modifier: this
        });
        params.node.style.display = !!value ? '' : 'none';
    }
}

ModifierManager.registerModifier('display', DisplayModifier);

export class DisabledModifier extends Modifier {
    process (node, attr) {
        this.expr = Expression.parseMultiple(attr)[0];
    }

    apply (params = {}) {
        let path = ScopeManager.resolvePathWithScope(params.node, this.expr.path);
        let value = this.expr.getValue(params.node, params.data);
        let node = params.node;
        params.manager.addDataTargetNode({
            path,
            node,
            modifier: this
        });
        whenDefined(node, () => node.disabled = !!value);
    }
}

ModifierManager.registerModifier('disabled', DisabledModifier);

export class ValueModifier extends Modifier {
    process (node, attr) {
        this.expr = Expression.parseMultiple(attr)[0];
        this.bound = new WeakSet();
    }

    apply (params = {}) {
        const node = params.node;
        if (!this.bound.has(node)) {
            let data = params.data;
            this.bound.add(node);
            node.addEventListener('input', () => {
                set(data, ScopeManager.resolvePathWithScope(node, this.expr.path), node.value);
            });
        }
        const {value, path} = this.expr.getData(params.node, params.data);
        params.manager.addDataTargetNode({
            path,
            node,
            modifier: this
        });
        if (value + '' === node.value || +value === +node.value) return;
        whenDefined(node, () => node.value = value ?? '');
    }
}

ModifierManager.registerModifier('value', ValueModifier);

export class CheckModifier extends Modifier {
    process (node, attr) {
        this.expr = Expression.parseMultiple(attr)[0];
        this.bound = new WeakSet();
    }

    apply (params = {}) {
        if (!this.bound.has(params.node)) {
            let data = params.data;
            const node = params.node;
            this.bound.add(node);
            params.node.addEventListener('change', () => {
                set(data, ScopeManager.resolvePathWithScope(node, this.expr.path), !!node.checked);
            });
        }
        let path = ScopeManager.resolvePathWithScope(params.node, this.expr.path);
        params.manager.addDataTargetNode({
            path,
            node: params.node,
            modifier: this
        });
        this.setTimeout && clearTimeout(this.setTimeout);
        this.setTimeout = setTimeout(() => {
            const value = this.expr.getValue(params.node, params.data, params.manager);
            if (!!value === !!params.node.checked) return;
            params.node.checked = !!value;
        });
    }
}

ModifierManager.registerModifier('check', CheckModifier);

export class RadioModifier extends Modifier {
    process (node, attr) {
        this.expr = Expression.parseMultiple(attr)[0];
        this.bound = new WeakSet();
    }

    apply (params = {}) {
        if (!this.bound.has(params.node)) {
            let data = params.data;
            const node = params.node;
            this.bound.add(node);
            params.node.addEventListener('change', () => {
                set(data, ScopeManager.resolvePathWithScope(node, this.expr.path), node.value);
            });
        }
        let path = ScopeManager.resolvePathWithScope(params.node, this.expr.path);
        params.manager.addDataTargetNode({
            path,
            node: params.node,
            modifier: this
        });

        setTimeout(() => {
            const value = this.expr.getValue(params.node, params.data);
            params.node.checked = value + '' === params.node.value;
        });
    }
}

ModifierManager.registerModifier('radio', RadioModifier);

export class SelectModifier extends Modifier {
    process (node, attr) {
        this.expr = Expression.parseMultiple(attr)[0];
        this.bound = new WeakSet();
    }

    apply (params = {}) {
        const node = params.node;
        if (!this.bound.has(params.node)) {
            let data = params.data;
            this.bound.add(node);
            params.node.addEventListener('change', () => {
                let value = node.value;
                if (node.hasAttribute('multiple')) {
                    const values = [];
                    for (let child of node.children) {
                        child.selected && values.push(child.value);
                    }
                    value = values.join(',')
                }
                set(data, ScopeManager.resolvePathWithScope(node, this.expr.path), value);
            });
        }
        let path = ScopeManager.resolvePathWithScope(params.node, this.expr.path);
        params.manager.addDataTargetNode({
            path,
            node: params.node,
            modifier: this
        });
        let nodeValue = node.value;
        if (node.hasAttribute('multiple')) {
            const values = [];
            for (let child of node.children) {
                child.selected && values.push(child.value);
            }
            nodeValue = values.join(',');
        }
        const value = this.expr.getValue(params.node, params.data);
        if (value && value + '' === nodeValue) return;
        // since options can be rendered via wudu-array, we apply value after the select dom content is built
        setTimeout(() => {
            const value = this.expr.getValue(params.node, params.data);
            let nodeValue = node.value;
            if (node.hasAttribute('multiple')) {
                const values = [];
                for (let child of node.children) {
                    child.selected && values.push(child.value);
                }
                nodeValue = values.join(',');
            }
            if (value && value + '' === nodeValue) return;
            if (value && node.hasAttribute('multiple')) {
                const values = value.split(',');
                for (let child of node.children) {
                    child.selected = values.includes(child.value);
                }
                return;
            }
            params.node.value = value;
        }, 0);
    }
}

ModifierManager.registerModifier('select', SelectModifier);

export class EventModifier extends Modifier {
    process (node, attr) {
        this.exprs = Expression.parseMultiple(attr);
        this.bound = new WeakMap();
    }

    apply (params = {}) {
        const exprs = params.expression ? [params.expression] : this.exprs;
        const node = params.node;
        const manager = params.manager;
        for (let expr of exprs) {
            if (!this.bound.has(node)) {
                this.bound.set(node, new Map());
            }
            if (!this.bound.get(node).has(expr.path)) {
                this.bound.get(node).set(expr.path, new Set());
            }
            if (this.bound.get(node).get(expr.path)?.has(expr.prop)) continue;
            this.bound.get(node).get(expr.path).add(expr.prop);
            const fn = function (manager, method) {
                return function (event) {
                    manager.invokeViewMethod(method, event);
                }
            }(manager, expr.path);
            const props = {};
            if (expr.prop.startsWith('!')) {
                props.passive = true;
                expr.prop = expr.prop.replace('!', '');
            }
            node.addEventListener(expr.prop, fn, props);
        }
    }
}

ModifierManager.registerModifier('event', EventModifier);
export class ClickModifier extends Modifier {
    process (node, attr) {
        this.exprs = Expression.parseMultiple(attr);
        this.bound = new WeakMap();
    }

    apply (params = {}) {
        const exprs = params.expression ? [params.expression] : this.exprs;
        const node = params.node;
        const manager = params.manager;
        for (let expr of exprs) {
            if (!this.bound.has(node)) this.bound.set(node, new Set());
            if (this.bound.get(node).has(expr.path)) continue;
            this.bound.get(node).add(expr.path);
            node.addEventListener('click', function (manager, expr) {
                return function (event) {
                    manager.invokeViewMethod(expr.path, event);
                }
            }(manager, expr));
        }
    }
}
ModifierManager.registerModifier('click', ClickModifier);

export class InputEventModifier extends Modifier {
    event = 'input';

    process (node, attr) {
        this.exprs = Expression.parseMultiple(attr);
        this.exprs.forEach(expr => {
            expr.keys = expr.prop.split('+').map(str => str.trim().toLowerCase());
            if (expr.keys.length > 1) {
                expr.modifierKeys = expr.keys.slice(0, -1);
                expr.key = expr.keys[expr.keys.length - 1].toLowerCase();
                return;
            }
            expr.key = expr.keys[0];
        });
        this.bound = new WeakMap();
    }

    apply (params = {}) {
        const exprs = params.expression ? [params.expression] : this.exprs;
        const node = params.node;
        const manager = params.manager;
        for (let expr of exprs) {
            if (!this.bound.has(node)) this.bound.set(node, new Set());
            if (this.bound.get(node).has(expr.path)) continue;
            this.bound.get(node).add(expr.path);
            node.addEventListener(this.event, function (manager, expr) {
                return function (event) {
                    if (expr.modifierKeys) {
                        if (!expr.modifierKeys.every(modifier => event[`${modifier}Key`])) return;
                    }
                    if ((event.key || event.data || '').toLowerCase() !== expr.key && event.code?.toLowerCase() !== expr.key) return;
                    manager.invokeViewMethod(expr.path, event);
                }
            }(manager, expr));
        }
    }
}

ModifierManager.registerModifier('input', InputEventModifier);

export class KeyUpEventModifier extends InputEventModifier {
    event = 'keyup';
}

ModifierManager.registerModifier('keyup', KeyUpEventModifier)

export class KeyDownEventModifier extends InputEventModifier {
    event = 'keydown';
}
ModifierManager.registerModifier('keydown', KeyDownEventModifier);

export class HoverModifier extends DomModifier {
    process (node, attr) {
        this.exprs = Expression.parseMultiple(attr);
        this.bound = new WeakMap();
    }

    apply (params) {
        const [mouseover, mouseout] = this.exprs;
        const node = params.node;
        const manager = params.manager;
        if (!this.bound.has(node)) this.bound.set(node, new Set());
        if (!this.bound.get(node).has(mouseover.path)) {
            this.bound.get(node).add(mouseover.path);
            node.addEventListener('mouseover', function (manager, expr) {
                return function (event) {
                    manager.invokeViewMethod(expr.path, event);
                }
            }(manager, mouseover));
        }
        if (!this.bound.get(node).has(mouseout.path)) {
            this.bound.get(node).add(mouseout.path);
            node.addEventListener('mouseout', function (manager, expr) {
                return function (event) {
                    manager.invokeViewMethod(expr.path, event);
                }
            }(manager, mouseout));
        }
    }
}
ModifierManager.registerModifier('hover', HoverModifier);

export class IfModifier extends RenderModifier {
    process (node, attr) {
        this.expr = Expression.parseSingle(attr);
        this.refMap = new Map();
    }

    apply (params = {}) {
        let ref;
        if (this.refMap.has(params.node)) {
            ref = this.refMap.get(params.node);
        } else {
            ref = {
                container: document.createDocumentFragment(),
                comment: new Comment(),
                node: params.node
            };
            this.refMap.set(params.node, ref);
        }
        let {value, path} = this.expr.getData(ref.comment.parentElement ? ref.comment : ref.node, params.data, params.manager);
        params.manager.addDataTargetNode({
            path,
            node: params.node,
            modifier: this,
            keepDetached: true
        });

        if (!value) {
            if (ref.node.parentElement) {
                ref.node.parentNode.replaceChild(ref.comment, ref.node);
                ref.container.appendChild(ref.node);
            }
            return;
        }

        ref.comment.parentElement && ref.comment.parentElement.replaceChild(ref.node, ref.comment);
    }
}
ModifierManager.registerModifier('if', IfModifier);

export class ComponentModifier extends RenderModifier {
    process (node, attr) {
        this.expr = Expression.parseSingle(attr);
        this.nodes = new WeakMap();
        this.views = new WeakMap();
    }

    async apply (params = {}) {
        let component;
        let {value, path} = this.expr.getData(params.node, params.data);
        params.manager.addDataTargetNode({
            path,
            node: params.node,
            modifier: this,
            disposeOnDestroy: true
        });
        if (this.nodes.get(params.node) === value) {
            return;
        }
        this.nodes.set(params.node, value);
        if (this.loading) {
            await this.loading;
        }
        if (!value) {
            if (this.views.get(params.node)) this.views.get(params.node)?.dispose();
            this.views.delete(params.node)
            return;
        }
        this.loading = new Promise(resolve => {
            this.ready = resolve;
        });
        if (this.views.get(params.node)) {
            this.views.get(params.node).dispose();
        }
        if (typeof value === 'string') {
            component = (await import(value)).default;
        } else if (value instanceof View) {
            component = value;
        } else {
            component = new value({parent: params.node});
        }
        if (component.$disposed) {
            this.ready();
            this.loading = null;
            return;
        }
        this.views.set(params.node, component);

        const modifiers = params.manager.getNodeModifiers(params.node);
        if (!modifiers?.dom) {
            this.ready();
            this.loading = null;
            return;
        }

        const compData = [...modifiers.dom].find(item => item instanceof ComponentDataModifier);
        if (!compData) {
            this.ready();
            this.loading = null;
            return;
        }
        compData.apply(params);
        this.ready();
        this.loading = null;
    }

    dispose (options) {
        this.views.get(options.nodeRef?.deref?.())?.dispose?.();
    }
}
ModifierManager.registerModifier('component', ComponentModifier);

export class ComponentDataModifier extends DomModifier {
    process (node, attr) {
        this.exprs = Expression.parseMultiple(attr);
    }

    apply (params = {}) {
        const modifiers = params.manager.getNodeModifiers(params.node);
        if (!modifiers?.render) return;

        const comp = [...modifiers.render].find(item => item instanceof ComponentModifier);
        if (!comp) return;

        const view = comp?.views.get(params.node);
        if (!view || view.$disposed) return;

        const exprs = params.expression ? [params.expression] : this.exprs;
        for (let expr of exprs) {
            if (params?.event?.data?.key && !expr.path.includes(params.event.data.key)) continue;
            let {value, path} = expr.getData(params.node, params.data);
            params.manager.addDataTargetNode({
                path,
                node: params.node,
                modifier: this
            });
            view[expr.prop] = value;
        }
    }
}
ModifierManager.registerModifier('component-data', ComponentDataModifier);
ModifierManager.registerModifier('cdata', ComponentDataModifier);