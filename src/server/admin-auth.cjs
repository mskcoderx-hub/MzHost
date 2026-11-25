const {createHash,timingSafeEqual,scrypt}=require('node:crypto');
const derive=require('node:util').promisify(scrypt);
const equal=(a,b)=>timingSafeEqual(...[a,b].map(x=>createHash('sha256').update(x).digest()));
function credentials(local) {
  if(local) return {username:'1',check:async value=>equal(value,'1')};
  if(process.env.ADMIN_CREDENTIALS) {
    let entry;
    try {entry=JSON.parse(process.env.ADMIN_CREDENTIALS);} catch {return null;}
    if(typeof entry?.username!=='string' || !entry.username.trim() || !/^[a-f0-9]{32}\$[a-f0-9]{128}$/.test(entry.hash)) return null;
    const [salt,hex]=entry.hash.split('$');
    return {username:entry.username,check:async value=>timingSafeEqual(await derive(value,salt,64),Buffer.from(hex,'hex'))};
  }
  const username=process.env.ADMIN_USERNAME?.trim(),pass=process.env.ADMIN_PASSWORD;
  return username && pass?.length>=16 ? {username,check:async value=>equal(value,pass)} : null;
}
module.exports={credentials};
