import test from "node:test";
import assert from "node:assert/strict";
import { AutonomousCodingEngine } from "../src/agent/autonomous-coding-engine.js";
test("coding engine inspects workspace before generating an approval-gated proposal",async()=>{
 const calls=[];const agent={async processTask(task){calls.push(["task",task]);return {taskId:"task-1",status:"RECEIVED"};},async inspectTaskWorkspace(id,paths){calls.push(["inspect",id,paths]);return {files:[{path:"src/a.js",exists:false,content:null}]};},prepareCodingChanges(id,files){calls.push(["prepare",id,files]);return {changes:files.map(file=>({path:file.path,requiresApproval:true}))};},approveTask(id){calls.push(["approve",id]);return {status:"WAITING_FOR_APPROVAL"};}};
 let n=0;const providerClient={async generate(input){calls.push(["generate",input]);n++;return {text:n===1?'{"paths":["src/a.js"]}':'{"files":[{"path":"src/a.js","content":"export const a = 1;"}]}'}}};
 const result=await new AutonomousCodingEngine({agent,providerClient}).createProposal({task:"Add a constant"});
 assert.equal(result.approvalRequired,true);assert.equal(result.status,"WAITING_FOR_APPROVAL");
 assert.deepEqual(calls.map(call=>call[0]),["task","generate","inspect","generate","prepare","approve"]);
});
test("coding engine rejects malformed inspection plans before workspace access",async()=>{
 const agent={async processTask(){return {taskId:"task-2",status:"RECEIVED"};},async inspectTaskWorkspace(){throw new Error("must not inspect");}};
 const engine=new AutonomousCodingEngine({agent,providerClient:{async generate(){return {text:'{"paths":[]}'}}}});
 await assert.rejects(engine.createProposal({task:"bad"}),/1-20/);
});
test("coding engine rejects modifications to paths that were not inspected",async()=>{
 const agent={async processTask(){return {taskId:"task-3",status:"RECEIVED"};},async inspectTaskWorkspace(){return {files:[]};}};
 let n=0;const engine=new AutonomousCodingEngine({agent,providerClient:{async generate(){n++;return {text:n===1?'{"paths":["src/a.js"]}':'{"files":[{"path":"src/b.js","content":"x"}]}'}}}});
 await assert.rejects(engine.createProposal({task:"bad"}),/uninspected/);
});
