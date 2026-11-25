const {randomUUID,createHmac,timingSafeEqual}=require("node:crypto");
const plans=require("../public/plans.js");
const month=30*86400000;
const sandboxAmount=100;
function currentPlan(user,now=Date.now()) {
  if(!user || !Object.hasOwn(plans,user.plan)) return null;
  return user.plan==="Free" || user.planExpires>new Date(now)?user.plan:null;
}
function canonical(value) {
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value==="object") return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
function validSignature(body,sig,secret) {
  if(!secret || typeof sig!=="string" || !/^[a-f0-9]{128}$/i.test(sig)) return false;
  const mac=createHmac("sha512",secret).update(JSON.stringify(canonical(body))).digest();
  return timingSafeEqual(mac,Buffer.from(sig,"hex"));
}
function settings() {
  const sandbox=process.env.NOWPAYMENTS_SANDBOX?.trim().toLowerCase()==="true";
  return {sandbox,api:sandbox?"https://api-sandbox.nowpayments.io/v1":"https://api.nowpayments.io/v1",
    origin:process.env.APP_ORIGIN,ready:Boolean(process.env.NOWPAYMENTS_API_KEY && process.env.NOWPAYMENTS_IPN_SECRET && /^https:\/\//.test(process.env.APP_ORIGIN||""))};
}
async function billing({db,email,user,req,send,body,allow}) {
  const orders=db.collection("hosting_orders");
  const {ready,origin,api,sandbox}=settings();
  if(req.method==="GET") {
    const history=await orders.find({owner:email},{projection:{_id:0,plan:1,status:1,amount:1,created:1,sandbox:1,providerAmount:1}}).sort({created:-1}).limit(20).toArray();
    return send(200,{email,plans,plan:currentPlan(user),expires:user.planExpires||null,orders:history,paymentsReady:ready,sandbox,sandboxAmount});
  }
  if(typeof body?.plan!=="string" || !Object.hasOwn(plans,body.plan)) return send(400,{message:"Choose an available plan."});
  const plan=body.plan,active=currentPlan(user);
  if(active && active!=="Free" && plan!==active) return send(409,{message:"Your current paid plan is active until its expiry date."});
  if(plan==="Free") {
    const changed=await db.collection("users").updateOne({_id:email,$or:[{plan:null},{plan:"Free"},{planExpires:{$lte:new Date()}}]},{$set:{plan,planExpires:null}});
    return changed.matchedCount?send(200,{ok:true}):send(409,{message:"Refresh your plan details."});
  }
  if(!ready) return send(503,{message:"Paid checkout is awaiting merchant setup."});
  if(!sandbox && !await db.collection("vps_test_worker").findOne({planProtocol:1,seen:{$gte:new Date(Date.now()-90000)}},{projection:{_id:1}})) return send(503,{message:"The hosting worker is offline. Try checkout when hosting is available."});
  if(!await allow("checkout:"+email,Date.now(),5,60000)) return send(429,{message:"Try checkout again in a minute."});
  const existing=await orders.findOne({owner:email,plan,sandbox,status:"waiting",...(sandbox?{paymentId:{$type:"string"}}:{url:{$type:"string"}}),created:{$gt:new Date(Date.now()-900000)}});
  if(existing) return send(200,sandbox?{sandboxPayment:true}:{url:existing.url});
  const order={_id:randomUUID(),owner:email,plan,sandbox,amount:plans[plan].price,created:new Date(),status:"creating"};
  if(sandbox) order.providerAmount=sandboxAmount;
  await orders.insertOne(order);
  let failure="NOWPayments could not be reached. Please try again shortly.";
  try {
    const payload={price_amount:order.providerAmount ?? order.amount,price_currency:"usd",order_id:order._id,order_description:"MzHost "+plan+" / 30 days",ipn_callback_url:origin+"/api/payments-ipn"};
    Object.assign(payload,sandbox?{pay_currency:"btc",case:"success"}:{success_url:origin+"/billing",cancel_url:origin+"/billing"});
    const result=await fetch(api+(sandbox?"/payment":"/invoice"),{method:"POST",redirect:"error",signal:AbortSignal.timeout(8000),
      headers:{"Content-Type":"application/json","x-api-key":process.env.NOWPAYMENTS_API_KEY.trim()},body:JSON.stringify(payload)});
    let invoice;
    try { invoice=await result.json() || {}; } catch { invoice={}; }
    if(!result.ok) {
      const code=String(invoice.code||"");
      const detail=code+" "+String(invoice.message||"");
      if([401,403].includes(result.status) || /api.?key|unauthori/i.test(detail)) failure=sandbox?"NOWPayments rejected the sandbox API key. Use the key from the sandbox merchant account.":"NOWPayments rejected the merchant API key.";
      else if(/minimum|too.?small|less.than|below|minimal/i.test(detail)) failure="NOWPayments declined this amount because it is below the payment minimum.";
      else if(/wallet|currency|currencies/i.test(detail)) failure="Check the merchant payout wallet and enabled currencies in NOWPayments.";
      else if(result.status!==429 && result.status<500) failure="NOWPayments declined checkout (HTTP "+result.status+( /^[A-Z_0-9]{2,48}$/.test(code)?" / "+code:"")+"). Check the merchant configuration.";
      throw Error();
    }
    failure="NOWPayments returned an incomplete or unrecognized checkout response.";
    if(sandbox) {
      const id=String(invoice.payment_id||"");
      if(!/^\d{1,32}$/.test(id)) throw Error();
      await orders.updateOne({_id:order._id,status:"creating"},{$set:{paymentId:id,status:"waiting"}});
      return send(200,{sandboxPayment:true});
    }
    const url=new URL(invoice.invoice_url);
    if(!invoice.id || url.protocol!=="https:" || !/^(?:[a-z0-9-]+\.)*nowpayments\.io$/.test(url.hostname) || url.username || url.password) throw Error();
    await orders.updateOne({_id:order._id,status:"creating"},{$set:{invoiceId:String(invoice.id),url:url.href,status:"waiting"}});
    return send(200,{url:url.href});
  } catch {
    await orders.updateOne({_id:order._id,status:"creating"},{$set:{status:"checkout_failed"}});
    return send(502,{message:failure});
  }
}
async function ipn({db,client,req,body,send}) {
  if(!validSignature(body,req.headers["x-nowpayments-sig"],process.env.NOWPAYMENTS_IPN_SECRET)) return send(403,{});
  if(typeof body?.order_id!=="string") return send(400,{});
  const orders=db.collection("hosting_orders"),order=await orders.findOne({_id:body.order_id});
  if(!order || order.sandbox!==settings().sandbox || String(body.price_currency).toLowerCase()!=="usd" || Number(body.price_amount)!==(order.providerAmount ?? order.amount)) return send(409,{});
  const matches=order.sandbox && order.paymentId ? String(body.payment_id)===order.paymentId :
    order.invoiceId && String(body.invoice_id)===order.invoiceId;
  if(!matches) return send(409,{});
  if(body.payment_status!=="finished" || !(Number.isFinite(Number(body.pay_amount)) && Number.isFinite(Number(body.actually_paid)) && Number(body.pay_amount)>0 && Number(body.actually_paid)>=Number(body.pay_amount))) {
    if(["failed","expired","partially_paid","confirming","confirmed","sending","waiting"].includes(body.payment_status))
      await orders.updateOne({_id:order._id,paidAt:null},{$set:{status:body.payment_status}});
    return send(200,{});
  }
  await client.withSession(session=>session.withTransaction(async()=>{
    const settled=await orders.updateOne({_id:order._id,paidAt:null},{$set:{status:order.sandbox?"sandbox_paid":"paid",paidAt:new Date()}},{session});
    if(!settled.modifiedCount) return;
    if(order.sandbox) return;
    const users=db.collection("users"),user=await users.findOne({_id:order.owner},{session});
    if(!user) throw Error("Order account missing");
    const now=Date.now(), remaining=Math.max(0,(user.planExpires?.getTime()||0)-now);
    const credit=currentPlan(user) && plans[user.plan].price?remaining*plans[user.plan].price/order.amount:0;
    await users.updateOne({_id:order.owner},{$set:{plan:order.plan,planExpires:new Date(now+month+credit)}},{session});
  }));
  return send(200,{});
}
module.exports={billing,ipn,currentPlan,validSignature,plans};
