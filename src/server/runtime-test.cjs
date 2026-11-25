const {createHash,randomUUID,timingSafeEqual}=require("node:crypto");
const {currentPlan}=require("./billing.cjs");
const digest=value=>createHash("sha256").update(value).digest();
function runtimeAccess(email) {
  if(!email) return "sign_in_required";
  return process.env.VPS_WORKER_KEY?.length>=32?"enabled":"setup_required";
}
const images={Python:{"3.12":"python:3.12-alpine","3.13":"python:3.13-alpine"},"Node.js":{"22":"node:22-alpine","24":"node:24-alpine"}};
function project(server,entry=server.entry) {
  const image=Object.hasOwn(images,server.runtime) && Object.hasOwn(images[server.runtime],server.version) && images[server.runtime][server.version];
  if(!image) throw Error("Select a supported runtime and version in Configuration.");
  if(!server.files.some(f=>f.path===entry && !f.binary) || !(server.runtime==="Python"?/\.py$/:/\.(js|cjs|mjs)$/).test(entry)) throw Error("Choose a runnable project file.");
  for(const f of server.files) {
    if(typeof f.path!=="string" || !f.path.split("/").every(p=>/^[a-zA-Z0-9_. -]{1,80}$/.test(p) && p!=="." && p!=="..")) throw Error("Rename files to use relative project paths.");
  }
  return {image,entry,files:server.files.map(f=>f.binary?{path:f.path,data:f.data}:{path:f.path,text:f.text})};
}
function status(doc) {
  const live=doc?.seen && Date.now()-doc.seen.getTime()<90000;
  return {online:Boolean(live),serverId:doc?.serverId || null,state:doc?.state || "idle",logs:doc?.logs || "",generation:doc?.generation || null,
    interactive:Boolean(doc?.workerInstance),inputPending:Boolean(doc?.input),inputFailed:doc?.inputFailed===true};
}
async function runtimeTest({req,send,readBody,store,email,user,sameOrigin,now}) {
  if(!store.runtime) return send(404,{});
  const worker=req.headers.authorization;
  if(worker) {
    if(!(process.env.VPS_WORKER_KEY?.length>=32) || !timingSafeEqual(digest(worker),digest("Bearer "+process.env.VPS_WORKER_KEY))) return send(403,{});
    if(req.method!=="POST") return send(405,{});
    const report=await readBody(req,120000);
    if(!report || !["idle","starting","running","exited","stopped","failed"].includes(report.state) || typeof report.logs!=="string" || report.logs.length>16000) return send(400,{});
    if(report.slot!==undefined && (!Number.isInteger(report.slot) || report.slot<0 || report.slot>31)) return send(400,{});
    const doc=await store.runtime.poll(report,now);
    const sendProject=doc.desired==="run" && doc.generation!==report.generation;
    const input=doc.input;
    const deliver=report.state==="running" && doc.desired==="run" && doc.generation===report.generation && input && input.instance===report.instance;
    return send(200,{slot:report.slot || 0,generation:doc.generation || null,desired:doc.desired || "stop",project:sendProject?doc.project:undefined,input:deliver?{id:input.id,line:input.line}:undefined});
  }
  if(runtimeAccess(email)!=="enabled") return send(403,{});
  if(req.method==="GET") {
    const {owned,online,available}=await store.runtime.get(email);
    const current=status(owned);
    return send(200,{...current,online:owned?current.online:online,available});
  }
  if(req.method!=="POST" || !sameOrigin()) return send(403,{});
  const data=await readBody(req,4096);
  if(!data || !["run","stop","input"].includes(data.action) || typeof data.serverId!=="string") return send(400,{});
  if(data.action==="input") {
    if(typeof data.line!=="string" || Buffer.byteLength(data.line)>512 || /[\r\n\0]/.test(data.line) || typeof data.generation!=="string") return send(400,{message:"Send one line of up to 512 bytes."});
    if(!await store.allowAttempt("vps-terminal-input:"+digest(email).toString("hex"),now,60)) return send(429,{message:"Try again in one minute."});
    const result=await store.runtime.input(email,data.serverId,data.generation,data.line,randomUUID());
    return result?send(202,status(result)):send(409,{message:"Refresh the terminal. Input needs a running project and an available prompt."});
  }
  if(!await store.allowAttempt("vps-control:"+digest(email).toString("hex"),now,20)) return send(429,{message:"Try again in one minute."});
  let payload=null;
  if(data.action==="run") {
    const plan=currentPlan(user);
    if(!plan) return send(402,{message:"Choose a hosting plan in Billing before starting a server."});
    const saved=await store.workspace(email);
    if(saved.revision!==data.revision) return send(409,{message:"Refresh the workspace before launching."});
    const server=saved.workspace.servers.find(s=>s.id===data.serverId);
    if(!server) return send(404,{});
    try {payload=project(server,data.entry);} catch(error){return send(400,{message:error.message});}
    payload.plan=plan;
    payload.expires=plan==="Free"?null:new Date(user.planExpires).getTime();
    payload.volume=digest(email).toString("hex");
    payload.directory=digest(server.id).toString("hex");
  }
  const issued=await store.runtime.command(email,data.serverId,data.action,payload,randomUUID());
  return issued?send(202,status(issued)):send(409,{message:data.action==="run"?"No hosting slot is available. If one of your projects is running, stop it before starting another.":"This project has no active run to stop."});
}
module.exports={runtimeTest,runtimeAccess,project};
