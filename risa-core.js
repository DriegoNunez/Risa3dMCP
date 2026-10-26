// risa-core.js
// Shared RISA-3D parsing helpers used by both index.js and risa-cli.js.

import fs from "fs";

// ---- File I/O ----
// Tools always work on "\n" text. writeRisaFile restores the source file's
// line endings, so an edited model never ends up with mixed CRLF/LF rows.

export function detectEol(text) {
  return /\r\n/.test(text) ? "\r\n" : "\n";
}

export function normalizeEol(text) {
  return String(text).replace(/\r\n/g, "\n");
}

export function readRisaFile(filePath) {
  return normalizeEol(fs.readFileSync(filePath, "utf8"));
}

// Validates the edited content against the source model, then writes it via a
// temp file + rename so a failed write never leaves a half-written .r3d behind.
export function writeRisaFile(outputPath, content, { sourcePath }) {
  const raw = fs.readFileSync(sourcePath, "utf8");
  const errors = validateRisaEdit(normalizeEol(raw), normalizeEol(content));

  if (errors.length > 0) {
    throw new Error(
      `Refusing to write ${outputPath}: the edited model failed validation.\n- ${errors.join("\n- ")}`
    );
  }

  const text = normalizeEol(content).replace(/\n/g, detectEol(raw));
  const tmpPath = `${outputPath}.tmp`;

  fs.writeFileSync(tmpPath, text, "utf8");
  fs.renameSync(tmpPath, outputPath);
}

// ---- Sections ----

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Finds "[NAME] <n> ... [END_NAME]". RISA nests sections with leading dots
// ([.MEMBERS_MAIN_DATA], [..MODEL_TITLE]), so any number of dots is accepted;
// pass the bare name. Returns positions so callers can splice by offset.
export function findSection(content, name) {
  const bare = escapeRegExp(String(name).replace(/^\.+/, ""));
  const regex = new RegExp(`\\[(\\.*)${bare}\\] <(\\d+)>([\\s\\S]*?)\\[\\1END_${bare}\\]`);
  const match = content.match(regex);
  if (!match) return null;

  const bodyStart = match.index + match[0].indexOf(">") + 1;

  return {
    dots: match[1],
    declaredCount: parseInt(match[2], 10),
    body: match[3],
    lines: match[3].trim().split("\n").filter(l => l.trim()),
    start: match.index,
    end: match.index + match[0].length,
    bodyStart,
    bodyEnd: bodyStart + match[3].length
  };
}

// Reads only the "<n>" count from a section header, dotted or not.
export function getSectionCount(content, name) {
  const bare = escapeRegExp(String(name).replace(/^\.+/, ""));
  const match = content.match(new RegExp(`\\[\\.*${bare}\\] <(\\d+)>`));
  return match ? parseInt(match[1], 10) : null;
}

// Replaces exactly the text a regex match covered. Unlike String.replace this
// never hits an earlier identical block and never expands "$&" / "$1".
export function spliceMatch(content, match, replacement) {
  if (!match || content.substr(match.index, match[0].length) !== match[0]) {
    throw new Error("spliceMatch: the match is stale (content changed since it was found)");
  }
  return content.slice(0, match.index) + replacement + content.slice(match.index + match[0].length);
}

// Replaces one capture group. The pattern's groups 1..groupIndex must be
// contiguous from the start of the match, e.g. /(\[X\] <\d+>)([\s\S]*?)(\[END_X\])/.
export function spliceMatchGroup(content, match, groupIndex, replacement) {
  if (!match || content.substr(match.index, match[0].length) !== match[0]) {
    throw new Error("spliceMatchGroup: the match is stale (content changed since it was found)");
  }

  let start = match.index;
  for (let g = 1; g < groupIndex; g++) start += match[g].length;

  return content.slice(0, start) + replacement + content.slice(start + match[groupIndex].length);
}

// Applies several splices against the same original content, last-first so
// earlier offsets stay valid.
export function spliceMatches(content, edits) {
  return [...edits]
    .sort((a, b) => b[0].index - a[0].index)
    .reduce((acc, [match, replacement]) => spliceMatch(acc, match, replacement), content);
}

