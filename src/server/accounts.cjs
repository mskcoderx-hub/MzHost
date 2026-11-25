const { randomBytes, scrypt, createHash, timingSafeEqual } = require("node:crypto");
const {record:writeEvent,mailSettings,sendVerification}=require("./notifications.cjs");
const {runtimeAccess,runtimeTest}=require("./runtime-test.cjs");
const services=require("./service.cjs");
const {currentPlan,plans}=require("./billing.cjs");
const derive = require("node:util").promisify(scrypt);
const week = 7 * 24 * 60 * 60;
const digest = value => createHash("sha256").update(value).digest("hex");

const hashOptions = {N:32768, r:8, p:3, maxmem:64*1024*1024};
function validServer(server) {
  const list=(value,max,check)=>Array.isArray(value) && value.length<=max && value.every(check);
  const runtime=value=>["Python","Node.js"].includes(value);
  const memory=value=>[150,256,512,1024,2048,4096].includes(value);
  const id=value=>typeof value==="string" && /^[a-f0-9-]{36}$/i.test(value);
  const file=f=>f && typeof f.path==="string" && f.path.length<=160 &&
    (f.binary===true ? typeof f.data==="string" && f.data.length<=349528 && /^[A-Za-z0-9+/]*={0,2}$/.test(f.data) : typeof f.text==="string" && Buffer.byteLength(f.text)<=262144);
  const project=s=>s && runtime(s.runtime) && typeof s.entry==="string" && list(s.files,80,file);
  const snapshot=s=>project(s) && id(s.id) && Number.isFinite(s.time);
  const event=e=>e && Number.isFinite(e.time) && typeof e.message==="string";
  return project(server) && id(server.id) && typeof server.name==="string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(server.name) &&
    (!server.plan || Object.hasOwn(plans,server.plan)) && memory(server.memory) && Number.isFinite(server.started) &&
    list(server.backups,5,b=>snapshot(b) && memory(b.memory)) && list(server.deployments,3,r=>snapshot(r) && typeof r.name==="string") &&
    list(server.logs,140,event) && list(server.activity,80,event) && Array.isArray(server.env) &&
    server.env.every(v=>v && typeof v.key==="string" && /^[A-Za-z_][A-Za-z_0-9]{0,79}$/.test(v.key) && typeof v.value==="string" && v.value.length<=4096);
}
async function readBody(req,limit) {
  if(req.body!==undefined) {
    const raw=typeof req.body==="string" || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body);
    if(Buffer.byteLength(raw)>limit) throw Object.assign(Error("Request is too large."),{status:413});
    try {return JSON.parse(raw);}
    catch {throw Object.assign(Error("Invalid JSON."),{status:400});}
  }
  const chunks=[];
  let length=0;
  for await (const chunk of req) {
    const bytes=Buffer.from(chunk);
    length+=bytes.length;
    if(length>limit) throw Object.assign(Error("Request is too large."),{status:413});
    chunks.push(bytes);
  }
  try {return JSON.parse(Buffer.concat(chunks).toString("utf8"));}
  catch {throw Object.assign(Error("Invalid JSON."),{status:400});}
}
module.exports={hashOptions,accounts(store,{secure=false,localTest=false}={}) {
  const record=(group,event,email,servers)=>writeEvent(group,event,email,store.audit,servers);
  const dummySalt=randomBytes(16).toString("hex");
  return async function handle(action, req, res) {
    function send(status, data) {
      res.writeHead(status, {"Content-Type":"application/json", "Cache-Control":"no-store"}).end(JSON.stringify(data));
    }
    const cookie = /(?:^|;\s*)mz_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || "");
    const oldToken = cookie ? digest(cookie[1]) : "";
    const now = Date.now();
    const host = req.headers.host;
    if (!secure && !/^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(host || "")) return send(403, {});
    if(services.actions.includes(action)) return services.service({action,store,db:store.db,client:store.client,secure,req,res,send,readBody,sameOrigin,oldToken});
    if(action==="runtime" && req.headers.authorization) return runtimeTest({req,send,readBody,store,now});
    if (action === "workspace" || action==="runtime" || (action === "session" && req.method === "GET")) {
      const session = await store.session(oldToken,now);
      const user=session && await store.user(session.email);
      const verified=session && (session.email==="1" ? localTest : user?.verifiedAt);
      const email=verified ? session.email : null;
      if(action==="runtime") return runtimeTest({req,send,readBody,store,email,user,sameOrigin,now});
      if(action==="workspace") {
        if(!store.workspace) return send(404,{});
        if(!email) {console.info(JSON.stringify({event:"workspace.access_denied",time:new Date().toISOString()}));return send(401,{});}
        if(req.method==="GET") return send(200,await store.workspace(email));
        if(req.method!=="PUT") return send(405,{});
        if(!sameOrigin()) return send(403,{});
        if(!await store.allowAttempt("save:"+digest(email),now,90)) return send(429,{message:"Too many saves. Retry in a minute."});
        const {workspace,revision}=await readBody(req,3*1024*1024+1024) || {};
        if(!Number.isSafeInteger(revision) || revision<0 || !Array.isArray(workspace?.servers) || workspace.servers.length>5 || typeof workspace.selected!=="string") return send(400,{message:"Invalid workspace."});
        const ids=new Set();
        for(const server of workspace.servers) {
          if(!validServer(server) || ids.has(server.id)) return send(400,{message:"Invalid server configuration."});
          ids.add(server.id);
        }
        if(ids.size ? !ids.has(workspace.selected) : workspace.selected!=="") return send(400,{message:"Invalid server selection."});
        const entitlement=currentPlan(user);
        if(store.db && !entitlement) {
          const prior=await store.workspace(email);
          if(workspace.servers.some(s=>!prior.workspace.servers.some(old=>old.id===s.id))) return send(402,{message:"Choose Free or a paid plan in Billing before creating a server."});
        } else if(store.db) {
          for(const server of workspace.servers) {
            server.plan=entitlement;
            server.memory=plans[entitlement].memory;
          }
        }
        const saved=await store.save(email,revision,workspace);
        if(!saved) await record("workspace","workspace.revision_conflict",email);
        if(saved?.added?.length) await record("workspace","preview.server_created",email,saved.added);
        if(saved?.removed?.length) await record("workspace","preview.server_removed",email,saved.removed);
        return send(saved?200:409,saved?{revision:revision+1}:{message:"Workspace changed."});
      }
      const access=email && (store.runtime?runtimeAccess(email):"storage_required");
      return send(200,{email,plan:currentPlan(user),workspaceStorage:store.workspace?"mongodb":"tab",vpsTest:access==="enabled",runtimeAccess:access});
    }
    if (!["login","register","verify","logout"].includes(action)) return send(404, {});
    if (req.method !== "POST") return send(405, {});
    function sameOrigin() {
      return req.headers.origin===(secure?"https://":"http://")+host && req.headers["content-type"]?.split(";")[0]==="application/json";
    }
    if (!sameOrigin()) return send(403, {});
    const cookieFlags = "; HttpOnly; Path=/; SameSite=Strict"+(secure?"; Secure":"");
    if (action === "logout") {
      const session=oldToken && await store.session(oldToken,now);
      await store.logout(oldToken);
      if(session) await record("accounts","session.ended",session.email);
      res.setHeader("Set-Cookie", "mz_session=; Max-Age=0" + cookieFlags);
      return send(200, {});
    }
    const ip=secure ? (req.headers["x-vercel-forwarded-for"] || req.socket?.remoteAddress || "preview") : "local";
    if(!await store.allowAttempt("ip:"+digest(String(ip)),now)) {
      if(await store.allowAttempt("ip-alert:"+digest(String(ip)),now,1)) await record("security","auth.rate_limited");
      return send(429,{message:"Too many attempts. Try again in a minute."});
    }
    const data=await readBody(req,4096);
    const email = typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";
    const password = data?.password;
    if(action==="verify") {
      if(typeof data?.token!=="string" || !/^[a-f0-9]{64}$/.test(data.token)) return send(400,{message:"Request a new verification link."});
      if(typeof password!=="string" || password.length<12 || password.length>256) return send(400,{message:"Use a password between 12 and 256 characters."});
      const salt=randomBytes(16).toString("hex");
      const hash=await derive(password,salt,32,hashOptions);
      const result=await store.confirm(digest(data.token),salt,hash.toString("hex"),now);
      if(!result) return send(400,{message:"This link expired or has already been used. Request a new link."});
      if(result.created) await record("accounts","account.created",result.email);
      await record("accounts","email.verified",result.email);
      return send(200,{verified:true});
    }
    const isTestLogin = localTest && action === "login" && email === "1";
    if ((!isTestLogin && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || email.length > 254) return send(400, {message:"Enter a valid email address."});
    if(action==="login" && (typeof password!=="string" || !password.length || password.length>256)) return send(400,{message:"Enter your password."});
    const user = await store.user(email);
    if(action==="register") {
      let settings;
      try {settings=mailSettings(host,secure);}
      catch {await record("operations","email.configuration_missing");return send(503,{message:"Verification email is temporarily unavailable."});}
      const token=randomBytes(32).toString("hex");
      if(!user?.verifiedAt && await store.allowAttempt("mail:"+digest(email),now,4,3600000) && await store.issue(email,digest(token),now)) {
        if(!await store.allowAttempt("mail-budget",now,Number(process.env.MAIL_HOURLY_LIMIT)||100,3600000)) {
          if(await store.allowAttempt("mail-budget-alert",now,1,3600000)) await record("operations","email.volume_limit");
          return send(429,{message:"Verification email is busy. Try again later."});
        }
        try {await record("operations",await sendVerification(email,token,settings),email);}
        catch {await record("operations","email.send_failed",email);return send(503,{message:"Email could not be sent. Request a new link in one minute."});}
      }
      return send(202,{pending:true,message:"If this address needs verification, a link will arrive shortly. Already verified? Log in."});
    }
    if(!await store.allowAttempt("login:"+digest(email),now,20,900000)) {
      if(await store.allowAttempt("account-alert:"+digest(email),now,1,900000)) await record("security","account.login_rate_limited",email);
      return send(429,{message:"Too many login attempts. Try again later."});
    }
    const salt = user?.salt || dummySalt;
    const hash = await derive(password, salt, 32, hashOptions);
    if (!user || !timingSafeEqual(hash, Buffer.from(user.hash,"hex"))) {
      await record("security","login.failed",email);return send(401, {message:"The email or password is incorrect."});
    }
    if(!isTestLogin && !user.verifiedAt) return send(403,{message:"Verify your email to continue. Use Request verification link below."});
    const token = randomBytes(32).toString("hex");
    await store.authenticate({email,oldToken,token:digest(token),expires:now+week*1000,now});
    await record("accounts","login.succeeded",email);
    res.setHeader("Set-Cookie","mz_session=" + token + "; Max-Age=" + week + cookieFlags);
    send(200, {email});
  };
}};
