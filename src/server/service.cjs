const {randomBytes,createHash,timingSafeEqual}=require("node:crypto");
const {billing,ipn}=require("./billing.cjs");
const {discord}=require("./identity.cjs");
const digest=s=>createHash("sha256").update(s).digest();
const localSessions=new Map();
async function status(db) {
  if(!db) return {website:"online",database:"offline",worker:"offline",updatedAt:new Date()};
  const active=await db.collection("vps_test_worker").findOne({planProtocol:1,seen:{$gte:new Date(Date.now()-90000)}},{projection:{_id:1}});
  return {website:"online",database:"online",worker:active?"online":"offline",updatedAt:new Date()};
}
async function admin({db,secure,store,res,req,body,send}) {
  const local=!secure && process.env.NODE_ENV!=="production" && !process.env.VERCEL;
  const sessions=db?.collection("admin_sessions");
  const raw=/(?:^|;\s*)mz_admin=([\da-f]{64})(?:;|$)/.exec(req.headers.cookie||"")?.[1];
  const key=raw && digest(raw).toString("hex");
  const now=Date.now(),cookie="; Path=/api; HttpOnly; SameSite=Strict"+(secure?"; Secure":"");
  const valid=key && (sessions?await sessions.findOne({_id:key,expires:{$gt:new Date()}}):localSessions.get(key)>now);
  if(req.method==="POST" && typeof body?.password==="string") {
    const auth=require("./admin-auth.cjs").credentials(local);
    if(!auth || (!local && !sessions)) return send(503,{message:"Admin sign-in is unavailable. The project owner must finish production setup."});
    const ip=req.headers["x-vercel-forwarded-for"]||req.socket?.remoteAddress||"local";
    if(!await store.allowAttempt("admin:"+digest(String(ip)).toString("hex"),now,6,900000)) return send(429,{message:"Try again in 15 minutes."});
    if(!await auth.check(body.password) || body.username!==auth.username) return send(401,{message:"Incorrect admin credentials."});
    const value=randomBytes(32).toString("hex"),id=digest(value).toString("hex");
    if(sessions) await sessions.insertOne({_id:id,expires:new Date(now+1800000)});
    else {for(const [k,v] of localSessions) if(v<=now) localSessions.delete(k);localSessions.set(id,now+1800000);}
    res.setHeader("Set-Cookie","mz_admin="+value+cookie+"; Max-Age=1800");
    return send(200,{ok:true});
  }
  if(!valid) return send(401,{message:"Sign in to administration."});
  if(req.method==="POST") {
    if(body?.action==="logout") {
      if(sessions) await sessions.deleteOne({_id:key});else localSessions.delete(key);
      res.setHeader("Set-Cookie","mz_admin="+cookie+"; Max-Age=0");return send(200,{ok:true});
    }
    if(body?.action==="sync-status" && db) {
      const result=await publishStatus(db);
      return ["synced","unchanged"].includes(result.state)?send(200,result):send(503,{message:result.message || "A status update is already in progress."});
    }
    if(body?.action==="check-reviews" && db) {
      try {
        const items=await require("./community.cjs").reviews(db);
        return send(200,{count:items.length});
      } catch(error) {return send(503,{message:error.message});}
    }
    return send(400,{message:"This action requires the connected database."});
  }
  if(!db) return send(200,{accounts:store.countUsers?.()||0,activePlans:0,workers:0,orders:[]});
  const [accounts,activePlans,workers,orders]=await Promise.all([
    db.collection("users").countDocuments(),db.collection("users").countDocuments({$or:[{plan:"Free"},{planExpires:{$gt:new Date()}}]}),
    db.collection("vps_test_worker").countDocuments({seen:{$gte:new Date(now-90000)}}),
    db.collection("hosting_orders").find({},{projection:{_id:0,plan:1,status:1,amount:1,created:1,sandbox:1,providerAmount:1}}).sort({created:-1}).limit(30).toArray()
  ]);
  return send(200,{accounts,activePlans,workers,orders});
}
async function publishStatus(db) {
  const {website,database,worker,updatedAt}=await status(db);
  try {
    const result=await require("./community.cjs").syncStatus(db,{updatedAt,services:[["Website",website],["Database",database],["Hosting worker",worker]].map(([name,value])=>({name,status:value==="online"?"operational":"offline"}))});
    if(result.state==="unconfigured") result.message="Set DISCORD_BOT_TOKEN and the numeric DISCORD_CLIENT_ID for MzBot in Vercel Production.";
    return result;
  } catch(error) {
    const reasons={401:"Discord rejected DISCORD_BOT_TOKEN.",403:"Give MzBot View Channel, Read Message History and Send Messages in the status channel.",404:"MzBot cannot find the configured status channel.",429:"Discord rate-limited this update. Retry shortly."};
    return {state:"failed",message:reasons[error.status] || (error.message?.includes("APP_ORIGIN")?"Set APP_ORIGIN to the HTTPS website origin.":"Could not publish the Discord status panel. Check the status channel, bot credentials and APP_ORIGIN.")};
  }
}
const actions=["archive","github-login","github-callback","github","github-hook","status","reviews","admin","billing","payments-ipn","discord-login","discord-callback","sync-status"];
async function service(ctx) {
  const {action,db,req,send,readBody,sameOrigin,store,oldToken}=ctx;
  if(action==="archive") return require("./archives.cjs").archiveRequest(ctx);
  if(action.startsWith("github")) return require("./github.cjs").github(ctx);
  if(action==="sync-status") {
    const secret=process.env.CRON_SECRET;
    if(req.method!=="GET" || !db || !secret || !timingSafeEqual(digest(req.headers.authorization||""),digest("Bearer "+secret))) return send(403,{});
    const result=await publishStatus(db);
    return send(["failed","unconfigured"].includes(result.state)?503:200,result);
  }
  if(action==="discord-login" || action==="discord-callback") return discord(ctx);
  if(action==="status" || action==="reviews") {
    if(req.method!=="GET") return send(405,{});
    if(action==="status") return send(200,await status(db));
    if(db) try {return send(200,{reviews:await require("./community.cjs").reviews(db)});} catch {}
    return send(503,{message:"The Discord review feed is temporarily unavailable."});
  }
  if(action==="payments-ipn") {
    if(req.method!=="POST" || !db) return send(405,{});
    return ipn({...ctx,body:await readBody(req,32768)});
  }
  if(!["GET","POST"].includes(req.method)) return send(405,{});
  if(req.method==="POST" && !sameOrigin()) return send(403,{});
  const body=req.method==="POST"?await readBody(req,4096):null;
  if(action==="admin") return admin({...ctx,body});
  const session=oldToken && await store.session(oldToken,Date.now());
  const user=session && await store.user(session.email);
  if(!user?.verifiedAt) return send(401,{message:"Sign in with a verified account."});
  if(!db) return send(503,{message:"Enable MongoDB to choose a hosting plan."});
  return billing({...ctx,body,email:session.email,user,allow:store.allowAttempt.bind(store)});
}
module.exports={actions,service};
