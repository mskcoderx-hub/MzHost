const test=require("node:test");
const assert=require("node:assert/strict");
const {accounts}=require("../src/server/accounts.cjs");

test("autosaves stay quiet and workspace alerts name the affected servers",async t=>{
  process.env.DISCORD_WORKSPACE_WEBHOOK="https://discord.com/api/webhooks/123/test";
  const audit=[],messages=[];
  t.mock.method(console,"info",()=>{});
  t.mock.method(global,"fetch",async (_,options)=>{
    messages.push(JSON.parse(options.body).embeds[0]);return {ok:true};
  });
  let changes={added:[],removed:[]};
  const email="person@example.test";
  const handle=accounts({session:()=>({email}),user:()=>({verifiedAt:true}),allowAttempt:()=>true,
    runtime:{},workspace:()=>({}),save:()=>changes,audit:item=>audit.push(item)},{secure:true});
  async function request(action) {
    let result;
    await handle(action,{method:action==="session"?"GET":"PUT",headers:{host:"example.test",origin:"https://example.test","content-type":"application/json"},
      body:{revision:0,workspace:{servers:[],selected:""}}},{writeHead(){return this;},end(body){result=JSON.parse(body);}});
    return result;
  }
  for(let i=0;i<4;i++) await request("workspace");
  assert.equal(audit.length,0);assert.equal(messages.length,0);
  changes={added:["mybot"],removed:["old-bot"]};
  await request("workspace");
  assert.deepEqual(messages.map(({title,description})=>[title,description]),[["Server created","mybot"],["Server deleted","old-bot"]]);
  changes=false;await request("workspace");
  assert.equal(audit.at(-1).event,"workspace.revision_conflict");assert.equal(messages.length,2);

  delete process.env.VPS_WORKER_KEY;
  assert.equal((await request("session")).runtimeAccess,"setup_required");
  process.env.VPS_WORKER_KEY="x".repeat(32);
  process.env.VPS_TEST_EMAIL="other@example.test";
  const privateSession=await request("session");
  assert.equal(privateSession.runtimeAccess,"enabled");assert.equal(privateSession.vpsTest,true);
  assert.ok(!JSON.stringify(privateSession).includes(process.env.VPS_TEST_EMAIL));
  process.env.VPS_TEST_EMAIL=email;
  assert.equal((await request("session")).vpsTest,true);
});
