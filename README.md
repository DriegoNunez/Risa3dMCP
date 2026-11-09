# RISA-3D & RISAFloor MCP Toolkit

> Create, inspect, edit and report on structural model files through an MCP-compatible AI assistant.

Work with RISA-3D `.r3d` files and native RISAFloor `.rfl` files using dedicated tools for each format. The server reads and edits model files directly; analysis and design remain in the RISA applications.

## Capabilities at a glance

| Workflow | RISA-3D | RISAFloor |
|---|---|---|
| Create a file from scratch | Empty `.r3d` with project metadata | Empty `.rfl` with project metadata |
| Inspect a model | Model, geometry, properties and load reports | Layouts, floors, points, beams, columns, loads and definitions |
| Edit geometry | Nodes and members; copy, translate, mirror, split and merge | Points and beams/columns; template-based floors; copy, translate, mirror, split and compatible merge |
| Edit loads | Template-based node and distributed load additions | Point/line load add, modify, delete; PreDL/PostDL/live magnitudes; area-load definitions and combination factors |
| Review changes | QC, comparisons and batch reports | QC, comparisons, folder summaries and CSV/XLSX member schedules |
| Analyze or design | Open and solve in RISA-3D | Open and solve in RISAFloor |

**Validation status:** automated regression tests pass. Empty-model import was
checked in RISA-3D 23 and RISAFloor 19. Native application verification of the
new RISAFloor geometry/load editing tools is still pending. RISAFloor writes
target native 19.x files and do not provide complete RISA-3D feature parity.

