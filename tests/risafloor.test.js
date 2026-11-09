import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRisaServer } from "../index.js";
import { buildEmptyRisaModel } from "../risa-create.js";
import { readRisaFile } from "../risa-core.js";
import { block, tokens, readFloorModel, checkFloorModel, compareFloorModels, patchRow } from "../risafloor-core.js";

// Authored, deterministic two-layout fixture. Labels intentionally repeat on
// different floors; numeric tails use the native v19 record shapes.
const q=s=>`"${s.padEnd(32)}"`;
const table=(name,lines)=>`[${name}] <${lines.length}>\n${lines.join("\n")}\n[${name.match(/^\.*/)[0]}END_${name.replace(/^\.*/,"")}]\n`;
const member=(name,a,b)=>`${q(name)} ${q("Wide Flange")} ${q("W18X35")} 65562 ${a} ${b} -1 1 1 0 1 0 3120 -1 -1 0 0 0 0 ${q("")} ${q("W10x12")};`;
function makeLayout(id){return `[RF_LAYOUT : ${id}]\n[.RF_FLOORS]\n${q("Level "+id)} -1 0 0 0 0 ${15*id} 180 1 -1 0 0 0 0 0 0 0 0;\n[.END_RF_FLOORS]\n`+
  table(".RF_POINT_LOCATIONS",[["N1",0,0],["N2",10,0],["N3",20,0],["N4",20,10]].map(([n,x,z])=>`${q(n)} ${x} ${z} -1 0 65535 -1 0 0 0 0 -1;`))+
  "[.RF_BEAMS]\n"+table("..RF_BEAMS_MAIN_DATA",[member("B1",1,2),member("B2",2,3)])+
  table("..RF_BEAMS_DESIGN_DATA",[`${q("B1")} -1 1 -1;`,`${q("B2")} -1 2 -1;`])+
  table("..RF_BEAMS_SUPPLEMENTARY_DATA",[`${q("B1")} -1 "00000000-0000-0000-0000-000000000001";`,`${q("B2")} -1 "00000000-0000-0000-0000-000000000002";`])+
  table("..RF_BEAMS_SUPPLEMENTARY_DATA_NEW",["0 0 0;","0 0 0;"])+"[.END_RF_BEAMS]\n"+
  "[.RF_COLUMNS]\n"+table("..RF_COLUMNS_MAIN_DATA",[`${q("C1")} ${q("Wide Flange")} ${q("W6X15")} 19 1 0 -1 1 1 0 1 0 0 0 0 ${q("")} ${q("W6x8.5")} 0 0 701694644;`])+
  table("..RF_COLUMNS_CSTACK_DATA",[`${q("Stack 1")} 1 0 0 1;`])+"[.END_RF_COLUMNS]\n"+
  table(".RF_POINT_LOADS",["-1 2 2.000000 3.000000 4.000000 0 5.000000 6.000000 7.000000 8.000000 9.000000 10.000000 -1 0 0 1 1 1 0 1 1 1;"])+
  table(".RF_LINE_LOADS",["-1 1 3 1.000000 2.000000 3.000000 4.000000 5.000000 6.000000 0 7.000000 8.000000 9.000000 10.000000 11.000000 12.000000 13.000000 14.000000 15.000000 16.000000 17.000000 18.000000 -1 0 0 1 0 1 1 1 1 1;"])+
  `[END_RF_LAYOUT : ${id}]\n`;}
