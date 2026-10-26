// delete_member must keep distributed loads on the right members: loads on
// deleted members go away, loads on later members follow them to their new
// positions, and BASIC_LOAD_CASES counts stay in step.
import fs from "fs";
import path from "path";
import assert from "assert";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createRisaServer } from "../index.js";
import {
  tokenize,
  normalizeEol,
  parseNodesOrdered,
  parseMembersResolved,
  parseLoadsByBasicLoadCase,
  remapMemberLoadsAfterDelete,
  loadTableIssues,
  validateRisaEdit
} from "../risa-core.js";
import { samplePath, outputDir, ensureOutputDir } from "./test-utils.js";

ensureOutputDir();

// Fixture distributed loads: DL on M3 and M4, LL on M3.
const sample = normalizeEol(fs.readFileSync(samplePath, "utf8"));

const server = createRisaServer();
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "risa-delete-tests", version: "1.0.0" });
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

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

// { DL: ["M3:-0.100000", ...], LL: [...] } with loads resolved to member labels.
function loadsByCase(content) {
  const members = parseMembersResolved(content, parseNodesOrdered(content));
  const result = {};

  for (const c of parseLoadsByBasicLoadCase(content).cases) {
    result[c.name] = c.distributedLoads.map(r => {
      const member = members[parseInt(r.tokens[0], 10) - 1];
      return `${member ? member.label : "?"}:${r.tokens[2]}`;
    });
  }

  return result;
}

async function deleteMembers(memberLabels, name) {
  const outputPath = path.join(outputDir, `delete-${name}.r3d`);
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  const result = await client.callTool({
    name: "delete_member",
    arguments: { filePath: samplePath, outputPath, memberLabels }
  });
  const text = result.content.map(c => c.text).join("\n");

  assert.ok(fs.existsSync(outputPath), text);
  return { text, content: normalizeEol(fs.readFileSync(outputPath, "utf8")) };
}

await test("fixture loads resolve to the expected members", async () => {
  assert.deepStrictEqual(loadsByCase(sample), {
    DL: ["M3:-0.100000", "M4:-0.100000"],
    LL: ["M3:-0.250000"]
  });
});

await test("deleting M3 drops its DL and LL loads and keeps M4's load on M4", async () => {
  const { text, content } = await deleteMembers(["M3"], "m3");

  assert.deepStrictEqual(loadsByCase(content), { DL: ["M4:-0.100000"], LL: [] });
  assert.deepStrictEqual(loadTableIssues(content), []);
  assert.deepStrictEqual(validateRisaEdit(sample, content), []);
  assert.match(text, /Distributed loads removed with deleted members: 2/);
  assert.match(text, /Distributed loads renumbered to new member positions: 1/);
});

await test("deleting M1 renumbers every load without dropping any", async () => {
  const { text, content } = await deleteMembers(["M1"], "m1");

  assert.deepStrictEqual(loadsByCase(content), loadsByCase(sample));
  assert.match(text, /removed with deleted members: 0/);
  assert.match(text, /renumbered to new member positions: 3/);
});

await test("deleting M4 and M5 drops M4's load and leaves M3's loads alone", async () => {
  const { content } = await deleteMembers(["M5", "M4"], "m4-m5");

  assert.deepStrictEqual(loadsByCase(content), { DL: ["M3:-0.100000"], LL: ["M3:-0.250000"] });
  assert.deepStrictEqual(validateRisaEdit(sample, content), []);
});

await test("deleting a member with no loads leaves the load tables unchanged", async () => {
  const { content } = await deleteMembers(["M5"], "m5");

  const loadsSection = text => text.slice(text.indexOf("[BASIC_LOAD_CASES]"), text.indexOf("[LOAD_COMBINATIONS]"));
  assert.strictEqual(loadsSection(content), loadsSection(sample));
});

await test("remapMemberLoadsAfterDelete reports dropped rows with their case", async () => {
  const result = remapMemberLoadsAfterDelete(sample, [3]);

  assert.deepStrictEqual(result.droppedRows.map(d => `${d.caseName}@${d.position}`), ["DL@3", "LL@3"]);
  assert.strictEqual(result.renumbered, 1);
  assert.strictEqual(tokenize(result.content.match(/\[DIRECT_DISTRIBUTED_LOADS\] <1>\n(.*)/)[1])[0], "3");
});

await test("delete_member refuses to edit loads when load tables are already inconsistent", async () => {
  const brokenPath = path.join(outputDir, "delete-broken-source.r3d");
  const outputPath = path.join(outputDir, "delete-broken-out.r3d");
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  fs.writeFileSync(brokenPath, sample.replace("[DIRECT_DISTRIBUTED_LOADS] <3>", "[DIRECT_DISTRIBUTED_LOADS] <4>"), "utf8");

  const result = await client.callTool({
    name: "delete_member",
    arguments: { filePath: brokenPath, outputPath, memberLabels: ["M3"] }
  });

  assert.match(result.content[0].text, /^Error: Load tables are already inconsistent/);
  assert.ok(!fs.existsSync(outputPath));
});

await client.close();
await server.close();
