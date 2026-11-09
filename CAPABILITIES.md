# RISA MCP Toolkit — Capability Presentation

## 1. From a request to a model file

Connect an MCP-compatible assistant to the local server. Provide a model path,
ask for an inspection or supported edit, and review the resulting file in RISA.
The toolkit supports RISA-3D and native RISAFloor through separate tool families.

```mermaid
flowchart LR
    A[Your request] --> B[MCP assistant]
    B --> C[RISA file tools]
    C --> D[Reports or edited model copy]
    D --> E[Review and solve in RISA]
```

## 2. Create a starting file

`create_risa_model` creates an empty `.r3d` or `.rfl` file with project metadata.
No source file is required. Choose `program: "risa3d"` or `program: "risafloor"`.
The file contains no populated structure. Create the initial structural and load
templates in the native application before using template-based editing tools.

## 3. Understand an existing model

| RISA-3D | RISAFloor |
|---|---|
| Inspect nodes, members, sections, materials and basic load cases | Inspect layouts, floors, points, beams, columns and point/line loads |
| Compare models and produce batch reports | Compare geometry, floor metadata, loads and combinations |
| Check model consistency | Check counts, labels, coordinates, references and member companion tables |

QC checks file consistency; it does not establish structural adequacy.

## 4. Edit RISAFloor geometry

Use `edit_risafloor_geometry` to apply a batch of operations to a new file.

- Add and move plan points; delete unused points where references can be updated.
- Add beams or columns from existing templates; reconnect, resize or delete supported members.
- Translate or mirror points; copy beams and their design data.
- Split beams or merge connected, collinear beams with matching properties.
- Add an empty floor from an independent floor template; edit floor name or elevation.

Labels are scoped to each layout. Coordinates use native plan X/Z; floor elevation
is separate. Beam copying does not copy loads, columns or slab polygons. Review
releases and design lengths after splitting beams.

## 5. Edit RISAFloor loads

| Tool | Supported operation |
|---|---|
| `edit_risafloor_load` | Add a point/line load from a template, modify or delete it |
| `edit_risafloor_load` | Set or scale PreDL, PostDL and live magnitudes |
| `modify_risafloor_area_load_definition` | Edit or clone uniform area-load magnitudes |
| `modify_risafloor_load_combination` | Replace category/factor pairs or clone a combination |

Point loads use scalar magnitudes. Line loads use start/end pairs. Values use
the source model's units and sign convention. Other load categories and existing
direction/reduction flags are retained; scaling affects only the three supported
categories. Area-load polygons and load attribution are not regenerated.

## 6. Review and deliver

Find members by section, label, connectivity or plan length. Replace section
sizes, compare model copies, export RISAFloor beam/column schedules to CSV or
Excel, and summarize a folder of models. RISAFloor edits validate the source and
result, preserve line endings and require a new output path.

Example requests:

> Read this RISAFloor model and list the layouts, beams and columns.

> Save a separate copy with beam M1 on layout 1 changed to W21X44.

> Set the first point load's live magnitude to 3.75 in native model units,
> save a new copy, and compare its loads with the original.

> Export the beam and column schedule to a new Excel file.

## 7. Compatibility and current limits

| Check | Status |
|---|---|
| Automated parser, creation, geometry, load, export and refusal-path regressions | Passing |
| Empty-file import | Checked in RISA-3D 23 and RISAFloor 19 |
| Native RISAFloor geometry/load edit verification | Pending |
| RISAFloor write format | Native 19.x |
| Analysis, design and refreshed results | Run in the native application |

RISAFloor floor deletion, wall/slab/diaphragm editing, area-load polygon editing,
arbitrary material/design-rule editing, SAF export and weight takeoffs are not
implemented. Shared layouts, unknown member side tables, integrated RISA-3D
files and unsafe column-stack deletions are refused. These tools do not provide
complete parity between programs.

See the [README](README.md) for setup, tool names and JSON examples.
