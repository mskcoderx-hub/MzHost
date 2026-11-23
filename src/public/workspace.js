"use strict";

// One browser tab owns its sandbox. All lifecycle operations below are simulations.
const Workspace = (() => {
  const runtimes = {
    Python: {file:"main.py", command:"python", source:'print("Listening for events.")\n', manifest:"requirements.txt", dependencies:"# Add Python packages here\n"},
    "Node.js": {file:"index.js", command:"node", source:'console.log("Listening for events.");\n', manifest:"package.json", dependencies:'{\n  "private": true\n}\n'}
  };
  const byteLength = text => new TextEncoder().encode(text).length;
  const uid = () => crypto.randomUUID();
  function name(value) {
    const result = value.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(result)) throw Error("Use 1–40 lowercase letters, numbers or hyphens for the server name.");
    return result;
  }
  function filePath(value) {
    const result = value.trim();
    if (result.length > 160 || result.split("/").some(part => !/^[\w.-][\w. -]{0,79}$/.test(part) || part === "." || part === "..")) throw Error("Enter a relative file path, such as src/main.py.");
    return result;
  }
  function event(server, message) {
    server.activity.unshift({time:Date.now(), message});
    server.activity.length = Math.min(server.activity.length, 80);
  }
  function log(server, message) {
    server.logs.push({time:Date.now(), message});
    if (server.logs.length > 140) server.logs.shift();
  }
  function runnable(runtime, file) {
    if (!file || typeof file.text !== "string" || file.binary) return false;
    return runtime === "Python" ? /\.py$/i.test(file.path) : runtime === "Node.js" && /\.(?:js|cjs|mjs)$/i.test(file.path);
  }
  function startup(server) {
    const candidates = server.files.filter(f => runnable(server.runtime,f));
    const selected = candidates.find(f => f.path === server.entry);
    const relative = "./" + server.entry;
    const command = selected ? runtimes[server.runtime].command + " " + (/\s/.test(relative) ? JSON.stringify(relative) : relative) : "";
    let suggested;
    let reason;
    if (server.runtime === "Node.js") {
      const manifest = server.files.find(f => f.path === "package.json");
      try {
        const pkg = JSON.parse(manifest?.text || "{}");
        const start = typeof pkg?.scripts?.start === "string" && /^node\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))\s*$/.exec(pkg.scripts.start.trim());
        const paths = [[start && (start[1] || start[2] || start[3]), "package.json start script"], [pkg?.main, "package.json main field"]];
        for (const [path,source] of paths) {
          if (typeof path !== "string") continue;
          suggested = candidates.find(f => f.path === path.replace(/^\.\//,""));
          if (suggested) { reason=source; break; }
        }
      } catch { /* A malformed manifest can still be edited in Files. */ }
    } else if (server.runtime === "Python") {
      const mains = candidates.filter(f => /^if\s+__name__\s*==\s*["']__main__["']\s*:/m.test(f.text));
      if (mains.length === 1) { suggested=mains[0]; reason="Python main block"; }
    }
    if (!suggested) {
      const names = server.runtime === "Python" ? ["main.py","bot.py","app.py"] : ["index.js","index.mjs","index.cjs","bot.js","app.js"];
      const matches = candidates.filter(f => names.includes(f.path.split("/").pop()));
      if (matches.length === 1) { suggested=matches[0]; reason="common startup filename"; }
      else if (candidates.length === 1) { suggested=candidates[0]; reason="only runnable file"; }
    }
    return {selected, command, candidates, suggested, reason};
  }
  const plans = {
    Starter: {memory:512, disk:1, cpu:0.25, price:2},
    Standard: {memory:1024, disk:2, cpu:0.5, price:4},
    Plus: {memory:2048, disk:4, cpu:1, price:7}
  };
  const versions = {Python:["3.13","3.12"], "Node.js":["24","22"]};
  const databases = ["No database","MongoDB","PostgreSQL","Bring my own"];
  const serverLimit = 5;
  function create(label, runtime, setup) {
    const defaults = runtimes[runtime];
    if (!Object.hasOwn(runtimes,runtime)) throw Error("Choose a supported runtime.");
    const server = {id:uid(), name:name(label), runtime, entry:defaults.file, memory:512, restart:false,
      started:0, files:[{path:defaults.file,text:defaults.source},{path:defaults.manifest,text:defaults.dependencies}],
      env:[], deployments:[], backups:[], logs:[], activity:[]};
    if (setup) {
      if (!Object.hasOwn(plans,setup.plan) || !versions[runtime].includes(setup.version) || !databases.includes(setup.database)) throw Error("Review the server options.");
      Object.assign(server,{plan:setup.plan, version:setup.version, database:setup.database,
        memory:plans[setup.plan].memory, files:[], entry:"", firstDeploy:true});
    }
    event(server,"Server created");
    return server;
  }
  function power(server, action) {
    if (!["start","stop","restart"].includes(action)) throw Error("Unknown power action.");
    if (action !== "start" && !server.started) throw Error("Server is already stopped.");
    if (action === "start" && server.started) throw Error("Server is already running.");
    const launch = startup(server);
    if (action !== "stop" && !launch.selected) throw Error("Choose a startup file for "+server.runtime+" in Files before starting.");
    if (action !== "start") log(server,"Process stopped.");
    server.started = action === "stop" ? 0 : Date.now();
    if (server.started) {
      log(server,"$ " + launch.command);
      log(server,"Runtime ready. Listening for events.");
    }
    event(server,{start:"Server started",stop:"Server stopped",restart:"Server restarted"}[action]);
  }
  function seed() {
    const relay = create("relay-bot","Python");
    const dispatch = create("dispatch-bot","Node.js");
    power(relay,"start");
    const past = 9 * 60 * 1000;
    relay.started -= past;
    for (const record of [...relay.logs,...relay.activity]) record.time -= past;
    return {servers:[relay,dispatch], selected:relay.id};
  }
  function storeFile(server, file, replacePath = null) {
    file.path = filePath(file.path);
    const others = server.files.filter(f => f.path !== replacePath);
    if (others.some(f => f.path === file.path || f.path.startsWith(file.path+"/") || file.path.startsWith(f.path+"/"))) throw Error("A file or folder already uses that path.");
    if (others.length >= 80) throw Error("This sandbox supports 80 files per server.");
    if ((file.binary ? file.data.length * .75 : byteLength(file.text)) > 256*1024) throw Error("Choose a file under 256 KB for this preview.");
    server.files = [...others,file].sort((a,b)=>a.path.localeCompare(b.path));
    if (replacePath && server.entry === replacePath) server.entry = file.path;
  }
  function snapshot(server) {
    if (server.backups.length >= 5) throw Error("Remove a backup first. Each server has five backup slots.");
    server.backups.unshift({id:uid(),time:Date.now(),files:structuredClone(server.files),entry:server.entry,runtime:server.runtime,version:server.version,memory:server.memory,restart:server.restart});
    event(server,"Backup created");
  }
  function restore(server, id) {
    const back = server.backups.find(b=>b.id===id);
    if (!back) throw Error("Backup no longer exists.");
    if (server.started) power(server,"stop");
    for (const key of ["files","entry","runtime","memory","restart"]) server[key]=structuredClone(back[key]);
    if(server.plan) server.version=back.version || versions[server.runtime][0];
    event(server,"Restored files and configuration from backup");
    log(server,"Backup restored. Server is stopped.");
  }
  function command(server, raw) {
    const cmd = raw.trim().toLowerCase();
    const supported = ["help","status","ls","uptime","start","stop","restart","crash"];
    if (!supported.includes(cmd)) throw Error("Unknown sandbox command. Enter help for the list.");
    log(server,"mz> "+cmd);
    if (["start","stop","restart"].includes(cmd)) power(server,cmd);
    else if (cmd==="crash") {
      if (!server.started) throw Error("Start the server before simulating a crash.");
      power(server,"stop"); log(server,"Simulated process exit (1).");
      event(server,"Simulated runtime failure");
      if (server.restart) power(server,"start");
    } else if (cmd==="help") log(server,supported.join("  "));
    else if (cmd==="ls") log(server,server.files.map(f=>f.path).join("  ") || "No files");
    else if (cmd==="status") log(server,server.name+" | "+server.runtime+" | "+(server.started?"Running":"Stopped"));
    else log(server,server.started ? Math.max(0,Math.floor((Date.now()-server.started)/1000))+" seconds" : "Offline");
  }
  function deploy(server, description) {
    const note=description.trim();
    if (!note || note.length>80) throw Error("Enter a release name of up to 80 characters.");
    power(server,server.started?"restart":"start");
    const release={id:uid(),name:note,time:Date.now(),files:structuredClone(server.files),entry:server.entry,runtime:server.runtime,version:server.version};
    server.firstDeploy=false;
    server.deployments.unshift(release);
    server.deployments.splice(3);
    log(server,"Preview deployment ready: "+note);
    event(server,"Deployed "+note);
  }
  function redeploy(server,id) {
    const release=server.deployments.find(item=>item.id===id);
    if (!release) throw Error("Release no longer exists.");
    server.files=structuredClone(release.files);
    server.entry=release.entry;server.runtime=release.runtime;
    if(server.plan) server.version=release.version || versions[server.runtime][0];
    deploy(server,release.name);
  }
  return {create,seed,event,log,name,power,storeFile,startup,runnable,snapshot,restore,deploy,redeploy,command,runtimes,byteLength,plans,versions,databases,serverLimit};
})();
