// RISAFloor native text editing. Layout IDs and point positions are distinct:
// member/load point references are one-based positions WITHIN a layout.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const tokens = row => [...row.matchAll(/"[^"]*"|[^\s;]+/g)].map(m => m[0]);
const value = s => s?.replace(/^"|"$/g, "").trim();
const number = s => Number(value(s));
const labelOf = row => value(tokens(row)[0]);
function quote(s, width = 32) {
  if (typeof s !== "string" || !s.trim() || s.length > width || /[\x00-\x1f\x7f"\[\];]/.test(s)) throw Error(`Label must be 1-${width} characters without quotes, brackets, semicolons or controls`);
  return `"${s.padEnd(width)}"`;
}
function finite(n) { if (!Number.isFinite(n)) throw Error("Expected a finite number"); return n; }
export function patchRow(row, changes) {
  const matches = [...row.matchAll(/"[^"]*"|[^\s;]+/g)];
  for (const index of Object.keys(changes).map(Number).sort((a,b) => b-a)) {
    const m = matches[index];
    if (!m) throw Error(`Unrecognized record: missing field ${index}`);
    row = row.slice(0,m.index) + changes[index] + row.slice(m.index+m[0].length);
  }
  return row;
}

// Named blocks may have a row count or contain nested blocks. Never resolve a
// repeated name globally: callers first narrow to a specific layout/container.
export function block(text, name, required = true) {
  const dots = name.match(/^\.*/)[0];
  const end = dots + "END_" + name.slice(dots.length);
  const re = new RegExp(`^\\[${esc(name)}\\]([^\\n]*)\\n([\\s\\S]*?)^\\[${esc(end)}\\][^\\n]*(?:\\n|$)`, "gm");
  const matches = [...text.matchAll(re)];
  if (matches.length !== 1) {
    if (!required && matches.length === 0) return null;
    throw Error(`Expected one [${name}] block, found ${matches.length}`);
  }
  const m = matches[0];
  return { name, start:m.index, end:m.index+m[0].length, raw:m[0], body:m[2], count: /<(\d+)>/.test(m[1]) ? Number(m[1].match(/<(\d+)>/)[1]) : null,
    rows: m[2].split("\n").filter(s => s.trim()) };
}
function replaceBlock(text, b, body, count = b.count) {
  let header = b.raw.slice(0,b.raw.indexOf("\n"));
  if (count !== null) header = header.replace(/<\d+>/, `<${count}>`);
  const closing = b.raw.slice(b.raw.lastIndexOf("["));
  return text.slice(0,b.start) + header + "\n" + body.replace(/\n?$/, "\n") + closing + text.slice(b.end);
}
export function setRows(text, name, rows) {
  const b = block(text,name);
  if (b.body.includes("[")) throw Error(`Cannot edit nested block ${name} as a row table`);
  return replaceBlock(text,b,rows.length ? rows.join("\n")+"\n" : "", b.count === null ? null : rows.length);
}
const rows = (text,name) => block(text,name,false)?.rows ?? [];
export function floorLayouts(text) {
  const outer = block(text,"RF_LAYOUTS");
  return [...outer.body.matchAll(/^\[RF_LAYOUT : (\d+)\]/gm)].map(m => {
    const id = Number(m[1]); const b = block(text,`RF_LAYOUT : ${id}`);
    return { id, ...b, floors: rows(b.body,".RF_FLOORS").map(r => ({ name:labelOf(r), fields:tokens(r).map(value) })) };
  });
}
function layout(text,id) { const found = floorLayouts(text).find(l=>l.id===id); if(!found) throw Error(`Layout ${id} not found`); return found; }
function editLayout(text,id,edit) {
  const b=layout(text,id);
  if(b.floors.length!==1)throw Error("Shared/empty layouts require native floor editing before geometry/load changes");
  return replaceBlock(text,b,edit(b.body));
}
function pointList(body) { return rows(body,".RF_POINT_LOCATIONS").map((r,i)=>{const t=tokens(r);return {label:value(t[0]),index:i+1,x:number(t[1]),z:number(t[2])};}); }
const family = kind => kind === "beam" ? "BEAMS" : kind === "column" ? "COLUMNS" : (()=>{throw Error("kind must be beam or column");})();
function memberList(body,kind) {
  return rows(body,`..RF_${family(kind)}_MAIN_DATA`).map((r,i)=>{const t=tokens(r);return {label:value(t[0]),index:i+1,type:value(t[1]),size:value(t[2]),iPoint:number(t[4]),...(kind==="beam"?{jPoint:number(t[5])}:{}),kind};});
}
function findIndex(records,label) { const matches=records.map((r,i)=>labelOf(r)===label?i:-1).filter(i=>i>=0);if(matches.length!==1)throw Error(`Expected unique label ${label}`);return matches[0]; }
function pointIndex(body,label) { return findIndex(rows(body,".RF_POINT_LOCATIONS"),label)+1; }

export function readFloorModel(text) {
  if (!text.startsWith("[RISA_FLOOR_INPUT_DATA]")) throw Error("Expected a native RISAFloor .rfl model");
  const layouts=floorLayouts(text).map(l=>({id:l.id,floors:l.floors,points:pointList(l.body),beams:memberList(l.body,"beam"),columns:memberList(l.body,"column"),
    pointLoads:rows(l.body,".RF_POINT_LOADS").map((r,i)=>({row:i+1,pointIndex:number(tokens(r)[1]),fields:tokens(r).map(value)})),
    lineLoads:rows(l.body,".RF_LINE_LOADS").map((r,i)=>({row:i+1,startPointIndex:number(tokens(r)[1]),endPointIndex:number(tokens(r)[2]),fields:tokens(r).map(value)}))}));
  return {program:"risafloor",title:block(text,"..RF_MODEL_TITLE",false)?.body.trim()??"",units:rows(text,"RF_UNITS"),layouts,
    counts:{layouts:layouts.length,floors:layouts.reduce((n,l)=>n+l.floors.length,0),points:layouts.reduce((n,l)=>n+l.points.length,0),beams:layouts.reduce((n,l)=>n+l.beams.length,0),columns:layouts.reduce((n,l)=>n+l.columns.length,0)},
    loadCombinations:rows(text,"RF_LOAD_COMBINATIONS").map((r,i)=>({row:i+1,label:labelOf(r),raw:r}))};
}

export function checkFloorModel(text) {
  const errors=[],warnings=[]; let model;
  try { model=readFloorModel(text); } catch(e) { return {errors:[e.message],warnings}; }
  const ids=new Set();
  for(const l of floorLayouts(text)) {
    if(ids.has(l.id))errors.push(`Duplicate layout ${l.id}`);ids.add(l.id);
    const points=pointList(l.body), count=points.length;
    const checkRef=(ref,desc)=>{if(!Number.isInteger(ref)||ref<1||ref>count)errors.push(`Layout ${l.id}: ${desc} invalid point ${ref}`);};
    for(const name of [".RF_POINT_LOCATIONS","..RF_BEAMS_MAIN_DATA","..RF_COLUMNS_MAIN_DATA",".RF_POINT_LOADS",".RF_LINE_LOADS"]) {
      const b=block(l.body,name,false);if(b&&b.count!==b.rows.length)errors.push(`Layout ${l.id}: ${name} count mismatch`);
      if(b&&name.includes("LOADS"))for(const r of b.rows)if(tokens(r).some(t=>t!=="|"&&!Number.isFinite(Number(t))))errors.push(`Layout ${l.id}: nonnumeric load record`);
      const minFields={".RF_POINT_LOCATIONS":12,"..RF_BEAMS_MAIN_DATA":21,"..RF_COLUMNS_MAIN_DATA":20,".RF_POINT_LOADS":22,".RF_LINE_LOADS":32}[name];
      if(b)for(const r of b.rows)if(tokens(r).length<minFields)errors.push(`Layout ${l.id}: truncated ${name} record`);
    }
    for(const [name,items] of [["points",points],["beams",memberList(l.body,"beam")],["columns",memberList(l.body,"column")]]) {
      const labels=new Set();for(const item of items){if(labels.has(item.label))errors.push(`Layout ${l.id}: duplicate ${name} label ${item.label}`);labels.add(item.label);}
    }
    const coords=new Map(); for(const p of points){if(!Number.isFinite(p.x)||!Number.isFinite(p.z))errors.push(`Layout ${l.id}: nonfinite point ${p.label}`);const key=`${p.x},${p.z}`;if(coords.has(key))warnings.push(`Layout ${l.id}: coincident points ${coords.get(key)} and ${p.label}`);coords.set(key,p.label);}
    for(const kind of ["beam","column"]) {
      const members=memberList(l.body,kind);
      for(const m of members) {checkRef(m.iPoint,m.label);if(kind==="beam") {checkRef(m.jPoint,m.label);const a=points[m.iPoint-1],b=points[m.jPoint-1];if(a&&b&&Math.hypot(a.x-b.x,a.z-b.z)<1e-10)errors.push(`Layout ${l.id}: zero-length beam ${m.label}`);}}
      const container=block(l.body,`.RF_${family(kind)}`,false);
      if(container)for(const match of container.body.matchAll(/^\[(\.\.RF_[^\]]+)\] <(\d+)>/gm)){
        const b=block(container.body,match[1]);if(b.count!==members.length||b.rows.length!==members.length)errors.push(`Layout ${l.id}: companion ${b.name} count mismatch`);
        if(!/CSTACK_DATA|SUPPLEMENTARY_DATA_NEW/.test(b.name))b.rows.forEach((r,i)=>{if(labelOf(r)!==members[i]?.label)errors.push(`Layout ${l.id}: companion ${b.name} label/order mismatch`);});
      }
    }
    for(const r of rows(l.body,".RF_POINT_LOADS")) checkRef(number(tokens(r)[1]),"point load");
    for(const r of rows(l.body,".RF_LINE_LOADS")){checkRef(number(tokens(r)[1]),"line load start");checkRef(number(tokens(r)[2]),"line load end");}
  }
  if(block(text,"RF_LAYOUTS").count!==model.layouts.length)errors.push("RF_LAYOUTS count mismatch");
  return {errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
}

export function readFloorFile(filePath) {return fs.readFileSync(filePath,"utf8").replace(/\r\n/g,"\n");}
export function writeFloorFile(filePath,outputPath,edit) {
  if(!path.isAbsolute(outputPath)||path.extname(outputPath).toLowerCase()!==".rfl")throw Error("outputPath must be an absolute new .rfl path");
  const raw=fs.readFileSync(filePath,"utf8"), text=raw.replace(/\r\n/g,"\n");
  const before=checkFloorModel(text);if(before.errors.length)throw Error(`Source failed validation: ${before.errors.join("; ")}`);
  const version=Number(rows(text,"RF_VERSION_NUMBER")[0]?.replace(/;/g,""));
  if(!(version>=19&&version<20))throw Error("RISAFloor writes currently support version 19.x only");
  if(text.includes("[RISA-3D_INPUT_DATA]"))throw Error("Integrated RISAFloor/RISA-3D files must be edited in the application to regenerate linked data");
  const updated=edit(text), qc=checkFloorModel(updated);if(qc.errors.length)throw Error(`Edit failed validation: ${qc.errors.join("; ")}`);
  const fd=fs.openSync(outputPath,"wx");
  try{fs.writeFileSync(fd,raw.includes("\r\n")?updated.replace(/\n/g,"\r\n"):updated,"utf8");fs.fsyncSync(fd);}catch(e){fs.closeSync(fd);fs.unlinkSync(outputPath);throw e;}fs.closeSync(fd);
  return {outputPath,counts:readFloorModel(updated).counts,warnings:qc.warnings,note:"Model input edited. Open in RISAFloor and re-solve; analysis/design results are not regenerated."};
}

export function editPoint(text,{layoutId,label,x,z,add=false,templateLabel}) {
  return editLayout(text,layoutId,body=>{
    const records=rows(body,".RF_POINT_LOCATIONS"), changes={1:finite(x).toExponential(12),2:finite(z).toExponential(12)};
    if(add){quote(label);if(records.some(r=>labelOf(r)===label))throw Error("Point label already exists");
      const template=templateLabel?records[findIndex(records,templateLabel)]:records[0];
      // Native neutral point record, verified against RISAFloor 19 output.
      records.push(patchRow(template??'"N" 0 0 -1 0 65535 -1 0 0 0 0 -1;', {0:quote(label),...changes}));
    }else{const i=findIndex(records,label);records[i]=patchRow(records[i],changes);}
    if(!block(body,".RF_POINT_LOCATIONS",false))return body+`\n[.RF_POINT_LOCATIONS] <${records.length}>\n${records.join("\n")}\n[.END_RF_POINT_LOCATIONS]\n`;
    return setRows(body,".RF_POINT_LOCATIONS",records);
  });
}

// All side tables travel with a member. Do not clone or delete only MAIN_DATA.
function memberTables(body,kind,change) {
  const b=block(body,`.RF_${family(kind)}`);
  let content=b.body;
  const names=[...content.matchAll(/^\[(\.\.RF_[^\]]+)\] <\d+>/gm)].map(m=>m[1]);
  const known=kind==="beam"?["MAIN_DATA","DESIGN_DATA","SUPPLEMENTARY_DATA","SUPPLEMENTARY_DATA_NEW","DETAILING_DATA"]:["MAIN_DATA","DESIGN_DATA","SUPPLEMENTARY_DATA","CSTACK_DATA","DETAILING_DATA"];
  if(names.some(n=>!known.some(s=>n===`..RF_${family(kind)}_${s}`)))throw Error("Unknown member side table; cannot change member count safely");
  for(const name of names)content=setRows(content,name,change(rows(content,name),name));
  return replaceBlock(body,b,content);
}
export function editMember(text,args) {
  const {layoutId,kind,label,action,templateLabel,templateLayoutId,iPointLabel,jPointLabel,size}=args;
  return editLayout(text,layoutId,body=>{
    const name=`..RF_${family(kind)}_MAIN_DATA`, records=rows(body,name);
    const donor=action==="add"&&templateLayoutId!==undefined?layout(text,templateLayoutId).body:body;
    const index=findIndex(action==="add"?rows(donor,name):records,action==="add"?templateLabel:label);
    if(action==="add"){
      if(records.some(r=>labelOf(r)===label))throw Error("Member label already exists");quote(label);
      const i=pointIndex(body,iPointLabel),j=kind==="beam"?pointIndex(body,jPointLabel):undefined;
      const containerName=`.RF_${family(kind)}`;
      if(!block(body,containerName,false)){
        const donorBlock=block(donor,containerName);
        const emptyTables=[...donorBlock.body.matchAll(/^\[(\.\.RF_[^\]]+)\] <\d+>/gm)].map(m=>`[${m[1]}] <0>\n[..END_${m[1].slice(2)}]\n`).join("");
        body+=`\n[${containerName}]\n${emptyTables}[.END_RF_${family(kind)}]\n`;
      }
      return memberTables(body,kind,(table,n)=>{
        let row=rows(donor,n)[index];if(!row)throw Error("Missing template side-table row");
        if(!n.endsWith("SUPPLEMENTARY_DATA_NEW"))row=patchRow(row,{0:quote(label)});
        row=row.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,()=>randomUUID());
        if(n===name)row=patchRow(row,{4:i,...(kind==="beam"?{5:j}:{}),...(size?{2:quote(size)}:{})});
        return [...table,row];
      });
    }
    if(action==="delete") {
      if(kind==="column"&&floorLayouts(text).length>1)throw Error("Column deletion in multi-layout models requires native column-stack updates");
      return memberTables(body,kind,table=>table.filter((_,i)=>i!==index));
    }
    if(action!=="modify")throw Error("Unknown member action");
    const changes={};if(size!==undefined)changes[2]=quote(size);if(iPointLabel!==undefined)changes[4]=pointIndex(body,iPointLabel);if(jPointLabel!==undefined){if(kind!=="beam")throw Error("Columns have one plan point");changes[5]=pointIndex(body,jPointLabel);}
    if(!Object.keys(changes).length)throw Error("No member changes supplied");
    records[index]=patchRow(records[index],changes);return setRows(body,name,records);
  });
}

