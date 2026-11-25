const mongoAccounts=require("../src/server/mongo-accounts.cjs");

module.exports=async function handler(req,res) {
  let action;
  try {
    const url=new URL(req.url,"https://localhost");
    action=req.query?.action || url.searchParams.get("action") || url.pathname.split("/").pop();
    if(!["session","login","register","verify","logout","workspace","runtime",...require("../src/server/service.cjs").actions].includes(action)) return res.status(404).end();
    const handle=await mongoAccounts();
    await handle(action,req,res);
  } catch(error) {
    if(action==="status" && req.method==="GET") {
      res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
      return res.end(JSON.stringify({website:"online",database:"offline",worker:"unknown",updatedAt:new Date()}));
    }
    const status=error.status===400 || error.status===413 ? error.status : 503;
    if(status===503) await require("../src/server/notifications.cjs").record("operations","api.unavailable");
    res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});
    res.end(JSON.stringify({message:status===503?"The preview database is unavailable. Try again shortly.":error.message}));
  }
};