const empty=buildEmptyRisaModel({program:"risafloor",outputPath:"fixture.rfl",title:"Floor Test"});
export const fixture=empty.replace(/\[RF_LAYOUTS\][\s\S]*?\[END_RF_LAYOUTS\]/,
  `[RF_LAYOUTS] <2>\n${makeLayout(1)}${makeLayout(2)}[END_RF_LAYOUTS]`)
  .replace("[RISA_FLOOR_FINISH]",`[RF_AREA_LOAD_DEFINITIONS]\n${table(".RF_STANDARD",[`${q("Office")} 0 1 2 3 0 0 0 -1 0 0 1 0 0;`])}[END_RF_AREA_LOAD_DEFINITIONS]\n`+
  table("RF_LOAD_COMBINATIONS",[`${q("Service")} 1 1 1 1 0 0 0 0 0 0 1 -1 1 1 | 1 1.0 | 2 1.0 | 0 0 | 0 0 | 0 0 | 0 0 | 0 0 | 0 0 | 0 0 | 0 0;`])+"[RISA_FLOOR_FINISH]");

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"rfl-tests-"));
const server=createRisaServer(),client=new Client({name:"floor-tests",version:"1.0"});
const [st,ct]=InMemoryTransport.createLinkedPair();let serial=0;
const read=p=>fs.readFileSync(p,"utf8").replace(/\r\n/g,"\n");
const layoutBody=(t,id=1)=>block(t,`RF_LAYOUT : ${id}`).body;
async function call(name,args){return client.callTool({name,arguments:args});}
async function edit(filePath,name,args){const outputPath=path.join(dir,`edit-${serial++}.rfl`);const result=await call(name,{filePath,outputPath,...args});assert.ok(!result.isError,JSON.stringify(result));const text=read(outputPath);assert.deepEqual(checkFloorModel(text).errors,[]);return {text,outputPath,result};}
async function fail(filePath,name,args){const outputPath=path.join(dir,`reject-${serial++}.rfl`);const result=await call(name,{filePath,outputPath,...args});assert.equal(result.isError,true,JSON.stringify(result));assert.ok(!fs.existsSync(outputPath));}
try{
  await Promise.all([server.connect(st),client.connect(ct)]);
  assert.deepEqual(checkFloorModel(fixture).errors,[]);
  assert.equal(readFloorModel(fixture).counts.beams,4);
  const list=await client.listTools();assert.ok(list.tools.some(t=>t.name==="edit_risafloor_geometry"));
  for(const eol of ["\n","\r\n"]){
    const source=path.join(dir,eol.length===1?"lf.rfl":"crlf.rfl");fs.writeFileSync(source,fixture.replace(/\n/g,eol));
    const original=fs.readFileSync(source,"utf8");
    const result=await edit(source,"edit_risafloor_geometry",{operations:[
      {action:"add_point",layoutId:1,label:"N5",x:25,z:5},
      {action:"move_point",layoutId:1,label:"N2",x:11,z:1},
      {action:"add_member",layoutId:1,kind:"beam",label:"B3",templateLabel:"B1",iPointLabel:"N4",jPointLabel:"N5",size:"W21X44"},
      {action:"modify_member",layoutId:1,kind:"column",label:"C1",size:"W8X24"}
    ]});
    assert.equal(layoutBody(result.text,2),layoutBody(fixture,2));
    const l=readFloorModel(result.text).layouts[0];assert.equal(l.points[1].x,11);assert.equal(l.beams[2].size,"W21X44");assert.equal(l.columns[0].size,"W8X24");
    const side=block(layoutBody(result.text),"..RF_BEAMS_SUPPLEMENTARY_DATA");assert.equal(side.count,3);assert.ok(!side.rows[2].includes("00000000-0000-0000-0000-000000000001"));
    const raw=fs.readFileSync(result.outputPath,"utf8");assert.equal(raw.includes("\r\n"),eol.length===2);if(eol.length===2)assert.ok(!/(^|[^\r])\n/.test(raw));
    assert.equal(fs.readFileSync(source,"utf8"),original);
    assert.throws(()=>readRisaFile(source),/risafloor/);

    const copied=await edit(source,"edit_risafloor_geometry",{operations:[{action:"copy_beams",layoutId:1,beamLabels:["B1","B2"],prefix:"X",dx:0,dz:20}]});
    const cl=readFloorModel(copied.text).layouts[0];assert.equal(cl.points.length,7);assert.equal(cl.beams.length,4);assert.equal(cl.pointLoads.length,1);assert.equal(cl.lineLoads.length,1);
    const moved=await edit(source,"edit_risafloor_geometry",{operations:[{action:"mirror_geometry",layoutId:1,mirrorAxis:"x",mirrorAt:5},{action:"translate_geometry",layoutId:1,dx:2,dz:3},{action:"modify_floor",layoutId:1,name:"Renamed",elevation:18}]});
    assert.equal(readFloorModel(moved.text).layouts[0].points[0].x,12);assert.equal(readFloorModel(moved.text).layouts[0].floors[0].name,"Renamed");
    const split=await edit(source,"edit_risafloor_geometry",{operations:[{action:"split_beam",layoutId:1,label:"B1",newLabel:"Split",pointLabel:"Mid",fraction:0.3}]});
    assert.equal(readFloorModel(split.text).layouts[0].points.at(-1).x,3);
    const deleted=await edit(source,"edit_risafloor_geometry",{operations:[{action:"delete_member",layoutId:1,kind:"beam",label:"B1"}]});
    assert.equal(readFloorModel(deleted.text).layouts[0].beams[0].label,"B2");assert.equal(block(layoutBody(deleted.text),"..RF_BEAMS_DESIGN_DATA").rows.length,1);
    assert.equal(block(layoutBody(deleted.text),".RF_LINE_LOADS").body,block(layoutBody(fixture),".RF_LINE_LOADS").body);

    const addedFloor=await edit(source,"edit_risafloor_geometry",{operations:[
      {action:"add_floor",templateLayoutId:1,name:"Third",elevation:45},
      {action:"add_point",layoutId:3,label:"A",x:0,z:0},
      {action:"add_point",layoutId:3,label:"B",x:10,z:0},
      {action:"add_member",layoutId:3,kind:"beam",label:"NewBeam",templateLayoutId:1,templateLabel:"B1",iPointLabel:"A",jPointLabel:"B"}
    ]});
    assert.equal(readFloorModel(addedFloor.text).layouts[2].beams[0].label,"NewBeam");
    const seededLoad=await edit(addedFloor.outputPath,"edit_risafloor_load",{layoutId:3,kind:"point",action:"add",templateLayoutId:1,templateRow:1,pointLabel:"B",preDL:2});
    assert.equal(readFloorModel(seededLoad.text).layouts[2].pointLoads[0].pointIndex,2);
    const removedPoint=await edit(source,"edit_risafloor_geometry",{operations:[{action:"delete_point",layoutId:1,label:"N4"}]});
    assert.equal(readFloorModel(removedPoint.text).layouts[0].points.length,3);
    const merged=await edit(split.outputPath,"edit_risafloor_geometry",{operations:[{action:"merge_beams",layoutId:1,firstLabel:"B1",secondLabel:"Split"}]});
    assert.equal(readFloorModel(merged.text).layouts[0].beams.length,2);
    assert.equal(readFloorModel(merged.text).layouts[0].beams[0].jPoint,2);
    await fail(source,"edit_risafloor_geometry",{operations:[{action:"merge_beams",layoutId:1,firstLabel:"B1",secondLabel:"B2"}]});
    await fail(source,"edit_risafloor_geometry",{operations:[{action:"delete_point",layoutId:1,label:"N2"}]});

    const changedLoad=await edit(source,"edit_risafloor_load",{layoutId:1,kind:"point",action:"modify",row:1,preDL:12,postDL:13,live:14,pointLabel:"N4"});
    const pt=tokens(block(layoutBody(changedLoad.text),".RF_POINT_LOADS").rows[0]);assert.deepEqual(pt.slice(1,5),["4","12","13","14"]);assert.deepEqual(pt.slice(5),tokens(block(layoutBody(fixture),".RF_POINT_LOADS").rows[0]).slice(5));
    const addedLoad=await edit(source,"edit_risafloor_load",{layoutId:1,kind:"line",action:"add",templateRow:1,startPointLabel:"N2",endPointLabel:"N4",preDL:[2,4],postDL:[6,8],live:[10,12]});
    const lt=tokens(block(layoutBody(addedLoad.text),".RF_LINE_LOADS").rows[1]);assert.deepEqual(lt.slice(1,9),["2","4","2","4","6","8","10","12"]);
    const scaled=await edit(source,"edit_risafloor_load",{layoutId:1,kind:"line",action:"modify",row:1,factor:2});assert.deepEqual(tokens(block(layoutBody(scaled.text),".RF_LINE_LOADS").rows[0]).slice(3,9),["2","4","6","8","10","12"]);
    const delLoad=await edit(source,"edit_risafloor_load",{layoutId:1,kind:"point",action:"delete",row:1});assert.equal(readFloorModel(delLoad.text).layouts[0].pointLoads.length,0);
    const area=await edit(source,"modify_risafloor_area_load_definition",{label:"Office",preDL:5,postDL:6,live:7,newLabel:"Storage"});assert.equal(block(block(area.text,"RF_AREA_LOAD_DEFINITIONS").body,".RF_STANDARD").rows.length,2);
    const combo=await edit(source,"modify_risafloor_load_combination",{label:"Service",newLabel:"Strength",factors:[{category:1,factor:1.2},{category:2,factor:1.6}]});assert.equal(readFloorModel(combo.text).loadCombinations.length,2);assert.ok(combo.text.includes("| 2 1.600000"));
    const replaced=await edit(source,"replace_risafloor_section_size",{oldSize:"W18X35",newSize:"W21X44",layoutId:1});assert.equal(readFloorModel(replaced.text).layouts[1].beams[0].size,"W18X35");
    assert.ok(compareFloorModels(fixture,result.text).changes.some(c=>c.entity==="layout 1/point N2"));
    const clone=await edit(source,"clone_risafloor_model",{});assert.equal(clone.text,fixture);
    for(const format of ["csv","xlsx"]){const exported=path.join(dir,`${serial++}.${format}`);const r=await call("export_risafloor_schedule",{filePath:source,outputPath:exported,format});assert.ok(!r.isError,JSON.stringify(r));assert.ok(fs.statSync(exported).size>0);assert.equal((await call("export_risafloor_schedule",{filePath:source,outputPath:exported,format})).isError,true);}
    for(const view of ["summary","floors","points","members","loads","materials","decks","design_rules","combinations"]){assert.ok(!(await call("read_risafloor_model",{filePath:source,view})).isError);}
    assert.ok(!(await call("find_risafloor_members",{filePath:source,layoutId:1,pointLabel:"N2"})).isError);
    assert.ok(!(await call("compare_risafloor_models",{filePathA:source,filePathB:result.outputPath})).isError);
    const same=await call("clone_risafloor_model",{filePath:source,outputPath:source});assert.equal(same.isError,true);assert.equal(fs.readFileSync(source,"utf8"),original);
    const alias=path.join(dir,`alias-${serial++}.rfl`);fs.linkSync(source,alias);assert.equal((await call("clone_risafloor_model",{filePath:source,outputPath:alias})).isError,true);
    await fail(source,"edit_risafloor_geometry",{operations:[{action:"move_point",layoutId:1,label:"N1",x:5,z:2},{action:"add_member",layoutId:1,kind:"beam",label:"B1",templateLabel:"B2",iPointLabel:"N1",jPointLabel:"N2"}]});
    await fail(source,"edit_risafloor_geometry",{operations:[{action:"move_point",layoutId:1,label:"N2",x:0,z:0}]});
    await fail(source,"edit_risafloor_geometry",{operations:[{action:"delete_member",layoutId:1,kind:"column",label:"C1"}]});
    await fail(source,"edit_risafloor_load",{layoutId:1,kind:"line",action:"modify",row:1,preDL:1});
    await fail(source,"edit_risafloor_load",{layoutId:99,kind:"point",action:"modify",row:1,preDL:1});
    await fail(source,"edit_risafloor_load",{layoutId:1,kind:"point",action:"add",templateRow:99,preDL:1});
    assert.equal(fs.readFileSync(source,"utf8"),original);
  }
  assert.ok(checkFloorModel(fixture.replace('[.RF_POINT_LOCATIONS] <4>','[.RF_POINT_LOCATIONS] <9>')).errors.length);
  assert.ok(checkFloorModel(fixture.replace('65562 1 2','65562 1 99')).errors.length);
  assert.ok(checkFloorModel(fixture.replace('-1 2 2.000000','-1 99 2.000000')).errors.length);
  assert.equal(patchRow('"Test $&" 1 2;',{1:3}),'"Test $&" 3 2;');
  assert.ok(!(await call("batch_summarize_risafloor_folder",{folderPath:dir,mode:"qc"})).isError);
  console.log("PASS: RISAFloor geometry/load edits, reports, exports, QC, isolation, companions, line endings and refusal paths through MCP");
}finally{await client.close();await server.close();fs.rmSync(dir,{recursive:true,force:true});}
