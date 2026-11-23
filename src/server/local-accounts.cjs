const {DatabaseSync}=require("node:sqlite");
const {randomBytes,scryptSync}=require("node:crypto");
const {accounts,hashOptions}=require("./accounts.cjs");
module.exports=function localAccounts(databaseFile,{localTest=false}={}) {
  const db = new DatabaseSync(databaseFile);
  db.exec(`CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL);`);
  if(!db.prepare("PRAGMA table_info(users)").all().some(col=>col.name==="verifiedAt")) db.exec("ALTER TABLE users ADD COLUMN verifiedAt INTEGER");
  db.exec("CREATE TABLE IF NOT EXISTS email_verifications(email TEXT PRIMARY KEY, digest TEXT UNIQUE, sent INTEGER, expires INTEGER)");
  if (localTest && !db.prepare("SELECT 1 FROM users WHERE email='1'").get()) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync("1", salt, 32, hashOptions);
    db.prepare("INSERT OR IGNORE INTO users(email,salt,hash) VALUES (?,?,?)").run("1",salt,hash.toString("hex"));
  }
  const limits=new Map();
  return accounts({
    session:(token,now)=>db.prepare("SELECT email FROM sessions WHERE token=? AND expires>?").get(token,now),
    user:email=>db.prepare("SELECT salt,hash,verifiedAt FROM users WHERE email=?").get(email),
    logout:token=>db.prepare("DELETE FROM sessions WHERE token=?").run(token),
    allowAttempt(key,now,max=12,period=60000) {
      for(const [k,v] of limits) if(v.until<=now) limits.delete(k);
      const limit=limits.get(key) || {until:now+period,count:0};
      limits.set(key,limit);return ++limit.count<=max;
    },
    issue(email,digest,now) {
      db.prepare("DELETE FROM email_verifications WHERE expires<=?").run(now);
      return Boolean(db.prepare("INSERT INTO email_verifications VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET digest=excluded.digest,sent=excluded.sent,expires=excluded.expires WHERE sent<=?").run(email,digest,now,now+1800000,now-60000).changes);
    },
    confirm(digest,salt,hash,now) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const ticket=db.prepare("DELETE FROM email_verifications WHERE digest=? AND expires>? RETURNING email").get(digest,now);
        let result=null;
        if(ticket) {
          const old=db.prepare("SELECT verifiedAt FROM users WHERE email=?").get(ticket.email);
          if(!old?.verifiedAt) {
            db.prepare("INSERT INTO users(email,salt,hash,verifiedAt) VALUES (?,?,?,?) ON CONFLICT(email) DO UPDATE SET salt=excluded.salt,hash=excluded.hash,verifiedAt=excluded.verifiedAt").run(ticket.email,salt,hash,now);
            db.prepare("DELETE FROM sessions WHERE email=?").run(ticket.email);
            result={email:ticket.email,created:!old};
          }
        }
        db.exec("COMMIT");return result;
      } catch(error) {db.exec("ROLLBACK");throw error;}
    },
    authenticate({email,oldToken,token,expires,now}) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM sessions WHERE expires<=? OR token=?").run(now,oldToken);
        db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(token,email,expires);
        db.exec("COMMIT");return true;
      } catch(error) {db.exec("ROLLBACK");throw error;}
    }
  },{localTest});
};