// ---- Write validation ----

function sectionMarkerCounts(content) {
  const counts = {};
  for (const m of content.matchAll(/^\[([^\]\n]+)\]/gm)) {
    counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  return counts;
}

// Compares an edited model with its source and returns a list of problems the
// edit introduced. Problems already present in the source are not reported.
export function validateRisaEdit(original, updated) {
  const errors = [];

  const before = sectionMarkerCounts(original);
  const after = sectionMarkerCounts(updated);
  for (const [marker, count] of Object.entries(before)) {
    if ((after[marker] || 0) < count) {
      errors.push(`section marker [${marker}] is missing from the edited model`);
    }
  }

  for (const name of ["NODES", "MEMBERS_MAIN_DATA"]) {
    const was = findSection(original, name);
    const now = findSection(updated, name);

    if (was && !now) {
      errors.push(`[${name}] section could not be parsed in the edited model`);
    } else if (now && now.declaredCount !== now.lines.length) {
      const wasConsistent = !was || was.declaredCount === was.lines.length;
      if (wasConsistent) {
        errors.push(`[${name}] header says <${now.declaredCount}> but the section has ${now.lines.length} rows`);
      }
    }
  }

  const qcBefore = runQCChecks(original);
  const qcAfter = runQCChecks(updated);
  const newItems = (key) => {
    const old = new Set(qcBefore[key]);
    return qcAfter[key].filter(item => !old.has(item));
  };

  newItems("invalidNodeRefs").forEach(item => errors.push(`invalid node reference: ${item}`));
  newItems("zeroLength").forEach(item => errors.push(`zero-length member: ${item}`));
  newItems("duplicateMemberLabels").forEach(item => errors.push(`duplicate member label: ${item}`));

  const loadIssuesBefore = new Set(loadTableIssues(original));
  loadTableIssues(updated)
    .filter(issue => !loadIssuesBefore.has(issue))
    .forEach(issue => errors.push(issue));

  return errors;
}

// ---- Load tables ----
// Load rows do not name their load case. Each case owns a contiguous block of
// rows, in BASIC_LOAD_CASES order, sized by a count token on the case's row.

export const LOAD_TABLES = {
  node: { section: "NODE_LOADS", countToken: 2 },
  distributed: { section: "DIRECT_DISTRIBUTED_LOADS", countToken: 5 },
  area: { section: "AREA_LOADS", countToken: 6 }
};

function orderedBasicLoadCaseLines(content) {
  return getSectionLines(content, "BASIC_LOAD_CASES")
    .map(line => ({ line, tokens: tokenize(line) }))
    .sort((a, b) => parseInt(a.tokens[0], 10) - parseInt(b.tokens[0], 10));
}

// Lists mismatches between the BASIC_LOAD_CASES counts, each load section's
// "<n>" header and its actual rows. With references (default) it also lists
// load rows pointing past the last node/member; editors that are mid-way
// through renumbering pass { references: false }.
export function loadTableIssues(content, { references = true } = {}) {
  const issues = [];
  const cases = orderedBasicLoadCaseLines(content);

  for (const table of Object.values(LOAD_TABLES)) {
    const section = findSection(content, table.section);
    if (!section) continue;

    if (section.declaredCount !== section.lines.length) {
      issues.push(`[${table.section}] header says <${section.declaredCount}> but the section has ${section.lines.length} rows`);
    }

    const owned = cases.reduce((sum, c) => sum + (parseInt(cleanSemi(c.tokens[table.countToken]), 10) || 0), 0);
    if (cases.length > 0 && owned !== section.lines.length) {
      issues.push(`[BASIC_LOAD_CASES] assigns ${owned} ${table.section} rows but the section has ${section.lines.length}`);
    }
  }

  if (!references) return issues;

  // Node and distributed load rows start with a 1-based node/member position.
  const refTables = [
    ["NODE_LOADS", "node", parseNodesOrdered(content).length],
    ["DIRECT_DISTRIBUTED_LOADS", "member", getSectionLines(content, "MEMBERS_MAIN_DATA").length]
  ];

  for (const [name, what, available] of refTables) {
    getSectionLines(content, name).forEach((line, i) => {
      const ref = parseInt(tokenize(line)[0], 10);
      if (!(ref >= 1 && ref <= available)) {
        issues.push(`[${name}] row ${i + 1} points to ${what} ${ref}, but the model has ${available} ${what}s`);
      }
    });
  }

  return issues;
}

