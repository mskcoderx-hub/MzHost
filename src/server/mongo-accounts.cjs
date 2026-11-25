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
    await Promise.all([sessions,limits,pending,audit,db.collection("admin_sessions"),db.collection("oauth_states")].map(collection=>collection.createIndex({expires:1},{expireAfterSeconds:0})));
    await users.createIndex({githubId:1},{unique:true,partialFilterExpression:{githubId:{$type:"number"}}});
    await db.collection("github_links").createIndex({repoId:1,installation:1,branch:1,auto:1});
    await users.createIndex({discordId:1},{unique:true,partialFilterExpression:{discordId:{$type:"string"}}});
    await db.collection("hosting_orders").createIndex({owner:1,created:-1});
    await pending.createIndex({digest:1},{unique:true});
    await tests.createIndex({owner:1},{unique:true,partialFilterExpression:{owner:{$type:"string"}}});
    // Preserve the ownership of an existing private trial during the upgrade.
    const legacyOwner=process.env.VPS_TEST_EMAIL?.trim().toLowerCase();
    if(legacyOwner) await tests.updateOne({_id:"primary",owner:{$exists:false},serverId:{$type:"string"}},{$set:{owner:legacyOwner}});
    const freeStates=["idle","stopped","exited","failed"];
    const publicStatus={project:0,"input.line":0};
    return accounts({
      db,client,
      runtime:{
        async get(owner) {
          const live={planProtocol:1,seen:{$gte:new Date(Date.now()-90000)}};
          const [owned,online,available]=await Promise.all([
            tests.findOne({owner},{projection:publicStatus}),
            tests.findOne(live,{projection:{_id:1}}),
            tests.findOne({...live,state:{$in:freeStates}},{projection:{_id:1}})
          ]);
          return {owned,online:Boolean(online),available:Boolean(available)};
        },
        async poll(report,now) {
          const slot=report.slot?"slot-"+report.slot:"primary";
          const instance=typeof report.instance==="string" && /^[0-9a-f]{32}$/.test(report.instance)?report.instance:null;
          await tests.updateOne({_id:slot},{$set:{seen:new Date(now),workerInstance:instance,planProtocol:report.planProtocol===1?1:0},$setOnInsert:{desired:"stop",generation:null,state:"idle"}},{upsert:true});
          if(report.generation===null) {
            await tests.updateOne({_id:slot,desired:"run",state:{$in:["exited","failed"]}},{$set:{desired:"stop",project:null},$unset:{input:""}});
          }
          const expiring=await tests.findOne({_id:slot,desired:"run","project.expires":{$type:"number",$lte:now}},{projection:{owner:1,generation:1,"project.plan":1}});
          if(expiring?.owner) {
            const renewed=await users.findOne({_id:expiring.owner,plan:expiring.project.plan,planExpires:{$gt:new Date(now)}},{projection:{planExpires:1}});
            if(renewed) await tests.updateOne({_id:slot,generation:expiring.generation},{$set:{"project.expires":renewed.planExpires.getTime()}});
          }
          // Retire private trial jobs and expired paid leases, including on worker reconnect.
          await tests.updateOne({_id:slot,desired:"run",$or:[{"project.plan":null},{"project.expires":{$type:"number",$lte:now}},{planProtocol:0}]},
            {$set:{desired:"stop",generation:require("node:crypto").randomUUID(),state:"queued",project:null},$unset:{input:""}});
          await tests.updateOne({_id:slot,input:{$ne:null},"input.instance":{$ne:instance}},{$unset:{input:""},$set:{inputFailed:true}});
          if(report.generation===null || (typeof report.generation==="string" && report.generation.length===36)) {
            const run={_id:slot,generation:report.generation};
            // A stop can overtake a launch. Only accept logs from the issued run generation.
            await tests.updateOne(run,[{$set:{state:{$literal:report.state},logs:{$cond:[{$eq:["$desired","run"]},{$literal:report.logs},"$logs"]}}}]);
            const pending={...run,"input.instance":instance};
            if(typeof report.inputAck==="string") {
              await tests.updateOne({...pending,"input.id":report.inputAck},{$unset:{input:""},$set:{inputFailed:report.inputFailed===true}});
            }
            if(report.state!=="running") await tests.updateOne({...pending,input:{$ne:null}},{$unset:{input:""},$set:{inputFailed:true}});
          }
          return tests.findOne({_id:slot});
        },
        input(owner,serverId,generation,line,id) {
          const filter={owner,serverId,generation,state:"running",desired:"run",input:null,workerInstance:{$type:"string"},seen:{$gte:new Date(Date.now()-90000)}};
          return tests.findOneAndUpdate(filter,[{$set:{input:{id:{$literal:id},line:{$literal:line},instance:"$workerInstance"},inputFailed:false}}],{returnDocument:"after",projection:publicStatus});
        },
        async command(owner,serverId,desired,project,generation) {
          const options={returnDocument:"after",projection:publicStatus};
          const values={owner,serverId,desired,project,generation,state:"queued",inputFailed:false};
          const update={$set:values,$unset:{input:""}};
          if(desired==="stop") return tests.findOneAndUpdate({owner,serverId,desired:"run"},update,options);
          values.logs="";
          const free={planProtocol:1,state:{$in:freeStates},seen:{$gte:new Date(Date.now()-90000)}};
          const previous=await tests.findOneAndUpdate({...free,owner},update,options);
          if(previous) return previous;
          try {
            return await tests.findOneAndUpdate(free,update,options);
          } catch(error) {
            // Concurrent requests from one account cannot reserve a second slot.
            if(error.code===11000) return null;
            throw error;
          }
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
      async workspaceRevision(email) {
        return (await workspaces.findOne({_id:email},{projection:{revision:1}}))?.revision || 0;
      },
      async save(email,revision,workspace) {
        try {
          return await client.withSession(session=>session.withTransaction(async()=>{
            const previous=await workspaces.findOneAndUpdate({_id:email,revision},{$set:{workspace},$inc:{revision:1}},
              {session,upsert:revision===0,returnDocument:"before",projection:{"workspace.servers.id":1,"workspace.servers.name":1}});
            if(!previous && revision!==0) return false;
            const before=previous?.workspace?.servers || [];
            const after=workspace.servers;
            const changed=(from,to)=>from.filter(s=>!to.some(other=>other.id===s.id));
            const removed=changed(before,after);
            if(removed.length) await db.collection("github_links").deleteMany({owner:email,serverId:{$in:removed.map(s=>s.id)}},{session});
            if(removed.length) await tests.updateOne({owner:email,serverId:{$in:removed.map(s=>s.id)},desired:"run"},{
              $set:{desired:"stop",state:"queued",generation:require("node:crypto").randomUUID(),project:null},$unset:{input:""}
            },{session});
            return {added:changed(after,before).map(s=>s.name),removed:removed.map(s=>s.name)};
          }));
        } catch(error) {if(error.code===11000) return false;throw error;}
      }
    },{secure});
  } catch(error) {await client.close();throw error;}
}
module.exports=(secure=true)=>{
  if(!connections.has(secure)) connections.set(secure,connect(secure).catch(error=>{connections.delete(secure);throw error;}));
  return connections.get(secure);
};
