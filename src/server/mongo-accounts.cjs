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
    await Promise.all([sessions,limits].map(collection=>collection.createIndex({expires:1},{expireAfterSeconds:0})));
    return accounts({
      user:email=>users.findOne({_id:email}),
      session:(token,now)=>sessions.findOne({_id:token,expires:{$gt:new Date(now)}}),
      logout:token=>sessions.deleteOne({_id:token}),
      async allowAttempt(ip,now) {
        const bucket=Math.floor(now/60000);
        const record=await limits.findOneAndUpdate({_id:ip+"-"+bucket},{$inc:{count:1},$setOnInsert:{expires:new Date((bucket+2)*60000)}},{upsert:true,returnDocument:"after"});
        return record.count<=12;
      },
      async authenticate({register,email,salt,hash,oldToken,token,expires}) {
        try {
          await client.withSession(session=>session.withTransaction(async ()=>{
            if(register) await users.insertOne({_id:email,salt,hash},{session});
            if(oldToken) await sessions.deleteOne({_id:oldToken},{session});
            await sessions.insertOne({_id:token,email,expires:new Date(expires)},{session});
          }));
          return true;
        } catch(error) {if(register && error.code===11000) return false;throw error;}
      },
      async workspace(email) {
        return await workspaces.findOne({_id:email},{projection:{_id:0}}) || {revision:0,workspace:{servers:[],selected:""}};
      },
      async save(email,revision,workspace) {
        try {
          const result=await workspaces.updateOne({_id:email,revision},{$set:{workspace},$inc:{revision:1}},{upsert:revision===0});
          return Boolean(result.modifiedCount || result.upsertedCount);
        } catch(error) {if(error.code===11000) return false;throw error;}
      }
    },{secure});
  } catch(error) {await client.close();throw error;}
}
module.exports=(secure=true)=>{
  if(!connections.has(secure)) connections.set(secure,connect(secure).catch(error=>{connections.delete(secure);throw error;}));
  return connections.get(secure);
};