// Start/end offsets of each quote-aware token, so one field can be rewritten
// without disturbing the row's spacing.
export function tokenSpans(line) {
  const spans = [];
  let i = 0;

  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i])) i++;
    if (i >= line.length) break;

    const start = i;
    if (line[i] === '"') {
      i++;
      while (i < line.length && line[i] !== '"') i++;
      i++;
    } else {
      while (i < line.length && !/\s/.test(line[i])) i++;
    }
    spans.push({ start, end: i });
  }

  return spans;
}

// Replaces token `index` in a row, keeping a trailing ";" on the last token.
export function replaceToken(line, index, value) {
  const span = tokenSpans(line)[index];
  if (!span) throw new Error(`Row has no field ${index}: ${line.trim()}`);

  const old = line.slice(span.start, span.end);
  const suffix = old.endsWith(";") ? ";" : "";

  return line.slice(0, span.start) + value + suffix + line.slice(span.end);
}

// Formats a number the way an existing field is written (scientific or fixed).
export function formatLikeToken(token, value) {
  return /e[+-]?\d/i.test(cleanSemi(token)) ? formatSciNotation(value) : value.toFixed(6);
}

function replaceSectionLines(content, name, section, lines) {
  const body = lines.length > 0 ? `\n${lines.join("\n")}\n` : "\n";
  const rebuilt = `[${section.dots}${name}] <${lines.length}>${body}[${section.dots}END_${name}]`;
  return content.slice(0, section.start) + rebuilt + content.slice(section.end);
}

// Adds one load row to a basic load case by copying an existing row of the
// same type from that case and overwriting the given fields. Copying keeps the
// direction code and RISA's internal load-case ID, which are not decoded.
//   kind:          "node" | "distributed"
//   caseName:      basic load case name (case-insensitive)
//   targetIndex:   1-based node/member position written to field 0
//   templateIndex: optional node/member position of the row to copy
//   fields:        { tokenIndex: number } values to write into the copy
export function addLoadFromTemplate(content, { kind, caseName, targetIndex, templateIndex, fields }) {
  const table = LOAD_TABLES[kind];
  if (!table) throw new Error(`Unknown load table "${kind}"`);

  const loadSection = findSection(content, table.section);
  const blcSection = findSection(content, "BASIC_LOAD_CASES");
  if (!loadSection) throw new Error(`No [${table.section}] section found.`);
  if (!blcSection) throw new Error("No [BASIC_LOAD_CASES] section found.");

  const before = loadTableIssues(content);
  if (before.length > 0) {
    throw new Error(`Load tables are already inconsistent, refusing to add rows:\n- ${before.join("\n- ")}`);
  }

  const cases = orderedBasicLoadCaseLines(content);
  let cursor = 0;
  let target = null;

  for (const c of cases) {
    const count = parseInt(cleanSemi(c.tokens[table.countToken]), 10) || 0;
    if (clean(c.tokens[1]).toLowerCase() === caseName.trim().toLowerCase()) {
      target = { ...c, start: cursor, count };
      break;
    }
    cursor += count;
  }

  if (!target) {
    const names = cases.map(c => clean(c.tokens[1])).join(", ");
    throw new Error(`Load case "${caseName}" not found. Available: ${names}`);
  }

  const caseRows = loadSection.lines.slice(target.start, target.start + target.count);
  if (caseRows.length === 0) {
    throw new Error(
      `Load case "${clean(target.tokens[1])}" has no existing ${table.section} rows to copy. ` +
      `Add one load of this type to the case in RISA-3D first so its direction and internal ID can be copied.`
    );
  }

  const templateRow = templateIndex
    ? caseRows.find(row => parseInt(tokenize(row)[0], 10) === templateIndex)
    : caseRows[0];

  if (!templateRow) {
    throw new Error(`No ${table.section} row for position ${templateIndex} in load case "${clean(target.tokens[1])}" to copy.`);
  }

  const templateTokens = tokenize(templateRow);
  let newRow = replaceToken(templateRow, 0, String(targetIndex));
  for (const [index, value] of Object.entries(fields)) {
    newRow = replaceToken(newRow, Number(index), formatLikeToken(templateTokens[index], value));
  }

  const loadLines = [...loadSection.lines];
  loadLines.splice(target.start + target.count, 0, newRow);

  const blcLines = blcSection.lines.map(line =>
    line === target.line ? replaceToken(line, table.countToken, String(target.count + 1)) : line
  );

  // Rebuild the later section first so the earlier section's offsets stay valid.
  const edits = [
    [table.section, loadSection, loadLines],
    ["BASIC_LOAD_CASES", blcSection, blcLines]
  ].sort((a, b) => b[1].start - a[1].start);

  const updated = edits.reduce((acc, [name, section, lines]) => replaceSectionLines(acc, name, section, lines), content);

  return {
    content: updated,
    caseName: clean(target.tokens[1]),
    caseIndex: parseInt(target.tokens[0], 10),
    rowNumber: target.start + target.count + 1,
    templateRow: templateRow.trim(),
    newRow: newRow.trim(),
    rowsInCase: target.count + 1
  };
}

