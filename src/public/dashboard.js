"use strict";
const W = Workspace;
const $ = id => document.getElementById(id);
const views = Array.from($("views").querySelectorAll("a"), a => a.hash.slice(1));
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const time = stamp => new Date(stamp).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
const dateTime = stamp => new Date(stamp).toLocaleString();
const label = key => key.charAt(0).toUpperCase()+key.slice(1);
const used = file => file.binary ? Math.floor(file.data.length*3/4) - (file.data.match(/=*$/)[0].length) : W.byteLength(file.text);
const size = bytes => bytes < 1024 ? bytes+" B" : Math.ceil(bytes/1024)+" KB";
let state, storageKey, persistent = true, submitModal, noticeTimer, filter = "", settingsDirty = false;
let directory = "";
const active = () => state.servers.find(s=>s.id===state.selected);
const routes = [...views,"setup"];
let view = routes.includes(location.hash.slice(1)) ? location.hash.slice(1) : "servers";
let draft, reviewing=false;
let cloud=false, revision=0, acknowledged, syncing=false, conflict=false;

async function saveCloud() {
  if (!cloud || syncing || conflict || acknowledged===state) return;
  syncing=true;
  const status=$("sync-status");
  status.hidden=false;
  status.textContent="Saving workspace…";
  try {
    while (acknowledged!==state) {
      const snapshot=state;
      const response=await fetch("/api/workspace",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({revision,workspace:snapshot})});
      if(response.status===409) {
        conflict=true;
        throw Error("This workspace changed in another tab. Reload to open the saved version.");
      }
      if(!response.ok) throw Error(response.status===413?"Workspace is too large to save. Remove large files or backups.":"Workspace could not be saved. Check your connection and retry.");
      revision=(await response.json()).revision;
      acknowledged=snapshot;
    }
    status.hidden=true;
  } catch(error) {
    status.textContent=error.message+" ";
    status.insertAdjacentHTML("beforeend",button(conflict?"Reload":"Retry save",conflict?"reload":"retry-save"));
  } finally { syncing=false; }
}