export function transformFloor(text,{layoutId,pointLabels,dx=0,dz=0,mirrorAxis,mirrorAt=0}) {
  [dx,dz,mirrorAt].forEach(finite);
  if(mirrorAxis!==undefined&&!["x","z"].includes(mirrorAxis))throw Error("mirrorAxis must be x or z");
  return editLayout(text,layoutId,body=>{
    const selected=new Set(pointLabels??pointList(body).map(p=>p.label));if(!selected.size)throw Error("No points selected");
    for(const name of selected)pointIndex(body,name);
    return setRows(body,".RF_POINT_LOCATIONS",rows(body,".RF_POINT_LOCATIONS").map(r=>{
      if(!selected.has(labelOf(r)))return r;const t=tokens(r);let x=number(t[1]),z=number(t[2]);if(mirrorAxis==="x")x=2*mirrorAt-x;if(mirrorAxis==="z")z=2*mirrorAt-z;
      return patchRow(r,{1:finite(x+dx).toExponential(12),2:finite(z+dz).toExponential(12)});
    }));
  });
}

// A copied beam reuses its design data; loads remain separate floor entities.
export function copyFloorBeams(text,{layoutId,beamLabels,dx=0,dz=0,prefix,mirrorAxis,mirrorAt=0}) {
  quote(prefix);const original=layout(text,layoutId).body, members=memberList(original,"beam"), points=pointList(original);
  const chosen=beamLabels.map(label=>{const m=members.find(m=>m.label===label);if(!m)throw Error(`Beam ${label} not found`);return m;});
  if(new Set(beamLabels).size!==beamLabels.length)throw Error("Duplicate beam selection");
  const needed=[...new Set(chosen.flatMap(m=>[m.iPoint,m.jPoint]))], map=new Map();
  for(const ref of needed){const p=points[ref-1],label=prefix+p.label;map.set(ref,label);text=editPoint(text,{layoutId,label,x:(mirrorAxis==="x"?2*mirrorAt-p.x:p.x)+dx,z:(mirrorAxis==="z"?2*mirrorAt-p.z:p.z)+dz,add:true,templateLabel:p.label});}
  for(const m of chosen)text=editMember(text,{layoutId,kind:"beam",action:"add",label:prefix+m.label,templateLabel:m.label,iPointLabel:map.get(m.iPoint),jPointLabel:map.get(m.jPoint)});
  return text;
}