// Rewrites a load table case by case. mapRow(row, caseName) returns the row to
// keep (possibly changed) or null to drop it; each case's count in
// BASIC_LOAD_CASES is updated to match, so ownership of later rows is kept.
export function rewriteLoadRows(content, kind, mapRow) {
  const table = LOAD_TABLES[kind];
  const loadSection = findSection(content, table.section);
  if (!loadSection || loadSection.lines.length === 0) return content;

  const blcSection = findSection(content, "BASIC_LOAD_CASES");
  if (!blcSection) throw new Error(`[${table.section}] has rows but no [BASIC_LOAD_CASES] section was found.`);

  const before = loadTableIssues(content, { references: false });
  if (before.length > 0) {
    throw new Error(`Load tables are already inconsistent, refusing to change load rows:\n- ${before.join("\n- ")}`);
  }

  const newLoadLines = [];
  const newCounts = new Map();
  let cursor = 0;

  for (const c of orderedBasicLoadCaseLines(content)) {
    const count = parseInt(cleanSemi(c.tokens[table.countToken]), 10) || 0;
    const kept = loadSection.lines
      .slice(cursor, cursor + count)
      .map(row => mapRow(row, clean(c.tokens[1])))
      .filter(row => row !== null);

    newLoadLines.push(...kept);
    if (kept.length !== count) newCounts.set(c.line, kept.length);
    cursor += count;
  }

  const blcLines = blcSection.lines.map(line =>
    newCounts.has(line) ? replaceToken(line, table.countToken, String(newCounts.get(line))) : line
  );

  const edits = [
    [table.section, loadSection, newLoadLines],
    ["BASIC_LOAD_CASES", blcSection, blcLines]
  ].sort((a, b) => b[1].start - a[1].start);

  return edits.reduce((acc, [name, section, lines]) => replaceSectionLines(acc, name, section, lines), content);
}

// After members are removed, distributed loads on those members are dropped
// and loads on later members are renumbered to the members' new positions.
//   removedPositions: 1-based positions in the ORIGINAL member order
export function remapMemberLoadsAfterDelete(content, removedPositions) {
  const removed = [...new Set(removedPositions)].sort((a, b) => a - b);
  const droppedRows = [];
  let renumbered = 0;

  const updated = rewriteLoadRows(content, "distributed", (row, caseName) => {
    const position = parseInt(tokenize(row)[0], 10);

    if (removed.includes(position)) {
      droppedRows.push({ caseName, position, row: row.trim() });
      return null;
    }

    const shift = removed.filter(p => p < position).length;
    if (shift === 0) return row;

    renumbered++;
    return replaceToken(row, 0, String(position - shift));
  });

  return { content: updated, droppedRows, renumbered };
}

