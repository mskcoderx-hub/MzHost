const test=require("node:test");
const assert=require("node:assert/strict");
const {accounts}=require("../src/server/accounts.cjs");

test("private VPS trial checks ownership and hands the saved project only to its worker",async ()=>{
  process.env.VPS_TEST_EMAIL="owner@example.test";
  process.env.VPS_WORKER_KEY="test-key-for-the-private-worker-123456";
  const definition={id:"unit-server",runtime:"Python",version:"3.13",entry:"main.py",files:[{path:"main.py",text:'print("hello")'}]};
  let doc={seen:new Date(),state:"idle"};
  let email=process.env.VPS_TEST_EMAIL;
  const handle=accounts({
    session:()=>email?{email}:null,user:()=>({verifiedAt:new Date()}),allowAttempt:()=>true,
    workspace:()=>({revision:4,workspace:{servers:[definition]}}),
    runtime:{
      get:()=>doc,
      command:(serverId,desired,project,generation)=>(doc={...doc,serverId,desired,project,generation,state:"queued"}),
      poll:report=>{if(report.generation===doc.generation) Object.assign(doc,{state:report.state,logs:report.logs});return doc;}
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
  assert.equal((await request({...action,revision:3})).code,409);
  assert.equal((await request({...action,serverId:"someone-else"})).code,404);
  const accepted=await request(action);
  assert.equal(accepted.code,202);assert.equal(accepted.data.project,undefined);
  const poll={state:"idle",logs:"",generation:null};
  assert.equal((await request(poll,"Bearer other")).code,403);
  const bearer="Bearer "+process.env.VPS_WORKER_KEY;
  const job=(await request(poll,bearer)).data;
  assert.equal(job.project.image,"python:3.13-alpine");
  assert.deepEqual(job.project.files,definition.files);
  assert.equal((await request({generation:job.generation,state:"running",logs:"hello"},bearer)).data.project,undefined);
  assert.equal((await request(null,undefined,"GET")).data.logs,"hello");
  assert.equal((await request({...action,action:"stop"})).code,202);
  assert.equal((await request(poll,bearer)).data.desired,"stop");
  definition.files.push({path:"../outside",text:"test"});
  assert.equal((await request(action)).code,400);
  email="other@example.test";
  assert.equal((await request(action)).code,403);
  email=null;assert.equal((await request(null,undefined,"GET")).code,403);
});
