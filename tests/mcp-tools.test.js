// Runs the MCP write tools end to end against the fixture, in both LF and CRLF
// form, and checks each output keeps the source line endings and validates.
import fs from "fs";
import path from "path";
import assert from "assert";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createRisaServer } from "../index.js";
import { normalizeEol, validateRisaEdit, parseNodesOrdered, parseMembersResolved } from "../risa-core.js";
import { samplePath, outputDir, ensureOutputDir } from "./test-utils.js";

ensureOutputDir();

const server = createRisaServer();
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "risa-tests", version: "1.0.0" });
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

async function callTool(name, args) {
  const result = await client.callTool({ name, arguments: args });
  return result.content.map(c => c.text).join("\n");
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err.message);
    process.exitCode = 1;
  }
}

const writeCases = [
  ["modify_section_set", { oldSize: "W14X22", newSize: "W16X26", mode: "both" }],
  ["batch_replace_section_size", { replacements: [{ oldSize: "HSS6X6X4", newSize: "HSS8X8X4", scope: "both" }] }],
  ["clone_model_with_changes", {
    changes: {
      sectionSizes: [{ oldSize: "W14X22", newSize: "W16X26", scope: "both" }],
      boundaryConditions: [{ nodeLabel: "N1", rotZ: "Free" }],
      loadMagnitudes: [{ memberLabel: "M3", loadCaseName: "DL", newStartMag: -0.2 }],
      nodeLoads: [{ nodeLabel: "N5", loadCaseName: "DL", newMagnitude: -2 }]
    }
  }],
  ["add_member", { type: "Wide Flange", size: "W12X19", iNodeLabel: "N2", jNodeLabel: "N4" }],
  ["add_member", { type: "Tube", size: "HSS6X6X4", iNodeLabel: "N6", jCoord: { x: 20, y: 0, z: 15 } }],
  ["move_node", { nodeLabel: "N5", x: 11, y: 12, z: 0 }],
  ["delete_member", { memberLabels: ["M5"] }],
  ["copy_member", { sourceMemberLabel: "M3", newMemberLabel: "M90", iNodeLabel: "N2", jNodeLabel: "N4" }],
  ["split_member", { memberLabel: "M1", splitFraction: 0.5 }],
  ["merge_members", { memberLabel1: "M3", memberLabel2: "M4" }],
  ["mirror_geometry", { memberLabels: ["M1", "M3"], mirrorPlane: "YZ", mirrorAt: 30 }],
  ["copy_translate_geometry", { memberLabels: ["M1", "M2", "M3", "M4"], dx: 0, dy: 0, dz: 15 }]
];

const sources = {
  lf: path.join(outputDir, "mcp-source-lf.r3d"),
  crlf: path.join(outputDir, "mcp-source-crlf.r3d")
};

const sample = normalizeEol(fs.readFileSync(samplePath, "utf8"));
fs.writeFileSync(sources.lf, sample, "utf8");
fs.writeFileSync(sources.crlf, sample.replace(/\n/g, "\r\n"), "utf8");

await test("read_risa_model reports the member count from [.MEMBERS_MAIN_DATA]", async () => {
  const summary = JSON.parse(await callTool("read_risa_model", { filePath: sources.lf }));

  assert.strictEqual(summary.memberCount, 5);
  assert.strictEqual(summary.nodeCount, 6);
  assert.strictEqual(summary.title, "Synthetic Test Frame");
});

await test("read_risa_model trims CR from CRLF titles", async () => {
  const summary = JSON.parse(await callTool("read_risa_model", { filePath: sources.crlf }));

  assert.strictEqual(summary.title, "Synthetic Test Frame");
  assert.strictEqual(summary.memberCount, 5);
});

for (const [eol, sourcePath] of Object.entries(sources)) {
  for (const [i, [tool, args]] of writeCases.entries()) {
    await test(`${tool} #${i} writes a valid model with ${eol.toUpperCase()} endings`, async () => {
      const outputPath = path.join(outputDir, `mcp-${tool}-${i}-${eol}.r3d`);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

      const text = await callTool(tool, { filePath: sourcePath, outputPath, ...args });

      assert.ok(!/^Error/m.test(text), text);
      assert.ok(fs.existsSync(outputPath), `No output written:\n${text}`);

      const raw = fs.readFileSync(outputPath, "utf8");
      if (eol === "crlf") {
        assert.ok(!/(^|[^\r])\n/.test(raw), "Found LF-only line in CRLF output");
      } else {
        assert.ok(!raw.includes("\r"), "Found CR in LF output");
      }

      const updated = normalizeEol(raw);
      assert.notStrictEqual(updated, sample, "Output should differ from the source");
      assert.deepStrictEqual(validateRisaEdit(sample, updated), []);

      const nodes = parseNodesOrdered(updated);
      assert.ok(parseMembersResolved(updated, nodes).length > 0);
    });
  }
}

await test("replace_section_size_in_folder keeps CRLF endings", async () => {
  const folder = path.join(outputDir, "mcp-folder");
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder);
  fs.copyFileSync(sources.crlf, path.join(folder, "frame.r3d"));

  const text = await callTool("replace_section_size_in_folder", {
    folderPath: folder, oldSize: "W14X22", newSize: "W16X26", outputSuffix: "_rev"
  });

  const outPath = path.join(folder, "frame_rev.r3d");
  assert.ok(fs.existsSync(outPath), text);
  assert.ok(!/(^|[^\r])\n/.test(fs.readFileSync(outPath, "utf8")), "Found LF-only line in CRLF output");
});

await client.close();
await server.close();