// Plans the distributed loads for merging member `removePosition` into member
// `keepPosition` (1-based, original order). A load can only be carried over
// exactly when both members have the same uniform full-length load in a case
// (start/end locations 0) and both run in the merged member's direction:
// those pairs combine into the kept member's load. Anything else would need
// its locations rewritten, which needs RISA's location encoding, so it is
// returned as a blocker instead.
//   consistentOrientation: kept member runs outer->common and the removed
//                          member runs common->outer
export function planMergedMemberLoads(content, { keepPosition, removePosition, consistentOrientation }) {
  const combined = [];
  const blockers = [];

  const describe = (caseName, which, tokens) =>
    `${caseName} on ${which}: ${tokens[2]} -> ${tokens[3]}, locations ${tokens[4]} -> ${tokens[5]}`;
  const isUniformFullLength = t =>
    parseFloat(t[2]) === parseFloat(t[3]) && parseFloat(t[4]) === 0 && parseFloat(t[5]) === 0;
  const keyOf = t => t.slice(1).join(" ");

  for (const c of parseLoadsByBasicLoadCase(content).cases) {
    const onKeep = c.distributedLoads.filter(r => parseInt(r.tokens[0], 10) === keepPosition);
    const onRemove = c.distributedLoads.filter(r => parseInt(r.tokens[0], 10) === removePosition);
    const unmatched = [...onRemove];

    for (const row of onKeep) {
      const partner = unmatched.findIndex(other => keyOf(other.tokens) === keyOf(row.tokens));

      if (consistentOrientation && isUniformFullLength(row.tokens) && partner >= 0) {
        unmatched.splice(partner, 1);
        combined.push(describe(c.name, "both members", row.tokens));
      } else {
        blockers.push(describe(c.name, "kept member", row.tokens));
      }
    }

    unmatched.forEach(row => blockers.push(describe(c.name, "removed member", row.tokens)));
  }

  return { combined, blockers };
}

// Quote-aware tokenizer: treats anything inside "..." as a single token.
export function tokenize(line) {
  const tokens = [];
  let i = 0;
  const len = line.length;

  while (i < len) {
    while (i < len && /\s/.test(line[i])) i++;
    if (i >= len) break;

    if (line[i] === '"') {
      let j = i + 1;
      while (j < len && line[j] !== '"') j++;
      tokens.push(line.substring(i, j + 1));
      i = j + 1;
    } else {
      let j = i;
      while (j < len && !/\s/.test(line[j])) j++;
      tokens.push(line.substring(i, j));
      i = j;
    }
  }

  return tokens;
}

