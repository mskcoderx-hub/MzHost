const {randomBytes,randomUUID,createHash,createHmac,timingSafeEqual,createCipheriv,createDecipheriv}=require("node:crypto");
const {callbackUrl}=require("./oauth-origin.cjs");
const {fileRecord}=require("./archives.cjs");
const {project}=require("./runtime-test.cjs");
const {currentPlan}=require("./billing.cjs");
const tree=require("../public/project-tree.js");
const digest=value=>createHash("sha256").update(value).digest();
const fail=(status,message)=>Object.assign(Error(message),{status});
const api="https://api.github.com";
const clientId=()=>process.env.GITHUB_CLIENT_ID?.trim();
const secret=()=>process.env.GITHUB_CLIENT_SECRET?.trim();
const appUrl=()=>/^[a-z0-9-]+$/i.test(process.env.GITHUB_APP_SLUG||"")?"https://github.com/apps/"+process.env.GITHUB_APP_SLUG+"/installations/new":null;
function wrap(value) {
  const nonce=randomBytes(12),cipher=createCipheriv("aes-256-gcm",digest(secret()),nonce);
  const bytes=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),bytes]).toString("base64");
}
function unwrap(value) {
  const bytes=Buffer.from(value,"base64"),cipher=createDecipheriv("aes-256-gcm",digest(secret()),bytes.subarray(0,12));
  cipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString();
}
async function exchange(params) {
  const result=await fetch("https://github.com/login/oauth/access_token",{method:"POST",redirect:"error",signal:AbortSignal.timeout(9000),
    headers:{Accept:"application/json"},body:new URLSearchParams({client_id:clientId(),client_secret:secret(),...params})});
  const data=await result.json();
  if(!result.ok || !data.access_token) throw fail(401,"Reconnect your GitHub account to continue.");
  return data;
}
function credentials(data) {
  return {access:wrap(data.access_token),refresh:data.refresh_token?wrap(data.refresh_token):null,
    expires:data.expires_in?Date.now()+data.expires_in*1000:null};
}
async function tokenFor(db,owner) {
  const table=db.collection("github_accounts"),row=await table.findOne({_id:owner});
  if(!row) throw fail(401,"Connect your GitHub account first.");
  if(!row.expires || row.expires>Date.now()+30000) return unwrap(row.access);
  if(!row.refresh) throw fail(401,"Reconnect your GitHub account.");
  const locked=await table.findOneAndUpdate({_id:owner,access:row.access,$or:[{refreshing:null},{refreshing:{$lt:Date.now()-20000}}]},{$set:{refreshing:Date.now()}});
  if(!locked) throw fail(409,"GitHub authorization is refreshing. Retry shortly.");
  try {
    const next=credentials(await exchange({grant_type:"refresh_token",refresh_token:unwrap(row.refresh)}));
    const updated=await table.updateOne({_id:owner,access:row.access},{$set:next,$unset:{refreshing:""}});
    if(!updated.modifiedCount) throw fail(409,"GitHub connection changed. Retry.");
    return unwrap(next.access);
  } finally {await table.updateOne({_id:owner,access:row.access},{$unset:{refreshing:""}});}
}
async function get(token,path) {
  const response=await fetch(api+path,{redirect:"error",signal:AbortSignal.timeout(9000),headers:{Authorization:"Bearer "+token,Accept:"application/vnd.github+json","User-Agent":"MzHost"}});
  if(!response.ok) throw fail(response.status===401?401:response.status===404?404:502,response.status===401?"Reconnect your GitHub account.":response.status===404?"GitHub could not find that repository or branch.":"GitHub could not complete the request. Check app access and try again.");
  return response.json();
}
const paramsFor=req=>new URL(req.url,"https://localhost").searchParams;
async function oauth(ctx) {
  const {req,res,secure,store,db,action,oldToken}=ctx;
  if(req.method!=="GET") throw fail(405,"Use a sign-in link.");
  const callback=callbackUrl("github",secure),query=paramsFor(req),cookieAttrs="; HttpOnly; Path=/api; SameSite=Lax"+(secure?"; Secure":"");
  const table=db.collection("oauth_states");
  const redirect=location=>res.writeHead(302,{Location:location,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}).end();
  if(action==="github-login") {
    const connect=query.get("connect")==="1",billing=query.get("next")==="/billing";
    if(req.headers.host && req.headers.host!==callback.host) return redirect(callback.origin+"/api/github-login"+(connect?"?connect=1":billing?"?next=/billing":""));
    if(!await store.allowAttempt("github-oauth:"+digest(req.socket?.remoteAddress||"unknown").toString("hex"),Date.now(),100)) throw fail(429,"Try again shortly.");
    const session=connect && oldToken && await store.session(oldToken,Date.now());
    if(connect && !session) return redirect("/account#login");
    const state=randomBytes(32).toString("hex"),verifier=randomBytes(48).toString("base64url");
    await table.insertOne({_id:digest(state).toString("hex"),provider:"github",expires:new Date(Date.now()+600000),verifier,owner:session?.email||null,session:connect?oldToken:null,billing});
    res.setHeader("Set-Cookie","mz_github="+state+cookieAttrs+"; Max-Age=600");
    return redirect("https://github.com/login/oauth/authorize?"+new URLSearchParams({client_id:clientId(),redirect_uri:callback.href,state,code_challenge:digest(verifier).toString("base64url"),code_challenge_method:"S256"}));
  }
  const cookie=/(?:^|;\s*)mz_github=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||"")?.[1];
  if(!cookie || query.get("state")!==cookie) throw fail(403,"This GitHub sign-in expired. Start again.");
  const state=await table.findOneAndDelete({_id:digest(cookie).toString("hex"),provider:"github",expires:{$gt:new Date()}});
  const clear="mz_github="+cookieAttrs+"; Max-Age=0";res.setHeader("Set-Cookie",clear);
  if(!state || !query.get("code")) return redirect(state?.owner?"/dashboard#deployments":"/account#login");
  if(state.owner && (await store.session(state.session,Date.now()))?.email!==state.owner) throw fail(403,"The original MzHost session expired.");
  const grant=await exchange({code:query.get("code"),redirect_uri:callback.href,code_verifier:state.verifier});
  const profile=await get(grant.access_token,"/user");
  if(!Number.isSafeInteger(profile.id)) throw fail(403,"GitHub identity is unavailable.");
  const users=db.collection("users"),known=await users.findOne({githubId:profile.id});
  let owner=state.owner || known?._id;
  if(!owner) {
    const emails=await get(grant.access_token,"/user/emails");
    owner=emails.find(item=>item.primary && item.verified)?.email?.trim().toLowerCase();
    if(!owner || owner.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)) throw fail(403,"Verify your primary email address on GitHub first.");
  }
  if(known && known._id!==owner) throw fail(409,"That GitHub account is already linked to another MzHost account.");
  try {
    await users.updateOne({_id:owner,$or:[{githubId:null},{githubId:profile.id}]},{$set:{githubId:profile.id,verifiedAt:new Date()},
      $setOnInsert:{created:new Date(),salt:randomBytes(16).toString("hex"),hash:randomBytes(32).toString("hex")}},{upsert:true});
  } catch(error) {if(error.code===11000) throw fail(409,"This account is linked to another GitHub identity.");throw error;}
  await db.collection("github_accounts").updateOne({_id:owner},{$set:{...credentials(grant),login:profile.login,githubId:profile.id},$unset:{refreshing:""}},{upsert:true});
  const session=randomBytes(32).toString("hex"),now=Date.now();
  await store.authenticate({email:owner,oldToken:state.session||oldToken,token:digest(session).toString("hex"),expires:now+604800000,now});
  res.setHeader("Set-Cookie",[clear,"mz_session="+session+"; HttpOnly; Path=/; SameSite=Strict; Max-Age=604800"+(secure?"; Secure":"")]);
  return redirect(state.owner?"/dashboard#deployments":state.billing?"/billing":"/dashboard");
}
async function sourceFiles(token,repoId,branch,previousSha) {
  const repo=await get(token,"/repositories/"+repoId);
  const base="/repos/"+repo.full_name.split("/").map(encodeURIComponent).join("/");
  const ref=await get(token,base+"/branches/"+encodeURIComponent(branch));
  const head=ref.commit;
  if(head.sha===previousSha) return null;
  const treeId=head.commit.tree.sha;
  const objects=await get(token,base+"/git/trees/"+treeId+"?recursive=1");
  if(objects.truncated) throw fail(413,"The repository tree is too large for this workspace.");
  const dirs=[],blobs=[];let bytes=0;
  for(const item of objects.tree) {
    try {tree.path(item.path);} catch {throw fail(400,"Rename the unsupported repository path: "+item.path.slice(0,160));}
    if(item.type==="tree") {dirs.push(item.path);continue;}
    if(item.type!=="blob" || !["100644","100755"].includes(item.mode)) throw fail(400,"This repository contains a symlink or submodule. Import regular files only.");
    bytes+=item.size;blobs.push(item);
    if(!Number.isSafeInteger(item.size) || item.size<0 || item.size>262144 || bytes>3*1024*1024 || blobs.length>80) throw fail(413,"Repository exceeds workspace limits (80 files, 256 KB per file, 3 MB total).");
  }
  if(dirs.length>160) throw fail(413,"Repository exceeds the folder limit.");
  const files=[];
  for(let i=0;i<blobs.length;i+=6) {
    files.push(...await Promise.all(blobs.slice(i,i+6).map(async item=>{
      const blob=await get(token,base+"/git/blobs/"+item.sha),data=Buffer.from(blob.content||"","base64");
      if(blob.encoding!=="base64" || data.length!==item.size) throw fail(502,"GitHub returned an incomplete file.");
      return fileRecord(item.path,data);
    })));
  }
  return {files,folders:dirs,sha:head.sha,repo:repo.full_name};
}
function publicLink(link) {
  if(!link) return null;
  return {repo:link.repo,branch:link.branch,sha:link.sha,updated:link.updated,auto:link.auto,result:link.result,error:link.error||null};
}
async function synchronize(ctx,link,{prior=link,revision,manual=false}={}) {
  const {db,store,client}=ctx,table=db.collection("github_links"),owner=link.owner;
  const saved=await store.workspace(owner),server=saved.workspace.servers.find(s=>s.id===link.serverId);
  if(!server) throw fail(404,"Server no longer exists.");
  if(revision!==undefined && revision!==saved.revision) throw fail(409,"The workspace changed. Reload before importing.");
  const token=await tokenFor(db,owner),source=await sourceFiles(token,link.repoId,link.branch,manual?undefined:link.sha);
  if(!source) return;
  server.files=source.files;server.folders=source.folders;
  const runnable=server.files.filter(f=>!f.binary && (server.runtime==="Python"?/\.py$/:/\.(js|cjs|mjs)$/i).test(f.path));
  if(!runnable.some(f=>f.path===server.entry)) server.entry=runnable.find(f=>f.path===(server.runtime==="Python"?"main.py":"index.js"))?.path || (runnable.length===1?runnable[0].path:"");
  const now=new Date(),message="Imported "+source.repo+" @ "+source.sha.slice(0,7);
  server.activity=[{time:now.getTime(),message},...server.activity].slice(0,80);
  if(Buffer.byteLength(JSON.stringify(saved.workspace))>3*1024*1024) throw fail(413,"The import would exceed the saved workspace size limit.");
  let payload;const user=await store.user(owner),plan=currentPlan(user);
  if(plan && server.entry) {
    try {payload=project(server);} catch {}
    if(payload) Object.assign(payload,{plan,expires:plan==="Free"?null:new Date(user.planExpires).getTime(),volume:digest(owner).toString("hex"),directory:digest(server.id).toString("hex")});
  }
  await client.withSession(session=>session.withTransaction(async()=>{
    const match={_id:link._id,...(prior?{binding:prior.binding,sha:prior.sha}:{binding:{$exists:false}})};
    const record={...link,repo:source.repo,updated:now,sha:source.sha,error:null,result:"Files updated"};
    if(payload) {
      const result=await db.collection("vps_test_worker").updateOne({owner,serverId:server.id,desired:"run",state:{$in:["running","starting","queued"]},planProtocol:1,seen:{$gt:new Date(Date.now()-90000)}},
        {$set:{project:payload,generation:randomUUID(),state:"queued",logs:"",inputFailed:false},$unset:{input:""}},{session});
      if(result.modifiedCount) record.result="Restart queued";
    }
    const changed=await db.collection("workspaces").updateOne({_id:owner,revision:saved.revision},{$set:{workspace:saved.workspace},$inc:{revision:1}},{session});
    if(!changed.modifiedCount) throw fail(409,"Workspace changed during import. Retry.");
    const bound=await table.replaceOne(match,record,{session,upsert:!prior});
    if(!bound.matchedCount && !bound.upsertedCount) throw fail(409,"Repository connection changed. Retry.");
  }));
}
async function hook(ctx) {
  const {req,send,db}=ctx,signingKey=process.env.GITHUB_WEBHOOK_SECRET;
  if(!signingKey || req.method!=="POST") throw fail(403,"Webhook unavailable.");
  const signature=req.headers["x-hub-signature-256"];
  if(!/^sha256=[0-9a-f]{64}$/.test(signature||"")) throw fail(403,"Invalid signature.");
  const chunks=[];let bytes=0;
  for await(const chunk of req) {const data=Buffer.from(chunk);bytes+=data.length;if(bytes>4*1024*1024) throw fail(413,"Payload too large.");chunks.push(data);}
  const raw=Buffer.concat(chunks),expected=createHmac("sha256",signingKey).update(raw).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature.slice(7),"hex"))) throw fail(403,"Invalid signature.");
  if(req.headers["x-github-event"]!=="push") return send(200,{ok:true});
  const event=JSON.parse(raw.toString());
  if(event.deleted || !event.ref?.startsWith("refs/heads/")) return send(200,{ok:true});
  const table=db.collection("github_links"),cursor=table.find({repoId:event.repository?.id,installation:event.installation?.id,branch:event.ref.slice(11),auto:true});
  let failures=0;
  for await(const link of cursor) {
    try {
      try {await synchronize(ctx,link);}
      catch(error) {
        if(error.status!==409) throw error;
        const current=await table.findOne({_id:link._id,binding:link.binding,auto:true});
        if(current) await synchronize(ctx,current);
      }
    }
    catch(error) {failures++;await table.updateOne({_id:link._id,binding:link.binding,sha:link.sha},{$set:{error:error.status?error.message:"Import failed. Sync again from Deployments."}});}
  }
  return send(failures?503:200,{ok:!failures});
}
async function panel(ctx) {
  const {req,store,db,send,oldToken,readBody,sameOrigin}=ctx;
  const session=oldToken && await store.session(oldToken,Date.now());
  if(!session) throw fail(401,"Sign in to MzHost.");
  const owner=session.email,q=paramsFor(req);
  if(!["GET","POST"].includes(req.method) || (req.method==="POST" && !sameOrigin())) throw fail(403,"Invalid repository request.");
  const body=req.method==="POST"?await readBody(req,4096):{},serverId=body.serverId||q.get("server");
  const saved=await store.workspace(owner);
  if(!saved.workspace.servers.some(s=>s.id===serverId)) throw fail(404,"Server not found.");
  const table=db.collection("github_links"),id=digest(owner+"|"+serverId).toString("hex"),link=await table.findOne({_id:id});
  const action=body.action||q.get("list");
  if(!action) {
    const account=await db.collection("github_accounts").findOne({_id:owner},{projection:{login:1}});
    return send(200,{login:account?.login||null,install:appUrl(),link:publicLink(link)});
  }
  if(!await store.allowAttempt("github:"+owner,Date.now(),60)) throw fail(429,"Retry in a minute.");
  if(req.method==="GET") {
    const token=await tokenFor(db,owner),page=Math.max(1,Math.min(1000,parseInt(q.get("page"),10)||1)),paging="?per_page=50&page="+page;
    if(action==="installations") {
      const result=await get(token,"/user/installations"+paging);
      return send(200,{items:result.installations.map(i=>({id:i.id,name:i.account.login})),more:page*50<result.total_count});
    }
    const install=Number(q.get("installation"));
    if(action==="repos" && Number.isSafeInteger(install) && install>0) {
      const result=await get(token,"/user/installations/"+install+"/repositories"+paging);
      return send(200,{items:result.repositories.map(r=>({id:r.id,name:r.full_name,branch:r.default_branch})),more:page*50<result.total_count});
    }
    const repoId=Number(q.get("repo"));
    if(action==="branches" && Number.isSafeInteger(repoId) && repoId>0) {
      const repo=await get(token,"/repositories/"+repoId);
      const names=await get(token,"/repos/"+repo.full_name.split("/").map(encodeURIComponent).join("/")+"/branches"+paging);
      return send(200,{items:names.map(b=>({name:b.name})),more:names.length===50});
    }
    throw fail(400,"Unknown list.");
  }
  if(action==="disconnect") {if(link) await table.deleteOne({_id:id,binding:link.binding});return send(200,{ok:true});}
  if(!Number.isSafeInteger(body.revision) || body.revision!==saved.revision) throw fail(409,"Reload the latest workspace before syncing.");
  if(action==="sync" && link) await synchronize(ctx,link,{manual:true,revision:body.revision});
  else if(action==="bind") {
    const {repoId,installation,branch}=body;
    if(!Number.isSafeInteger(repoId) || repoId<=0 || !Number.isSafeInteger(installation) || installation<=0 || typeof branch!=="string" || !branch.trim() || branch.length>255) throw fail(400,"Choose a repository and branch.");
    if(body.auto && !process.env.GITHUB_WEBHOOK_SECRET) throw fail(503,"Configure the GitHub App webhook before enabling push updates.");
    const token=await tokenFor(db,owner);
    // Verify the selected repository belongs to an installation the user can access.
    let found=false,page=1;
    while(!found) {
      const result=await get(token,"/user/installations/"+installation+"/repositories?per_page=100&page="+page);
      found=result.repositories.some(r=>r.id===repoId);
      if(page++*100>=result.total_count) break;
    }
    if(!found) throw fail(403,"Grant the MzHost GitHub App access to this repository.");
    await synchronize(ctx,{_id:id,owner,serverId,installation,repoId,branch:branch.trim(),auto:body.auto===true,binding:randomUUID()},{prior:link,manual:true,revision:body.revision});
  } else throw fail(400,"Unknown repository action.");
  return send(200,{ok:true});
}
async function github(ctx) {
  try {
    if(!ctx.db || !clientId() || !secret()) throw fail(503,"GitHub integration has not been configured on this host.");
    if(ctx.action==="github-hook") return await hook(ctx);
    if(ctx.action==="github") return await panel(ctx);
    return await oauth(ctx);
  } catch(error) {
    const status=error.code===11000?409:error.status||503;
    return ctx.send(status,{message:error.status?error.message:status===409?"The connection changed. Retry.":"GitHub is unavailable. Try again."});
  }
}
module.exports={github,hook,sourceFiles,synchronize,credentials};
