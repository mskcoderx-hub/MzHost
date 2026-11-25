const {randomBytes,createHash}=require("node:crypto");
const hash=s=>createHash("sha256").update(s).digest("hex");
const token=()=>randomBytes(32).toString("hex");
async function discord({action,req,res,db,store,send,secure,oldToken}) {
  const clientId=process.env.DISCORD_CLIENT_ID,secret=process.env.DISCORD_CLIENT_SECRET;
  if(!clientId || !secret || !db) return send(503,{message:"Discord sign-in needs the application credentials and MongoDB."});
  if(req.method!=="GET") return send(405,{});
  const callback=require("./oauth-origin.cjs").callbackUrl("discord",secure);
  const {origin}=callback,redirectUri=callback.href;
  const states=db.collection("oauth_states");
  const stateCookie="; HttpOnly; Path=/api; SameSite=Lax"+(secure?"; Secure":"");
  const redirect=location=>res.writeHead(302,{Location:location,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}).end();
  if(action==="discord-login") {
    if(req.headers.host && req.headers.host!==callback.host) return redirect(origin+"/api/discord-login"+(new URL(req.url,origin).searchParams.get("next")==="/billing"?"?next=/billing":""));
    if(!await store.allowAttempt("oauth:"+hash(req.socket?.remoteAddress||"unknown"),Date.now(),120)) return send(429,{message:"Try again shortly."});
    const state=token(),returnTo=new URL(req.url,origin).searchParams.get("next");
    await states.insertOne({_id:hash(state),expires:new Date(Date.now()+600000),billing:returnTo==="/billing"});
    res.setHeader("Set-Cookie","mz_oauth="+state+stateCookie+"; Max-Age=600");
    const params=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:"code",scope:"identify email",state});
    return redirect("https://discord.com/oauth2/authorize?"+params);
  }
  const params=new URL(req.url,origin).searchParams;
  const cookie=/(?:^|;\s*)mz_oauth=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||"")?.[1];
  if(!cookie || params.get("state")!==cookie) return send(403,{message:"This sign-in request expired. Start again."});
  const state=await states.findOneAndDelete({_id:hash(cookie),expires:{$gt:new Date()}});
  res.setHeader("Set-Cookie","mz_oauth="+stateCookie+"; Max-Age=0");
  if(!state || !params.get("code")) return redirect("/account#login");
  const exchange=await fetch("https://discord.com/api/v10/oauth2/token",{method:"POST",redirect:"error",signal:AbortSignal.timeout(7000),
    body:new URLSearchParams({grant_type:"authorization_code",client_id:clientId,client_secret:secret,redirect_uri:redirectUri,code:params.get("code")})});
  if(!exchange.ok) return send(401,{message:"Discord sign-in expired. Try again."});
  const {access_token}=await exchange.json();
  const response=await fetch("https://discord.com/api/v10/users/@me",{headers:{Authorization:"Bearer "+access_token},redirect:"error",signal:AbortSignal.timeout(7000)});
  if(!response.ok) return send(401,{message:"Could not verify the Discord account."});
  const profile=await response.json(),email=profile.email?.trim().toLowerCase();
  if(profile.verified!==true || !/^\d{15,21}$/.test(profile.id) || typeof email!=="string" || email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(403,{message:"Verify your email on Discord first."});
  const users=db.collection("users");
  let user=await users.findOne({discordId:profile.id});
  if(!user) {
    // A verified mailbox is also the identity proof used by email registration.
    try {
      user=await users.findOneAndUpdate({_id:email,$or:[{discordId:null},{discordId:profile.id}]},
        {$set:{discordId:profile.id,verifiedAt:new Date()},$setOnInsert:{created:new Date(),salt:token(),hash:token()}},{upsert:true,returnDocument:"after"});
    } catch(error) {if(error.code===11000) return send(409,{message:"This email is linked to a different Discord identity. Sign in with your original method."});throw error;}
  }
  const session=token(),now=Date.now();
  await store.authenticate({email:user._id,oldToken,token:hash(session),expires:now+604800000,now});
  res.setHeader("Set-Cookie",["mz_oauth="+stateCookie+"; Max-Age=0","mz_session="+session+"; HttpOnly; Path=/; SameSite=Strict; Max-Age=604800"+(secure?"; Secure":"")]);
  return redirect(state.billing?"/billing":"/dashboard");
}
module.exports={discord};