export function splitFloorBeam(text,{layoutId,label,newLabel,pointLabel,fraction=0.5}) {
  if(!(fraction>0&&fraction<1))throw Error("fraction must be between 0 and 1");
  const b=layout(text,layoutId).body,m=memberList(b,"beam").find(m=>m.label===label);if(!m)throw Error("Beam not found");
  const ps=pointList(b),a=ps[m.iPoint-1],z=ps[m.jPoint-1];
  text=editPoint(text,{layoutId,label:pointLabel,x:a.x+(z.x-a.x)*fraction,z:a.z+(z.z-a.z)*fraction,add:true,templateLabel:a.label});
  text=editMember(text,{layoutId,kind:"beam",action:"add",label:newLabel,templateLabel:label,iPointLabel:pointLabel,jPointLabel:z.label});
  return editMember(text,{layoutId,kind:"beam",action:"modify",label,jPointLabel:pointLabel});
}

export function editFloorMetadata(text,{layoutId,name,elevation}) {
  return editLayout(text,layoutId,body=>{
    const records=rows(body,".RF_FLOORS");if(records.length!==1)throw Error("Shared layouts require native floor editing");
    const changes={};if(name!==undefined)changes[0]=quote(name);if(elevation!==undefined)changes[6]=finite(elevation);
    if(!Object.keys(changes).length)throw Error("No floor changes supplied");
    return setRows(body,".RF_FLOORS",[patchRow(records[0],changes)]);
  });
}

