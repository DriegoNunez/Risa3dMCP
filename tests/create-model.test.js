import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRisaServer } from "../index.js";
import { createRisaModel, buildEmptyRisaModel } from "../risa-create.js";
import { findSection, normalizeEol, validateRisaEdit } from "../risa-core.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "risa-create-"));
const server = createRisaServer();
const client = new Client({ name: "create-model-tests", version: "1.0.0" });
const [st, ct] = InMemoryTransport.createLinkedPair();
try {
  await Promise.all([server.connect(st), client.connect(ct)]);
  const outputPath = path.join(dir, "new.r3d");
  const result = await client.callTool({ name: "create_risa_model", arguments: { outputPath, title: "New $& project", company: "ACME", designer: "Test" } });
  assert.ok(!result.isError, JSON.stringify(result));
  const raw = fs.readFileSync(outputPath, "utf8");
  assert.ok(!/(^|[^\r])\n/.test(raw));
  const content = normalizeEol(raw);
  assert.ok(content.startsWith("[RISA-3D_INPUT_DATA]"));
  assert.ok(content.endsWith("[FINISH]\n"));
  for (const name of ["NODES", "MEMBERS_MAIN_DATA", "BOUNDARY_CONDITIONS", "BASIC_LOAD_CASES", "LOAD_COMBINATIONS"]) {
    assert.equal(findSection(content, name).declaredCount, 0);
    assert.equal(findSection(content, name).lines.length, 0);
  }
  assert.deepEqual(validateRisaEdit("", content), []);
  const summaryResult = await client.callTool({ name: "read_risa_model", arguments: { filePath: outputPath } });
  const summary = JSON.parse(summaryResult.content[0].text);
  assert.equal(summary.title, "New $& project");
  assert.equal(summary.nodeCount, 0);
  assert.equal(summary.memberCount, 0);
  assert.equal(summary.designer, "Test");
  const again = await client.callTool({ name: "create_risa_model", arguments: { outputPath } });
  assert.equal(again.isError, true);
  assert.equal(fs.readFileSync(outputPath, "utf8"), raw);
  console.log("PASS: MCP creates an empty model without a source, parses metadata and refuses overwrite");

  const floorPath = path.join(dir, "floor.RFL");
  const floorArgs = { outputPath: floorPath, program: "risafloor", title: "New Floor", company: "Floor Co", designer: "Floor Designer" };
  const floorResult = await client.callTool({ name: "create_risa_model", arguments: floorArgs });
  assert.ok(!floorResult.isError, JSON.stringify(floorResult));
  const floorSummary = JSON.parse(floorResult.content[0].text);
  assert.equal(floorSummary.program, "risafloor");
  assert.equal(floorSummary.floorCount, 0);
  assert.equal(floorSummary.beamCount, 0);
  assert.equal(floorSummary.columnCount, 0);
  assert.ok(!("nodeCount" in floorSummary));
  const floorRaw = fs.readFileSync(floorPath, "utf8");
  assert.ok(!/(^|[^\r])\n/.test(floorRaw));
  const floor = normalizeEol(floorRaw);
  assert.ok(floor.startsWith("[RISA_FLOOR_INPUT_DATA]"));
  assert.ok(floor.endsWith("[RISA_FLOOR_FINISH]\n0\n[FINISH]\n"));
  assert.ok(!floor.includes("[RISA-3D_INPUT_DATA]"));
  assert.ok(!floor.includes("[NODES]"));
  assert.equal(findSection(floor, "RF_MODEL_TITLE").lines[0], "New Floor");
  assert.equal(findSection(floor, "RF_COMPANY_NAME").lines[0], "Floor Co");
  assert.equal(findSection(floor, "RF_DESIGNER_NAME").lines[0], "Floor Designer");
  for (const name of ["RF_LAYOUTS", "RF_DIAPHRAGMS", "RF_PCOL_UBLS"]) {
    assert.equal(findSection(floor, name).declaredCount, 0);
    assert.equal(findSection(floor, name).lines.length, 0);
  }
  assert.equal((await client.callTool({ name: "create_risa_model", arguments: floorArgs })).isError, true);
  assert.equal(fs.readFileSync(floorPath, "utf8"), floorRaw);
  for (const args of [
    { program: "risafloor", outputPath: path.join(dir, "wrong.r3d") },
    { program: "risa3d", outputPath: path.join(dir, "wrong.rfl") },
    { outputPath: path.join(dir, "implicit.rfl") },
    { program: "unknown", outputPath: path.join(dir, "invalid.rfl") },
    { program: "risafloor", outputPath: path.join(dir, "injected.rfl"), title: "bad\n[RF_LAYOUTS]" }
  ]) {
    assert.equal((await client.callTool({ name: "create_risa_model", arguments: args })).isError, true);
    assert.ok(!fs.existsSync(args.outputPath));
  }
  assert.ok(!buildEmptyRisaModel({ outputPath: floorPath, program: "risafloor" }).includes("[..RF_COMPANY_NAME]"));
  console.log("PASS: RISAFloor creation through MCP uses native RF sections, validates program/extension, and protects existing files");

  for (const field of ["title", "company", "designer"]) {
    for (const value of ["bad\n[NODES] <1>", 'bad"quote', "bad\u0000", "x".repeat(201)]) {
      assert.throws(() => createRisaModel({ outputPath: path.join(dir, "bad.r3d"), [field]: value }));
      assert.ok(!fs.existsSync(path.join(dir, "bad.r3d")));
    }
  }
  for (const outputPath of ["relative.r3d", path.join(dir, "bad.txt"), path.join(dir, "missing", "new.r3d")]) {
    assert.throws(() => createRisaModel({ outputPath }));
  }
  const alias = path.join(dir, "alias.r3d");
  fs.linkSync(outputPath, alias);
  assert.throws(() => createRisaModel({ outputPath: alias }), /EEXIST/);
  assert.equal(fs.readFileSync(outputPath, "utf8"), raw);
  assert.ok(buildEmptyRisaModel({ outputPath }).includes("Untitled"));
  assert.ok(!buildEmptyRisaModel({ outputPath }).includes("[..COMPANY_NAME]"));
  assert.ok(!buildEmptyRisaModel({ outputPath, designer: "  " }).includes("[..DESIGNER_NAME]"));
  console.log("PASS: rejects invalid metadata, invalid destinations and existing hard-link targets");
} finally {
  await client.close();
  await server.close();
  // Only the uniquely allocated test directory is removed.
  fs.rmSync(dir, { recursive: true, force: true });
}