**Explore:** [Capability presentation](CAPABILITIES.md) ·
[RISAFloor tool reference](#risafloor-reading-and-editing) ·
[Quick start](#quick-start)

![Node](https://img.shields.io/badge/Node.js-18+-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Tests](https://img.shields.io/badge/tests-passing-brightgreen)
![MCP](https://img.shields.io/badge/MCP-Compatible-purple)
![Version](https://img.shields.io/badge/version-v2.1.0-blue)

---

## Demo

> *"Summarize this model for a report"*
> *"What steel grade is this model using?"*
> *"What are the boundary conditions at the column bases?"*
> *"Compare these two models and tell me what changed"*

Once connected, provide the model's absolute path and use the tools for its
format. For example: “List the beams on layout 1 of this RISAFloor file, then
save a separate copy with beam M1 changed to W21X44.”

---

## Why This Project Exists

RISA-3D has no public API.

This project bridges that gap by treating `.r3d` files as the interface, allowing AI assistants to inspect, compare, modify, and report on structural models without automating the RISA application itself.

The goal is to augment structural engineers, not replace engineering judgment.

---

## What Is This?

MCP (Model Context Protocol) is an open standard that lets AI assistants like Claude connect to external tools and files. This server acts as a bridge between Claude Desktop and your RISA-3D models. Claude reads your `.r3d` files directly and answers questions about them in plain English.

No RISA-3D API is required. This works by reading RISA-3D's plain-text `.r3d` file format directly. Includes a modular regression test suite to ensure parser and write-tool reliability as the project evolves

---

## Quick Start

```bash
git clone https://github.com/DriegoNunez/Risa3dMCP.git

cd Risa3dMCP

npm install

node risa-cli.js help
```

For Claude Desktop integration, continue to the Installation section below.

---

## Table of Contents

- [Why This Project Exists](#why-this-project-exists)
- [What Is This?](#what-is-this)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [MCP Tools](#mcp-tools)
- [Example Prompts](#example-prompts)
- [CLI Usage](#cli-usage)
- [Technical Notes](#technical-notes)
- [Regression Tests](#regression-tests)
- [Roadmap](#roadmap)
- [Known Limitations](#known-limitations)
- [License](#license)

---

## Architecture

                 Claude Desktop
                       │
                 MCP (index.js)
                       │
                  risa-core.js
                  /       \
            risa-cli.js  .r3d files

---

## Project Structure

```text
risa3d-mcp-server/
│
├── index.js
├── risa-core.js
├── risa-cli.js
│
├── tests/
│   
│   ├── parser.test.js
│   ├── loads.test.js
│   ├── qc.test.js
│   ├── write-tools.test.js
│   ├── geometry.test.js
│   ├── run-tests.js
│   ├── run-all.js
│   └── test-utils.js
│
├── package.json
├── README.md
└── CHANGELOG.md
```

---

## What This Server Does

This MCP server reads and modifies `.r3d` RISA-3D model files.
It can:

- Read nodes, members, sections, supports, load cases, and load combinations
- Generate model summaries
- Generate load summaries grouped by RISA basic load case
- Export member schedules to Excel
- Clone a model with controlled changes
- Run QA/QC checks on RISA models
- Run CLI diagnostics without Claude/MCP

Currently includes 40+ MCP tools covering: 

- Model interrogation
- QA/QC
- Load Parsing & Validation
- Material Takeoffs
- SAF and Excel Exports
- Model Comparison
- Model Cloning and Editing
- CLI Debugging Toolkit
- Geometry Editing
- Batch Workflows
- Regression-tested Parsing Utilities

---

## Use Without Claude

The project includes a standalone command-line interface (`risa-cli.js`).

This allows engineers to test parsing logic and generate reports without installing Claude Desktop or using MCP.

Example:

```cmd
node risa-cli.js generate-load-summary "C:\Models\TEST.r3d"
```

Useful for:

- Testing parser changes
- Verifying load extraction
- Debugging RISA files
- Running reports locally

---

## What You Can Do

Once connected, you can ask Claude things like:

- *"Summarize this model for a report -- include members, nodes, loads, boundary conditions, and materials"*
- *"What steel grade and Fy value is assigned in this model?"*
- *"List all the boundary conditions, which nodes are fixed vs. pinned?"*
- *"What section sizes are assigned to each section set?"*
- *"List all the members and their section sizes"*
- *"Run a QC check on this model"*
- *"Compare these two models and tell me what changed"*
- *"Export a member schedule for all HSS members"*

---

## Requirements

- Windows PC with RISA-3D installed
- [Claude Desktop](https://claude.ai/download) (free)
- [Node.js](https://nodejs.org) (LTS version -- free)
- A Claude account 

---

## Installation

### Step 1 -- Install Node.js

Download and install the **LTS version** from [nodejs.org](https://nodejs.org). Click through all the defaults.

Verify it worked, open Command Prompt and run:
```
node --version
npm --version
```
Both should return version numbers.

---

### Step 2 -- Download the Project

```bash
git clone https://github.com/vibhanshu-mishra/risa3d-mcp-server.git

cd risa3d-mcp-server

npm install
```
---

### Step 3 -- Test the Server

In Command Prompt, run:
```
cd risa3d-mcp-server
node index.js
```

If you see a blinking cursor with no errors, it is working. Press **Ctrl+C** to stop it.

---

### Step 4 -- Connect to Claude Desktop

1. Install [Claude Desktop](https://claude.ai/download) if you haven't already
2. Press **Windows + R**, type `%APPDATA%\Claude` and press Enter
3. Open or create `claude_desktop_config.json`
4. Paste in the following:

```json
{
  "mcpServers": {
    "risa3d": {
      "command": "node",
      "args": [
        "C:\\path\\to\\risa3d-mcp-server\\index.js"
      ]
    }
  }
}
```

5. Save the file
6. Fully quit Claude Desktop (right-click the system tray icon -> Quit)
7. Reopen Claude Desktop

---

### Step 5 -- Verify It's Running

In Claude Desktop:
1. Click the **+** button in the chat input box
2. Click **Connectors**
3. You should see **risa3d** listed as connected

Or go to **Settings -> Developer** and confirm risa3d shows as **running**.

---

## Example Prompts

### Model Reading

```
Summarize this model for a report:
"C:\path\to\model.r3d"
```

```
List all the members in this model.
```

```
List all Wide Flange members only.
```

```
What materials are defined in this model?
```

```
What section sets are defined?
```

```
List the boundary conditions.
```

```
What load combinations are defined?
```

---

### QA / QC

```
Run a QC check on this model.
```

```
Check this model for duplicate nodes.
```

```
Find all members using HSS8X8X10.
```

```
Flag members longer than 20 feet.
```

```
Compare these two models and summarize the differences.
```

```
Show every member connected to M41.
```

```
Show every member connected to node N25.
```

---

### Editing

```
Change the Stringer section set from C15X33.9 to C12X20.7 and save as a new model.
```

```
Clone this model and change member M41 to HSS6X6X10.
```

```
Move node N44 to new coordinates.
```

```
Delete members M20 through M25.
```

```
Copy member M41 between N200 and N205.
```

```
Split member M41 at 50% of its length.
```

```
Merge members M41 and M42.
```

```
Add a -1.5 k node load to N17 in the DL case.
```

```
Add a -0.25 k/ft distributed load to M41 in LL, copying the direction from M40's LL load.
```

---

### Geometry

```
Mirror these members about the Y-axis.
```

```
Copy these members 20 feet in the X direction.
```

```
Add a brace between N44 and a new point at (6,0,-12).
```

---

### Batch Processing

```
Summarize every model in this folder.
```

```
Replace C15X33.9 with C12X20.7 across all models in this folder.
```

```
Run QC on every model in this folder and export an Excel summary.
```

---

### Export

```
Export the member schedule to Excel.
```

```
Export the load summary to Excel.
```

```
Export this model to SAF format.
```

```
Generate a material takeoff.
```

```
Export every HSS member to a schedule.
```

---

---

## MCP Tools

### Model Reading & Reporting

| Tool | Description |
|---|---|
| `read_risa_model` | Reads a `.r3d` file and returns a project summary (title, node count, member count, plate count, file size). |
| `summarize_model_for_report` | Single-call report including project info, members, nodes, materials, supports, loads, and load combinations. |
| `list_members` | Lists members by type or full detail with optional filtering. |
| `list_nodes` | Lists all nodes with coordinates. |
| `get_file_section` | Returns the raw contents of any named `.r3d` section. |
| `get_model_materials` | Lists all defined steel materials and properties. |
| `get_boundary_conditions` | Returns all support conditions with plain-English descriptions. |
| `get_section_sets` | Lists section sets and assigned member sizes. |
| `get_load_cases` | Lists all basic load cases. |
| `list_load_combinations` | Lists all load combinations. |
| `get_deflection_limits` | Returns global and member deflection rules. |

---

### QA / QC

| Tool | Description |
|---|---|
| `qc_check_risa_model` | Runs common QA/QC checks. |
| `find_duplicate_nodes` | Finds duplicate nodes within a coordinate tolerance. |
| `find_members_by_section` | Finds all members using a specified section size. |
| `find_unbraced_length_issues` | Flags members exceeding a user-defined length threshold. |
| `find_connected_members` | Lists all members connected to a specified member. |
| `get_member_connectivity_at_node` | Lists all members connected to a specified node. |
| `compare_risa_models` | Compares two `.r3d` models and summarizes differences. |

---

### Editing Tools

| Tool | Description |
|---|---|
| `create_risa_model` | Creates a new empty RISA-3D `.r3d` or RISAFloor `.rfl` file without a source model, with optional project metadata. Refuses to overwrite existing files. |
| `modify_section_set` | Changes section sizes and saves a new model. |
| `clone_model_with_changes` | Creates a modified copy of a model with section, support, or load changes. |
| `add_member` | Adds a new member using existing or newly created nodes. |
| `move_node` | Moves an existing node. |
| `delete_member` | Deletes one or more members, removes their distributed loads and renumbers loads on later members. |
| `copy_member` | Copies an existing member between two nodes. |
| `split_member` | Splits one member into two. |
| `merge_members` | Merges two compatible members into one. Combines matching uniform full-length distributed loads; refuses if any other load would have to move. |
| `mirror_geometry` | Mirrors selected geometry. |
| `copy_translate_geometry` | Copies geometry using XYZ offsets. |
| `add_node_load` | Adds a node load to an existing basic load case. |
| `add_distributed_load` | Adds a member distributed load to an existing basic load case. |

---

### Batch Tools

| Tool | Description |
|---|---|
| `batch_summarize_folder` | Summarizes every model in a folder. |
| `batch_summarize_folder_to_excel` | Writes folder summaries directly to Excel. |
| `replace_section_size_in_folder` | Replaces one section size across every model in a folder. |
| `batch_replace_section_size` | Performs multiple section replacements in one model. |
| `batch_qc_folder` | Runs QC checks across an entire folder and exports an Excel summary. |

---

### Export Tools

| Tool | Description |
|---|---|
| `export_member_schedule` | Exports member schedules as CSV. |
| `export_member_schedule_to_excel` | Writes member schedules directly to Excel. |
| `export_load_summary_to_excel` | Writes load summaries directly to Excel. |
| `export_to_saf` | Exports the model to SAF (`.xlsx`) format. |

---

---

## RISA-3D Load Parsing

RISA-3D `.r3d` files do not always store visible load case names directly inside load rows. For example, load rows may contain internal raw IDs like:

```text
88
89
90
```

These are internal RISA load identifiers and should not be assumed to match the visible Basic Load Case numbering shown in the RISA interface.

This project resolves loads using the confirmed RISA pattern:

```text
[BASIC_LOAD_CASES]
  -> distributed load count
  -> area load count
  -> node load count
  -> row order inside load tables
```

The shared helper `parseLoadsByBasicLoadCase(content)` groups loads by visible RISA Basic Load Case name, such as:

```text
DL
LL
WLx
WLz
BLC 1 Transient Area Loads
```

instead of exposing internal raw IDs.

---

## Current Load Editing Support

### Creating a model from scratch

Call `create_risa_model` with an absolute `outputPath` in an existing folder:

```json
{
  "outputPath": "C:\\Models\\NewProject.r3d",
  "title": "New Project",
  "company": "Example Engineering",
  "designer": "Project Engineer"
}
```

Only `outputPath` is required. The default title is `Untitled`. The tool writes
CRLF text, file headers, project metadata, and empty geometry and load tables.
It needs neither a source file nor an installed RISA application at runtime.
Existing files (including hard-link and symlink targets) are never overwritten.
Metadata must be a single line of at most 200 characters, without quotes,
brackets or control characters. The parent directory must already exist.

To create a **RISAFloor** file, select `program: "risafloor"` and use `.rfl`:

```json
{
  "program": "risafloor",
  "outputPath": "C:\\Models\\NewFloorProject.rfl",
  "title": "New Floor Project",
  "company": "Example Engineering",
  "designer": "Project Engineer"
}
```

`program` defaults to `"risa3d"`; existing `.r3d` calls remain unchanged. The
extension must match the selected program (case-insensitive). RISAFloor output
uses native `RF_` sections and empty layout/diaphragm tables, not renamed RISA-3D
data. It contains **no floors, beams, columns or loads**. Open it in RISAFloor,
confirm units and model settings, and add floors and structural elements there.
The tool returns floor/beam/column counts for RISAFloor and node/member counts
for RISA-3D. RISAFloor import and project metadata were checked in RISAFloor 19
using file format version `19.02044`.

Use the dedicated RISAFloor tools below for reading and editing `.rfl` files.
The original RISA-3D tools reject native RISAFloor input to prevent accidental
use of the wrong file format.

### RISAFloor reading and editing

RISAFloor editing targets native **19.x** files. All edits write a new `.rfl`
path, preserve LF/CRLF line endings, and validate the source and result before
writing. Existing files and hard-link/symlink aliases cannot be overwritten.
Layout IDs and point references are local to each layout; repeated member or
point labels on different floors are supported.

| Tool | Capability |
|---|---|
| `read_risafloor_model` | Summary, floors, points, beams/columns, point/line loads, materials, decks, design rules or combinations via `view`. |
| `get_risafloor_section` | Read a raw section; specify `layoutId` for repeated sections. |
| `qc_check_risafloor_model` | Counts, labels, references, coordinates, zero-length beams, member companion tables and coincident points. |
| `edit_risafloor_geometry` | Atomic batch of point/member edits, translation, mirroring, beam copying/splitting and floor metadata edits. |
| `edit_risafloor_load` | Add from a template, modify, delete or scale supported point/line load categories. |
| `modify_risafloor_area_load_definition` | Edit or clone uniform area-load PreDL/PostDL/live magnitudes; preserves polygon references. |
| `modify_risafloor_load_combination` | Replace category/factor pairs or clone a combination, retaining its flags. |
| `find_risafloor_members` | Filter by section, connectivity, label and minimum beam plan length. |
| `replace_risafloor_section_size` | Replace beam/column section sizes in one or all layouts. |
| `compare_risafloor_models` | Compare floor metadata, geometry, point/line loads and load combinations. |
| `clone_risafloor_model` | Validated copy, optionally with geometry operations. |
| `export_risafloor_schedule` | CSV/XLSX beam and column schedules with resolved plan coordinates. |
| `batch_summarize_risafloor_folder` | Folder summaries or per-file QC, with isolated error reporting. |

Example geometry transaction:

```json
{
  "filePath": "C:\\Models\\Floor.rfl",
  "outputPath": "C:\\Models\\Floor-edited.rfl",
  "operations": [
    { "action": "move_point", "layoutId": 1, "label": "N2", "x": 25, "z": 10 },
    { "action": "modify_member", "layoutId": 1, "kind": "beam", "label": "M1", "size": "W21X44" }
  ]
}
```

Geometry actions are `add_point`, `move_point`, `delete_point`, `add_floor`, `add_member`, `modify_member`,
`delete_member`, `translate_geometry`, `mirror_geometry`, `copy_beams`,
`split_beam`, `merge_beams` and `modify_floor`. Member kinds are `beam` and `column`.
`add_member` requires a `templateLabel` (optionally from `templateLayoutId`), a new `label`, an
`iPointLabel` and (for beams) `jPointLabel`. All companion rows are copied;
new member UUIDs are generated. `copy_beams` takes `beamLabels`, a new-label
`prefix`, `dx`/`dz`, and optional `mirrorAxis` (`x` or `z`) and `mirrorAt`.
It copies beam geometry/design data, **not loads, columns or slab polygons**.
Moving/mirroring points moves every entity attached to those points, including
point/line loads. Splitting keeps the original beam's design properties on
both pieces; review releases and design/unbraced lengths in RISAFloor.
`add_floor` creates an empty layout using an independent floor's settings via
`templateLayoutId`, `name` and `elevation`. `delete_point` only removes unused
points in layouts whose references can be updated safely. `merge_beams` requires
collinear, connected beams with matching companion properties.

Example `edit_risafloor_load` call:

```json
{
  "filePath": "C:\\Models\\Floor.rfl",
  "outputPath": "C:\\Models\\Floor-loads.rfl",
  "layoutId": 1,
  "kind": "line",
  "action": "modify",
  "row": 1,
  "preDL": [0.1, 0.1],
  "postDL": [0.2, 0.3],
  "live": [0.4, 0.4]
}
```

Rows are one-based within the selected layout. Point loads use scalar
magnitudes; line loads use `[start, end]`. All magnitudes and coordinates use
the source model's units and sign convention. `factor` scales **PreDL, PostDL
and live only**, preserving other categories. Live-load reduction and load
direction flags are retained. To add a load, use `action: "add"` and an existing
`templateRow`; unspecified template magnitudes/flags are copied. Optional
`templateLayoutId` selects a donor layout; specify target point labels when
copying a load between layouts. To delete,
use `action: "delete"` and `row`. Load combinations use native RISAFloor
category numbers, not RISA-3D basic-load-case numbers.

Current boundaries: create initial floor/member/load templates in RISAFloor.
Floor deletion, area-load polygon editing, wall/slab/diaphragm editing, arbitrary material/design-rule
editing, SAF export and weight takeoffs are not implemented. Shared layouts,
unknown member side tables, integrated RISA-3D files and multi-layout column
deletion are refused where reference updates cannot be guaranteed. Native
analysis, design checks, load attribution and results are not regenerated;
open the output in RISAFloor and re-solve. These tools do not claim complete
RISA-3D feature parity.

This creates an **empty model**, not a designed or populated structure. RISA
supplies defaults for omitted settings and metadata; check units, materials,
section sets and model settings after opening it. The existing `add_member`
tool still needs an initial member of the same type, and load-addition tools
need an existing load of that type in the target case. Create those initial
items in RISA-3D before using those editing tools. Import of the empty file was
checked in RISA-3D 23 (native saved file version `23.02044`); other versions have
not been verified. No analysis or design checks are run by this tool.

Restart your MCP server/client connection after updating the server to discover
the new tool.

`clone_model_with_changes` currently supports:

- Section size changes
- Boundary condition changes
- Member distributed load magnitude changes
- Node load magnitude changes

It does **not** currently edit area loads.

### Adding loads

`add_node_load` and `add_distributed_load` add a new row to an existing basic load case:

- The new row is inserted at the end of that case's block of rows, and the case's count in `[BASIC_LOAD_CASES]` and the section's `<n>` header are increased, so loads in later cases keep their owner.
- The row is copied from an existing load of the same type **in the same case** (the first one, or the one on `templateNodeLabel` / `templateMemberLabel`). Only the node/member, magnitudes and, for distributed loads, the optional start/end locations are changed. The direction code and RISA's internal load-case ID are copied, because their encoding is not fully decoded.
- A case with no loads of that type cannot be used yet: add one load of that type in RISA-3D first.
- Every saved file is re-checked: load-case counts must match the rows, and every load must point to an existing node or member.

Area loads are intentionally excluded because RISA may generate transient/memberized distributed loads from area loads. Editing the area loads without regenerating those derived loads could create an inconsistent model.

---

## CLI Usage

The CLI lives in `risa-cli.js`. Run commands from the project folder:

```cmd
node risa-cli.js help
```

### Generate Load Summary

```cmd
node risa-cli.js generate-load-summary "C:\path\to\model.r3d"
```

Include generated transient load cases:

```cmd
node risa-cli.js generate-load-summary "C:\path\to\model.r3d" --include-transient
```

### Debug Load Case Counts

```cmd
node risa-cli.js debug-load-case-counts "C:\path\to\model.r3d"
```

### Debug Raw Load Structure

```cmd
node risa-cli.js debug-load-structure "C:\path\to\model.r3d" 10
```

### Debug Member Load Rows

```cmd
node risa-cli.js debug-member-load-rows "C:\path\to\model.r3d" M41
```

### Debug Load Membership

```cmd
node risa-cli.js debug-load-membership "C:\path\to\model.r3d"
```

---

## MCP Usage

Start the MCP server with:

```cmd
node index.js
```

In your MCP client config, point to:

```cmd
node C:\path\to\risa3d-mcp-server\index.js
```

## Safety Notes

- The server never overwrites the original file when cloning.
- Use `clone_model_with_changes` with a different `outputPath`.
- Always open cloned `.r3d` files in RISA-3D and verify the model before using them for design.
- Write/edit tools should be treated as engineering-assist tools, not final design authority.

---

## Development Workflow

Typical workflow used during development:

1. Add or modify a parser in `risa-core.js`
2. Test locally using `risa-cli.js`
3. Validate against a real `.r3d` file
4. Move the logic into the MCP tools in `index.js`
5. Test again through Claude Desktop

The CLI exists specifically so parser development does not require Claude or MCP during iteration.

---

## Developer Checks

Before committing changes, run:

```cmd
node --check index.js
node --check risa-core.js
node --check risa-cli.js
```

---

## Regression Tests

This project includes a modular regression test suite to protect the parser and write helpers from breaking during future development.

Run the full suite:

```cmd
node tests\run-all.js
```

Current coverage:

- Parser
- Load ownership
- Geometry helpers
- QC engine
- Write helpers
- File I/O: section lookup, safe splicing, CRLF preservation, pre-save validation
- Adding node and distributed loads
- Every write tool, end to end through an MCP client, on LF and CRLF copies of `tests/fixtures/sample.r3d` (a synthetic model)

---

## Technical Notes on the `.r3d` Format

Several non-obvious quirks in RISA's file format that this server handles, documented here for anyone extending it:

**1. Fixed-width quoted fields.** Labels, types, and section sizes are stored as quote-padded strings, e.g. `"M14                             "`. A naive whitespace split breaks these into multiple phantom tokens. This server uses a quote-aware tokenizer that treats anything inside `"..."` (including internal spaces) as a single field.

**2. Members reference nodes by position, not by label.** In `[.MEMBERS_MAIN_DATA]`, the i-node and j-node fields are 1-based indices into the order of the `[NODES]` list -- not the node label strings. For example, a member line containing `1 7` means the 1st node listed to the 7th node listed, which might resolve to `N5` and `N18`. This server resolves those indices against an ordered node array.

**3. Load section names.** Point/nodal loads are stored under `[NODE_LOADS]`, not `[JOINT_LOADS]`. Member distributed loads are stored under `[DIRECT_DISTRIBUTED_LOADS]`, not `[MEMBER_DISTRIBUTED_LOADS]`.

**4. Load case IDs in load sections.** The load case index stored in `[NODE_LOADS]`, `[DIRECT_DISTRIBUTED_LOADS]`, and `[AREA_LOADS]` entries is an internal RISA database ID, not the sequential 1-based index from `[BASIC_LOAD_CASES]`. When no name match is found, the tool labels the load case as `LC{n}`.

The member line format (after tokenizing) is:
```
Label, Type (e.g. "Wide Flange", "Tube", "Channel", "None"), Size (e.g. "W14X22", "HSS8X8X10"), iNodeIndex, jNodeIndex, ...
```

---

## Roadmap

- [x] Read and summarize any `.r3d` model
- [x] List members with type, size, and resolved node connectivity
- [x] List nodes with coordinates
- [x] List load combinations
- [x] Get raw file section by name
- [x] Compare two models and summarize differences
- [x] Export member schedule as CSV
- [x] QC checker for common modeling issues
- [x] Get steel material properties (Grade, E, Fy, Fu)
- [x] Get boundary conditions with plain-English descriptions
- [x] Get section sets and assigned sizes
- [x] Summarize model for report in a single call (includes loads)
- [x] Batch summarize all models in a project folder
- [x] Get basic load cases with load type classification
- [x] Find all members using a specific section size
- [x] Get deflection limit rules (global and per-member)
- [x] Modify member section sizes and save the updated model
- [x] Clone a model with section, boundary condition, and load changes applied
- [x] Material takeoff with AISC shape weights
- [x] Length-based screen for unbraced length review
- [x] Direct .xlsx export (member schedule and batch summary)
- [x] Add new members (braces, posts, etc.) connecting existing or new nodes
- [x] Export to SAF format (.xlsx) for import into SCIA, SOFiSTiK, AxisVM, and other SAF-compatible software
- [x] Detect duplicate nodes (coordinate tolerance scan)
- [x] Replace section size globally across a folder of models
- [x] Diff two model versions (nodes, members, section sets, load combinations)
- [x] Standalone CLI mode for parser testing
- [x] Load ownership resolution using Basic Load Case counts
- [x] Node load editing in cloned models
- [x] Batch replace multiple section sizes in one model
- [x] Batch QC folder export to Excel
- [x] Export load summaries to Excel
- [x] Move existing nodes
- [x] Delete members
- [x] Find connected members
- [x] Get member connectivity at a node
- [x] Copy members between existing nodes
- [x] Split members
- [x] Merge compatible members
- [x] Mirror selected geometry
- [x] Copy/translate selected geometry
- [x] Shared geometry editing helpers in `risa-core.js`
- [x] Modular regression test suite

---

## Known Limitations

Current limitations:

- Area load editing is not supported.
- Generated transient/memberized loads are read but not regenerated.
- The server does not run RISA analysis.
- The server does not run RISA design checks.
- The server reads and modifies `.r3d` files only.
- Write operations should always be verified inside RISA-3D before engineering use.
- Load combinations are currently read but not modified.
---

## Contributing

Pull requests are welcome. If you work with RISA-3D and have ideas for new tools, open an issue and let's discuss.

---

## About

Built by **Vibhanshu Mishra, PE** -- Structural Engineer at AG&E Structural Engineers, Austin TX.

Specialising in steel and mission-critical structures. Building AI tools for a niche where none existed.
