/**
 * Tests for function-extractor: extractFunctions, extractClasses,
 * extractExports, extractJsDoc, getFunctionSignature, getDependencies.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractFunctions,
  extractClasses,
  extractExports,
  extractJsDoc,
  getFunctionSignature,
  getDependencies,
} = require("../../src/codegen/function-extractor");

// ---- extractFunctions ----

test("extractFunctions: named function declarations", () => {
  const code = `function greet(name) {
  return 'Hello, ' + name;
}

function add(a, b) {
  return a + b;
}

console.log('done');`;

  const fns = extractFunctions(code);
  assert.equal(fns.length, 2);
  assert.equal(fns[0].name, "greet");
  assert.equal(fns[0].type, "declaration");
  assert.deepEqual(fns[0].params, ["name"]);
  assert.ok(fns[0].body.includes("return 'Hello, ' + name;"));
  assert.equal(fns[1].name, "add");
  assert.deepEqual(fns[1].params, ["a", "b"]);
});

test("extractFunctions: arrow functions", () => {
  const code = `const double = (x) => {
  return x * 2;
};

const square = x => x * x;

const greet = async (name) => {
  return 'Hi ' + name;
};`;

  const fns = extractFunctions(code);
  assert.equal(fns.length, 3);
  assert.equal(fns[0].name, "double");
  assert.equal(fns[0].type, "arrow");
  assert.deepEqual(fns[0].params, ["x"]);

  assert.equal(fns[1].name, "square");
  assert.ok(fns[1].body.includes("return x * x"));

  assert.equal(fns[2].name, "greet");
  assert.equal(fns[2].async, true);
});

test("extractFunctions: function expressions", () => {
  const code = `const handler = function(event) {
  console.log(event);
  return true;
};

var process = function inner(data) {
  return data.map(x => x * 2);
};`;

  const fns = extractFunctions(code);
  assert.equal(fns.length, 2);
  assert.equal(fns[0].name, "handler");
  assert.deepEqual(fns[0].params, ["event"]);
});

test("extractFunctions: async functions and generators", () => {
  const code = `async function fetchData(url) {
  const res = await fetch(url);
  return res.json();
}

function* idGenerator() {
  let id = 0;
  while (true) yield id++;
}

async function* asyncGen() {
  yield 1;
}`;

  const fns = extractFunctions(code);
  assert.equal(fns.length, 3);
  assert.equal(fns[0].name, "fetchData");
  assert.equal(fns[0].async, true);

  assert.equal(fns[1].name, "idGenerator");
  assert.equal(fns[1].generator, true);

  assert.equal(fns[2].name, "asyncGen");
  assert.equal(fns[2].async, true);
});

test("extractFunctions: returns structured objects with positions", () => {
  const code = `// comment
function first() {
  return 1;
}

function second(a, b) {
  return a + b;
}`;

  const fns = extractFunctions(code);
  assert.equal(fns.length, 2);

  for (const fn of fns) {
    assert.ok(typeof fn.name === "string");
    assert.ok(typeof fn.type === "string");
    assert.ok(Array.isArray(fn.params));
    assert.ok(typeof fn.body === "string");
    assert.ok(typeof fn.startLine === "number");
    assert.ok(typeof fn.endLine === "number");
    assert.ok(fn.endLine > fn.startLine);
  }
});

// ---- extractClasses ----

test("extractClasses: class declarations", () => {
  const code = `class Animal {
  constructor(name) {
    this.name = name;
  }
  speak() {
    return this.name;
  }
}

class Dog extends Animal {
  bark() {
    return 'woof';
  }
}`;

  const classes = extractClasses(code);
  assert.equal(classes.length, 2);
  assert.equal(classes[0].name, "Animal");
  assert.equal(classes[0].superClass, null);
  assert.equal(classes[1].name, "Dog");
  assert.equal(classes[1].superClass, "Animal");
  assert.ok(classes[1].methods.some((m) => m.name === "bark"));
});

test("extractClasses: class expressions", () => {
  const code = `const MyClass = class {
  method() { return 1; }
};

const SubClass = class extends Base {
  method2() { return 2; }
};`;

  const classes = extractClasses(code);
  assert.equal(classes.length, 2);
  assert.equal(classes[0].name, "MyClass");
  assert.equal(classes[1].name, "SubClass");
  assert.equal(classes[1].superClass, "Base");
});

// ---- extractExports ----

test("extractExports: named and default exports", () => {
  const code = `export function helper() { return true; }
export const VERSION = '1.0.0';
export class Service {}
export { helper as doHelp, VERSION };
export default function main() { return 0; }
module.exports = { helper, VERSION };
exports.extra = 42;`;

  const exports = extractExports(code);
  assert.ok(exports.some((e) => e.name === "helper" && e.type === "named"));
  assert.ok(exports.some((e) => e.name === "VERSION" && e.type === "named"));
  assert.ok(exports.some((e) => e.name === "Service" && e.type === "named"));
  assert.ok(exports.some((e) => e.name === "main" && e.type === "default"));
  assert.ok(exports.some((e) => e.name === "doHelp"));
  assert.ok(exports.some((e) => e.name === "helper" && e.type === "cjs-named"));
  assert.ok(exports.some((e) => e.name === "extra" && e.type === "cjs-named"));
});

// ---- extractJsDoc ----

test("extractJsDoc: extracts JSDoc with tags and associated declarations", () => {
  const code = `/**
 * Calculates the sum of two numbers.
 * @param {number} a - first operand
 * @param {number} b - second operand
 * @returns {number} The sum of a and b
 */
