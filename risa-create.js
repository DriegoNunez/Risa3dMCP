import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// A new, empty model has no structural properties or load encoding to infer.
// The outer markers and label widths follow the RISA-3D 22.90025 text format
// shipped with RISA-3D 23. Application import is a separate compatibility check
// from the MCP parser tests. Empty-file import was checked in RISA-3D 23
// (native saved file version 23.02044);
// this is not an analysis-ready structural model.
const singleLine = z.string().max(200).refine(
  value => !/[\x00-\x1f\x7f\[\]"]/.test(value),
  "Use a single line without control characters, brackets, or double quotes"
);

export const createModelSchema = z.object({
  outputPath: z.string().min(1).describe("Absolute path of a NEW .r3d file; parent folder must exist. Existing files are never overwritten."),
  title: singleLine.default("Untitled").describe("Project title"),
  company: singleLine.default(""),
  designer: singleLine.default("")
}).strict();

function section(name, rows = []) {
  const dots = name.match(/^\.*/)[0];
  const bare = name.slice(dots.length);
  return [`[${name}] <${rows.length}>`, ...rows, `[${dots}END_${bare}]`].join("\n");
}

export function buildEmptyRisaModel(input) {
  const { title, company, designer } = createModelSchema.parse(input);
  const chunks = [
    "[RISA-3D_INPUT_DATA]",
    section("VERSION_NUMBER", ["22.90025;"]),
    section("PROGRAM_INFO", ["64;"]),
    "[GLOBAL_PARAMETERS]\n[.PROJECT_DESCRIPTION]",
    // RISA skips blank lines and can reuse the prior value for an empty field.
    // Omit unset metadata so the application applies its normal defaults.
    ...[["..MODEL_TITLE", title], ["..COMPANY_NAME", company], ["..DESIGNER_NAME", designer]]
      .filter(([, value]) => value.trim()).map(([name, value]) => section(name, [value])),
    "[.END_PROJECT_DESCRIPTION]\n[END_GLOBAL_PARAMETERS]",
    section("LABEL_LENGTHS", ["32 32 32 32 32 32 32 32 32 32 32 32 32 79 200 200 32 32 36 32 10 32 32 32;"]),
    "[MATERIAL_PROPERTIES]\n[END_MATERIAL_PROPERTIES]",
    "[SECTION_SETS]\n[END_SECTION_SETS]",
    section("NODES"),
    section("BOUNDARY_CONDITIONS"),
    "[MEMBERS]",
    ...["MAIN_DATA", "DESIGN_PARAMETERS", "BRB_DATA", "SUPPLEMENTARY_DATA", "DETAILING_DATA", "DESIGN_CALCMODE_PARAMETERS"]
      .map(suffix => section(`.MEMBERS_${suffix}`)),
    "[END_MEMBERS]",
    ...["PLATES", "BASIC_LOAD_CASES", "NODE_LOADS", "POINT_LOADS", "DIRECT_DISTRIBUTED_LOADS", "AREA_LOADS", "LOAD_COMBINATIONS"].map(name => section(name)),
    "[FILE_INFORMATION]",
    section(".FILE_SOURCE", ["2;"]),
    section(".FILE_TYPE", ["0;"]),
    "[END_FILE_INFORMATION]",
    "[RISA_3D_FINISH]\n0\n[FINISH]"
  ];
  return chunks.join("\n\n") + "\n";
}

export function createRisaModel(input) {
  const options = createModelSchema.parse(input);
  if (!path.isAbsolute(options.outputPath) || path.extname(options.outputPath).toLowerCase() !== ".r3d") {
    throw new Error("outputPath must be an absolute path ending in .r3d");
  }
  const content = buildEmptyRisaModel(options).replace(/\n/g, "\r\n");
  // Exclusive creation also protects against aliases, symlinks and races.
  // Never use the edit writer: it requires a source file and permits replacement.
  const fd = fs.openSync(options.outputPath, "wx");
  try {
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    fs.unlinkSync(options.outputPath);
    throw error;
  }
  fs.closeSync(fd);
  return {
    outputPath: options.outputPath,
    title: options.title,
    nodeCount: 0,
    memberCount: 0,
    status: "created_empty_model",
    notes: "Empty model, with no geometry or loads. RISA supplies defaults for omitted settings and metadata. Confirm units and model settings in RISA-3D and define materials, section sets and initial members/load cases before using the existing template-based editing tools. No analysis or design has been performed."
  };
}
