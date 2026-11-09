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
  outputPath: z.string().min(1).describe("Absolute path of a NEW .r3d (risa3d) or .rfl (risafloor) file; parent folder must exist. Existing files are never overwritten."),
  program: z.enum(["risa3d", "risafloor"]).default("risa3d").describe("Target application. Defaults to risa3d for backward compatibility."),
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
  const options = createModelSchema.parse(input);
  if (options.program === "risafloor") return buildEmptyFloorModel(options);
  const { title, company, designer } = options;
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

// RISAFloor is a distinct format, not a renamed .r3d file. These markers and
// label widths follow the native 19.02044 format; no user model is read/copied.
function buildEmptyFloorModel({ title, company, designer }) {
  return [
    "[RISA_FLOOR_INPUT_DATA]",
    section("RF_VERSION_NUMBER", ["19.02044;"]) + " <1>",
    section("RF_PROGRAM_INFO", ["64;"]) + " <1>",
    "[RF_GLOBAL_PARAMETERS]\n[.RF_PROJECT_DESCRIPTION]",
    ...[["..RF_MODEL_TITLE", title], ["..RF_COMPANY_NAME", company], ["..RF_DESIGNER_NAME", designer]]
      .filter(([, value]) => value.trim()).map(([name, value]) => section(name, [value])),
    "[.END_RF_PROJECT_DESCRIPTION]\n[END_RF_GLOBAL_PARAMETERS]",
    section("RF_LABEL_LENGTHS", ["32 32 32 60 32 60 80 32 200 32 32 32 32 32 32 32 32 200 32 32 36 32 10 32 32;"]),
    section("RF_LAYOUTS"),
    section("RF_DIAPHRAGMS"),
    section("RF_PCOL_UBLS"),
    "[RF_FILE_INFORMATION]",
    section(".RF_FILE_SOURCE", ["0;"]),
    section(".RF_FILE_TYPE", ["0;"]),
    "[END_RF_FILE_INFORMATION]",
    "[RISA_FLOOR_FINISH]\n0\n[FINISH]"
  ].join("\n\n") + "\n";
}

export function createRisaModel(input) {
  const options = createModelSchema.parse(input);
  const isFloor = options.program === "risafloor";
  const extension = isFloor ? ".rfl" : ".r3d";
  if (!path.isAbsolute(options.outputPath) || path.extname(options.outputPath).toLowerCase() !== extension) {
    throw new Error(`outputPath must be an absolute path ending in ${extension} for ${options.program}`);
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
    program: options.program,
    title: options.title,
    ...(isFloor ? { floorCount: 0, beamCount: 0, columnCount: 0 } : { nodeCount: 0, memberCount: 0 }),
    status: "created_empty_model",
    notes: isFloor
      ? "Empty RISAFloor model, with no floors, geometry or loads. RISAFloor supplies defaults for omitted settings and metadata. Create the initial floor and member/load templates in RISAFloor, then use the dedicated risafloor reading/editing tools. No analysis or design has been performed."
      : "Empty model, with no geometry or loads. RISA supplies defaults for omitted settings and metadata. Confirm units and model settings in RISA-3D and define materials, section sets and initial members/load cases before using the existing template-based editing tools. No analysis or design has been performed."
  };
}