function add(a, b) {
  return a + b;
}

/** Just a constant */
const MAX = 100;`;

  const docs = extractJsDoc(code);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].associatedName, "add");
  assert.ok(docs[0].tags.some((t) => t.tag === "param"));
  assert.ok(docs[0].tags.some((t) => t.tag === "returns"));
  assert.equal(docs[1].associatedName, "MAX");
});

// ---- getFunctionSignature ----

test("getFunctionSignature: returns params with types and return type", () => {
  const func = {
    name: "greet",
    params: ["name: string", "age: number = 0"],
    body: 'return "Hello, " + name;',
    async: false,
  };

  const sig = getFunctionSignature(func);
  assert.equal(sig.name, "greet");
  assert.equal(sig.params.length, 2);
  assert.equal(sig.params[0].name, "name");
  assert.equal(sig.params[0].type, "string");
  assert.equal(sig.params[1].name, "age");
  assert.equal(sig.params[1].type, "number");
  assert.equal(sig.params[1].defaultValue, "0");
  assert.equal(sig.returnType, "string");
});

test("getFunctionSignature: handles destructured params", () => {
  const func = {
    name: "process",
    params: ["{ name, age }", "options"],
    body: "return { name, age };",
    async: false,
  };

  const sig = getFunctionSignature(func);
  assert.equal(sig.params.length, 2);
  assert.ok(sig.params[0].name.includes("{"));
  assert.equal(sig.params[0].type, null);
  assert.equal(sig.returnType, "Object");
});

// ---- getDependencies ----

test("getDependencies: finds external references in function body", () => {
  const body = `
    const result = transform(data);
    const filtered = result.filter(x => x > threshold);
    logger.info('Processing done', filtered);
    return filtered;
  `;

  const deps = getDependencies(body);
  assert.ok(deps.includes("transform"));
  assert.ok(deps.includes("data"));
  assert.ok(deps.includes("filter"));
  assert.ok(deps.includes("threshold"));
  assert.ok(deps.includes("logger"));
  // Should not include builtins/globals.
  assert.ok(!deps.includes("console"));
  assert.ok(!deps.includes("const"));
  assert.ok(!deps.includes("return"));
});

test("getDependencies: excludes JS keywords and builtins", () => {
  const body = `
    const arr = new Array(10);
    const json = JSON.stringify(data);
    const result = Math.max(...arr);
    if (result > 0) {
      return result;
    }
  `;

  const deps = getDependencies(body);
  assert.ok(deps.includes("data"));
  assert.ok(deps.includes("arr"));
  // Should exclude builtins.
  assert.ok(!deps.includes("Array"));
  assert.ok(!deps.includes("JSON"));
  assert.ok(!deps.includes("Math"));
  assert.ok(!deps.includes("new"));
  assert.ok(!deps.includes("if"));
});
