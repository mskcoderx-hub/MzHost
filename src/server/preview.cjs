// Run with node preview.cjs from the project folder.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const accounts = require("./local-accounts.cjs");

const files = new Map([
  ["/verify", ["verify.html", "text/html; charset=utf-8"]],
  ["/verify.js", ["verify.js", "text/javascript; charset=utf-8"]],
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/file-links.js", ["file-links.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/home.js", ["home.js", "text/javascript; charset=utf-8"]],
  ["/dashboard", ["dashboard.html", "text/html; charset=utf-8"]],
  ["/dashboard.css", ["dashboard.css", "text/css; charset=utf-8"]],
  ["/workspace.js", ["workspace.js", "text/javascript; charset=utf-8"]],
  ["/dashboard.js", ["dashboard.js", "text/javascript; charset=utf-8"]],
  ["/account", ["account.html", "text/html; charset=utf-8"]],
  ["/account.css", ["account.css", "text/css; charset=utf-8"]],
  ["/account.js", ["account.js", "text/javascript; charset=utf-8"]],
  ["/images/MzHostAuthPanel.png", ["images/MzHostAuthPanel.png", "image/png"]],
  ["/images/MzHostLogo.png", ["images/MzHostLogo.png", "image/png"]],
  ["/images/MzHostBanner.png", ["images/MzHostBanner.png", "image/png"]]
]);

for(const page of ["billing","status","admin"]) files.set("/"+page,[page+".html","text/html; charset=utf-8"]);
for(const name of ["discord-mark","google-mark","community-avatar"]) {
  const asset="images/"+name+".png";
  files.set("/"+asset,[asset,"image/png"]);
}
for(const asset of ["project-tree.js","file-manager.js","github-panel.js","common.js","service-pages.js","plans.js","service-pages.css","pricing.css"]) files.set("/"+asset,[asset,asset.endsWith(".js")?"text/javascript; charset=utf-8":"text/css"]);
const root = path.resolve(__dirname, "../..");
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const publicDir = path.join(root, "src", "public");
const port = Number(process.argv[2] || process.env.PORT || 4181);
const dataDir = path.join(root, ".local-data");
fs.mkdirSync(dataDir, {recursive:true});
const useMongo=process.env.MZHOST_STORAGE==="mongodb";
const handleAccount = useMongo ? async (...args)=>(await require("./mongo-accounts.cjs")(false))(...args) : accounts(path.join(dataDir, "accounts.sqlite"), {
  localTest: process.env.LOCAL_TEST_ACCOUNT === "true" && process.env.NODE_ENV !== "production"
});
const server = http.createServer((request, response) => {
  for(const {key,value} of securityHeaders) response.setHeader(key,value);
  if (request.url.startsWith("/api/")) {
    handleAccount(request.url.split("?")[0].slice(5), request, response).catch(error => {
      const status=[400,413].includes(error.status)?error.status:503;
      if (!response.headersSent) response.writeHead(status, {"Content-Type":"application/json", "Cache-Control":"no-store"});
      response.end(JSON.stringify({message:status===503?"Account service unavailable. Please try again.":error.message}));
    });
    return;
  }
  const pathname=request.url.split("?")[0];
  const redirected=pathname==="/index" || pathname==="/index.html" ? "/" :
    (/^\/(account|dashboard|verify)\.html$/.test(pathname) ? pathname.slice(0,-5) : null);
  if(redirected && ["GET","HEAD"].includes(request.method)) {
    response.writeHead(308,{Location:redirected+request.url.slice(pathname.length)}).end();
    return;
  }
  const file = files.get(pathname);
  if (!file || !["GET", "HEAD"].includes(request.method)) {
    response.writeHead(404).end();
    return;
  }
  fs.readFile(path.join(publicDir, file[0]), (error, data) => {
    if (error) {
      response.writeHead(500).end();
      return;
    }
    response.writeHead(200, { "Content-Type": file[1], "Content-Length": data.length });
    response.end(request.method === "HEAD" ? undefined : data);
  });
});
server.on("error", error => {
  console.error(error.message);
  process.exitCode = 1;
});
const securityHeaders=require("../../vercel.json").headers[0].headers;
server.listen(port, "127.0.0.1", () => console.log("MzHost preview on http://127.0.0.1:" + port));
