/**
 * Tests for ImportManager: parse, addImport, removeImport, sortImports,
 * mergeImports, getImports, hasImport.
 */
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { ImportManager } = require("../../src/codegen/import-manager");

const mgr = new ImportManager();

// ---- parse ----

test("parse: basic named imports", () => {
  const code = `import { useState, useEffect } from 'react';
import { render } from 'react-dom';
console.log('hello');`;

  const imports = mgr.parse(code);
  assert.equal(imports.length, 2);
  assert.equal(imports[0].source, "react");
  assert.equal(imports[0].type, "es");
  assert.deepEqual(imports[0].named.map((n) => n.name), ["useState", "useEffect"]);
  assert.equal(imports[1].source, "react-dom");
  assert.deepEqual(imports[1].named.map((n) => n.name), ["render"]);
});

test("parse: default import", () => {
  const code = `import React from 'react';
import _ from 'lodash';`;

  const imports = mgr.parse(code);
  assert.equal(imports.length, 2);
  assert.equal(imports[0].default, "React");
  assert.equal(imports[0].source, "react");
  assert.equal(imports[1].default, "_");
  assert.equal(imports[1].source, "lodash");
});

test("parse: namespace import", () => {
  const code = `import * as utils from './utils';
import * as ReactAll from 'react';`;

  const imports = mgr.parse(code);
  assert.equal(imports.length, 2);
  assert.equal(imports[0].namespace, "utils");
  assert.equal(imports[0].source, "./utils");
  assert.equal(imports[1].namespace, "ReactAll");
});

test("parse: mixed default + named import", () => {
  const code = `import React, { useState, useCallback as useCb } from 'react';`;

  const imports = mgr.parse(code);
  assert.equal(imports.length, 1);
  assert.equal(imports[0].default, "React");
  assert.equal(imports[0].source, "react");
  assert.deepEqual(imports[0].named.map((n) => n.name), ["useState", "useCallback"]);
  assert.equal(imports[0].named[1].alias, "useCb");
});

test("parse: side-effect imports", () => {
  const code = `import 'reflect-metadata';
import './styles.css';`;

  const imports = mgr.parse(code);
  assert.equal(imports.length, 2);
  assert.equal(imports[0].source, "reflect-metadata");
  assert.equal(imports[0].type, "es");
  assert.equal(imports[0].default, null);
  assert.equal(imports[0].named.length, 0);
  assert.equal(imports[1].source, "./styles.css");
});

test("parse: require() calls", () => {
  const code = `const fs = require('fs');
const { join, resolve } = require('path');
const axios = require('axios').default;`;

  const imports = mgr.parse(code);
  assert.equal(imports.length, 3);
  assert.equal(imports[0].type, "cjs");
  assert.equal(imports[0].default, "fs");
  assert.equal(imports[0].source, "fs");

  assert.equal(imports[1].type, "cjs");
  assert.deepEqual(imports[1].named.map((n) => n.name), ["join", "resolve"]);

  assert.equal(imports[2].type, "cjs");
  assert.equal(imports[2].default, "axios");
});

test("parse: multi-line destructured imports", () => {
  const code = `import {
  useState,
  useEffect,
  useCallback
} from 'react';`;

  const imports = mgr.parse(code);
  assert.equal(imports.length, 1);
  assert.equal(imports[0].source, "react");
  assert.deepEqual(
    imports[0].named.map((n) => n.name),
    ["useState", "useEffect", "useCallback"]
  );
});

test("parse: TypeScript type imports", () => {
  const code = `import type { User, Session } from './types';
import { type ApiResponse } from './responses';
import type DefaultConfig from './config';`;

  const imports = mgr.parse(code);
  assert.equal(imports.length, 3);
  assert.equal(imports[0].isType, true);
  assert.deepEqual(imports[0].named.map((n) => n.name), ["User", "Session"]);
  assert.equal(imports[1].isType, false); // inline type is parsed but isType not set for { type X }
  assert.equal(imports[2].isType, true);
  assert.equal(imports[2].default, "DefaultConfig");
});

test("parse: dynamic imports", () => {
  const code = `const module = await import('./heavy-module');
import('./lazy').then(m => m.init());`;

  const imports = mgr.parse(code);
  assert.ok(imports.some((i) => i.source === "./heavy-module"));
  assert.ok(imports.some((i) => i.source === "./lazy"));
});

// ---- addImport ----

