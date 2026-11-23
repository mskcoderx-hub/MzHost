const {randomUUID,createHmac}=require("node:crypto");
const fs=require("node:fs/promises");
const path=require("node:path");

async function record(group,event,email,persist) {
  const item={id:randomUUID(),time:new Date().toISOString(),group,event};
  if(email && process.env.AUDIT_KEY) item.account=createHmac("sha256",process.env.AUDIT_KEY).update(email).digest("hex").slice(0,20);
  console.info(JSON.stringify(item));
  if(persist) {
    try {await persist(item);}
    catch {console.warn(JSON.stringify({event:"audit.storage_unavailable",id:item.id}));}
  }
  const target=process.env["DISCORD_"+group.toUpperCase()+"_WEBHOOK"];
  if(!target) return;
  try {
    const url=new URL(target);
    if(url.origin!=="https://discord.com" || !/^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname)) throw Error();
    const response=await fetch(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(1800),
      headers:{"Content-Type":"application/json"},body:JSON.stringify({allowed_mentions:{parse:[]},
        embeds:[{title:event,color:0xffd23f,description:item.account?"Account · "+item.account:undefined,timestamp:item.time,footer:{text:"MzHost / "+group+" / "+item.id}}]})});
    if(!response.ok) throw Error();
  } catch { console.warn(JSON.stringify({event:"discord.notification_failed",group,id:item.id})); }
}

function mailSettings(host,secure) {
  if(!secure && process.env.NODE_ENV!=="production" && !process.env.RESEND_API_KEY) return {origin:"http://"+host,local:true};
  const origin=new URL(process.env.APP_ORIGIN);
  if(origin.protocol!=="https:" || origin.username || origin.password || origin.href!==origin.origin+"/" ||
     !process.env.RESEND_API_KEY || !process.env.MAIL_FROM) throw Error("Mail configuration unavailable");
  return {origin:origin.origin,local:false};
}

async function sendVerification(email,token,settings) {
  const link=settings.origin+"/verify#"+token;
  const subject="Verify your MzHost email";
  const text="Confirm this email and set your MzHost password. This link expires in 30 minutes.\n\n"+link+"\n\nIf you did not request this email, you can ignore it.";
  const html=`<!doctype html><html lang="en"><body style="margin:0;background:#f3f3ef;color:#101010;font:16px/1.55 Arial,sans-serif"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" style="max-width:520px;background:white;border-top:5px solid #ffd23f;border-radius:8px"><tr><td style="padding:34px"><b>MzHost</b><h1 style="font-size:34px;line-height:1.1;margin:34px 0 12px">Verify your email<span style="color:#a17a00">.</span></h1><p>Confirm this address and choose your password to open your hosting workspace.</p><p style="margin:26px 0"><a href="${link}" style="display:inline-block;padding:12px 20px;background:#ffd23f;color:black;border-radius:5px;text-decoration:none;font-weight:bold">Verify email</a></p><p style="font-size:14px">This link expires in 30 minutes. If you did not request it, you can ignore this email.</p></td></tr></table></td></tr></table></body></html>`;
  if(settings.local) {
    const folder=path.resolve(__dirname,"../../.local-data");
    await fs.mkdir(folder,{recursive:true});
    await fs.writeFile(path.join(folder,"latest-verification.html"),html,{mode:0o600});
    return "email.local_preview";
  }
  const response=await fetch("https://api.resend.com/emails",{method:"POST",redirect:"error",signal:AbortSignal.timeout(6000),
    headers:{Authorization:"Bearer "+process.env.RESEND_API_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({from:process.env.MAIL_FROM,to:[email],subject,text,html})});
  if(!response.ok) throw Error("Mail provider unavailable");
  return "email.accepted";
}
module.exports={record,mailSettings,sendVerification};
