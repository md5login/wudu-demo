export function get (source, path) {
    let p = path && path.split('.') || [];
    while (source && p.length) {
        source = source[p.shift()];
    }
    return source;
}

export function set (source, path, value) {
    let p = path.split('.');
    while (source && p.length > 1) {
        const s = p.shift();
        if (!source[s]) source[s] = {};
        source = source[s];
    }
    return source && (source[p[0]] = value);
}