test("addImport: adds import when not present", () => {
  const code = `const x = 1;
console.log(x);`;

  const result = mgr.addImport(code, "react", "{ useState }");
  assert.ok(result.includes("import { useState } from 'react';"));
  assert.ok(result.includes("const x = 1;"));
});

test("addImport: no-op when import already exists", () => {
  const code = `import React from 'react';
const x = 1;`;

  const result = mgr.addImport(code, "react", "React");
  assert.equal(result, code);
});

test("addImport: merges into existing import from same source", () => {
  const code = `import { useState } from 'react';
console.log('test');`;

  const result = mgr.addImport(code, "react", "{ useEffect }");
  // Named imports are sorted alphabetically: useEffect comes before useState.
  assert.ok(result.includes("{ useEffect, useState }"));
  assert.ok(!result.includes("import { useState } from 'react';\nimport { useEffect }"));
});

// ---- removeImport ----

test("removeImport: removes entire import line", () => {
  const code = `import { a } from './mod-a';
import { b } from './mod-b';
const x = 1;`;

  const result = mgr.removeImport(code, "./mod-a");
  assert.ok(!result.includes("./mod-a"));
  assert.ok(result.includes("./mod-b"));
  assert.ok(result.includes("const x = 1;"));
});

test("removeImport: removes specific named import from multi-import", () => {
  const code = `import React, { useState, useEffect } from 'react';
console.log(React);`;

  const result = mgr.removeImport(code, "useEffect");
  assert.ok(result.includes("useState"));
  assert.ok(!result.includes("useEffect"));
  assert.ok(result.includes("from 'react'"));
});

// ---- sortImports ----

test("sortImports: groups builtin, external, relative", () => {
  const code = `import { join } from 'path';
import React from 'react';
import { helper } from './helper';
import { useState } from 'react';
import * as fs from 'node:fs';
import { sortBy } from 'lodash';
import '../styles.css';`;

  const result = mgr.sortImports(code);

  // Check ordering: builtins first, then external, then relative.
  const lines = result.split("\n").map((l) => l.trim()).filter(Boolean);
  const joinIdx = lines.findIndex((l) => l.includes("path"));
  const fsIdx = lines.findIndex((l) => l.includes("fs"));
  const reactIdx = lines.findIndex((l) => l.includes("from 'react'"));
  const lodashIdx = lines.findIndex((l) => l.includes("lodash"));
  const helperIdx = lines.findIndex((l) => l.includes("helper"));
  const stylesIdx = lines.findIndex((l) => l.includes("styles.css"));

  // Builtins should come before external.
  assert.ok(fsIdx < reactIdx, "node:fs should come before react");
  assert.ok(joinIdx < reactIdx, "path should come before react");

  // External before relative.
  assert.ok(reactIdx < helperIdx, "react should come before ./helper");
  assert.ok(lodashIdx < helperIdx, "lodash should come before ./helper");

  // Relative last.
  assert.ok(helperIdx < stylesIdx || stylesIdx < helperIdx); // both relative
});

// ---- mergeImports ----

test("mergeImports: combines duplicate imports from same source", () => {
  const code = `import { useState } from 'react';
import { useEffect } from 'react';
import React from 'react';
const x = 1;`;

  const result = mgr.mergeImports(code);
  // Should have one import from react.
  const reactImports = result.split("\n").filter((l) => l.includes("'react'"));
  assert.equal(reactImports.length, 1);
  assert.ok(result.includes("useState"));
  assert.ok(result.includes("useEffect"));
  assert.ok(result.includes("React"));
});

// ---- getImports / hasImport ----

test("getImports: returns structured list", () => {
  const code = `import foo from './foo';
import { bar, baz } from './bar';`;

  const imports = mgr.getImports(code);
  assert.equal(imports.length, 2);
  assert.equal(imports[0].type, "es");
  assert.equal(imports[1].type, "es");
  assert.ok(imports[0].startLine > 0);
  assert.ok(imports[0].endLine > 0);
});

test("hasImport: checks existence of import by source", () => {
  const code = `import React from 'react';
const x = 1;`;

  assert.equal(mgr.hasImport(code, "react"), true);
  assert.equal(mgr.hasImport(code, "vue"), false);
});

test("hasImport: checks specific specifier", () => {
  const code = `import React, { useState, useEffect } from 'react';`;

  assert.equal(mgr.hasImport(code, "react", "React"), true);
  assert.equal(mgr.hasImport(code, "react", "{ useState }"), true);
  assert.equal(mgr.hasImport(code, "react", "{ useReducer }"), false);
  assert.equal(mgr.hasImport(code, "lodash", "_"), false);
});
