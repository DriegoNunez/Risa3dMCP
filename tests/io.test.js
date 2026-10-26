import fs from "fs";
import path from "path";
import assert from "assert";

import {
  findSection,
  getSectionCount,
  spliceMatch,
  spliceMatchGroup,
  spliceMatches,
  readRisaFile,
  writeRisaFile,
  validateRisaEdit,
  getNodesSection,
  getMembersSection,
  replaceSectionSizeInContent
} from "../risa-core.js";

import {
  readSample,
  samplePath,
  outputDir,
  ensureOutputDir,
  test
} from "./test-utils.js";

ensureOutputDir();

const content = readSample();

test("findSection finds dotted and undotted sections by bare name", () => {
  const members = findSection(content, "MEMBERS_MAIN_DATA");
  const nodes = findSection(content, "NODES");

  assert.ok(members, "Expected [.MEMBERS_MAIN_DATA]");
  assert.strictEqual(members.dots, ".");
  assert.strictEqual(members.declaredCount, members.lines.length);
  assert.ok(nodes, "Expected [NODES]");
  assert.strictEqual(nodes.dots, "");
  assert.strictEqual(content.slice(nodes.bodyStart, nodes.bodyEnd), nodes.body);
});

test("getSectionCount reads the member count from [.MEMBERS_MAIN_DATA]", () => {
  assert.strictEqual(getSectionCount(content, "MEMBERS_MAIN_DATA"), 5);
  assert.strictEqual(getSectionCount(content, "NODES"), 6);
  assert.strictEqual(getSectionCount(content, "DOES_NOT_EXIST"), null);
});

test("spliceMatch replaces only the matched occurrence and keeps $ literal", () => {
  const text = "AAA [X] AAA";
  const match = text.match(/AAA$/);
  const result = spliceMatch(text, match, "$& $1");

  assert.strictEqual(result, "AAA [X] $& $1");
});

test("spliceMatch refuses a stale match", () => {
  const text = "one two";
  const match = text.match(/two/);

  assert.throws(() => spliceMatch("one three", match, "x"), /stale/);
});

test("spliceMatchGroup replaces a body group", () => {
  const text = "[A] <1>\nold\n[END_A]";
  const match = text.match(/(\[A\] <\d+>)([\s\S]*?)(\[END_A\])/);

  assert.strictEqual(spliceMatchGroup(text, match, 2, "\nnew\n"), "[A] <1>\nnew\n[END_A]");
});

test("spliceMatches applies edits from the same snapshot in any order", () => {
  const nodes = getNodesSection(content);
  const members = getMembersSection(content);

  const result = spliceMatches(content, [
    [nodes.match, "NODES_REPLACED"],
    [members.match, "MEMBERS_REPLACED"]
  ]);

  assert.ok(result.includes("NODES_REPLACED"));
  assert.ok(result.includes("MEMBERS_REPLACED"));
  assert.ok(!result.includes("[END_NODES]"));
});

test("replaceSectionSizeInContent changes set and member sizes", () => {
  const result = replaceSectionSizeInContent(content, { oldSize: "W14X22", newSize: "W16X26", scope: "both" });

  assert.strictEqual(result.setsChanged, 1);
  assert.strictEqual(result.membersChanged, 3);
  assert.strictEqual(validateRisaEdit(content, result.content).length, 0);
});

test("validateRisaEdit flags a stale header count", () => {
  const broken = content.replace("[NODES] <6>", "[NODES] <7>");
  const errors = validateRisaEdit(content, broken);

  assert.ok(errors.some(e => e.includes("[NODES]")), errors.join("; "));
});

test("validateRisaEdit flags a dropped section marker", () => {
  const broken = content.replace("[END_AREA_LOADS]\n", "");
  const errors = validateRisaEdit(content, broken);

  assert.ok(errors.some(e => e.includes("END_AREA_LOADS")), errors.join("; "));
});

test("validateRisaEdit flags a new out-of-range node reference", () => {
  const members = findSection(content, "MEMBERS_MAIN_DATA");
  const badLine = members.lines[0].replace(/ 1 2 /, " 1 99 ");
  const broken = content.replace(members.lines[0], badLine);
  const errors = validateRisaEdit(content, broken);

  assert.ok(errors.some(e => e.includes("invalid node reference")), errors.join("; "));
});

test("readRisaFile normalizes CRLF and writeRisaFile restores it", () => {
  const crlfSource = path.join(outputDir, "io-crlf-source.r3d");
  const crlfOut = path.join(outputDir, "io-crlf-out.r3d");

  fs.writeFileSync(crlfSource, fs.readFileSync(samplePath, "utf8").replace(/\r?\n/g, "\r\n"), "utf8");

  const normalized = readRisaFile(crlfSource);
  assert.ok(!normalized.includes("\r"), "readRisaFile should return LF text");

  writeRisaFile(crlfOut, normalized, { sourcePath: crlfSource });

  const written = fs.readFileSync(crlfOut, "utf8");
  assert.ok(!/(^|[^\r])\n/.test(written), "Every line should end in CRLF");
  assert.strictEqual(written, fs.readFileSync(crlfSource, "utf8"));
  assert.ok(!fs.existsSync(`${crlfOut}.tmp`), "Temp file should be renamed away");
});

test("writeRisaFile refuses an invalid edit and writes nothing", () => {
  const outPath = path.join(outputDir, "io-refused.r3d");
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  const broken = content.replace("[NODES] <6>", "[NODES] <2>");

  assert.throws(() => writeRisaFile(outPath, broken, { sourcePath: samplePath }), /failed validation/);
  assert.ok(!fs.existsSync(outPath), "No output file should be written");
});
