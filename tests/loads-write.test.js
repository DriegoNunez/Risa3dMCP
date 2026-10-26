import assert from "assert";

import {
  tokenize,
  cleanSemi,
  findSection,
  parseLoadsByBasicLoadCase,
  addLoadFromTemplate,
  loadTableIssues,
  replaceToken,
  formatLikeToken,
  validateRisaEdit
} from "../risa-core.js";

import {
  readSample,
  test
} from "./test-utils.js";

// Fixture: DL owns 1 node load and distributed rows 1-2; LL owns distributed row 3.
const content = readSample().replace(/\r\n/g, "\n");

function caseLoads(text, name) {
  return parseLoadsByBasicLoadCase(text).cases.find(c => c.name === name);
}

function blcCount(text, name, tokenIndex) {
  const line = findSection(text, "BASIC_LOAD_CASES").lines.find(l => l.includes(`"${name} `));
  return parseInt(cleanSemi(tokenize(line)[tokenIndex]), 10);
}

test("fixture load tables are consistent", () => {
  assert.deepStrictEqual(loadTableIssues(content), []);
});

test("replaceToken rewrites one field and keeps spacing and semicolon", () => {
  assert.strictEqual(replaceToken('1 "DL   " 1 0 0 2 0;', 6, "5"), '1 "DL   " 1 0 0 2 5;');
  assert.strictEqual(replaceToken("5   2   -1.5   101;", 2, "-3.000000"), "5   2   -3.000000   101;");
});

test("formatLikeToken follows the template's number style", () => {
  assert.strictEqual(formatLikeToken("-0.100000", -0.25), "-0.250000");
  assert.strictEqual(formatLikeToken("1.000000000000e+00;", 2), "2.000000000000e+00");
});

test("addLoadFromTemplate adds a node load to DL and bumps its count", () => {
  const result = addLoadFromTemplate(content, { kind: "node", caseName: "dl", targetIndex: 2, fields: { 2: -3 } });

  assert.strictEqual(result.caseName, "DL");
  assert.strictEqual(result.rowNumber, 2);
  assert.strictEqual(blcCount(result.content, "DL", 2), 2);
  assert.strictEqual(findSection(result.content, "NODE_LOADS").declaredCount, 2);
  assert.deepStrictEqual(loadTableIssues(result.content), []);

  const rows = caseLoads(result.content, "DL").nodeLoads.map(r => r.tokens);
  assert.deepStrictEqual(rows[1], ["2", "2", "-3.000000", "101"], "copies direction and internal ID from the template");
});

test("addLoadFromTemplate inserts a DL distributed load before LL's rows", () => {
  const result = addLoadFromTemplate(content, { kind: "distributed", caseName: "DL", targetIndex: 5, fields: { 2: -0.3, 3: -0.3 } });

  assert.strictEqual(result.rowNumber, 3);
  assert.strictEqual(blcCount(result.content, "DL", 5), 3);
  assert.strictEqual(blcCount(result.content, "LL", 5), 1);

  const dl = caseLoads(result.content, "DL").distributedLoads.map(r => r.tokens[0]);
  const ll = caseLoads(result.content, "LL").distributedLoads.map(r => r.tokens);
  assert.deepStrictEqual(dl, ["3", "4", "5"]);
  assert.strictEqual(ll.length, 1);
  assert.strictEqual(cleanSemi(ll[0][6]), "102", "LL row keeps its owner after the insert");
  assert.deepStrictEqual(validateRisaEdit(content, result.content), []);
});

test("addLoadFromTemplate appends to the last case", () => {
  const result = addLoadFromTemplate(content, { kind: "distributed", caseName: "LL", targetIndex: 4, fields: { 2: -0.4, 3: -0.2 } });

  assert.strictEqual(result.rowNumber, 4);
  assert.strictEqual(blcCount(result.content, "LL", 5), 2);

  const ll = caseLoads(result.content, "LL").distributedLoads.map(r => r.tokens);
  assert.deepStrictEqual(ll[1].slice(0, 4), ["4", "2", "-0.400000", "-0.200000"]);
  assert.strictEqual(cleanSemi(ll[1][6]), "102");
});

test("addLoadFromTemplate copies the requested template row", () => {
  const sourceText = content.replace("4 2 -0.100000 -0.100000 0.000000 0.000000 101;", "4 3 -0.100000 -0.100000 0.000000 0.000000 101;");
  const result = addLoadFromTemplate(sourceText, { kind: "distributed", caseName: "DL", targetIndex: 1, templateIndex: 4, fields: { 2: 1, 3: 1 } });

  assert.strictEqual(tokenize(result.newRow)[1], "3", "direction comes from member 4's row");
});

test("addLoadFromTemplate refuses a case with no rows of that type", () => {
  assert.throws(
    () => addLoadFromTemplate(content, { kind: "node", caseName: "LL", targetIndex: 2, fields: { 2: -1 } }),
    /has no existing NODE_LOADS rows/
  );
});

test("addLoadFromTemplate lists available cases for an unknown name", () => {
  assert.throws(
    () => addLoadFromTemplate(content, { kind: "node", caseName: "WLx", targetIndex: 2, fields: { 2: -1 } }),
    /not found\. Available: DL, LL/
  );
});

test("addLoadFromTemplate refuses already-inconsistent load tables", () => {
  const broken = content.replace('1 "DL                              " 1 0 0 2 0;', '1 "DL                              " 1 0 0 1 0;');

  assert.throws(
    () => addLoadFromTemplate(broken, { kind: "node", caseName: "DL", targetIndex: 2, fields: { 2: -1 } }),
    /already inconsistent/
  );
});

test("validateRisaEdit flags a load-case count that no longer matches the rows", () => {
  const broken = content.replace("[DIRECT_DISTRIBUTED_LOADS] <3>\n3 2 -0.100000 -0.100000 0.000000 0.000000 101;\n", "[DIRECT_DISTRIBUTED_LOADS] <2>\n");
  const errors = validateRisaEdit(content, broken);

  assert.ok(errors.some(e => e.includes("[BASIC_LOAD_CASES] assigns 3")), errors.join("; "));
});

test("validateRisaEdit flags a load pointing past the last member", () => {
  const broken = content.replace("4 2 -0.100000 -0.100000 0.000000 0.000000 101;", "9 2 -0.100000 -0.100000 0.000000 0.000000 101;");
  const errors = validateRisaEdit(content, broken);

  assert.ok(errors.some(e => e.includes("points to member 9")), errors.join("; "));
});
