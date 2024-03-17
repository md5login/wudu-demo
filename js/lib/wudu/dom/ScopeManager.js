const scope = Symbol();
const keys = Symbol();
const root = Symbol();

export default class ScopeManager {
    static addScopeVar (node, name, value) {
        if (!node[scope]) node[scope] = {};
        if (!node[keys]) node[keys] = [];
        node[scope][name] = value;

        if (node[keys].includes(name)) return;

        let index = node[keys].indexOf(k => k.length < value.length);
        if (index === -1) {
            node[keys].unshift(name);
        } else {
            node[keys].splice(index, 0, name);
        }
    }
    static resolvePathWithScope (node, path) {
        if (!path.includes('#')) return path;
        if (!node) return path;
        if (!node[keys]) {
            if (node[root]) return path;
            return ScopeManager.resolvePathWithScope(node.parentElement, path);
        }
        for (let key of node[keys]) {
            path = path.replace(key, node[scope][key]);
        }
        if (path.includes('#') && !node[root]) return ScopeManager.resolvePathWithScope(node.parentElement, path);
        return path;
    }
    static markRootScope (node) {
        node[root] = true;
    }
}