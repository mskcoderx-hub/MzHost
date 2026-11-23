const { randomBytes, scrypt, createHash, timingSafeEqual } = require("node:crypto");
const derive = require("node:util").promisify(scrypt);
const week = 7 * 24 * 60 * 60;
const digest = value => createHash("sha256").update(value).digest("hex");

const hashOptions = {N:32768, r:8, p:3, maxmem:64*1024*1024};
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
    if (action === "workspace" || (action === "session" && req.method === "GET")) {
      const session = await store.session(oldToken,now);
      const email=session && (session.email!=="1" || localTest) ? session.email : null;
      if(action==="workspace") {
        if(!store.workspace) return send(404,{});
        if(!email) return send(401,{});
        if(req.method==="GET") return send(200,await store.workspace(email));
        if(req.method!=="PUT") return send(405,{});
        if(!sameOrigin()) return send(403,{});
        const {workspace,revision}=await readBody(req,3*1024*1024+1024) || {};
        if(!Number.isSafeInteger(revision) || revision<0 || !Array.isArray(workspace?.servers) || workspace.servers.length>5 || typeof workspace.selected!=="string") return send(400,{message:"Invalid workspace."});
        const saved=await store.save(email,revision,workspace);
        return send(saved?200:409,saved?{revision:revision+1}:{message:"Workspace changed."});
      }
      return send(200,{email,workspaceStorage:store.workspace?"mongodb":"tab"});
    }
    if (!["login","register","logout"].includes(action)) return send(404, {});
    if (req.method !== "POST") return send(405, {});
    function sameOrigin() {
      return req.headers.origin===(secure?"https://":"http://")+host && req.headers["content-type"]?.split(";")[0]==="application/json";
    }
    if (!sameOrigin()) return send(403, {});
    const cookieFlags = "; HttpOnly; Path=/; SameSite=Strict"+(secure?"; Secure":"");
    if (action === "logout") {
      await store.logout(oldToken);
      res.setHeader("Set-Cookie", "mz_session=; Max-Age=0" + cookieFlags);
      return send(200, {});
    }
    const ip=secure ? (req.headers["x-vercel-forwarded-for"] || req.socket?.remoteAddress || "preview") : "local";
    if(!await store.allowAttempt(digest(String(ip)),now)) return send(429,{message:"Too many attempts. Try again in a minute."});
    const data=await readBody(req,4096);
    const email = typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";
    const password = data?.password;
    const isTestLogin = localTest && action === "login" && email === "1";
    if ((!isTestLogin && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) || email.length > 254 || typeof password !== "string" || !password.length || password.length > 256) return send(400, {message:"Enter a valid login and password."});
    if (action === "register" && password.length < 12) return send(400, {message:"Use at least 12 characters for your password."});
    const user = await store.user(email);
    const salt = action === "register" ? randomBytes(16).toString("hex") : user?.salt || dummySalt;
    const hash = await derive(password, salt, 32, hashOptions);
    if (action === "login" && (!user || !timingSafeEqual(hash, Buffer.from(user.hash,"hex")))) return send(401, {message:"The email or password is incorrect."});
    const token = randomBytes(32).toString("hex");
    const created=await store.authenticate({register:action==="register",email,salt,hash:hash.toString("hex"),oldToken,token:digest(token),expires:now+week*1000,now});
    if(!created) return send(409,{message:"Unable to create that account. Try logging in."});
    res.setHeader("Set-Cookie","mz_session=" + token + "; Max-Age=" + week + cookieFlags);
    send(action === "register" ? 201 : 200, {email});
  };
}};
