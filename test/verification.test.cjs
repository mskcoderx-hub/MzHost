const test=require("node:test");
const assert=require("node:assert/strict");
const localAccounts=require("../src/server/local-accounts.cjs");
const {mailSettings}=require("../src/server/notifications.cjs");

test("verification, expiry, resend, provider failure and audit privacy",async t=>{
  process.env.APP_ORIGIN="https://mzhost.example";
  process.env.MAIL_FROM="MzHost <mail@mzhost.example>";
  process.env.RESEND_API_KEY="test-only";
  process.env.AUDIT_KEY="test-only-audit-key";
  for(const key of Object.keys(process.env)) if(key.startsWith("DISCORD_")) delete process.env[key];
  const events=[],messages=[];
  t.mock.method(console,"info",s=>events.push(JSON.parse(s)));
  let providerOnline=true;
  t.mock.method(global,"fetch",async (url,opts)=>{
    assert.equal(url,"https://api.resend.com/emails");
    messages.push(JSON.parse(opts.body));return {ok:providerOnline};
  });
  let now=Date.now();
  t.mock.method(Date,"now",()=>now);
  const handle=localAccounts(":memory:");
  const request=async(action,body,headers={})=>{
    const result={};
    await handle(action,{method:action==="session"?"GET":"POST",body,headers:{host:"localhost:4181",origin:"http://localhost:4181","content-type":"application/json",...headers}},
      {setHeader(k,v){result[k]=v;},writeHead(status){result.status=status;return this;},end(data){result.data=JSON.parse(data);}});
    return result;
  };
  const email="person@example.test",password="long-test-password";
  const lastToken=()=>messages.at(-1).text.match(/verify#([a-f0-9]{64})/)[1];
  assert.equal(mailSettings("other.example",true).origin,"https://mzhost.example");
  assert.equal((await request("register",{email},{origin:"https://other.example"})).status,403);
  assert.equal((await request("register",{email})).status,202);
  assert.equal(messages.length,1);
  assert.match(messages[0].html,/https:\/\/mzhost\.example\/verify#/);
  const expired=lastToken();
  await request("register",{email});assert.equal(messages.length,1);
  assert.equal((await request("login",{email,password})).status,401);
  now+=1800001;
  assert.equal((await request("verify",{token:expired,password})).status,400);
  await request("register",{email});
  const token=lastToken();
  const results=await Promise.all([request("verify",{token,password}),request("verify",{token,password})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
  const login=await request("login",{email,password});assert.equal(login.status,200);
  const cookie=login["Set-Cookie"].split(";")[0];
  assert.equal((await request("session",null,{cookie})).data.email,email);
  await request("logout",{},{cookie});
  assert.equal((await request("session",null,{cookie})).data.email,null);
  const sent=messages.length;
  await request("register",{email});assert.equal(messages.length,sent);
  providerOnline=false;
  assert.equal((await request("register",{email:"retry@example.test"})).status,503);
  now+=61000;providerOnline=true;
  assert.equal((await request("register",{email:"retry@example.test"})).status,202);
  for(const event of ["account.created","email.verified","login.succeeded","login.failed","session.ended","email.send_failed"]) assert.ok(events.some(e=>e.event===event),event);
  for(const sensitive of [email,password,token,expired,cookie]) assert.ok(!JSON.stringify(events).includes(sensitive));
});
