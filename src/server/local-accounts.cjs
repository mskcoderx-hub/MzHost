const {DatabaseSync}=require("node:sqlite");
const {randomBytes,scryptSync}=require("node:crypto");
const {accounts,hashOptions}=require("./accounts.cjs");
module.exports=function localAccounts(databaseFile,{localTest=false}={}) {
  const db = new DatabaseSync(databaseFile);
  db.exec(`CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, salt TEXT NOT NULL, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, email TEXT NOT NULL, expires INTEGER NOT NULL);`);
  if (localTest && !db.prepare("SELECT 1 FROM users WHERE email='1'").get()) {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync("1", salt, 32, hashOptions);
    db.prepare("INSERT OR IGNORE INTO users VALUES (?,?,?)").run("1",salt,hash.toString("hex"));
  }
  let attempts = 0;
  let resetAt = 0;
  return accounts({
    session:(token,now)=>db.prepare("SELECT email FROM sessions WHERE token=? AND expires>?").get(token,now),
    user:email=>db.prepare("SELECT salt,hash FROM users WHERE email=?").get(email),
    logout:token=>db.prepare("DELETE FROM sessions WHERE token=?").run(token),
    allowAttempt(_,now) {
      if(now>=resetAt) {resetAt=now+60000;attempts=0;}
      return ++attempts<=12;
    },
    authenticate({register,email,salt,hash,oldToken,token,expires,now}) {
      db.exec("BEGIN IMMEDIATE");
      try {
        if(register && !db.prepare("INSERT OR IGNORE INTO users VALUES (?,?,?)").run(email,salt,hash).changes) {
          db.exec("ROLLBACK");return false;
        }
        db.prepare("DELETE FROM sessions WHERE expires<=? OR token=?").run(now,oldToken);
        db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(token,email,expires);
        db.exec("COMMIT");return true;
      } catch(error) {db.exec("ROLLBACK");throw error;}
    }
  },{localTest});
};