function flash(message) {
  clearTimeout(noticeTimer);
  $("notice").textContent = message;
  noticeTimer = setTimeout(()=>$("notice").textContent="",6000);
}
function commit(change) {
  if(conflict) throw Error("Reload the latest workspace before editing.");
  const next = structuredClone(state);
  const s = next.servers.find(server=>server.id===next.selected);
  change(s,next);
  if(cloud && W.byteLength(JSON.stringify(next))>3*1024*1024) throw Error("This preview workspace has a 3 MB save limit. Remove files or backups first.");
  if (persistent) {
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { throw Error("This tab is out of storage. Remove a large file or backup and retry."); }
  }
  state = next;
  saveCloud();
  settingsDirty = false;
  paint();
}
function button(text, action, value="", classes="small-btn") {
  return '<button type="button" class="'+classes+'" data-action="'+action+'" data-value="'+escapeHTML(value)+'">'+escapeHTML(text)+'</button>';
}
function field(text, key, value="", attrs="") {
  return '<label>'+text+'<input name="'+key+'" value="'+escapeHTML(value)+'" '+attrs+'></label>';
}
function showModal(title, html, submitText, handler) {
  $("modal-title").textContent=title;
  $("modal-body").innerHTML=html;
  $("modal-error").textContent="";
  $("modal-submit").textContent=submitText;
  submitModal=handler;
  $("modal").showModal();
}
$("modal-form").addEventListener("submit",e=>{
  e.preventDefault();
  try { submitModal(new FormData(e.target)); $("modal").close(); }
  catch(error) { $("modal-error").textContent=error.message; }
});
function head(title, right="") {
  return '<div class="panel-head"><h2>'+title+'</h2>'+right+'</div>';
}
function controls(s) {
  if (s.firstDeploy && !s.started) return '<div class="controls"><a href="#files">Open files</a></div>';
  return '<div class="controls">'+(s.started ? button("Restart","restart","","")+button("Stop server","stop","","") : button("Start server","start","","accent"))+'</div>';
}
function runControl(operation) {
  let failure;
  commit(server=>{
    try { operation(server); }
    catch (error) {
      failure=error;
      W.log(server,"Error: "+error.message);
    }
  });
  if (failure) throw failure;
}
function logs(s, limit) {
  return '<div class="log-output" id="output">'+s.logs.slice(-limit).map(l=>'<div class="log-line"><time>'+time(l.time)+'</time><span>'+escapeHTML(l.message)+'</span></div>').join("")+(s.logs.length?"":'<p>Start the server to see its logs.</p>')+'</div>';
}
function consoleBox(s, full) {
  const startup = full ? '<div class="console-start"><span>Next start</span><code>'+escapeHTML(W.startup(s).command || "Startup file required")+'</code><a href="#files">Manage files</a></div>' : "";
  return '<section class="box terminal">'+head("Console",full?'<span class="small-mono">Simulated runtime</span>':'<a href="#console">Open console</a>')+startup+logs(s,full?140:4)+(full?'<form class="cmd" id="command"><input name="cmd" aria-label="Sandbox command" autocomplete="off" placeholder="Type help for commands" required maxlength="120"><button class="accent">Send</button></form>':'')+'</section>';
}
function activities(s, limit) {
  return s.activity.slice(0,limit).map(a=>'<div class="event-row"><span>'+escapeHTML(a.message)+'</span><time class="small-mono" title="'+escapeHTML(dateTime(a.time))+'">'+time(a.time)+'</time></div>').join("");
}
function sample(s, tick) {
  if (!s.started || tick*5000 < s.started-5000) return 0;
  const base=s.runtime==="Python"?84:112;
  return Math.round(base+8*Math.sin(tick*.54)+5*Math.sin(tick*.17));
}
function overview(s) {
  const tick=Math.floor(Date.now()/5000), memory=sample(s,tick);
  const stat=(key,value,unit)=>'<div class="stat"><span class="key">'+key+'</span><strong>'+value+'</strong><small>'+unit+'</small></div>';
  return '<div class="cards">'+stat("Memory",memory+' MB','of '+s.memory+' MB')+stat("CPU usage",s.started?(2+Math.abs(Math.sin(tick*.4))*2).toFixed(1)+'%':'0%','simulated')+stat("Project files",s.files.length,size(s.files.reduce((n,f)=>n+used(f),0))+' in use')+'</div>'+
    '<section class="box">'+head("Memory history",'<span class="small-mono">Last 5 minutes · sample</span>')+'<canvas id="chart" class="chart" role="img" aria-label="Simulated memory usage over the last five minutes"></canvas><div class="scale"><span>5 min ago</span><span>Now</span></div></section>'+
    '<div class="work-grid">'+consoleBox(s,false)+'<section class="box">'+head("Recent activity",'<a href="#activity">View all</a>')+activities(s,4)+'</section></div>';
}
function draw(s) {
  const c=$("chart"); if(!c) return;
  const w=c.clientWidth,h=c.clientHeight,dpr=window.devicePixelRatio||1;
  c.width=w*dpr; c.height=h*dpr;
  const g=c.getContext("2d"); if(!g) return;
  g.scale(dpr,dpr); g.lineWidth=1; g.strokeStyle="#dfdfd8";
  for (const y of [6,h/2,h-5]) { g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke(); }
  const tick=Math.floor(Date.now()/5000);
  g.strokeStyle="#aa8100";g.lineWidth=2.5;g.beginPath();
  for(let i=0;i<=60;i++) {
    const x=i*w/60,y=h-5-sample(s,tick-60+i)/160*(h-12);
    if(i===0) g.moveTo(x,y);else g.lineTo(x,y);
  }
  g.stroke();
}
function fileRows(s) {
  const dirs=new Set(), rows=[];
  const query=filter.trim().toLowerCase();
  for (const f of s.files) {
    if (query) { if (f.path.toLowerCase().includes(query)) rows.push(f); continue; }
    if (!f.path.startsWith(directory)) continue;
    const local=f.path.slice(directory.length);
    if (local.includes("/")) dirs.add(local.split("/")[0]); else rows.push(f);
  }
  const folders=[...dirs].sort().map(name=>'<div class="file-row">'+button(name+"/","directory",directory+name+"/","file-name dir-name")+'</div>');
  rows.sort((a,b)=>Number(b.path===s.entry)-Number(a.path===s.entry)||a.path.localeCompare(b.path));
  for (const f of rows) {
    const entry=f.path===s.entry && W.runnable(s.runtime,f);
    const start=entry ? '<span class="entry-tag">Runs first</span>' : W.runnable(s.runtime,f) ? button("Set as startup","set-entry",f.path) : "";
    folders.push('<div class="file-row">'+button(query?f.path:f.path.slice(directory.length),"open-file",f.path,"file-name")+'<span class="small-mono">'+size(used(f))+'</span><div class="group-end">'+start+'<details class="file-menu"><summary aria-label="Actions for '+escapeHTML(f.path)+'">Actions</summary><div>'+button("Rename","rename-file",f.path)+button("Download","download",f.path)+button("Delete","delete-file",f.path,"small-btn danger")+'</div></details></div></div>');
  }
  return folders.join("") || '<p class="empty">'+(s.files.length?"No matching files.":"Your project is empty. Upload a folder or create your first file.")+'</p>';
}
function files(s) {
  const launch=W.startup(s);
  let suggestion="";
  if (launch.suggested && launch.suggested!==launch.selected) suggestion='<div class="suggest-file"><span>Suggested by '+escapeHTML(launch.reason)+': <b>'+escapeHTML(launch.suggested.path)+'</b></span>'+button("Use this file","set-entry",launch.suggested.path)+'</div>';
  if(directory && !s.files.some(f=>f.path.startsWith(directory))) directory="";
  let prefix="";
  const crumbs=[button("Project root","directory","","file-name")];
  for(const part of directory.split("/").filter(Boolean)) {prefix+=part+"/";crumbs.push(button(part,"directory",prefix,"file-name"));}
  const entry=launch.selected ? '<code>'+escapeHTML(launch.command)+'</code>'+button("Edit startup file","open-file",s.entry) : '<p>Choose a '+(s.runtime==="Python"?".py":".js, .mjs or .cjs")+' file to run first.</p>';
  return '<section class="box startup-box">'+head("Startup file",'<a href="#console">Open console</a>')+'<div class="file-tools">'+entry+'</div>'+suggestion+'</section>'+
    '<section class="box file-browser">'+head("Project files")+'<div class="file-tools"><input id="file-search" class="file-search" aria-label="Search all file paths" placeholder="Search all files" value="'+escapeHTML(filter)+'">'+button("Upload files","upload","","accent")+button("Upload folder","upload-folder","","")+button("New file","new-file","","")+'</div><nav class="file-crumbs" aria-label="Folder path">'+crumbs.join('<span>/</span>')+'</nav><div class="list" id="file-list">'+fileRows(s)+'</div></section>';
}
function environment(s) {
  return '<section class="box">'+head("Environment variables",button("Add variable","new-env","","accent"))+'<p class="subtle">Use test values only. Variables are excluded from project backups.</p><div class="list">'+(s.env.map(item=>'<div class="env-row"><strong>'+escapeHTML(item.key)+'</strong><span class="env-value">••••••••</span><div class="group-end">'+button("Edit","edit-env",item.key)+button("Remove","remove-env",item.key)+'</div></div>').join("")||'<p class="empty">No variables configured.</p>')+'</div></section>';
}
function options(list,current) {
  return list.map(item=>'<option '+(String(item)===String(current)?"selected ":"")+'value="'+escapeHTML(item)+'">'+escapeHTML(item)+'</option>').join("");
}
function configuration(s) {
  const entries=W.startup(s).candidates.map(f=>f.path);
  const setup=s.plan ? '<label>Runtime version<select name="version">'+options(W.versions[s.runtime],s.version)+'</select></label><label>App database (preview)<select name="database">'+options(W.databases,s.database)+'</select></label>' : "";
  return '<section class="box">'+head("Startup configuration")+'<form id="settings" class="form-grid">'+field("Server name","name",s.name,'required maxlength="40"')+
    '<label>Runtime<select name="runtime">'+options(Object.keys(W.runtimes),s.runtime)+'</select></label><label>Entry file<select name="entry"><option value="">Choose later</option>'+options(entries,s.entry)+'</select></label>'+
    '<label>Memory limit (MB)<select name="memory">'+options([256,512,1024,2048].filter(m=>!s.plan || m<=W.plans[s.plan].memory),s.memory)+'</select></label>'+
    setup+'<label class="check full"><input type="checkbox" name="restart" '+(s.restart?"checked":"")+'> Restart after a simulated crash</label>'+
    '<div class="full controls"><button class="accent">Save configuration</button>'+button("Delete server","delete-server","","danger")+'</div></form></section>';
}
function backups(s) {
  return '<section class="box">'+head("Backups",button("Create backup","backup","","accent"))+'<p class="subtle">Snapshots include project files and startup configuration. Restoring a snapshot stops the server.</p><div class="list">'+(s.backups.map(b=>'<div class="file-row"><strong>'+escapeHTML(dateTime(b.time))+'</strong><span class="small-mono">'+b.files.length+' files</span><div class="group-end">'+button("Restore","restore",b.id)+button("Remove","remove-backup",b.id)+'</div></div>').join("")||'<p class="empty">No backups yet.</p>')+'</div></section>';
}
function deployments(s) {
  const rows=s.deployments.map(r=>'<div class="file-row"><strong>'+escapeHTML(r.name)+'</strong><span class="small-mono">'+escapeHTML(dateTime(r.time))+' · '+r.files.length+' files</span><div class="group-end">'+button("Redeploy","redeploy",r.id)+'</div></div>').join("");
  return '<section class="box">'+head("Release history",button("Deploy current files","deploy","","accent"))+'<p class="subtle">Test a release from the current files and entry point. The last three releases are available to redeploy.</p><div class="list">'+(rows||'<p class="empty">No releases yet.</p>')+'</div></section>';
}
function fleet() {
  const rows=state.servers.map(s=>'<div class="file-row">'+button(s.name,"select-server",s.id,"file-name")+'<span class="small-mono">'+s.runtime+' · '+s.memory+' MB</span><div class="group-end">'+(s.started?"Running":s.firstDeploy && !s.files.length?"Waiting for files":"Stopped")+'</div></div>').join("");
  return '<section class="box">'+head("Servers ("+state.servers.length+"/"+W.serverLimit+")",button("New server","create-server","","accent"))+rows+'</section>';
}
function setupPage() {
  draft ??= {name:"",runtime:"Python",version:W.versions.Python[0],plan:"Starter",database:"No database"};
  const p=W.plans[draft.plan];
  const summary='<dl class="specs">'+[
    ["Runtime",draft.runtime+" "+draft.version],["Plan",draft.plan],["Resources",p.memory+" MB RAM / "+p.disk+" GB disk / "+p.cpu+" vCPU"],
    ["App database",draft.database],["Proposed monthly price","$"+p.price+" USD"],["Due in preview","$0"]
  ].map(([key,value])=>'<div><dt>'+key+'</dt><dd>'+escapeHTML(value)+'</dd></div>').join("")+'</dl>';
  $("context").innerHTML='<p class="crumb"><a href="#servers">My servers</a> / New server</p><h1>'+(reviewing?"Review your server":"Set up your server")+'<span class="period">.</span></h1>';
  document.title=(reviewing?"Review server":"New server")+" | MzHost";
  if(reviewing) {
    $("content").innerHTML='<section class="box setup-card">'+head(escapeHTML(draft.name))+summary+'<p class="subtle">Creating this preview reserves a workspace for your files. Hosting and database provisioning are simulated.</p><div class="controls">'+button("Edit setup","edit-setup")+button("Create server","confirm-setup","","accent")+'</div></section>';
    return;
  }
  const choice=(title,key,list)=>'<label>'+title+'<select name="'+key+'">'+options(list,draft[key])+'</select></label>';
  $("content").innerHTML='<form id="setup" class="box setup-card">'+head("Project settings")+'<div class="form-grid">'+field("Server name","name",draft.name,'required maxlength="40" placeholder="my-bot" autocapitalize="none"')+
    choice("Runtime","runtime",Object.keys(W.runtimes))+choice("Version","version",W.versions[draft.runtime])+
    choice("Hosting plan","plan",Object.keys(W.plans))+choice("App database (optional)","database",W.databases)+'</div><p class="subtle" id="plan-hint">'+planHint(p)+'</p><p class="subtle">You can bring a database connection later through Environment. Use sample values during testing.</p><div class="controls"><button class="accent">Review setup</button><a href="#servers">Cancel</a></div></form>';
}
function planHint(p) {
  return p.memory+" MB memory · "+p.disk+" GB disk · "+p.cpu+" vCPU · $"+p.price+"/month proposed. Free to preview.";
}
function onboarding(s) {
  const manifest=W.runtimes[s.runtime].manifest, hasManifest=s.files.some(f=>f.path===manifest);
  const step=(title,detail,action)=>'<li><div><strong>'+title+'</strong><p class="subtle">'+detail+'</p></div>'+action+'</li>';
  return '<section class="box launch-guide">'+head("First deployment")+'<p class="subtle">'+escapeHTML(s.runtime+" "+s.version+" / "+s.plan+" / "+s.database)+'</p><ol>'+
    step("Add project files",s.files.length?s.files.length+" files in this project.":"Upload your project folder to keep its directory structure.",'<a href="#files">Open files</a>')+
    step("Confirm the startup file",escapeHTML(W.startup(s).command || "Choose the file MzHost should run first."),'<a href="#files">Choose file</a>')+
    step("Review dependencies",hasManifest?manifest+" found. Dependency installation is simulated.":"Add "+manifest+" if your project uses packages.",hasManifest?button("Review file","open-file",manifest):'<a href="#files">Manage files</a>')+
    step("Set environment variables",s.env.length?s.env.length+" configured.":"Optional. Use test values for this preview.",'<a href="#environment">Environment</a>')+
    step("Launch and read the logs","Save a release and run it in the simulator.",W.startup(s).selected?button("Deploy project","deploy","","accent"):'<span class="small-mono">Awaiting startup file</span>')+'</ol></section>';
}
function paint() {
  if (!state) return;
  const s=active();
  $("context").classList.toggle("overview-context",Boolean(s)&&view==="overview");
  $("server-switch").innerHTML=state.servers.map(item=>'<option value="'+escapeHTML(item.id)+'" '+(item===s?"selected":"")+'>'+escapeHTML(item.name)+'</option>').join("");
  $("server-switch").disabled=!s;
  for(const a of $("views").querySelectorAll("a")) {
    a.hidden=(view==="servers" || view==="setup" || !s) && a.hash!=="#servers";
    if(a.hash==="#"+view) a.setAttribute("aria-current","page");else a.removeAttribute("aria-current");
  }
  if(view==="setup") { setupPage();return; }
  if (!s) { document.title="My servers | MzHost"; $("context").innerHTML='<h1>My servers<span class="period">.</span></h1>'; $("content").innerHTML='<section class="box setup-card">'+head("Create your first server")+'<p class="subtle">Choose a runtime and plan, then upload your project.</p>'+button("New server","create-server","","accent")+'</section>';return; }
  if (view==="servers") {
    document.title="My servers | MzHost";
    $("context").innerHTML='<p class="crumb">Workspace</p><div class="context-row"><div><h1>My servers<span class="period">.</span></h1><p class="subtle">'+state.servers.filter(item=>item.started).length+' running of '+state.servers.length+' servers</p></div></div>';
    $("content").innerHTML=fleet();return;
  }
  document.title=label(view)+" · "+s.name+" | MzHost";
  $("context").innerHTML='<p class="crumb">Workspace / '+escapeHTML(s.name)+' / '+label(view)+'</p><div class="context-row"><div><h1>'+escapeHTML(view==="overview"?s.name:label(view))+'<span class="period">.</span></h1><p class="subtle"><span class="server-state '+(s.started?"online":"")+'">'+(s.started?"Running":s.firstDeploy && !s.files.length?"Waiting for files":"Stopped")+'</span> &nbsp; / &nbsp; '+escapeHTML([s.runtime,s.version].filter(Boolean).join(' '))+' &nbsp; / &nbsp; '+escapeHTML(s.entry || 'Awaiting startup file')+'</p></div>'+controls(s)+'</div>';
  const panels={overview,console:x=>consoleBox(x,true),files,deployments,environment,configuration,backups,activity:x=>'<section class="box">'+head("Activity history")+activities(x,80)+'</section>'};
  $("content").innerHTML=(view==="overview" && s.firstDeploy?onboarding(s):"")+panels[view](s);
  if(view==="overview") draw(s);
  if(view==="console") $("output").scrollTop=$("output").scrollHeight;
}

