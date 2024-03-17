import ScopeManager from './ScopeManager.js';
import { get } from './utils.js';

export default class Expression {
    static Separator = ';';
    static Delimiter = ':';
    static parseMultiple (raw) {
        return raw.split(Expression.Separator).map(s => new Expression(s.trim()));
    }
    static parseSingle (raw) {
        return new Expression(raw.trim());
    }
    constructor (raw) {
        this.setPath(raw);
    }

    getValue (node, data, manager = null, path = this.path) {
        let value = get(data, ScopeManager.resolvePathWithScope(node, path));
        if (manager && this.pipes.length) {
            value = this.pipes.reduce((value, pipe) => {
                return manager.resolvePipe(pipe, value);
            }, value);
        }
        return this.negative ? !value : value;
    }

    getData (node, data, manager = null, path = this.path) {
        path = ScopeManager.resolvePathWithScope(node, path);
        let value = get(data, path);
        if (manager && this.pipes.length) {
            value = this.pipes.reduce((value, pipe) => {
                return manager.resolvePipe(pipe, value);
            }, value);
        }
        return {
            path,
            value: this.negative ? !value : value
        };
    }

    setPath (raw) {
        this.raw = raw;
        let [prop, valuePath] = raw.split(Expression.Delimiter).map(s => s.trim());
        if (!valuePath) {
            valuePath = prop;
            prop = null;
        }
        this.prop = prop;

        this.negative = valuePath.startsWith('!');
        if (this.negative) {
            valuePath = valuePath.substr(1);
        }
        let [path, ...pipes] = valuePath.split('|').map(s => s.trim());
        this.pipes = pipes;

        this.path = path;
    }

    setProxy (proxyPath) {
        const raw = this.raw;
        this.setPath(proxyPath);
        this.raw = raw;
    }
}