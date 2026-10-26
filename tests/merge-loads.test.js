// merge_members must keep distributed loads exact: matching uniform
// full-length loads on both members combine, any other load on either member
// blocks the merge, and loads on later members are renumbered.
import fs from "fs";
import path from "path";
import assert from "assert";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createRisaServer } from "../index.js";
import {
  normalizeEol,
  parseNodesOrdered,
  parseMembersResolved,
  parseLoadsByBasicLoadCase,
  addLoadFromTemplate,
  rewriteLoadRows,
  validateRisaEdit
} from "../risa-core.js";
import { samplePath, outputDir, ensureOutputDir } from "./test-utils.js";

ensureOutputDir();

// Fixture: M3 (N2->N5) and M4 (N5->N4) share N5 and are both W14X22.
// DL: M3 -0.1, M4 -0.1 (uniform, full length). LL: M3 -0.25 only.
const sample = normalizeEol(fs.readFileSync(samplePath, "utf8"));

const add = (content, caseName, member, start, end = start) =>
  addLoadFromTemplate(content, { kind: "distributed", caseName, targetIndex: member, fields: { 2: start, 3: end } }).content;

// LL on M4 to match M3's, plus a DL load on M5 to watch renumbering.
const matching = add(add(sample, "LL", 4, -0.25), "DL", 5, -0.5);

const server = createRisaServer();
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "risa-merge-tests", version: "1.0.0" });
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

async function merge(sourceContent, name, memberLabel1 = "M3", memberLabel2 = "M4") {
  const sourcePath = path.join(outputDir, `merge-${name}-source.r3d`);
  const outputPath = path.join(outputDir, `merge-${name}-out.r3d`);
  fs.writeFileSync(sourcePath, sourceContent, "utf8");
  if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

  const result = await client.callTool({
    name: "merge_members",
    arguments: { filePath: sourcePath, outputPath, memberLabel1, memberLabel2 }
  });

  const text = result.content.map(c => c.text).join("\n");
  const written = fs.existsSync(outputPath) ? normalizeEol(fs.readFileSync(outputPath, "utf8")) : null;
  return { text, written };
}

await test("matching uniform loads combine and later loads are renumbered", async () => {
  const { text, written } = await merge(matching, "matching");

  assert.ok(written, text);
  assert.deepStrictEqual(loadsByCase(written), {
    DL: ["M3:-0.100000", "M5:-0.500000"],
    LL: ["M3:-0.250000"]
  });
  assert.deepStrictEqual(validateRisaEdit(matching, written), []);
  assert.match(text, /Distributed loads combined onto M3: 2/);
  assert.match(text, /renumbered to new member positions: 1/);
});

await test("a load on only one member blocks the merge", async () => {
  const { text, written } = await merge(sample, "one-sided");

  assert.strictEqual(written, null, "No file should be written");
  assert.match(text, /^Error: merge not done/);
  assert.match(text, /LL on kept member: -0\.250000 -> -0\.250000/);
  assert.doesNotMatch(text, /DL on/, "DL loads match and should not be listed");
});

await test("different magnitudes block the merge", async () => {
  const { text, written } = await merge(add(sample, "LL", 4, -0.3), "different");

  assert.strictEqual(written, null);
  assert.match(text, /LL on kept member: -0\.250000/);
  assert.match(text, /LL on removed member: -0\.300000/);
});

await test("a varying load blocks the merge even when both members match", async () => {
  const varying = add(add(sample, "LL", 4, -0.25), "DL", 3, -0.1, -0.2);
  const both = add(varying, "DL", 4, -0.1, -0.2);
  const { text, written } = await merge(both, "varying");

  assert.strictEqual(written, null);
  assert.match(text, /DL on kept member: -0\.100000 -> -0\.200000/);
});

await test("a partial-span load blocks the merge", async () => {
  const partial = matching.replace(
    "4 2 -0.100000 -0.100000 0.000000 0.000000 101;",
    "4 2 -0.100000 -0.100000 2.000000 5.000000 101;"
  );
  const { text, written } = await merge(partial, "partial");

  assert.strictEqual(written, null);
  assert.match(text, /DL on removed member: .*locations 2\.000000 -> 5\.000000/);
});

await test("reversed member order with loads blocks the merge", async () => {
  const { text, written } = await merge(matching, "reversed", "M4", "M3");

  assert.strictEqual(written, null);
  assert.match(text, /^Error: merge not done/);
});

await test("members without loads merge in either order", async () => {
  const noDistributed = rewriteLoadRows(sample, "distributed", () => null);
  const { text, written } = await merge(noDistributed, "no-loads", "M4", "M3");

  assert.ok(written, text);
  assert.match(text, /combined onto M4: 0/);
  assert.deepStrictEqual(validateRisaEdit(noDistributed, written), []);
});

await client.close();
await server.close();