export function addFloorLayout(text,{templateLayoutId,name,elevation}) {
  quote(name);finite(elevation);
  const all=floorLayouts(text),template=layout(text,templateLayoutId);
  if(all.some(l=>l.floors.some(f=>f.name===name)))throw Error("Floor name already exists");
  if(template.floors.length!==1||Number(template.floors[0].fields[1])!==-1)throw Error("Use an independent single-floor template layout");
  const id=Math.max(0,...all.map(l=>l.id))+1;
  // Keep native floor settings but intentionally create an empty layout. All
  // material, deck and rule definitions remain shared at the file level.
  const floorRow=patchRow(rows(template.body,".RF_FLOORS")[0],{0:quote(name),6:elevation});
  const content=`[RF_LAYOUT : ${id}]\n[.RF_FLOORS]\n${floorRow}\n[.END_RF_FLOORS]\n[.RF_POINT_LOCATIONS] <0>\n[.END_RF_POINT_LOCATIONS]\n[END_RF_LAYOUT : ${id}]\n`;
  const outer=block(text,"RF_LAYOUTS");return replaceBlock(text,outer,outer.body+content,all.length+1);
}

export function deleteFloorPoint(text,{layoutId,label}) {
  return editLayout(text,layoutId,body=>{
    // Unknown polygon/wall/diaphragm tables can also reference point positions.
    // Refuse their presence rather than silently leaving stale references.
    const allowed=new Set([".RF_POINT_LOCATIONS",".RF_POINT_LOADS",".RF_LINE_LOADS"]);
    for(const m of body.matchAll(/^\[([^\]]+)\] <(\d+)>/gm))if(Number(m[2])>0&&!allowed.has(m[1])&&!/^\.\.RF_(BEAMS|COLUMNS)_/.test(m[1]))throw Error(`Point deletion requires native updates for ${m[1]}`);
    const deleted=pointIndex(body,label);
    for(const kind of ["beam","column"])for(const m of memberList(body,kind))if(m.iPoint===deleted||m.jPoint===deleted)throw Error("Point is referenced by a member");
    const refs={"..RF_BEAMS_MAIN_DATA":[4,5],"..RF_COLUMNS_MAIN_DATA":[4],".RF_POINT_LOADS":[1],".RF_LINE_LOADS":[1,2]};
    for(const [name,fields] of Object.entries(refs))for(const r of rows(body,name))if(fields.some(i=>number(tokens(r)[i])===deleted))throw Error("Point is referenced by a load/member");
    body=setRows(body,".RF_POINT_LOCATIONS",rows(body,".RF_POINT_LOCATIONS").filter((_,i)=>i!==deleted-1));
    for(const [name,fields] of Object.entries(refs))if(block(body,name,false))body=setRows(body,name,rows(body,name).map(r=>{
      const t=tokens(r),changes={};for(const i of fields)if(number(t[i])>deleted)changes[i]=number(t[i])-1;return patchRow(r,changes);
    }));
    return body;
  });
}

