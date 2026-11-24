const {createHash,randomUUID,timingSafeEqual}=require("node:crypto");
const digest=value=>createHash("sha256").update(value).digest();
const runtimeOwner=email=>Boolean(process.env.VPS_TEST_EMAIL && process.env.VPS_WORKER_KEY?.length>=32 && email===process.env.VPS_TEST_EMAIL.trim().toLowerCase());
const images={Python:{"3.12":"python:3.12-alpine","3.13":"python:3.13-alpine"},"Node.js":{"22":"node:22-alpine","24":"node:24-alpine"}};
function project(server) {
  const image=Object.hasOwn(images,server.runtime) && Object.hasOwn(images[server.runtime],server.version) && images[server.runtime][server.version];
  if(!image) throw Error("Select a supported runtime and version in Configuration.");
  if(!server.files.some(f=>f.path===server.entry && !f.binary) || !(server.runtime==="Python"?/\.py$/:/\.(js|cjs|mjs)$/).test(server.entry)) throw Error("Choose a runnable startup file in Files.");
  for(const f of server.files) {
    if(typeof f.path!=="string" || !f.path.split("/").every(p=>/^[a-zA-Z0-9_. -]{1,80}$/.test(p) && p!=="." && p!=="..")) throw Error("Rename files to use relative project paths.");
  }
  return {image,entry:server.entry,files:server.files.map(f=>f.binary?{path:f.path,data:f.data}:{path:f.path,text:f.text})};
}
function status(doc) {
  const live=doc?.seen && Date.now()-doc.seen.getTime()<90000;
  return {online:Boolean(live),serverId:doc?.serverId || null,state:doc?.state || "idle",logs:doc?.logs || "",generation:doc?.generation || null};
}
async function runtimeTest({req,send,readBody,store,email,sameOrigin,now}) {
  if(!store.runtime) return send(404,{});
  const worker=req.headers.authorization;
  if(worker) {
    if(!runtimeOwner(process.env.VPS_TEST_EMAIL?.trim().toLowerCase()) || !timingSafeEqual(digest(worker),digest("Bearer "+process.env.VPS_WORKER_KEY))) return send(403,{});
    if(req.method!=="POST") return send(405,{});
    const report=await readBody(req,120000);
    if(!report || !["idle","starting","running","exited","stopped","failed"].includes(report.state) || typeof report.logs!=="string" || report.logs.length>16000) return send(400,{});
    const doc=await store.runtime.poll(report,now);
    const sendProject=doc.desired==="run" && doc.generation!==report.generation;
    return send(200,{generation:doc.generation || null,desired:doc.desired || "stop",project:sendProject?doc.project:undefined});
  }
  if(!runtimeOwner(email)) return send(403,{});
  if(req.method==="GET") return send(200,status(await store.runtime.get()));
  if(req.method!=="POST" || !sameOrigin()) return send(403,{});
  const data=await readBody(req,1024);
  if(!data || !["run","stop"].includes(data.action) || typeof data.serverId!=="string") return send(400,{});
  if(!await store.allowAttempt("vps-test-control",now,20)) return send(429,{message:"Try again in one minute."});
  let payload=null;
  if(data.action==="run") {
    const saved=await store.workspace(email);
    if(saved.revision!==data.revision) return send(409,{message:"Refresh the workspace before launching."});
    const server=saved.workspace.servers.find(s=>s.id===data.serverId);
    if(!server) return send(404,{});
    try {payload=project(server);} catch(error){return send(400,{message:error.message});}
  }
  const issued=await store.runtime.command(data.serverId,data.action,payload,randomUUID());
  return issued?send(202,status(issued)):send(409,{message:"Check that the worker is online and stop any other active test."});
}
module.exports={runtimeTest,runtimeOwner,project};
