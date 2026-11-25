const {createHash,randomUUID}=require("node:crypto");

const reviewsChannel="1574753304016068759";
const statusChannel="1574573212975767684";
const panelTitle="### <:server:1574587451937390602> MzHost - Service Status";
const emoji={
  operational:"<:online:1574587471474335794>",
  offline:"<:offline:1574587469377179710>",
  degraded:"<:warning:1574587483293749389>",
  maintenance:"<:maintenance:1574587466462011535>",
  unknown:"<:pending:1574587474875777174>"
};
const minute=60000;
const snowflake=value=>typeof value==="string" && /^\d{17,20}$/.test(value);
const clientId=()=>process.env.DISCORD_CLIENT_ID?.trim();
const configured=()=>Boolean(process.env.DISCORD_BOT_TOKEN?.trim() && snowflake(clientId()));

async function discord(channel,suffix="",method="GET",payload) {
  const response=await fetch("https://discord.com/api/v10/channels/"+channel+"/messages"+suffix,{
    method,redirect:"error",signal:AbortSignal.timeout(4500),
    headers:{Authorization:"Bot "+process.env.DISCORD_BOT_TOKEN.trim(),"Content-Type":"application/json"},
    body:payload && JSON.stringify(payload)
  });
  if(!response.ok) throw Object.assign(Error("Discord returned HTTP "+response.status),{status:response.status});
  return response.json();
}