export function mergeFloorBeams(text,{layoutId,firstLabel,secondLabel}) {
  const body=layout(text,layoutId).body, ms=memberList(body,"beam"),a=ms.find(m=>m.label===firstLabel),b=ms.find(m=>m.label===secondLabel);
  if(!a||!b||a.label===b.label||a.jPoint!==b.iPoint)throw Error("Choose two distinct beams oriented consecutively (first J = second I)");
  if(ms.some(m=>m!==a&&m!==b&&(m.iPoint===a.jPoint||m.jPoint===a.jPoint))||memberList(body,"column").some(m=>m.iPoint===a.jPoint))throw Error("Shared point connects to another member");
  const ps=pointList(body),p=ps[a.iPoint-1],q=ps[a.jPoint-1],r=ps[b.jPoint-1];
  const length=Math.hypot(r.x-p.x,r.z-p.z),sum=Math.hypot(q.x-p.x,q.z-p.z)+Math.hypot(r.x-q.x,r.z-q.z);
  if(length<1e-10||Math.abs(sum-length)>Math.max(1,length)*1e-9)throw Error("Beams must be collinear and contiguous");
  const container=block(body,".RF_BEAMS");
  for(const match of container.body.matchAll(/^\[(\.\.RF_[^\]]+)\] <\d+>/gm)){
    const name=match[1],table=rows(body,name);
    const normalize=(row)=>tokens(row).map((v,i)=>{
      if(i===0&&!name.endsWith("SUPPLEMENTARY_DATA_NEW"))return "LABEL";
      if(name.endsWith("MAIN_DATA")&&(i===4||i===5))return "POINT";
      if(/^"[0-9a-f-]{36}"$/i.test(v))return "UUID";
      return v;
    }).join(" ");
    if(normalize(table[a.index-1])!==normalize(table[b.index-1]))throw Error(`Beams have different ${name} properties; cannot merge safely`);
  }
  text=editMember(text,{layoutId,kind:"beam",action:"modify",label:firstLabel,jPointLabel:r.label});
  return editMember(text,{layoutId,kind:"beam",action:"delete",label:secondLabel});
}

