const test=require("node:test");
const assert=require("node:assert/strict");
const {service}=require("../src/server/service.cjs");
const {discord}=require("../src/server/identity.cjs");

test("admin rejects a foreign origin and blocks the local convenience login in production",async()=>{
  const response=(code,data)=>({code,data});
  const ctx={action:"admin",secure:true,store:{allowAttempt:()=>true},req:{method:"POST",headers:{}},
    send:response,sameOrigin:()=>true,readBody:()=>({username:"1",password:"1"}),res:{setHeader(){}}};
  delete process.env.ADMIN_PASSWORD;delete process.env.ADMIN_USERNAME;
  assert.equal((await service({...ctx,sameOrigin:()=>false})).code,403);
  assert.equal((await service(ctx)).code,503);
  let cookie;
  const local={...ctx,secure:false,res:{setHeader(_,value){cookie=value.split(";")[0];}}};
  assert.equal((await service(local)).code,200);
  assert.equal((await service({...local,req:{method:"GET",headers:{cookie}}})).code,200);
  const original=cookie;
  await service({...local,req:{method:"POST",headers:{cookie}},readBody:()=>({action:"logout"})});
  assert.equal((await service({...local,req:{method:"GET",headers:{cookie:original}}})).code,401);
});

test("Discord callback needs a fresh state from the same browser and a verified Discord email",async t=>{
  Object.assign(process.env,{DISCORD_CLIENT_ID:"123",DISCORD_CLIENT_SECRET:"test",APP_ORIGIN:"https://site.example"});
  let ticket,cookie,target,session,verified=false;
  const states={insertOne:value=>{ticket=value;},findOneAndDelete:q=>{
    if(!ticket || q._id!==ticket._id) return null;
    const value=ticket;ticket=null;return value;
  }};
  const users={findOne:()=>null,findOneAndUpdate:q=>({_id:q._id})};
  const context={secure:true,store:{allowAttempt:()=>true,authenticate:value=>{session=value;}},
    db:{collection:name=>name==="users"?users:states},req:{method:"GET",headers:{},url:"/api/discord-login"},
    res:{setHeader(_,v){cookie=v;},writeHead(_,v){target=v.Location;return this;},end(){}},send:(code)=>code};
  t.mock.method(global,"fetch",async url=>({ok:true,json:()=>url.endsWith("token")?{access_token:"callback-test"}:{id:"123456789012345678",email:"user@example.test",verified}}));
  async function begin(){
    await discord({...context,action:"discord-login"});
    const state=new URL(target).searchParams.get("state");
    return {...context,action:"discord-callback",req:{method:"GET",url:"/api/discord-callback?code=test&state="+state,headers:{cookie:cookie.split(";")[0]}}};
  }
  let request=await begin();
  assert.equal(await discord({...request,req:{...request.req,headers:{}}}),403);
  assert.equal(await discord(request),403);assert.equal(session,undefined);
  request=await begin();verified=true;await discord(request);
  assert.equal(session.email,"user@example.test");assert.equal(target,"/dashboard");
  const old=session;await discord(request);assert.equal(session,old);assert.equal(target,"/account#login");
});
