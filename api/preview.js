const mongoAccounts=require("../src/server/mongo-accounts.cjs");

module.exports=async function handler(req,res) {
  try {
    const url=new URL(req.url,"https://localhost");
    const action=req.query?.action || url.searchParams.get("action") || url.pathname.split("/").pop();
    if(!["session","login","register","logout","workspace"].includes(action)) return res.status(404).end();
    const handle=await mongoAccounts();
    await handle(action,req,res);
  } catch(error) {
    const status=error.status===400 || error.status===413 ? error.status : 503;
    res.writeHead(status,{"Content-Type":"application/json","Cache-Control":"no-store"});
    res.end(JSON.stringify({message:status===503?"The preview database is unavailable. Try again shortly.":error.message}));
  }
};