// MzBot posts one Components V2 text display, containing the ticket summary and optional feedback.
function displayText(message) {
  if(message.webhook_id || !message.author?.bot || message.author.id!==clientId()) return "";
  const display=message.components?.find(c=>c.type===17)?.components?.find(c=>c.type===10);
  return typeof display?.content==="string"?display.content:"";
}
function reviewFrom(message) {
  if(!snowflake(message.id) || (message.channel_id && message.channel_id!==reviewsChannel) ||
    message.webhook_id || !message.author?.bot || message.author.id!==clientId()) return;
  const embed=message.embeds?.find(e=>/MzHost\s*[-–—]\s*Support Feedback/i.test(e.title||""));
  const text=(displayText(message) || (embed && [embed.title,embed.description,
    ...(embed.fields||[]).map(f=>f.name.replace(/[:*]+$/,"")+": "+f.value)].filter(Boolean).join("\n")) || "").replace(/\r/g,"");
  const [header,...lines]=text.split("\n");
  if(!/\bMzHost\s*[-–—]\s*Support Feedback\s*$/i.test(header)) return;
  const start=lines.findIndex(line=>/^\s*\**Feedback\**:\**\s*/i.test(line));
  if(start<0) return;
  const fields=lines.slice(0,start).join("\n").replace(/\*\*/g,"");
  const rating=/^Rating:\s*([0-5])\s*\/\s*5\b/im.exec(fields);
  if(!rating || Number(rating[1])<4) return;
  const feedback=lines.slice(start).join("\n").replace(/^\s*\**Feedback\**:\**\s*/i,"").trim();
  // Private contact details and Discord mentions from a support conversation do not belong on the homepage.
  if(!feedback || /<[@#]|https?:\/\/|\S+@\S+\.\S+|\b(?:\d[ -]?){10,}\b/i.test(feedback)) return;
  const customer=/^Customer:\s*<@!?(\d+)>/im.exec(fields)?.[1];
  const member=message.mentions?.find(user=>user.id===customer);
  const result={id:message.id,name:member?.global_name || member?.username || "MzHost community member",stars:Number(rating[1]),text:feedback.replace(/\s+/g," ").slice(0,360)};
  if(snowflake(customer) && /^(a_)?[a-f0-9]{32}$/.test(member?.avatar||""))
    result.avatar="https://cdn.discordapp.com/avatars/"+customer+"/"+member.avatar+".png?size=96";
  const photo=message.attachments?.find(file=>/^image\/(?:jpeg|png|webp)$/.test(file.content_type) &&
    typeof file.url==="string" && file.url.startsWith("https://cdn.discordapp.com/attachments/"+reviewsChannel+"/"));
  if(photo) result.image=photo.url;
  return result;
}

async function lock(collection,id,freshBefore) {
  const now=new Date(),lease=randomUUID();
  const criteria={_id:id,$or:[{until:{$exists:false}},{until:{$lte:now}}]};
  if(freshBefore) criteria.$and=[{$or:[{updated:{$exists:false}},{updated:{$lt:freshBefore}}]}];
  try {
    return await collection.findOneAndUpdate(criteria,{$set:{lease,until:new Date(+now+45000)}},{upsert:true,returnDocument:"after"});
  } catch(error) {if(error.code===11000) return null;throw error;}
}
function priorReviews(doc) {
  return doc?.updated && +doc.updated>Date.now()-24*60*minute ? doc.items || [] : [];
}
async function reviews(db) {
  if(!configured()) throw Error("Discord reviews need bot credentials.");
  const collection=db.collection("community_cache");
  const cached=await collection.findOne({_id:"reviews"});
  if(cached?.updated && +cached.updated>Date.now()-5*minute) return cached.items || [];
  const claim=await lock(collection,"reviews",new Date(Date.now()-5*minute));
  if(!claim) {
    if(cached?.updated) return priorReviews(cached);
    throw Error("Review refresh in progress.");
  }
  const owned={_id:"reviews",lease:claim.lease};
  try {
    const items=[];
    let before="";
    for(let page=0;page<3 && items.length<6;page++) {
      const messages=await discord(reviewsChannel,"?limit=100"+before);
      items.push(...messages.map(reviewFrom).filter(Boolean).slice(0,6-items.length));
      if(messages.length<100 || !snowflake(messages.at(-1)?.id)) break;
      before="&before="+messages.at(-1).id;
    }
    await collection.updateOne(owned,{$set:{items,updated:new Date()},$unset:{lease:"",until:""}});
    return items;
  } catch(error) {
    // Keep the short lease as a retry delay when Discord is unavailable.
    const previous=priorReviews(claim);
    console.warn("Discord reviews unavailable",error.status || "connection");
    if(previous.length) return previous;
    const reasons={401:"Discord rejected DISCORD_BOT_TOKEN.",403:"Give MzBot View Channel and Read Message History in the ratings channel.",404:"MzBot cannot find the ratings channel.",429:"Discord rate-limited the ratings feed. Retry shortly."};
    throw Error(reasons[error.status] || "Discord reviews are unavailable.");
  }
}

function statusPanel(status) {
  const origin=new URL(process.env.APP_ORIGIN);
  if(origin.protocol!=="https:" || origin.username || origin.password || origin.href!==origin.origin+"/") throw Error("Set APP_ORIGIN to the HTTPS site origin.");
  const lines=status.services.slice(0,10).map(service=>{
    const key=String(service.status).toLowerCase();
    const state=Object.hasOwn(emoji,key)?key:"unknown";
    const name=String(service.name).replace(/[^a-zA-Z0-9 .()-]/g,"").slice(0,60);
    return emoji[state]+" **"+name+"** — "+state;
  });
  return {flags:32768,allowed_mentions:{parse:[]},components:[{type:17,accent_color:0xffd23f,components:[
    {type:10,content:panelTitle+"\n\n"+lines.join("\n")},
    {type:1,components:[{type:2,style:5,label:"View status",url:origin.origin+"/status"}]}
  ]}]};
}
async function syncStatus(db,status) {
  if(!configured()) return {state:"unconfigured"};
  const collection=db.collection("community_cache"),payload=statusPanel(status);
  const digest=createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const claim=await lock(collection,"status");
  if(!claim) return {state:"busy"};
  const owned={_id:"status",lease:claim.lease};
  try {
    let messageId=claim.messageId;
    if(snowflake(messageId) && claim.digest===digest) {
      if(+claim.updated>Date.now()-10*minute) return {state:"unchanged"};
      try {await discord(statusChannel,"/"+messageId);} catch(error) {if(error.status!==404) throw error;messageId=null;}
      if(messageId) {
        await collection.updateOne(owned,{$set:{updated:new Date()}});
        return {state:"unchanged"};
      }
    }
    if(!snowflake(messageId)) {
      const recent=await discord(statusChannel,"?limit=100");
      messageId=recent.find(m=>displayText(m).startsWith(panelTitle+"\n"))?.id;
    }
    if(snowflake(messageId)) {
      try {await discord(statusChannel,"/"+messageId,"PATCH",payload);}
      catch(error) {if(error.status!==404) throw error;messageId=null;}
    }
    if(!snowflake(messageId)) {
      const result=await discord(statusChannel,"","POST",{...payload,nonce:"mzhost-service-status",enforce_nonce:true});
      if(!snowflake(result.id)) throw Error("Discord did not return a status message ID.");
      messageId=result.id;
    }
    await collection.updateOne(owned,{$set:{messageId,digest,updated:new Date()}});
    return {state:"synced"};
  } finally {await collection.updateOne(owned,{$unset:{lease:"",until:""}});}
}
module.exports={reviews,syncStatus};
