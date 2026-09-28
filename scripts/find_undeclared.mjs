import * as acorn from 'acorn';
import fs from 'fs';

const code = fs.readFileSync('mansion/js/app.js', 'utf8');

// Parse AST
const ast = acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true
});

// Browser / Global built-ins
const globals = new Set([
    'window', 'document', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Math', 'Date', 'Array', 'Object',
    'String', 'Number', 'Boolean', 'Set', 'Map', 'WeakMap', 'WeakSet', 'Promise', 'Proxy', 'Reflect',
    'JSON', 'RegExp', 'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
    'AudioContext', 'webkitAudioContext', 'Image', 'FileReader', 'Blob', 'URL', 'Event', 'CustomEvent',
    'localStorage', 'sessionStorage', 'location', 'history', 'navigator', 'screen', 'fetch', 'alert',
    'confirm', 'prompt', 'isNaN', 'isFinite', 'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent',
    'encodeURI', 'decodeURI', 'THREE', 'PointerLockControls', 'CSS3DRenderer', 'CSS3DObject', 'YT',
    'atob', 'btoa', 'Float32Array', 'Uint8Array', 'Int32Array', 'Uint16Array', 'ArrayBuffer'
]);

// Scope tracking
class Scope {
    constructor(parent = null) {
        this.parent = parent;
        this.declarations = new Set();
    }
    has(name) {
        if (this.declarations.has(name)) return true;
        if (this.parent) return this.parent.has(name);
        return false;
    }
}

let rootScope = new Scope();
for (const g of globals) rootScope.declarations.add(g);

let currentScope = rootScope;
const undeclared = [];

function walk(node) {
    if (!node) return;

    let previousScope = currentScope;

    switch (node.type) {
        case 'Program':
            // Add imported identifiers and top level declarations
            for (const item of node.body) {
                if (item.type === 'ImportDeclaration') {
                    for (const spec of item.specifiers) {
                        currentScope.declarations.add(spec.local.name);
                    }
                } else if (item.type === 'FunctionDeclaration') {
                    if (item.id) currentScope.declarations.add(item.id.name);
                } else if (item.type === 'ClassDeclaration') {
                    if (item.id) currentScope.declarations.add(item.id.name);
                } else if (item.type === 'VariableDeclaration') {
                    for (const decl of item.declarations) {
                        addPatternNames(decl.id, currentScope.declarations);
                    }
                }
            }
            break;

        case 'FunctionDeclaration':
            if (node.id) currentScope.declarations.add(node.id.name);
            currentScope = new Scope(currentScope);
            for (const param of node.params) {
                addPatternNames(param, currentScope.declarations);
            }
            // Hoist function declarations within function scope
            if (node.body && node.body.body) {
                for (const item of node.body.body) {
                    if (item.type === 'FunctionDeclaration' && item.id) {
                        currentScope.declarations.add(item.id.name);
                    }
                }
            }
            break;

        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
            currentScope = new Scope(currentScope);
            if (node.id) currentScope.declarations.add(node.id.name);
            for (const param of node.params) {
                addPatternNames(param, currentScope.declarations);
            }
            if (node.body && node.body.type === 'BlockStatement' && node.body.body) {
                for (const item of node.body.body) {
                    if (item.type === 'FunctionDeclaration' && item.id) {
                        currentScope.declarations.add(item.id.name);
                    }
                }
            }
            break;

        case 'BlockStatement':
            currentScope = new Scope(currentScope);
            break;

        case 'CatchClause':
            currentScope = new Scope(currentScope);
            if (node.param) addPatternNames(node.param, currentScope.declarations);
            break;

        case 'VariableDeclaration':
            for (const decl of node.declarations) {
                addPatternNames(decl.id, currentScope.declarations);
            }
            break;

        case 'ClassDeclaration':
            if (node.id) currentScope.declarations.add(node.id.name);
            break;

        case 'Identifier':
            // Check identifier references
            break;
    }

    // Custom check for member / identifier
    if (node.type === 'Identifier') {
        // We handle this carefully during AST traversal
    }

    // Traverse children
    for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'range') continue;
        const child = node[key];
        if (Array.isArray(child)) {
            for (const c of child) {
                if (c && typeof c === 'object' && c.type) {
                    checkAndWalk(c, node, key);
                }
            }
        } else if (child && typeof child === 'object' && child.type) {
            checkAndWalk(child, node, key);
        }
    }

    currentScope = previousScope;
}

function addPatternNames(pattern, set) {
    if (!pattern) return;
    if (pattern.type === 'Identifier') {
        set.add(pattern.name);
    } else if (pattern.type === 'AssignmentPattern') {
        addPatternNames(pattern.left, set);
    } else if (pattern.type === 'RestElement') {
        addPatternNames(pattern.argument, set);
    } else if (pattern.type === 'ArrayPattern') {
        for (const elem of pattern.elements) addPatternNames(elem, set);
    } else if (pattern.type === 'ObjectPattern') {
        for (const prop of pattern.properties) {
            if (prop.type === 'Property') addPatternNames(prop.value, set);
            else if (prop.type === 'RestElement') addPatternNames(prop.argument, set);
        }
    }
}

function checkAndWalk(child, parent, key) {
    if (child.type === 'Identifier') {
        // Is it a reference (not a property access like obj.prop, not a label, not a declaration name)?
        const isProp = (parent.type === 'MemberExpression' && parent.property === child && !parent.computed);
        const isObjKey = (parent.type === 'Property' && parent.key === child && !parent.computed);
        const isDecl = (parent.type === 'VariableDeclarator' && parent.id === child) ||
                       (parent.type === 'FunctionDeclaration' && parent.id === child) ||
                       (parent.type === 'ClassDeclaration' && parent.id === child) ||
                       (parent.type === 'CatchClause' && parent.param === child);
        const isParam = (parent.type === 'FunctionDeclaration' || parent.type === 'FunctionExpression' || parent.type === 'ArrowFunctionExpression') &&
                        parent.params.includes(child);

        if (!isProp && !isObjKey && !isDecl && !isParam) {
            if (!currentScope.has(child.name)) {
                undeclared.push({ name: child.name, line: child.loc.start.line, col: child.loc.start.column });
            }
        }
    }
    walk(child);
}

walk(ast);

console.log('Found undeclared identifiers:');
for (const u of undeclared) {
    console.log(`Line ${u.line}: ${u.name}`);
}
