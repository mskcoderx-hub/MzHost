const test=require("node:test");
const assert=require("node:assert/strict");
const {accounts}=require("../src/server/accounts.cjs");

test("verified accounts can launch their own code and cannot read or control another account's run",async ()=>{
  delete process.env.VPS_TEST_EMAIL;
  process.env.VPS_WORKER_KEY="test-key-for-the-private-worker-123456";
  const definition={id:"unit-server",runtime:"Python",version:"3.13",entry:"main.py",files:[{path:"main.py",text:'print("hello")'}]};
  let doc={seen:new Date(),state:"idle"};
  const first="owner@example.test",second="other@example.test";
  let email=first,verified=true,plan;
  const handle=accounts({
    session:()=>email?{email}:null,user:()=>({verifiedAt:verified?new Date():null,plan}),allowAttempt:()=>true,
    workspace:owner=>({revision:4,workspace:{servers:[owner===first?definition:{...definition,files:[{path:"main.py",text:"print(2)"}]}]}}),
    runtime:{
      get:owner=>({owned:doc.owner===owner?doc:null,online:true,available:doc.state==="idle"}),
      command:(owner,serverId,desired,project,generation)=>{
        if(doc.owner!==owner && (desired==="stop" || !["idle","stopped","exited","failed"].includes(doc.state))) return null;
        return doc={...doc,owner,serverId,desired,project,generation,state:"queued",logs:""};
      },
      input:(owner,serverId,generation,line,id)=>{
        if(doc.owner!==owner || doc.serverId!==serverId || doc.generation!==generation || doc.state!=="running" || doc.input || !doc.workerInstance) return null;
        doc.input={line,id,instance:doc.workerInstance};return doc;
      },
      poll:report=>{
        doc.workerInstance=report.instance;
        if(report.generation===doc.generation) {
          Object.assign(doc,{state:report.state,logs:report.logs});
          if(report.inputAck===doc.input?.id) delete doc.input;
        }
        return doc;
      }
    }
  },{secure:true});
  async function request(body,authorization,method="POST") {
    const result={};
    await handle("runtime",{method,body,headers:{host:"example.test",origin:"https://example.test",authorization,"content-type":"application/json"}},{
      writeHead(code){result.code=code;return this;},end(value){result.data=JSON.parse(value);}
    });
    return result;
  }
  const action={action:"run",serverId:definition.id,revision:4};
  assert.equal((await request({...action,plan:"Plus",memory:4096})).code,402);
  plan="Free";
  assert.equal((await request({...action,revision:3})).code,409);
  assert.equal((await request({...action,serverId:"someone-else"})).code,404);
  const accepted=await request(action);
  assert.equal(accepted.code,202);assert.equal(accepted.data.project,undefined);
  const poll={state:"idle",logs:"",generation:null};
  assert.equal((await request(poll,"Bearer other")).code,403);
  const bearer="Bearer "+process.env.VPS_WORKER_KEY;
  const job=(await request(poll,bearer)).data;
  assert.equal(job.project.image,"python:3.13-alpine");
  assert.equal(job.project.plan,"Free");assert.ok(job.project.volume && job.project.directory);
  assert.deepEqual(job.project.files,definition.files);
  assert.equal((await request({generation:job.generation,state:"running",logs:"hello"},bearer)).data.project,undefined);
  assert.equal((await request(null,undefined,"GET")).data.logs,"hello");
  const instance="1".repeat(32);
  const running={generation:job.generation,state:"running",logs:"Your name?",instance};
  await request(running,bearer);
  const input={action:"input",serverId:definition.id,generation:job.generation,line:"test user"};
  assert.equal((await request({...input,generation:"stale"})).code,409);
  assert.equal((await request({...input,line:"bad\nline"})).code,400);
  email=second;
  const other=(await request(null,undefined,"GET")).data;
  assert.equal(other.serverId,null);assert.equal(other.logs,"");assert.equal(other.generation,null);assert.equal(other.available,false);
  assert.equal((await request(input)).code,409);
  assert.equal((await request({...action,action:"stop"})).code,409);
  assert.equal((await request(action)).code,409);
  email=first;
  const sent=await request(input);assert.equal(sent.code,202);assert.equal(sent.data.inputPending,true);assert.equal(sent.data.input,undefined);
  assert.equal((await request(input)).code,409);
  const pending=(await request(running,bearer)).data.input;
  assert.equal(pending.line,"test user");
  assert.deepEqual((await request(running,bearer)).data.input,pending);
  assert.equal((await request({...running,inputAck:pending.id},bearer)).data.input,undefined);
  definition.files.push({path:"src/test.py",text:"print(2)"});
  assert.equal((await request({...action,entry:"src/test.py"})).code,202);
  assert.equal((await request(poll,bearer)).data.project.entry,"src/test.py");
  assert.equal(definition.entry,"main.py");
  assert.equal((await request({...action,action:"stop"})).code,202);
  assert.equal((await request(poll,bearer)).data.desired,"stop");
  definition.files.push({path:"../outside",text:"test"});
  assert.equal((await request(action)).code,400);
  await request({generation:doc.generation,state:"stopped",logs:"older private output"},bearer);
  email=second;
  assert.equal((await request(action)).code,202);
  assert.equal((await request(poll,bearer)).data.project.files[0].text,"print(2)");
  verified=false;assert.equal((await request(action)).code,403);
  email=null;assert.equal((await request(null,undefined,"GET")).code,403);
});
