"use strict";
const GitHubPanel=(()=>{
  let sequence=0,busy=false;
  async function request(s,query={},body) {
    const url="/api/github?"+new URLSearchParams({server:s.id,...query});
    const response=await fetch(url,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...body,serverId:s.id,revision})}:{cache:"no-store"});
    const result=await response.json();
    if(!response.ok) throw Error(result.message||"Could not reach GitHub.");
    return result;
  }
  function render() {
    return '<section class="box repo-card">'+head("GitHub repository")+'<div id="github-source" role="status">Loading repository connection…</div></section>';
  }
  async function load(s) {
    const host=$("github-source");if(!host) return;
    if(!cloud) {host.textContent="Connect MongoDB workspace storage on this host to enable repository imports.";return;}
    const version=++sequence;
    try {
      const result=await request(s);
      if(!host.isConnected || version!==sequence) return;
      const link=result.link;
      const install=result.install?'<a class="inline-link" href="'+escapeHTML(result.install)+'" target="_blank" rel="noopener">Manage repository access ↗</a>':'';
      const login='<a class="button primary" href="/api/github-login?connect=1">'+(result.login?"Reconnect GitHub":"Connect GitHub")+'</a>';
      if(!result.login) {host.innerHTML='<p>Connect your GitHub account to import a repository and receive updates when you push.</p>'+login;return;}
      host.innerHTML='<div class="repo-account"><strong>'+escapeHTML(result.login)+'</strong>'+install+'</div>'+
        (link?'<h3>'+escapeHTML(link.repo)+'</h3><p><code>'+escapeHTML(link.branch)+'</code> · <code>'+escapeHTML(link.sha.slice(0,7))+'</code> · '+(link.auto?'Auto-update on':'Manual sync')+'</p><p>'+escapeHTML(link.result)+' · '+escapeHTML(dateTime(link.updated))+'</p>'+(link.error?'<p role="alert">'+escapeHTML(link.error)+'</p>':''):'<p>Choose a repository and branch to import into this server.</p>')+
        '<div class="controls">'+(link?button("Sync now","gh-sync","","accent")+button("Change repository","gh-pick")+button("Disconnect","gh-disconnect"):button("Choose repository","gh-pick","","accent"))+login+'</div>';
    } catch(error) {if(host.isConnected) host.textContent=error.message;}
  }
  async function list(s,type,query={}) {
    const values=[];let page=1;
    while(true) {
      const result=await request(s,{list:type,...query,page});
      values.push(...result.items);if(!result.more) return values;page++;
    }
  }
  async function refresh(s) {
    const response=await fetch("/api/workspace",{cache:"no-store"});
    if(!response.ok) throw Error("Files were imported. Reload to view the new workspace.");
    const saved=await response.json();
    if(acknowledged!==state || syncing || settingsDirty) throw Error("The import finished. Reload before saving further edits.");
    revision=saved.revision;state=saved.workspace;acknowledged=state;conflict=false;paint();
  }
  function guard(s) {
    if(!cloud || s.id!==active()?.id || syncedChangesPending()) throw Error("Finish saving your workspace before syncing.");
  }
  async function importAction(s,body) {
    guard(s);await request(s,{},body);await refresh(s);
    flash(body.action==="disconnect"?"Repository disconnected. Project files were kept.":"Repository files saved.");
  }
  async function picker(s) {
    const accounts=await list(s,"installations");
    if(active()?.id!==s.id || view!=="deployments") return;
    if(!accounts.length) throw Error("Use Manage repository access to install MzHost on a GitHub account first.");
    const choices=arr=>arr.map(item=>'<option value="'+escapeHTML(item.id)+'">'+escapeHTML(item.name)+'</option>').join("");
    const form='<label>GitHub account<select name="installation">'+choices(accounts)+'</select></label><label>Repository<select name="repo" required></select></label>'+field("Branch","branch","","required maxlength=255 list=github-branches")+'<datalist id="github-branches"></datalist>'+
      '<label class="checkbox-label"><input type="checkbox" name="auto" checked> Update on pushes to this branch</label><p>Importing replaces this server’s files and folders. Its environment and settings are kept. A running server restarts when its startup file is available.</p>';
    showModal("Import a repository",form,"Import files",async data=>importAction(s,{action:"bind",installation:Number(data.get("installation")),repoId:Number(data.get("repo")),branch:data.get("branch"),auto:data.has("auto")}));
    const fields=$("modal-form").elements;let generation=0,repos=[];
    const fillBranch=async()=>{
      const repo=fields.repo.value,choices=$("github-branches");
      fields.branch.value=repos.find(r=>String(r.id)===repo)?.branch||"";
      choices.replaceChildren();
      if(!repo) return;
      try {
        const result=await request(s,{list:"branches",repo});
        if(choices.isConnected && fields.repo.value===repo) choices.innerHTML=result.items.map(b=>'<option value="'+escapeHTML(b.name)+'"></option>').join("");
      } catch { /* The default and manually entered branch still work. */ }
    };
    const fillRepos=async()=>{
      const turn=++generation;fields.repo.disabled=true;fields.repo.innerHTML="";fields.branch.value="";
      try {
        const result=await list(s,"repos",{installation:fields.installation.value});
        if(turn!==generation || !fields.repo?.isConnected) return;
        repos=result;fields.repo.innerHTML=choices(repos);fillBranch();
        $("modal-error").textContent=repos.length?"":"Grant MzHost access to a repository on this account.";
      } catch(error) {if(turn===generation) $("modal-error").textContent=error.message;}
      finally {if(turn===generation && fields.repo) fields.repo.disabled=false;}
    };
    fields.installation.onchange=fillRepos;fields.repo.onchange=fillBranch;await fillRepos();
  }
  async function action(type,s) {
    if(busy) return;
    guard(s);busy=true;
    try {
      if(type==="gh-pick") return await picker(s);
      const unlink=type==="gh-disconnect";
      showModal(unlink?"Disconnect repository?":"Sync repository files?",unlink?"<p>Push updates stop. Your current files stay in this server.</p>":"<p>This replaces project files with the selected branch and restarts an active server when its startup file is available.</p>",unlink?"Disconnect":"Sync files",()=>importAction(s,{action:unlink?"disconnect":"sync"}));
    } finally {busy=false;}
  }
  return {render,load,action};
})();
