import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import * as XLSX from "xlsx";
import {
  block, floorLayouts, tokens, readFloorFile, readFloorModel, checkFloorModel,
  writeFloorFile, editPoint, editMember, transformFloor, copyFloorBeams,
  splitFloorBeam, editFloorMetadata, editFloorLoad, modifyFloorCombination,
  modifyFloorAreaDefinition, compareFloorModels, addFloorLayout, deleteFloorPoint, mergeFloorBeams
} from "./risafloor-core.js";

const num=z.number().finite();
const label=z.string().min(1).max(32).regex(/^[^\x00-\x1f\x7f"\[\];]+$/);
const input={filePath:z.string().describe("Source native RISAFloor .rfl path")};
const output={...input,outputPath:z.string().describe("Absolute path for a NEW .rfl file. Existing files are never overwritten.")};
const layoutId=z.number().int().positive().describe("Layout ID from read_risafloor_model; labels/point indices are scoped to this layout");
const kind=z.enum(["beam","column"]);
const magnitude=z.union([num,z.tuple([num,num])]).describe("Scalar for a point load; [start,end] for a line load. Native model units and sign convention.");
const opSchemas=[
  z.object({action:z.literal("add_point"),layoutId,label,x:num,z:num,templateLabel:label.optional()}),
  z.object({action:z.literal("move_point"),layoutId,label,x:num,z:num}),
  z.object({action:z.literal("delete_point"),layoutId,label}),
  z.object({action:z.literal("add_floor"),templateLayoutId:layoutId,name:label,elevation:num}),
  z.object({action:z.literal("add_member"),layoutId,kind,label,templateLabel:label,templateLayoutId:layoutId.optional(),iPointLabel:label,jPointLabel:label.optional(),size:label.optional()}),
  z.object({action:z.literal("modify_member"),layoutId,kind,label,iPointLabel:label.optional(),jPointLabel:label.optional(),size:label.optional()}),
  z.object({action:z.literal("delete_member"),layoutId,kind,label}),
  z.object({action:z.literal("translate_geometry"),layoutId,pointLabels:z.array(label).min(1).optional(),dx:num.default(0),dz:num.default(0)}),
  z.object({action:z.literal("mirror_geometry"),layoutId,pointLabels:z.array(label).min(1).optional(),mirrorAxis:z.enum(["x","z"]),mirrorAt:num.default(0)}),
  z.object({action:z.literal("copy_beams"),layoutId,beamLabels:z.array(label).min(1),prefix:label,dx:num.default(0),dz:num.default(0),mirrorAxis:z.enum(["x","z"]).optional(),mirrorAt:num.default(0)}),
  z.object({action:z.literal("split_beam"),layoutId,label,newLabel:label,pointLabel:label,fraction:num.gt(0).lt(1).default(0.5)}),
  z.object({action:z.literal("merge_beams"),layoutId,firstLabel:label,secondLabel:label}),
  z.object({action:z.literal("modify_floor"),layoutId,name:label.optional(),elevation:num.optional()})
].map(s=>s.strict());
const geometryOp=z.discriminatedUnion("action",opSchemas);

export function applyFloorGeometry(text, op) {
  op=geometryOp.parse(op);
  switch(op.action){
    case "add_point":return editPoint(text,{...op,add:true});
    case "move_point":return editPoint(text,op);
    case "delete_point":return deleteFloorPoint(text,op);
    case "add_floor":return addFloorLayout(text,op);
    case "add_member":return editMember(text,{...op,action:"add"});
    case "modify_member":return editMember(text,{...op,action:"modify"});
    case "delete_member":return editMember(text,{...op,action:"delete"});
    case "translate_geometry":case "mirror_geometry":return transformFloor(text,op);
    case "copy_beams":return copyFloorBeams(text,op);
    case "split_beam":return splitFloorBeam(text,op);
    case "merge_beams":return mergeFloorBeams(text,op);
    case "modify_floor":return editFloorMetadata(text,op);
    default:throw Error("Unknown geometry operation");
  }
}
const reportViews=["summary","floors","points","members","loads","materials","decks","design_rules","combinations"];
export function floorReport(text,view="summary",id) {
  const m=readFloorModel(text), layouts=id===undefined?m.layouts:m.layouts.filter(l=>l.id===id);
  if(id!==undefined&&!layouts.length)throw Error(`Layout ${id} not found`);
  switch(view){
    case "summary":return {program:m.program,title:m.title,counts:m.counts,units:m.units,floors:layouts.map(l=>({id:l.id,floors:l.floors}))};
    case "floors":return layouts.map(l=>({id:l.id,floors:l.floors}));
    case "points":return layouts.map(l=>({id:l.id,points:l.points}));
    case "members":return layouts.map(l=>({id:l.id,beams:l.beams,columns:l.columns}));
    case "loads":return {layouts:layouts.map(l=>({id:l.id,pointLoads:l.pointLoads,lineLoads:l.lineLoads})),areaDefinitions:block(text,"RF_AREA_LOAD_DEFINITIONS",false)?.body??""};
    case "combinations":return m.loadCombinations;
    case "materials":return block(text,"RF_MATERIAL_PROPERTIES",false)?.body??"";
    case "decks":return block(text,"RF_DECK_DEFINITIONS",false)?.body??"";
    case "design_rules":return ["RF_MEMBER_DESIGN_RULES","RF_WALL_DESIGN_RULES","RF_DESIGN_RULES"].map(name=>({name,content:block(text,name,false)?.body??""}));
    default:throw Error("Unknown report view");
  }
}

export function registerFloorTools(server) {
  const register=(name,description,schema,fn)=>server.tool(name,description,schema,async args=>{
    try{return {content:[{type:"text",text:JSON.stringify(await fn(args),null,2)}]};}
    catch(e){return {isError:true,content:[{type:"text",text:`Error: ${e.message}`}]};}
  });
  register("read_risafloor_model","Read native RISAFloor layouts, floor metadata, points, beams, columns, loads, materials, decks and design rules. Coordinates are native plan X/Z; floor elevation is separate.",
    {...input,view:z.enum(reportViews).default("summary"),layoutId:layoutId.optional()},a=>floorReport(readFloorFile(a.filePath),a.view,a.layoutId));
  register("get_risafloor_section","Inspect a raw native section. Repeated section names require a layoutId; this is read-only.",
    {...input,sectionName:z.string().min(1).max(100),layoutId:layoutId.optional()},a=>{
      let t=readFloorFile(a.filePath);readFloorModel(t);
      if(a.layoutId!==undefined){const l=floorLayouts(t).find(l=>l.id===a.layoutId);if(!l)throw Error("Layout not found");t=l.body;}
      return block(t,a.sectionName).raw;
    });
  register("qc_check_risafloor_model","Check layout/table counts, unique labels, finite coordinates, member/load point references, zero-length beams, companion-table alignment and coincident points. Not a structural design check.",input,a=>checkFloorModel(readFloorFile(a.filePath)));
  register("edit_risafloor_geometry","Apply geometry operations atomically to a new file: template-based add floors; add/move/delete unused points; template-based add/copy, reconnect, resize or delete beams/columns; translate/mirror points; copy/mirror beams; split/merge compatible beams; rename floors/change elevation. Point-attached floor loads stay attached. Copying beams does not copy loads or slabs. Review releases/design lengths after splitting. Unknown references and unsafe column-stack deletion are refused.",
    {...output,operations:z.array(geometryOp).min(1).max(1000)},a=>writeFloorFile(a.filePath,a.outputPath,t=>a.operations.reduce(applyFloorGeometry,t)));
  register("edit_risafloor_load","Add from a template, modify or delete a point/line load in one layout. PreDL/PostDL/live magnitudes are supported; reduction/direction flags and other load categories are preserved. factor scales only these three supported categories. Uses native units. Template-based add keeps all unspecified template fields.",
    {...output,layoutId,kind:z.enum(["point","line"]),action:z.enum(["add","modify","delete"]),row:z.number().int().positive().optional(),templateRow:z.number().int().positive().optional(),templateLayoutId:layoutId.optional(),pointLabel:label.optional(),startPointLabel:label.optional(),endPointLabel:label.optional(),preDL:magnitude.optional(),postDL:magnitude.optional(),live:magnitude.optional(),factor:num.optional()},
    a=>writeFloorFile(a.filePath,a.outputPath,t=>editFloorLoad(t,a)));
  register("modify_risafloor_area_load_definition","Change PreDL/PostDL/live in an existing uniform area-load definition, or clone it under newLabel. Existing polygons retain their definition indices. Does not draw/change polygons or regenerate load attribution.",
    {...output,label:z.string().min(1).max(60),newLabel:z.string().min(1).max(60).optional(),preDL:num.optional(),postDL:num.optional(),live:num.optional()},a=>writeFloorFile(a.filePath,a.outputPath,t=>modifyFloorAreaDefinition(t,a)));
  register("modify_risafloor_load_combination","Replace the factor list of an existing RISAFloor combination, or clone it under newLabel. Preserves design/service flags. category is a native RISAFloor load category number, not a RISA-3D basic-load-case number.",
    {...output,label:z.string().min(1).max(80),newLabel:z.string().min(1).max(80).optional(),factors:z.array(z.object({category:z.number().int().min(1).max(27),factor:num}).strict()).min(1).max(10)},
    a=>writeFloorFile(a.filePath,a.outputPath,t=>modifyFloorCombination(t,a)));
  register("find_risafloor_members","Find beams/columns by section, length, point connectivity or label. Length is the plan length of a beam, not an unbraced-length design check.",
    {...input,layoutId:layoutId.optional(),size:z.string().optional(),pointLabel:label.optional(),memberLabel:label.optional(),minimumLength:num.nonnegative().optional()},a=>{
      const m=readFloorModel(readFloorFile(a.filePath)),result=[];
      if(a.layoutId!==undefined&&!m.layouts.some(l=>l.id===a.layoutId))throw Error("Layout not found");
      for(const l of m.layouts.filter(l=>a.layoutId===undefined||l.id===a.layoutId)){
        let refs=a.pointLabel?l.points.filter(p=>p.label===a.pointLabel).map(p=>p.index):null;
        if(a.memberLabel){const member=[...l.beams,...l.columns].find(m=>m.label===a.memberLabel);refs=member?[member.iPoint,member.jPoint].filter(Boolean):[];}
        for(const member of [...l.beams,...l.columns]){const start=l.points[member.iPoint-1],end=l.points[member.jPoint-1],length=start&&end?Math.hypot(start.x-end.x,start.z-end.z):null;
          if(a.size&&member.size!==a.size)continue;if(refs&&!refs.includes(member.iPoint)&&!refs.includes(member.jPoint))continue;if(a.minimumLength!==undefined&&(length===null||length<a.minimumLength))continue;
          result.push({layoutId:l.id,...member,planLength:length});
        }
      }return result;
    });
  register("replace_risafloor_section_size","Replace a section size on matching beams/columns in selected or all layouts, preserving member categories and all side tables.",
    {...output,oldSize:label,newSize:label,layoutId:layoutId.optional()},a=>writeFloorFile(a.filePath,a.outputPath,t=>{
      const m=readFloorModel(t);let changed=0;
      for(const l of m.layouts.filter(l=>a.layoutId===undefined||l.id===a.layoutId))for(const member of [...l.beams,...l.columns])if(member.size===a.oldSize){t=editMember(t,{layoutId:l.id,kind:member.kind,label:member.label,action:"modify",size:a.newSize});changed++;}
      if(!changed)throw Error("No matching members");return t;
    }));
  register("compare_risafloor_models","Compare floor metadata, points, beams, columns, point/line loads and load combinations between two native RISAFloor files.",
    {filePathA:z.string(),filePathB:z.string()},a=>compareFloorModels(readFloorFile(a.filePathA),readFloorFile(a.filePathB)));
  register("clone_risafloor_model","Clone a native RISAFloor model to a new path, optionally applying geometry operations as one validated transaction.",
    {...output,operations:z.array(geometryOp).max(1000).default([])},a=>writeFloorFile(a.filePath,a.outputPath,t=>a.operations.reduce(applyFloorGeometry,t)));
  register("export_risafloor_schedule","Export beam/column schedule to CSV or Excel. Includes layout, labels, section and resolved plan endpoints; no inferred weights. Writes a new file only.",
    {...input,outputPath:z.string(),format:z.enum(["csv","xlsx"]).default("xlsx")},a=>{
      if(!path.isAbsolute(a.outputPath)||path.extname(a.outputPath).toLowerCase()!=="."+a.format)throw Error("Absolute output path must match format");
      const m=readFloorModel(readFloorFile(a.filePath)),records=[];
      for(const l of m.layouts)for(const member of [...l.beams,...l.columns]){const p=l.points[member.iPoint-1],q=l.points[member.jPoint-1];records.push({Layout:l.id,Kind:member.kind,Label:member.label,Type:member.type,Size:member.size,Start:p?.label??"",End:q?.label??"",X:p?.x??"",Z:p?.z??"",EndX:q?.x??"",EndZ:q?.z??""});}
      // String cells remain strings in xlsx. Neutralize CSV formula prefixes.
      let data;if(a.format==="csv"){const safe=records.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,typeof v==="string"&&/^[=+\-@\t\r]/.test(v)?"'"+v:v])));data=XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(safe));}
      else{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(records),"Members");data=XLSX.write(wb,{bookType:"xlsx",type:"buffer"});}
      fs.writeFileSync(a.outputPath,data,{flag:"wx"});return {outputPath:a.outputPath,rows:records.length};
    });
  register("batch_summarize_risafloor_folder","Read immediate .rfl files in a folder and return summaries or QC results. Per-file errors are reported without interrupting the batch; no models are modified.",
    {folderPath:z.string(),mode:z.enum(["summary","qc"]).default("summary")},a=>fs.readdirSync(a.folderPath,{withFileTypes:true}).filter(e=>e.isFile()&&/\.rfl$/i.test(e.name)).map(e=>{const filePath=path.join(a.folderPath,e.name);try{const t=readFloorFile(filePath);return {filePath,result:a.mode==="qc"?checkFloorModel(t):floorReport(t)};}catch(error){return {filePath,error:error.message};}}));
}