// PreDL/PostDL are the first two native standard magnitude slots. Remaining
// categories and direction/reduction flags are preserved byte-for-byte.
export const loadFields={point:{preDL:[2],postDL:[3],live:[4]},line:{preDL:[3,4],postDL:[5,6],live:[7,8]}};
export function editFloorLoad(text,{layoutId,kind,action,row,templateRow,templateLayoutId,pointLabel,startPointLabel,endPointLabel,preDL,postDL,live,factor}) {
  if(!loadFields[kind])throw Error("Load kind must be point or line");
  return editLayout(text,layoutId,body=>{
    const name=kind==="point"?".RF_POINT_LOADS":".RF_LINE_LOADS", records=rows(body,name);
    const donor=action==="add"&&templateLayoutId!==undefined?rows(layout(text,templateLayoutId).body,name):records;
    const index=(action==="add"?templateRow:row)-1;
    if(!Number.isInteger(index)||!(action==="add"?donor:records)[index])throw Error("A valid 1-based existing/template load row is required");
    if(action==="delete")return setRows(body,name,records.filter((_,i)=>i!==index));
    if(!["add","modify"].includes(action))throw Error("Unknown load action");
    if(action==="add"&&templateLayoutId!==undefined&&templateLayoutId!==layoutId&&
      (kind==="point"?!pointLabel:!startPointLabel||!endPointLabel))throw Error("Cross-layout load copies require explicit target point labels");
    let record=(action==="add"?donor:records)[index],changes={};
    if(kind==="point"&&pointLabel!==undefined)changes[1]=pointIndex(body,pointLabel);
    if(kind==="line"){if(startPointLabel!==undefined)changes[1]=pointIndex(body,startPointLabel);if(endPointLabel!==undefined)changes[2]=pointIndex(body,endPointLabel);}
    for(const [category,mag] of Object.entries({preDL,postDL,live}))if(mag!==undefined){const vals=Array.isArray(mag)?mag:[mag];if(vals.length!==loadFields[kind][category].length)throw Error(`${kind} ${category} expects ${loadFields[kind][category].length} magnitude(s)`);loadFields[kind][category].forEach((i,n)=>changes[i]=finite(vals[n]));}
    if(factor!==undefined){finite(factor);if(preDL!==undefined||postDL!==undefined||live!==undefined)throw Error("Use factor or explicit magnitudes, not both");const t=tokens(record);for(const i of Object.values(loadFields[kind]).flat())changes[i]=finite(number(t[i])*factor);}
    if(!Object.keys(changes).length)throw Error("No load changes supplied");
    record=patchRow(record,changes);
    if(action==="add")records.push(record);else records[index]=record;
    if(!block(body,name,false))return body+`\n[${name}] <${records.length}>\n${records.join("\n")}\n[.END_${name.slice(1)}]\n`;
    return setRows(body,name,records);
  });
}

