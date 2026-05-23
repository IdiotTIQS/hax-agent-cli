/**
 * Tests for RefactoringEngine: extractFunction, renameVariable,
 * convertToArrow, addErrorHandling, addLogging, formatCode, detectCodeSmells.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { RefactoringEngine } = require("../../src/codegen/refactoring");

const engine = new RefactoringEngine();

// ---- extractFunction ----

test("extractFunction: extracts selected code into new function by line range", () => {
  const code = `function process(items) {
  const filtered = items.filter(i => i.active);
  const result = filtered.map(i => i.name);
  console.log(result);
  return result;
}`;

  const res = engine.extractFunction(code, { startLine: 3, endLine: 4 }, { functionName: "mapAndLog" });

  assert.ok(res.content.includes("function mapAndLog"));
  assert.ok(res.content.includes("mapAndLog(filtered)"));
  assert.ok(res.content.includes("items.filter"));
  assert.equal(res.extractedFunction.name, "mapAndLog");
  assert.ok(res.extractedFunction.params.length > 0);
  assert.ok(res.extractedFunction.body.includes("filtered.map"));
});

test("extractFunction: infers outer variables as function parameters", () => {
  const code = `function calculate(total, rate) {
  const tax = total * rate;
  const final = tax + total;
  return final;
}`;

  const res = engine.extractFunction(code, { startLine: 3, endLine: 3 }, { functionName: "addTax" });

  // tax is local to selection, total is outer.
  assert.ok(res.content.includes("function addTax"));
  // Should include 'total' as a param since it's used in the selection.
  const params = res.extractedFunction.params;
  assert.ok(
    params.some((p) => p === "tax" || p === "total"),
    `Expected params to reference outer variable. Got: ${params.join(", ")}`
  );
});

test("extractFunction: insertBefore option places function before call site", () => {
  const code = `function main() {
  const x = 10;
  const y = x * 2;
  return y;
}`;

  const res = engine.extractFunction(
    code,
    { startLine: 3, endLine: 3 },
    { functionName: "doubleIt", insertAfter: false }
  );

  const lines = res.content.split("\n");
  const fnDefIdx = lines.findIndex((l) => l.includes("function doubleIt"));
  const callIdx = lines.findIndex((l) => l.includes("doubleIt(") && !l.includes("function"));

  // Function definition should appear before the call when insertAfter is false.
  assert.ok(fnDefIdx < callIdx, "Function definition should come before call site with insertBefore");
});

// ---- renameVariable ----

test("renameVariable: renames variable throughout code", () => {
  const code = `function sum(a, b) {
  const result = a + b;
  return result;
}

const result = sum(1, 2);
console.log(result);`;

  const renamed = engine.renameVariable(code, "result", "total");

  // All 'result' replacements should now be 'total'.
  assert.ok(!renamed.includes("const result"));
  assert.ok(renamed.includes("const total = a + b"));
  assert.ok(renamed.includes("return total;"));
  assert.ok(renamed.includes("const total = sum"));
  assert.ok(renamed.includes("console.log(total)"));
});

test("renameVariable: does not rename variables inside string literals", () => {
  const code = `const name = 'Alice';
const message = "Hello, name";
console.log(\`Welcome, \${name}\`);`;

  const renamed = engine.renameVariable(code, "name", "userName");

  // The variable declaration should change.
  assert.ok(renamed.includes("const userName = 'Alice'"));
  // The string literal "Hello, name" should NOT change.
  assert.ok(renamed.includes('"Hello, name"'));
  // Template literal expression should change.
  assert.ok(renamed.includes("Welcome, ${userName}"));
});

test("renameVariable: does not rename inside comments", () => {
  const code = `// The name variable holds the user name
const name = 'Bob';
/* old name reference */
console.log(name);`;

  const renamed = engine.renameVariable(code, "name", "identifier");

  assert.ok(renamed.includes("// The name variable holds the user name"));
  assert.ok(renamed.includes("const identifier = 'Bob'"));
  assert.ok(renamed.includes("/* old name reference */"));
  assert.ok(renamed.includes("console.log(identifier)"));
});

test("renameVariable: no-op when old and new names are the same", () => {
  const code = "const x = 1;";
  assert.equal(engine.renameVariable(code, "x", "x"), code);
});

// ---- convertToArrow ----

test("convertToArrow: converts function declaration to arrow function", () => {
  const code = `function greet(name) {
  return 'Hello, ' + name;
}`;

  const result = engine.convertToArrow(code, "greet");

  assert.ok(result.includes("const greet = (name) => {"));
  assert.ok(!result.startsWith("function greet"));
  assert.ok(result.includes("return 'Hello, ' + name;"));
});

test("convertToArrow: preserves async keyword", () => {
  const code = `async function fetchData(url) {
  const res = await fetch(url);
  return res.json();
}`;

  const result = engine.convertToArrow(code, "fetchData");

  assert.ok(result.includes("const fetchData = async (url) => {"));
  assert.ok(result.includes("await fetch(url)"));
});

test("convertToArrow: no-op when function not found", () => {
  const code = `const add = (a, b) => a + b;`;
  assert.equal(engine.convertToArrow(code, "multiply"), code);
});

// ---- addErrorHandling ----

test("addErrorHandling: wraps function body in try/catch", () => {
  const code = `function riskyOperation(data) {
  const parsed = JSON.parse(data);
  return parsed;
}`;

  const result = engine.addErrorHandling(code, "riskyOperation");

  assert.ok(result.includes("try {"));
  assert.ok(result.includes("catch (error) {"));
  assert.ok(result.includes("console.error('Error in riskyOperation:', error)"));
  assert.ok(result.includes("throw error;"));
  assert.ok(result.includes("JSON.parse(data)"));
});

test("addErrorHandling: works with arrow functions", () => {
  const code = `const parse = (input) => {
  return JSON.parse(input);
};`;

  const result = engine.addErrorHandling(code, "parse");

  assert.ok(result.includes("try {"));
  assert.ok(result.includes("Error in parse"));
});

// ---- addLogging ----

test("addLogging: adds console.log at entry and before returns", () => {
  const code = `function multiply(a, b) {
  return a * b;
}`;

  const result = engine.addLogging(code, "multiply");

  assert.ok(result.includes("console.log('multiply: entry'"));
  assert.ok(result.includes("console.log('multiply: exit'"));
  assert.ok(result.includes("return a * b;"));
});

test("addLogging: logs parameters on entry", () => {
  const code = `function process(data, options) {
  return transform(data, options);
}`;

  const result = engine.addLogging(code, "process");

  assert.ok(result.includes("console.log('process: entry'"));
  assert.ok(result.includes("data"));
  assert.ok(result.includes("options"));
});

// ---- formatCode ----

test("formatCode: normalizes indentation to 2 spaces", () => {
  const code = `function test() {
    const x = 1;
        if (x > 0) {
      return true;
  }
}`;

  const result = engine.formatCode(code);

  const lines = result.split("\n");
  // Should have consistent 2-space indentation.
  for (const line of lines) {
    if (line.trim() === "") continue;
    const leadingSpaces = line.match(/^(\s*)/)[1].length;
    assert.equal(leadingSpaces % 2, 0, `Line has invalid indentation: "${line}"`);
  }
});

test("formatCode: adds missing semicolons", () => {
  const code = `const x = 1
