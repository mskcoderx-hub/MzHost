const test=require("node:test");
const assert=require("node:assert/strict");
const {createHmac}=require("node:crypto");
const {billing,ipn,currentPlan}=require("../src/server/billing.cjs");

test("checkout uses the server price and only a matched signed settlement grants one paid term",async t=>{
  Object.assign(process.env,{APP_ORIGIN:"https://site.example",NOWPAYMENTS_API_KEY:"test",NOWPAYMENTS_IPN_SECRET:"test-signature-key",NOWPAYMENTS_SANDBOX:"false"});
  const user={_id:"a@example.test"}, collection={};
  let order,grants=0;
  collection.hosting_orders={
    findOne:async filter=>filter._id===order?._id?order:null,
    insertOne:async value=>{order={...value};},
    updateOne:async (filter,update)=>{
      if((filter.status && filter.status!==order.status) || (filter.paidAt===null && order.paidAt)) return {modifiedCount:0};
      Object.assign(order,update.$set);return {modifiedCount:1};
    }
  };
  collection.vps_test_worker={findOne:()=>({_id:"primary"})};
  collection.users={findOne:()=>user,updateOne:(_,update)=>{grants++;Object.assign(user,update.$set);}};
  const db={collection:name=>collection[name]},client={withSession:fn=>fn({withTransaction:fn=>fn()})};
  t.mock.method(global,"fetch",async(url,opts)=>{
    assert.equal(JSON.parse(opts.body).price_amount,1.5);
    assert.equal(JSON.parse(opts.body).ipn_callback_url,"https://site.example/api/payments-ipn");
    return {ok:true,json:()=>({id:"invoice",invoice_url:"https://nowpayments.io/payment/test"})};
  });
  const send=(code,data)=>({code,data});
  const result=await billing({db,user,email:user._id,req:{method:"POST"},send,allow:()=>true,body:{plan:"Starter",price:0}});
  assert.equal(result.code,200);assert.equal(currentPlan(user),null);
  const body={actually_paid:2,invoice_id:"invoice",order_id:order._id,pay_amount:2,payment_status:"finished",price_amount:1.5,price_currency:"usd"};
  const call=(data,valid=true)=>ipn({db,client,body:data,req:{headers:{"x-nowpayments-sig":valid?createHmac("sha512",process.env.NOWPAYMENTS_IPN_SECRET).update(JSON.stringify(data,Object.keys(data).sort())).digest("hex"):"bad"}},send});
  assert.equal((await call(body,false)).code,403);
  assert.equal((await call({...body,invoice_id:"unrelated"})).code,409);
  await call({...body,actually_paid:1});assert.equal(grants,0);
  await call(body);await call(body);assert.equal(grants,1);assert.equal(currentPlan(user),"Starter");
  assert.equal(currentPlan(user,user.planExpires.getTime()+1),null);
  process.env.NOWPAYMENTS_SANDBOX="true";order.sandbox=true;delete order.paidAt;
  await call(body);assert.equal(grants,1);assert.equal(order.status,"sandbox_paid");
});
