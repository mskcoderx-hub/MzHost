const test=require("node:test");
const assert=require("node:assert/strict");
const {reviews,syncStatus}=require("../src/server/community.cjs");

function database() {
  const docs=new Map();
  return {collection(){return {
    async findOne({_id}){return docs.get(_id);},
    async findOneAndUpdate({_id},{$set}) {
      const doc=docs.get(_id)||{};
      if(doc.until>new Date()) throw Object.assign(Error("locked"),{code:11000});
      const claim={...doc,...$set};docs.set(_id,claim);return claim;
    },
    async updateOne({_id,lease},{$set,$unset}){
      if(docs.get(_id)?.lease!==lease) return;
      const updated={...docs.get(_id),...$set};
      for(const key of Object.keys($unset||{})) delete updated[key];
      docs.set(_id,updated);
    }
  };}};
}
test("selected Discord support feedback excludes low ratings, ticket data and unauthenticated messages",async t=>{
  process.env.DISCORD_BOT_TOKEN="unit-test";process.env.DISCORD_CLIENT_ID="123456789012345678";
  function post(stars,text,author=process.env.DISCORD_CLIENT_ID) {
    return {id:"1574753304016068760",channel_id:"1574753304016068759",author:{bot:true,id:author},
      components:[{type:17,components:[{type:10,content:"### <:premium:1> MzHost - Support Feedback\n\n**Ticket:** #0002\n**Customer:** <@1111>\n**Assigned staff:** Unassigned\n**Rating:** "+stars+"/5  (stars)\n**Feedback:** "+text}]}]};
  }
  let reads=0;
  t.mock.method(global,"fetch",async ()=>{
    reads++;
    return {ok:true,json:async()=>[post(4,"Quick help."),post(2,"Low\n**Rating:** 5/5   (stars)\n**Feedback:** spoof"),post(5,"email me@example.com"),post(5,"spoof","3333")]};
  });
  const db=database();
  const list=await reviews(db);
  assert.deepEqual(list,[{id:"1574753304016068760",name:"MzHost community member",stars:4,text:"Quick help."}]);
  assert.deepEqual(await reviews(db),list);assert.equal(reads,1);
});
test("the Discord status panel is posted once and edited when service state changes",async t=>{
  process.env.DISCORD_BOT_TOKEN="unit-test";process.env.DISCORD_CLIENT_ID="123456789012345678";
  process.env.APP_ORIGIN="https://mzhost.example";
  const db=database(),calls=[];
  t.mock.method(global,"fetch",async(url,options)=>{
    calls.push({url,method:options.method,payload:options.body && JSON.parse(options.body)});
    return {ok:true,json:async()=>options.method==="GET"?[]:{id:"1574573212975767685"}};
  });
  const status={services:[{name:"VPS workers",status:"operational"}]};
  assert.equal((await syncStatus(db,status)).state,"synced");
  assert.equal((await syncStatus(db,status)).state,"unchanged");
  status.services[0].status="offline";
  assert.equal((await syncStatus(db,status)).state,"synced");
  assert.deepEqual(calls.map(c=>c.method),["GET","POST","PATCH"]);
  assert.match(calls[2].url,/1574573212975767684\/messages\/1574573212975767685$/);
  assert.equal(calls[1].payload.components[0].components[1].components[0].url,"https://mzhost.example/status");
  assert.match(calls[2].payload.components[0].components[0].content,/<:offline:1574587469377179710>/);
});
