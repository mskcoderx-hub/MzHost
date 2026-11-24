const {MongoClient}=require("mongodb");
const {accounts}=require("./accounts.cjs");
const connections=new Map();

async function connect(secure) {
  const client=new MongoClient(process.env.MONGODB_URI,{maxPoolSize:5,serverSelectionTimeoutMS:6000});
  try {
    await client.connect();
    const db=client.db(process.env.MONGODB_DB || "mzhost_preview");
    const users=db.collection("users"), sessions=db.collection("sessions");
    const workspaces=db.collection("workspaces"), limits=db.collection("auth_attempts");
    const pending=db.collection("email_verifications");
    const audit=db.collection("audit_events");
    const tests=db.collection("vps_test_worker");
    await Promise.all([sessions,limits,pending,audit].map(collection=>collection.createIndex({expires:1},{expireAfterSeconds:0})));
    await pending.createIndex({digest:1},{unique:true});
    return accounts({
      runtime:{
        get:()=>tests.findOne({_id:"primary"},{projection:{project:0}}),
        async poll(report,now) {
          await tests.updateOne({_id:"primary"},{$set:{seen:new Date(now)},$setOnInsert:{desired:"stop",generation:null,state:"idle"}},{upsert:true});
          if(report.generation===null || (typeof report.generation==="string" && report.generation.length===36)) {
            await tests.updateOne({_id:"primary",generation:report.generation},{$set:{state:report.state,logs:report.logs}});
          }
          return tests.findOne({_id:"primary"});
        },
        command(serverId,desired,project,generation) {
          const filter={_id:"primary",serverId};
          if(desired==="run") {
            delete filter.serverId;
            filter.seen={$gte:new Date(Date.now()-90000)};
            filter.$or=[{serverId},{desired:"stop",state:{$in:["stopped","idle"]}},{state:{$in:["exited","failed"]}}];
          }
          return tests.findOneAndUpdate(filter,{$set:{serverId,desired,project,generation,state:"queued",logs:""}},{returnDocument:"after",projection:{project:0}});
        }
      },
      audit:item=>audit.insertOne({...item,expires:new Date(Date.now()+30*86400000)}),
      user:email=>users.findOne({_id:email}),
      session:(token,now)=>sessions.findOne({_id:token,expires:{$gt:new Date(now)}}),
      logout:token=>sessions.deleteOne({_id:token}),
      async allowAttempt(key,now,max=12,period=60000) {
        const bucket=Math.floor(now/period);
        const record=await limits.findOneAndUpdate({_id:key+"-"+bucket},{$inc:{count:1},$setOnInsert:{expires:new Date((bucket+2)*period)}},{upsert:true,returnDocument:"after"});
        return record.count<=max;
      },
      async issue(email,digest,now) {
        try {
          await pending.updateOne({_id:email,sent:{$lte:now-60000}},{$set:{digest,sent:now,expires:new Date(now+1800000)}},{upsert:true});
          return true;
        } catch(error) {if(error.code===11000) return false;throw error;}
      },
      async confirm(digest,salt,hash,now) {
        return client.withSession(session=>session.withTransaction(async ()=>{
          const ticket=await pending.findOneAndDelete({digest,expires:{$gt:new Date(now)}},{session});
          if(!ticket) return null;
          const email=ticket._id;
          const old=await users.findOne({_id:email},{session});
          if(old?.verifiedAt) return null;
          await users.updateOne({_id:email},{$set:{salt,hash,verifiedAt:new Date(now)}},{upsert:true,session});
          await sessions.deleteMany({email},{session});
          return {email,created:!old};
        }));
      },
      async authenticate({email,oldToken,token,expires}) {
        await client.withSession(session=>session.withTransaction(async ()=>{
          if(oldToken) await sessions.deleteOne({_id:oldToken},{session});
          await sessions.insertOne({_id:token,email,expires:new Date(expires)},{session});
        }));
      },
      async workspace(email) {
        return await workspaces.findOne({_id:email},{projection:{_id:0}}) || {revision:0,workspace:{servers:[],selected:""}};
      },
      async save(email,revision,workspace) {
        try {
          const previous=await workspaces.findOneAndUpdate({_id:email,revision},{$set:{workspace},$inc:{revision:1}},
            {upsert:revision===0,returnDocument:"before",projection:{"workspace.servers.id":1}});
          if(!previous && revision!==0) return false;
          const before=new Set((previous?.workspace?.servers || []).map(s=>s.id));
          const after=new Set(workspace.servers.map(s=>s.id));
          return {added:[...after].filter(id=>!before.has(id)).length,removed:[...before].filter(id=>!after.has(id)).length};
        } catch(error) {if(error.code===11000) return false;throw error;}
      }
    },{secure});
  } catch(error) {await client.close();throw error;}
}
module.exports=(secure=true)=>{
  if(!connections.has(secure)) connections.set(secure,connect(secure).catch(error=>{connections.delete(secure);throw error;}));
  return connections.get(secure);
};
