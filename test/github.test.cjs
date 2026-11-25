const test=require("node:test");
const assert=require("node:assert/strict");
const {Readable}=require("node:stream");
const {createHmac,scryptSync}=require("node:crypto");
const {github,hook,synchronize,credentials}=require("../src/server/github.cjs");
const {callbackUrl}=require("../src/server/oauth-origin.cjs");

test("OAuth uses the canonical callback on either side of a trailing slash",()=>{
  process.env.APP_ORIGIN="https://mzhost.example/";
  assert.equal(callbackUrl("discord",true).href,"https://mzhost.example/api/discord-callback");
  process.env.DISCORD_REDIRECT_URI="https://auth.example/api/discord-callback";
  assert.equal(callbackUrl("discord",true).host,"auth.example");
  delete process.env.DISCORD_REDIRECT_URI;
});
test("production admin credential accepts its saved password and rejects an incorrect one",async()=>{
  const salt="01".repeat(16),password="test-only-password";
  process.env.ADMIN_CREDENTIALS=JSON.stringify({username:"owner",hash:salt+"$"+scryptSync(password,salt,64).toString("hex")});
  const auth=require("../src/server/admin-auth.cjs").credentials(false);
  assert.equal(auth.username,"owner");
  assert.equal(await auth.check(password),true);
  assert.equal(await auth.check("incorrect"),false);
  delete process.env.ADMIN_CREDENTIALS;
});
test("push signature uses the original bytes and filters by installation, repository and branch",async()=>{
  const key="mock webhook secret";
  process.env.GITHUB_WEBHOOK_SECRET=key;
  const body=JSON.stringify({ref:"refs/heads/feature/a",installation:{id:2},repository:{id:3}},null,2);
  const signature="sha256="+createHmac("sha256",key).update(body).digest("hex");
  let query;
  const ctx=text=>{
    const req=Readable.from([Buffer.from(text)]);
    Object.assign(req,{method:"POST",headers:{"x-hub-signature-256":signature,"x-github-event":"push"}});
    return {req,send:status=>status,db:{collection:()=>({find:filter=>{query=filter;return [];}})}};
  };
  assert.equal(await hook(ctx(body)),200);
  assert.deepEqual(query,{repoId:3,installation:2,branch:"feature/a",auto:true});
  await assert.rejects(hook(ctx(body+" ")),{status:403});
});
test("GitHub sign-in exchanges a one-time browser-bound state for an account session",async t=>{
  Object.assign(process.env,{GITHUB_CLIENT_ID:"mock-id",GITHUB_CLIENT_SECRET:"mock-secret",APP_ORIGIN:"https://mzhost.example/"});
  let state,cookies,redirect,user,session,grant;
  const tables={
    oauth_states:{insertOne:row=>{state=row;},findOneAndDelete:filter=>{if(!state || state._id!==filter._id) return null;const row=state;state=null;return row;}},
    users:{findOne:()=>null,updateOne:(q,values)=>{user={email:q._id,...values.$set};}},
    github_accounts:{updateOne:(_q,values)=>{grant=values.$set;}}
  };
  const ctx={db:{collection:n=>tables[n]},secure:true,store:{allowAttempt:()=>true,authenticate:row=>{session=row;}},
    res:{setHeader:(_k,v)=>{cookies=v;},writeHead:(_s,v)=>{redirect=v.Location;return {end(){}};}},send:s=>s};
  const req=(url,cookie)=>({method:"GET",url,headers:{host:"mzhost.example",cookie}});
  await github({...ctx,action:"github-login",req:req("/api/github-login")});
  const start=new URL(redirect),cookie=cookies.split(";")[0],nonce=start.searchParams.get("state"),verifier=state.verifier;
  assert.equal(start.searchParams.get("redirect_uri"),"https://mzhost.example/api/github-callback");
  assert.equal(start.searchParams.get("code_challenge_method"),"S256");
  t.mock.method(global,"fetch",async(url,options)=>{
    if(url.endsWith("access_token")) {
      assert.equal(options.body.get("code_verifier"),verifier);
      return {ok:true,json:()=>({access_token:"provider-token",refresh_token:"refresh-token",expires_in:3600})};
    }
    return {ok:true,json:()=>url.endsWith("/user")?{id:99,login:"tester"}:[{email:"owner@example.test",verified:true,primary:true}]};
  });
  const url="/api/github-callback?code=sample&state="+nonce;
  assert.equal(await github({...ctx,action:"github-callback",req:req(url,"")}),403);
  await github({...ctx,action:"github-callback",req:req(url,cookie)});
  assert.equal(user.githubId,99);assert.equal(session.email,"owner@example.test");
  assert.equal(redirect,"/dashboard");assert.equal(state,null);
  assert.ok(!JSON.stringify(grant).includes("provider-token"));
  assert.match(cookies[1],/^mz_session=/);
  await github({...ctx,action:"github-callback",req:req(url,cookie)});
  assert.equal(redirect,"/account#login");
});
test("repository sync imports nested files, preserves configuration and requeues the active project at the saved revision",async t=>{
  process.env.GITHUB_CLIENT_SECRET="test-secret";
  const owner="me@example.test",serverId="server",sha="a".repeat(40);
  const stored=credentials({access_token:"mock-access"});
  const link={owner,serverId,repoId:42,branch:"main",binding:"binding",_id:"link",sha:"previous"};
  const server={id:serverId,runtime:"Python",version:"3.13",files:[],env:[{key:"MODE",value:"test"}],entry:"old.py",activity:[]};
  let saved,updated,job;
  const responses={"/repositories/42":{full_name:"owner/project"},"/repos/owner/project/branches/main":{commit:{sha,commit:{tree:{sha:"tree"}}}},
    "/repos/owner/project/git/trees/tree?recursive=1":{tree:[{path:"src",type:"tree"},{path:"src/main.py",type:"blob",mode:"100644",size:4,sha:"blob"}]},
    "/repos/owner/project/git/blobs/blob":{encoding:"base64",content:"cGFzcw=="}};
  t.mock.method(global,"fetch",async(url,opts)=>{
    assert.equal(opts.headers.Authorization,"Bearer mock-access");
    const data=responses[url.replace("https://api.github.com","")];assert.ok(data);return {ok:true,json:async()=>data};
  });
  const tables={github_accounts:{findOne:()=>stored},workspaces:{updateOne:(q,v)=>{assert.equal(q.revision,8);saved=v.$set.workspace;return {modifiedCount:1};}},
    github_links:{replaceOne:(q,v)=>{assert.equal(q.binding,"binding");updated=v;return {matchedCount:1};}},
    vps_test_worker:{updateOne:(q,v)=>{assert.equal(q.owner,owner);assert.equal(q.serverId,serverId);job=v.$set;return {modifiedCount:1};}}};
  const ctx={db:{collection:n=>tables[n]},client:{withSession:fn=>fn({withTransaction:fn=>fn()})},
    store:{workspace:()=>({revision:8,workspace:{selected:serverId,servers:[structuredClone(server)]}}),user:()=>({plan:"Free"})}};
  await synchronize(ctx,link);
  assert.deepEqual(saved.servers[0].files,[{path:"src/main.py",text:"pass"}]);
  assert.deepEqual(saved.servers[0].env,server.env);
  assert.equal(updated.sha,sha);assert.equal(job.project.entry,"src/main.py");
  assert.equal(updated.result,"Restart queued");
  await assert.rejects(synchronize(ctx,link,{revision:7}),{status:409});
});
