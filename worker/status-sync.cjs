// Run alongside MzBot to refresh its existing Discord status panel independently of the VPS worker.
const {setTimeout:delay}=require("node:timers/promises");

async function main() {
  const origin=new URL(process.env.APP_ORIGIN || "https://mzhost.vercel.app");
  if(origin.protocol!=="https:" || origin.username || origin.password || origin.href!==origin.origin+"/") {
    throw Error("APP_ORIGIN must be the HTTPS site origin.");
  }
  const secret=process.env.CRON_SECRET;
  if(!secret) throw Error("Set CRON_SECRET to the same value as the Vercel project.");
  const shutdown=new AbortController();
  process.once("SIGTERM",()=>shutdown.abort());
  process.once("SIGINT",()=>shutdown.abort());
  let previous="";
  while(!shutdown.signal.aborted) {
    let result;
    try {
      const response=await fetch(new URL("/api/sync-status",origin),{method:"GET",redirect:"error",
        headers:{Authorization:"Bearer "+secret},signal:AbortSignal.any([shutdown.signal,AbortSignal.timeout(20000)])});
      if(!response.ok) {
        result="Status update failed (HTTP "+response.status+").";
      } else {
        const {state}=await response.json();
        switch(state) {
          case "synced": result="Discord status panel updated.";break;
          case "unchanged": result="Discord status panel is current.";break;
          case "busy": result="Another monitor is updating the status panel.";break;
          case "unconfigured": result="Discord status panel needs its bot credentials on Vercel.";break;
          default: result="Status endpoint returned an unknown result.";
        }
      }
    } catch {
      if(shutdown.signal.aborted) break;
      result="Status endpoint unavailable or returned invalid JSON.";
    }
    if(result!==previous) {console.log(new Date().toISOString(),result);previous=result;}
    try {await delay(120000,undefined,{signal:shutdown.signal});}
    catch(error){if(!shutdown.signal.aborted) throw error;}
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