export function modifyFloorCombination(text,{label,factors,newLabel}) {
  const records=rows(text,"RF_LOAD_COMBINATIONS"),index=findIndex(records,label);
  const parts=records[index].split("|");if(parts.length!==11)throw Error("Unsupported combination encoding");
  if(factors.length>10)throw Error("At most ten factors per combination");
  let head=parts[0];if(newLabel!==undefined)head=patchRow(head,{0:quote(newLabel,80)});
  const row=head+Array.from({length:10},(_,i)=>{const f=factors[i];if(f&&(!Number.isInteger(f.category)||f.category<1||f.category>27))throw Error("Expected RISAFloor category number 1-27");return `| ${f?f.category:0} ${f?finite(f.factor).toFixed(6):"0.000000"} `;}).join("").trimEnd()+";";
  if(newLabel){if(records.some(r=>labelOf(r)===newLabel))throw Error("Combination label exists");records.push(row);}else records[index]=row;
  return setRows(text,"RF_LOAD_COMBINATIONS",records);
}

export function modifyFloorAreaDefinition(text,{label,preDL,postDL,live,newLabel}) {
  const container=block(text,"RF_AREA_LOAD_DEFINITIONS"), name=".RF_STANDARD", records=rows(container.body,name),index=findIndex(records,label),changes={};
  if(preDL!==undefined)changes[2]=finite(preDL);if(postDL!==undefined)changes[3]=finite(postDL);if(live!==undefined)changes[4]=finite(live);
  if(newLabel!==undefined){if(records.some(r=>labelOf(r)===newLabel))throw Error("Area definition label exists");changes[0]=quote(newLabel,60);records.push(patchRow(records[index],changes));}
  else{if(!Object.keys(changes).length)throw Error("No magnitudes supplied");records[index]=patchRow(records[index],changes);}
  return replaceBlock(text,container,setRows(container.body,name,records));
}

export function compareFloorModels(a,b) {
  const left=readFloorModel(a),right=readFloorModel(b),changes=[];
  const flatten=m=>new Map(m.layouts.flatMap(l=>[...l.points.map(v=>[`layout ${l.id}/point ${v.label}`,v]),...l.beams.map(v=>[`layout ${l.id}/beam ${v.label}`,v]),...l.columns.map(v=>[`layout ${l.id}/column ${v.label}`,v]),...l.pointLoads.map(v=>[`layout ${l.id}/point load ${v.row}`,v]),...l.lineLoads.map(v=>[`layout ${l.id}/line load ${v.row}`,v]),[`layout ${l.id}/floors`,l.floors]]));
  const l=flatten(left),r=flatten(right);for(const key of new Set([...l.keys(),...r.keys()]))if(JSON.stringify(l.get(key))!==JSON.stringify(r.get(key)))changes.push({entity:key,before:l.get(key)??null,after:r.get(key)??null});
  if(JSON.stringify(left.loadCombinations)!==JSON.stringify(right.loadCombinations))changes.push({entity:"load combinations",before:left.loadCombinations,after:right.loadCombinations});
  return {before:left.counts,after:right.counts,changes};
}