function editFile(s, path) {
  const f=s.files.find(item=>item.path===path);
  if(f?.binary) { flash("This is a binary file. Use Download to open it.");return; }
  showModal(f?"Edit file":"New file",field("File path","path",f?.path||directory, 'required maxlength="160" placeholder="src/main.py"')+
    '<label>Contents<textarea name="text" spellcheck="false">'+escapeHTML(f?.text||"")+'</textarea></label>',"Save file", data=>commit(server=>{
    W.storeFile(server,{path:data.get("path"),text:data.get("text")},f?.path);
    W.event(server,"Saved "+data.get("path").trim());
  }));
}
function envModal(s,key) {
  const item=s.env.find(e=>e.key===key);
  showModal(item?"Edit variable":"Add variable",field("Key","key",key,'required maxlength="80" pattern="[A-Za-z_][A-Za-z_0-9]*" placeholder="LOG_LEVEL"')+
    field("Test value","value",item?.value||"", 'type="password" autocomplete="off" maxlength="4096"')+
    '<label><span><input type="checkbox" id="env-reveal" style="width:auto;min-height:0"> Show value</span></label>',"Save variable",data=>commit(server=>{
      const newKey=data.get("key");
      if (server.env.some(e=>e.key===newKey && e.key!==key)) throw Error("That variable already exists.");
      server.env=server.env.filter(e=>e.key!==key);
      server.env.push({key:newKey,value:data.get("value")});
      W.event(server,"Saved variable "+newKey);
    }));
}
function confirmAction(title, message, action, handler) {
  showModal(title,'<p class="subtle">'+escapeHTML(message)+'</p>',action,()=>commit(handler));
}
function download(f) {
  const bytes=f.binary ? Uint8Array.from(atob(f.data),c=>c.charCodeAt(0)) : f.text;
  const url=URL.createObjectURL(new Blob([bytes],{type:"application/octet-stream"}));
  const a=document.createElement("a");a.download=f.path.split("/").pop();a.href=url;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function createServer() {
  if(state.servers.length>=W.serverLimit) throw Error("This preview workspace can hold "+W.serverLimit+" servers.");
  draft=null;reviewing=false;
  if(view==="setup") setupPage(); else location.hash="setup";
}
function act(action,value) {
  const s=active();
  const f=s?.files.find(item=>item.path===value);
  if(action==="cancel") { $("modal").close();return; }
  if(action==="create-server") { createServer();return; }
  if(action==="retry-save") { saveCloud();return; }
  if(action==="reload") { location.reload();return; }
  if(action==="edit-setup") { reviewing=false;setupPage();return; }
  if(action==="confirm-setup" && view==="setup" && reviewing) {
    const server=W.create(draft.name,draft.runtime,draft);
    commit((_,next)=>{
      if(next.servers.length>=W.serverLimit || next.servers.some(item=>item.name===server.name)) throw Error("Check the server name and workspace limit.");
      next.servers.push(server); next.selected=server.id;
    });
    reviewing=false;draft=null;directory="";filter="";location.hash="overview";
    flash("Workspace created. Ready for your project files.");return;
  }
  if(!s) return;
  if(["start","stop","restart","backup"].includes(action) && settingsDirty && !confirm("Discard unsaved configuration changes?")) return;
  switch(action) {
    case "directory": directory=value;filter="";paint();break;
    case "set-entry":
      if (!W.runnable(s.runtime,f)) throw Error("Choose a runnable file for this server.");
      commit(server=>{server.entry=value;W.event(server,"Set startup file to "+value);});
      flash(s.started?"Startup file saved. Restart to use it.":"Startup file saved.");break;
    case "select-server": directory="";filter="";commit((_,next)=>next.selected=value);location.hash="overview";break;
    case "deploy":
      showModal("Deploy current files",field("Release name","release","","required maxlength=\"80\" placeholder=\"First release\""),"Deploy",data=>{commit(server=>W.deploy(server,data.get("release")));location.hash="console";});break;
    case "redeploy": confirmAction("Redeploy release?","This replaces your working files, runtime and entry point with this release and starts the server.","Redeploy",server=>W.redeploy(server,value));break;
    case "start": case "stop": case "restart":
      runControl(server=>W.power(server,action));break;
    case "new-file": editFile(s);break;
    case "open-file": editFile(s,value);break;
    case "upload": $("upload").click();break;
    case "upload-folder": $("folder-upload").click();break;
    case "download": download(f);break;
    case "rename-file":
      showModal("Rename file",field("File path","path",value,"required maxlength=\"160\""),"Rename",data=>commit(server=>{
        W.storeFile(server,{...f,path:data.get("path")},value);
        W.event(server,"Renamed "+value+" to "+data.get("path").trim());
      }));break;
    case "delete-file":
      if(value===s.entry && W.runnable(s.runtime,f)) throw Error("Set another file as startup before deleting this one.");
      confirmAction("Delete file?",value+" will be removed from this server.","Delete file", server=>{
        server.files=server.files.filter(item=>item.path!==value);W.event(server,"Deleted "+value);
      });break;
    case "edit-env": case "new-env": envModal(s,value);break;
    case "remove-env":
      confirmAction("Remove variable?",value+" will be removed.","Remove",server=>{
        server.env=server.env.filter(item=>item.key!==value);W.event(server,"Removed variable "+value);
      });break;
    case "backup": commit(server=>W.snapshot(server));break;
    case "restore": confirmAction("Restore backup?","This replaces current files and configuration. Environment variables are kept. Your server will be stopped.","Restore",server=>W.restore(server,value));break;
    case "remove-backup": confirmAction("Remove backup?","This snapshot will be permanently removed from the sandbox.","Remove",server=>{
      server.backups=server.backups.filter(b=>b.id!==value);W.event(server,"Removed a backup");
    });break;
    case "delete-server": confirmAction("Delete server?",s.name+" and its sandbox files, variables and backups will be removed.","Delete server",(server,next)=>{
      next.servers=next.servers.filter(item=>item.id!==server.id);next.selected=next.servers[0]?.id||"";
    });break;
  }
}
document.addEventListener("click",e=>{
  const btn=e.target.closest("[data-action]");
  if (!btn||!state) return;
  try { act(btn.dataset.action,btn.dataset.value||""); } catch(error){flash(error.message);}
});
document.addEventListener("input",e=>{
  if(e.target.closest("#settings")) settingsDirty=true;
  if(e.target.id==="file-search"){filter=e.target.value;$("file-list").innerHTML=fileRows(active());}
  if(e.target.id==="env-reveal") $("modal-form").elements.value.type=e.target.checked?"text":"password";
});
document.addEventListener("change",e=>{
  if(e.target.form?.id==="setup") {
    const form=e.target.form;
    if(e.target.name==="runtime") form.elements.version.innerHTML=options(W.versions[e.target.value],W.versions[e.target.value][0]);
    if(e.target.name==="plan") $("plan-hint").textContent=planHint(W.plans[e.target.value]);
    return;
  }
  if (!e.target.matches('#settings [name="runtime"]')) return;
  const form=e.target.form;
  if(form.elements.version) form.elements.version.innerHTML=options(W.versions[e.target.value],W.versions[e.target.value][0]);
  const launch=W.startup({...active(),runtime:e.target.value});
  form.elements.entry.innerHTML='<option value="">Choose later</option>'+options(launch.candidates.map(f=>f.path),launch.selected?.path||launch.suggested?.path);
});
$("content").addEventListener("submit",e=>{
  e.preventDefault();
  const data=new FormData(e.target);
  try {
    if(e.target.id==="setup") {
      draft=Object.fromEntries(data);
      draft.name=W.name(draft.name);
      if(state.servers.some(item=>item.name===draft.name)) throw Error("A server already uses this name.");
      reviewing=true;setupPage();$("panel").focus();
    } else if(e.target.id==="command") {
      runControl(s=>W.command(s,data.get("cmd")));
      $("command").elements.cmd.focus();
    } else if(e.target.id==="settings") {
      commit((s,next)=>{
        const name=W.name(data.get("name"));
        if(next.servers.some(item=>item.id!==s.id && item.name===name)) throw Error("Another server already uses this name.");
        const runtime=data.get("runtime"), entry=data.get("entry"), memory=Number(data.get("memory"));
        if(!Object.hasOwn(W.runtimes,runtime)||(entry && !W.runnable(runtime,s.files.find(f=>f.path===entry)))||![256,512,1024,2048].includes(memory)) throw Error("Choose a valid runtime, entry file and memory limit.");
        if(s.started && !entry) throw Error("Stop the server before clearing its startup file.");
        const reboot=s.started && (runtime!==s.runtime||entry!==s.entry||memory!==s.memory);
        if(s.plan && memory>W.plans[s.plan].memory) throw Error("Memory exceeds this plan.");
        if(s.plan) {
          if(!W.versions[runtime].includes(data.get("version")) || !W.databases.includes(data.get("database"))) throw Error("Review your version and database.");
          s.version=data.get("version");s.database=data.get("database");
        }
        Object.assign(s,{name,runtime,entry,memory,restart:data.has("restart")});
        W.event(s,"Startup configuration saved");
        if(reboot) W.power(s,"restart");
      });
      flash("Configuration saved.");
    }
  } catch(error) { flash(error.message); }
});
async function importFiles(e) {
  const serverId=active().id, target=directory;
  const isFolder=e.target.id==="folder-upload";
  const chosen=Array.from(e.target.files).map(file=>({
    file, path:target+(isFolder?file.webkitRelativePath.split("/").slice(1).join("/"):file.name)
  }));
  e.target.value="";
  if (!chosen.length) return;
  try {
    if(chosen.length>80||chosen.some(item=>item.file.size>256*1024)) throw Error("Choose up to 80 files, each 256 KB or smaller.");
    const incoming=await Promise.all(chosen.map(async ({file,path})=>{
      const bytes=new Uint8Array(await file.arrayBuffer());
      try {
        const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
        if(!/[\x00-\x08\x0e-\x1f]/.test(text)) return {path,text};
      } catch { /* Keep the original bytes for non-UTF-8 files. */ }
      let raw="";for(let i=0;i<bytes.length;i+=8192) raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
      return {path,binary:true,data:btoa(raw)};
    }));
    if (active()?.id!==serverId) throw Error("Server changed. Select the files again.");
    const collisions=incoming.filter(f=>active().files.some(old=>old.path===f.path));
    if (collisions.length && !confirm("Replace "+collisions.length+" existing file(s)?\n"+collisions.slice(0,6).map(f=>f.path).join("\n"))) return;
    commit((_,next)=>{
      const s=next.servers.find(item=>item.id===serverId);
      if(!s) throw Error("The upload destination no longer exists.");
      for(const f of incoming) W.storeFile(s,f,collisions.some(old=>old.path===f.path)?f.path:null);
      W.event(s,"Uploaded "+incoming.length+" file(s)");
    });flash("Upload complete.");
  } catch(error) { flash(error.message); }
}
$("upload").addEventListener("change",importFiles);
$("folder-upload").addEventListener("change",importFiles);
$("server-switch").addEventListener("change",e=>{
  if(settingsDirty&&!confirm("Discard unsaved configuration changes?")) {e.target.value=state.selected;return;}
  try {const id=e.target.value;filter="";directory="";commit((_,next)=>next.selected=id);if(view==="servers" || view==="setup") location.hash="overview";}
  catch(error){ e.target.value=state.selected;flash(error.message); }
});
window.addEventListener("hashchange",()=>{
  if(settingsDirty&&!confirm("Discard unsaved configuration changes?")) {history.replaceState(null,"","#"+view);return;}
  settingsDirty=false;filter="";
  view=routes.includes(location.hash.slice(1))?location.hash.slice(1):"servers";paint();
});
window.addEventListener("resize",()=>{if(state&&active()) draw(active());});
window.addEventListener("beforeunload",e=>{
  if(settingsDirty || (cloud && state!==acknowledged)) {e.preventDefault();e.returnValue="";}
});
async function initialize() {
  let owner="demo";
  if(location.protocol!=="file:" && !new URLSearchParams(location.search).has("demo")) {
    const response=await fetch("/api/session",{cache:"no-store"});
    if(!response.ok) throw Error("The account service is unavailable.");
    const session=await response.json();
    if(!session.email) { location.replace("./account.html#login");return; }
    owner="account:"+session.email;
    cloud=session.workspaceStorage==="mongodb";
  }
  storageKey="mzhost:sandbox:v1:"+owner;
  if(cloud) {
    const response=await fetch("/api/workspace",{cache:"no-store"});
    if(!response.ok) throw Error("Could not open the saved workspace. Refresh to try again.");
    const saved=await response.json();
    revision=saved.revision;state=saved.workspace;
    acknowledged=state;persistent=false;
    document.querySelector(".sandbox-tag").textContent="Online preview";
  } else {
    let cached;
    try { cached=sessionStorage.getItem(storageKey);sessionStorage.setItem(storageKey+":check","1");sessionStorage.removeItem(storageKey+":check"); }
    catch { persistent=false;flash("Tab storage is unavailable. Changes last until refresh."); }
    state=cached ? JSON.parse(cached) : owner==="demo" ? W.seed() : {servers:[],selected:""};
    for (const server of state.servers) server.deployments ??= [];
    if(!cached && persistent) sessionStorage.setItem(storageKey,JSON.stringify(state));
  }
  if(owner==="demo" && !location.hash) view="overview";
  paint();
  setInterval(()=>{
    if(view==="overview"&&active()&&!document.hidden&&!$("modal").open){
      const s=active(),tick=Math.floor(Date.now()/5000),values=$("content").querySelectorAll(".stat strong");
      if(values.length){values[0].textContent=sample(s,tick)+" MB";values[1].textContent=(s.started?(2+Math.abs(Math.sin(tick*.4))*2).toFixed(1):0)+"%";draw(s);}
    }
  },5000);
}
initialize().catch(error=>{$("content").textContent=error.message;});

