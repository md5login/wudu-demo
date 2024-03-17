import SafeBinder from '../SafeBinder.js';

export class Modifier extends SafeBinder {
    paths = [];
    process (node, attr) {}
    apply (node, data) {}
    propagateScope (node, scope) {}

    onChange () {}

    onGrow () {}

    onShrink () {}

    onAttach () {}

    onDetach () {}
}

export class DomModifier extends Modifier {}

export class RenderModifier extends Modifier {}

export default class ModifierManager {
    static modifiers = new Map();

    static registerModifier (name, modifier) {
        ModifierManager.modifiers.set(name, modifier);
    }
}