let y = x + 2
var z = y * 3
console.log(z)`;

  const result = engine.formatCode(code);

  assert.ok(result.includes("const x = 1;"));
  assert.ok(result.includes("let y = x + 2;"));
  assert.ok(result.includes("var z = y * 3;"));
});

test("formatCode: collapses multiple blank lines", () => {
  const code = `const a = 1;


const b = 2;


const c = 3;`;

  const result = engine.formatCode(code);

  const blankCount = result.split("\n").filter((l) => l === "").length;
  assert.ok(blankCount <= 2, `Too many blank lines: ${blankCount}`);
});

// ---- detectCodeSmells ----

test("detectCodeSmells: finds long functions (> 50 lines)", () => {
  // Build a long function.
  let body = "";
  for (let i = 0; i < 55; i++) {
    body += `  const x${i} = ${i};\n`;
  }
  const code = `function longFunc() {\n${body}  return 0;\n}`;

  const smells = engine.detectCodeSmells(code);

  assert.ok(smells.some((s) => s.type === "long-function"));
  const longSmell = smells.find((s) => s.type === "long-function");
  assert.ok(longSmell.message.includes("longFunc"));
});

test("detectCodeSmells: finds too many parameters (> 5)", () => {
  const code = `function manyArgs(a, b, c, d, e, f, g) {
  return a + b + c + d + e + f + g;
}`;

  const smells = engine.detectCodeSmells(code);

  assert.ok(
    smells.some((s) => s.type === "too-many-params"),
    `Expected too-many-params smell. Got: ${JSON.stringify(smells.map((s) => s.type))}`
  );
});

test("detectCodeSmells: finds duplicated code blocks", () => {
  const code = `function process(items) {
  const a = items.filter(Boolean);
  const b = a.map(x => x.trim());
  const c = b.join(' - ');
  const d = c.toLowerCase();
  const e = d.split(' ');
  return e;
}

function transform(items) {
  const a = items.filter(Boolean);
  const b = a.map(x => x.trim());
  const c = b.join(' - ');
  const d = c.toLowerCase();
  const e = d.split(' ');
  return { data: e };
}`;

  const smells = engine.detectCodeSmells(code);

  assert.ok(
    smells.some((s) => s.type === "duplicated-code"),
    `Expected duplicated-code smell. Got: ${JSON.stringify(smells.map((s) => s.type))}`
  );
});

test("detectCodeSmells: returns array with correct structure", () => {
  const code = `function short() { return 1; }`;
  const smells = engine.detectCodeSmells(code);

  // Short function with no issues should return empty or minimal smells.
  for (const smell of smells) {
    assert.ok(typeof smell.type === "string");
    assert.ok(typeof smell.message === "string");
    assert.ok(typeof smell.line === "number");
    assert.ok(typeof smell.severity === "string");
  }
});

test("detectCodeSmells: finds deep nesting", () => {
  const code = `function nested() {
  if (true) {
    if (true) {
      if (true) {
        if (true) {
          if (true) {
            if (true) {
              return 'deep';
            }
          }
        }
      }
    }
  }
}`;

  const smells = engine.detectCodeSmells(code);
  assert.ok(
    smells.some((s) => s.type === "deep-nesting"),
    `Expected deep-nesting smell. Got: ${JSON.stringify(smells.map((s) => s.type))}`
  );
});