export function clean(token) {
  return (token || "").replace(/"/g, "").trim();
}

export function cleanSemi(value) {
  return String(value || "").replace(";", "").trim();
}

export function parseBasicLoadCases(content) {
  const byIndex = {};

  getSectionLines(content, "BASIC_LOAD_CASES").forEach(line => {
    const t = tokenize(line);
    const index = parseInt(t[0], 10);
    const name = clean(t[1]);

    if (!isNaN(index) && name) {
      byIndex[index] = {
        index,
        name,
        rawTokens: t
      };
    }
  });

  return { byIndex };
}

export function getBasicLoadCaseName(blcData, index) {
  const id = parseInt(index, 10);
  return blcData.byIndex[id]?.name || `BLC${id}`;
}

export function buildBasicLoadCaseHelpers(content) {
  const blcData = parseBasicLoadCases(content);

  const byIndex = blcData.byIndex;
  const ordered = Object.values(byIndex).sort((a, b) => a.index - b.index);

  const nameByIndex = (idx) => {
    const n = parseInt(cleanSemi(idx), 10);
    return byIndex[n]?.name || `BLC${n}`;
  };

  const areaLoadCaseByRowIndex = (rowIndex) => {
    let cursor = 0;

    for (const blc of ordered) {
      const t = blc.rawTokens || [];
      const areaCount = parseInt(cleanSemi(t[6]), 10) || 0;

      if (rowIndex >= cursor && rowIndex < cursor + areaCount) {
        return blc.name;
      }

      cursor += areaCount;
    }

    return "Unresolved";
  };

  return { nameByIndex, areaLoadCaseByRowIndex };
}

// endSectionName is kept for older callers; the END marker is derived from the name.
export function getSectionLines(content, sectionName, endSectionName) {
  const section = findSection(content, sectionName);
  return section ? section.lines : [];
}

function buildLoadRows(lines, cursor, count) {
  return lines.slice(cursor, cursor + count).map((line, i) => ({
    rowNumber: cursor + i + 1,
    tokens: tokenize(line.trim().replace(/;\s*$/, "")),
    raw: line.trim()
  }));
}

export function parseLoadsByBasicLoadCase(content) {
  const blcData = parseBasicLoadCases(content);

  const nodeLines = getSectionLines(content, "NODE_LOADS", "END_NODE_LOADS");
  const distLines = getSectionLines(content, "DIRECT_DISTRIBUTED_LOADS", "END_DIRECT_DISTRIBUTED_LOADS");
  const areaLines = getSectionLines(content, "AREA_LOADS", "END_AREA_LOADS");

  let nodeCursor = 0;
  let distCursor = 0;
  let areaCursor = 0;

  const cases = Object.values(blcData.byIndex)
    .sort((a, b) => a.index - b.index)
    .map(blc => {
      const t = blc.rawTokens || [];

      const nodeCount = parseInt(cleanSemi(t[2]), 10) || 0;
      const distCount = parseInt(cleanSemi(t[5]), 10) || 0;
      const areaCount = parseInt(cleanSemi(t[6]), 10) || 0;

      const nodeLoads = buildLoadRows(nodeLines, nodeCursor, nodeCount);
      const distributedLoads = buildLoadRows(distLines, distCursor, distCount);
      const areaLoads = buildLoadRows(areaLines, areaCursor, areaCount);

      nodeCursor += nodeCount;
      distCursor += distCount;
      areaCursor += areaCount;

      return {
        index: blc.index,
        name: blc.name,
        nodeLoads,
        distributedLoads,
        areaLoads
      };
    });

  return {
    cases,
    totals: {
      nodeLoads: nodeLines.length,
      distributedLoads: distLines.length,
      areaLoads: areaLines.length,
      consumedNodeLoads: nodeCursor,
      consumedDistributedLoads: distCursor,
      consumedAreaLoads: areaCursor
    }
  };
}

export function parseNodesOrdered(content) {
  return getSectionLines(content, "NODES").map(line => {
    const t = tokenize(line);
    return {
      label: clean(t[0]),
      x: parseFloat(t[1]),
      y: parseFloat(t[2]),
      z: parseFloat(t[3])
    };
  });
}

export function parseMembersResolved(content, nodesOrdered) {
  return getSectionLines(content, "MEMBERS_MAIN_DATA").map(line => {
    const t = tokenize(line);
    const label = clean(t[0]);
    const type = clean(t[1]);
    const size = clean(t[2]);
    const iIdx = parseInt(t[3], 10);
    const jIdx = parseInt(t[4], 10);
    const iNodeObj = nodesOrdered[iIdx - 1];
    const jNodeObj = nodesOrdered[jIdx - 1];

    return {
      label,
      type,
      size,
      iNodeIndex: iIdx,
      jNodeIndex: jIdx,
      iNode: iNodeObj ? iNodeObj.label : null,
      jNode: jNodeObj ? jNodeObj.label : null,
      iCoord: iNodeObj || null,
      jCoord: jNodeObj || null
    };
  });
}

export function distance3D(a, b) {
  if (!a || !b) return null;

  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function replaceQuotedToken(line, oldValue, newValue) {
  const oldQuotedRegex = new RegExp(`"${oldValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*"`, "i");

  if (oldQuotedRegex.test(line)) {
    return line.replace(oldQuotedRegex, `"${newValue.padEnd(oldValue.length, " ")}"`);
  }

  return line;
}

export function replaceSectionSizeInContent(content, replacement) {
  const oldSize = replacement.oldSize;
  const newSize = replacement.newSize;
  const scope = replacement.scope || "both";
  const filterName = replacement.filterName;

  let updatedContent = content;
  let setsChanged = 0;
  let membersChanged = 0;

  if (scope === "set" || scope === "both") {
    const setsMatch = updatedContent.match(/(\[\.HR_STEEL_SECTION_SETS\] <\d+>)([\s\S]*?)(\[\.END_HR_STEEL_SECTION_SETS\])/);

    if (setsMatch) {
      const newBlock = setsMatch[2].split("\n").map(line => {
        if (!line.trim()) return line;

        const t = tokenize(line);
        if (!t || t.length < 3) return line;

        if (filterName && clean(t[0]) !== filterName) return line;

        if (clean(t[2]).toUpperCase() === oldSize.toUpperCase()) {
          setsChanged++;
          return replaceQuotedToken(line, clean(t[2]), newSize);
        }

        return line;
      }).join("\n");

      updatedContent = spliceMatchGroup(updatedContent, setsMatch, 2, newBlock);
    }
  }

  if (scope === "member" || scope === "both") {
    const membersMatch = updatedContent.match(/(\[\.MEMBERS_MAIN_DATA\] <\d+>)([\s\S]*?)(\[\.END_MEMBERS_MAIN_DATA\])/);

    if (membersMatch) {
      const newBlock = membersMatch[2].split("\n").map(line => {
        if (!line.trim()) return line;

        const t = tokenize(line);
        if (!t || t.length < 3) return line;

        if (filterName && clean(t[0]) !== filterName) return line;

        if (clean(t[2]).toUpperCase() === oldSize.toUpperCase()) {
          membersChanged++;
          return replaceQuotedToken(line, clean(t[2]), newSize);
        }

        return line;
      }).join("\n");

      updatedContent = spliceMatchGroup(updatedContent, membersMatch, 2, newBlock);
    }
  }

  return {
    content: updatedContent,
    setsChanged,
    membersChanged
  };
}

export function runQCChecks(content) {
  const nodesOrdered = parseNodesOrdered(content);

  const nodeCoordMap = {};
  nodesOrdered.forEach(n => {
    const key = `${n.x},${n.y},${n.z}`;
    if (!nodeCoordMap[key]) nodeCoordMap[key] = [];
    nodeCoordMap[key].push(n.label);
  });

  const duplicateNodes = Object.entries(nodeCoordMap)
    .filter(([coords, labels]) => labels.length > 1)
    .map(([coords, labels]) => ({
      coords,
      labels
    }));

  const members = parseMembersResolved(content, nodesOrdered);

  const memberLabels = new Set();
  const duplicateMemberLabels = [];
  const missingSize = [];
  const zeroLength = [];
  const invalidNodeRefs = [];

  members.forEach(m => {
    if (memberLabels.has(m.label)) duplicateMemberLabels.push(m.label);
    memberLabels.add(m.label);

    if (!m.size) missingSize.push(m.label);

    if (!m.iNode) {
      invalidNodeRefs.push(`${m.label}: i-node index ${m.iNodeIndex} is out of range (model has ${nodesOrdered.length} nodes)`);
    }

    if (!m.jNode) {
      invalidNodeRefs.push(`${m.label}: j-node index ${m.jNodeIndex} is out of range (model has ${nodesOrdered.length} nodes)`);
    }

    if (m.iNode && m.jNode) {
      const len = distance3D(m.iCoord, m.jCoord);
      if (len !== null && len < 0.001) {
        zeroLength.push(`${m.label} (${m.iNode} = ${m.jNode})`);
      }
    }
  });

  const issueCount =
    duplicateNodes.length +
    duplicateMemberLabels.length +
    missingSize.length +
    zeroLength.length +
    invalidNodeRefs.length;

  return {
    nodeCount: nodesOrdered.length,
    memberCount: members.length,
    duplicateNodes,
    duplicateMemberLabels,
    missingSize,
    zeroLength,
    invalidNodeRefs,
    issueCount,
    status: issueCount === 0 ? "PASS" : "REVIEW"
  };
}

export function padRISA(str, width = 32) {
  if (str.length >= width) return str.slice(0, width);
  return str + " ".repeat(width - str.length);
}

export function formatSciNotation(val) {
  return val.toExponential(12).replace(/e([+-])(\d+)/, (m, sign, digits) => {
    return `e${sign}${digits.padStart(2, "0")}`;
  });
}

export function generateUnusedLabel(prefix, usedSet, start = 9001) {
  let n = start;
  while (usedSet.has(`${prefix}${n}`)) n++;
  const label = `${prefix}${n}`;
  usedSet.add(label);
  return label;
}

export function getNodesSection(content) {
  const match = content.match(/(\[NODES\] <)(\d+)(>)([\s\S]*?)(\[END_NODES\])/);
  if (!match) return null;

  const body = match[4];
  const lines = body.split("\n").filter(l => l.trim());

  return {
    match,
    body,
    lines,
    count: lines.length
  };
}

export function getMembersSection(content) {
  const match = content.match(/(\[\.MEMBERS_MAIN_DATA\] <)(\d+)(>)([\s\S]*?)(\[\.END_MEMBERS_MAIN_DATA\])/);
  if (!match) return null;

  const body = match[4];
  const lines = body.split("\n").filter(l => l.trim());

  return {
    match,
    body,
    lines,
    count: lines.length
  };
}

export function getTrailingNodeFields(nodeLines) {
  if (!nodeLines || nodeLines.length === 0) return "";
  const lastNodeTokens = tokenize(nodeLines[nodeLines.length - 1]);
  return lastNodeTokens.slice(4).join(" ").replace(/;\s*$/, "");
}

export function buildNodeLine(label, x, y, z, trailingNodeFields) {
  return (
    `"${padRISA(label)}"   ` +
    `${formatSciNotation(x)}   ` +
    `${formatSciNotation(y)}   ` +
    `${formatSciNotation(z)}   ` +
    `${trailingNodeFields};`
  );
}

export function rebuildNodesSection(nodesMatch, updatedNodeLines) {
  const newCount = updatedNodeLines.filter(l => l.trim()).length;
  const updatedBody = updatedNodeLines.join("\n").replace(/\s*$/, "") + "\n";
  return `${nodesMatch[1]}${newCount}${nodesMatch[3]}${updatedBody}${nodesMatch[5]}`;
}

export function rebuildMembersSection(membersMatch, updatedMemberLines) {
  const newCount = updatedMemberLines.filter(l => l.trim()).length;
  const updatedBody = updatedMemberLines.join("\n").replace(/\s*$/, "") + "\n";
  return `${membersMatch[1]}${newCount}${membersMatch[3]}${updatedBody}${membersMatch[5]}`;
}

export function findExistingNodeByCoord(workingNodes, coord, tolerance = 0.001) {
  return workingNodes.find(n =>
    Math.abs(n.x - coord.x) <= tolerance &&
    Math.abs(n.y - coord.y) <= tolerance &&
    Math.abs(n.z - coord.z) <= tolerance
  );
}

export function findOrCreateNodeForGeometry({
  coord,
  workingNodes,
  existingNodeLabels,
  newNodeLines,
  trailingNodeFields,
  tolerance = 0.001
}) {
  const existing = findExistingNodeByCoord(workingNodes, coord, tolerance);

  if (existing) {
    return existing.index;
  }

  const label = generateUnusedLabel("N", existingNodeLabels);
  const index = workingNodes.length + 1;

  const newLine = buildNodeLine(
    label,
    coord.x,
    coord.y,
    coord.z,
    trailingNodeFields
  );

  newNodeLines.push(newLine);

  workingNodes.push({
    label,
    x: coord.x,
    y: coord.y,
    z: coord.z,
    index
  });

  return index;
}