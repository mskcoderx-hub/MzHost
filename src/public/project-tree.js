"use strict";
const ProjectTree=(()=>{
  function path(value) {
    if(typeof value!=="string" || !value || value.length>160 || value.split("/").some(p=>!/^[\w.-][\w. -]{0,79}$/.test(p) || p==="." || p==="..")) throw Error("Use a relative project path such as src/main.py.");
    return value;
  }
  const under=(p,root)=>p===root || p.startsWith(root+"/");
  function folders(s) {
    const dirs=new Set(s.folders || []);
    for(const p of [...dirs,...s.files.map(f=>f.path)]) {
      const parts=p.split("/");parts.pop();
      while(parts.length) {dirs.add(parts.join("/"));parts.pop();}
    }
    return [...dirs].sort();
  }
  function validate(s) {
    if(!Array.isArray(s.files) || !Array.isArray(s.folders || []) || s.files.length>80 || (s.folders?.length || 0)>160) throw Error("Projects support up to 80 files and 160 saved folders.");
    const files=new Set(s.files.map(f=>path(f.path)));
    const dirs=new Set(folders(s).map(path));
    if(files.size!==s.files.length || [...files].some(p=>dirs.has(p))) throw Error("A file or folder already uses that path.");
  }
  function addFolder(s,value) {
    path(value);
    if(folders(s).includes(value)) throw Error("That folder already exists.");
    (s.folders??=[]).push(value);validate(s);
  }
  function roots(values) {
    const unique=[...new Set(values)];
    return unique.filter(p=>!unique.some(parent=>p!==parent && under(p,parent)));
  }
  function relocate(s,values,destination,newName) {
    const selected=roots(values),dirs=folders(s),occupied=new Set([...dirs,...s.files.map(f=>f.path)]);
    if(destination && !dirs.includes(destination)) throw Error("Choose an existing destination folder.");
    const targets=new Map();
    for(const p of selected) {
      if(!occupied.has(p) || (destination && under(destination,p))) throw Error("Choose a destination outside the selected items.");
      const leaf=newName??p.split("/").pop();
      if(!leaf || leaf.includes("/")) throw Error("Enter a single file or folder name.");
      const target=path((destination?destination+"/":"")+leaf);
      if(target===p && selected.length===1) throw Error("Choose a different name or destination.");
      if(target!==p && (occupied.has(target) || [...targets.values()].includes(target))) throw Error("The destination already contains "+leaf+".");
      targets.set(p,target);
    }
    const map=p=>{const root=selected.find(r=>under(p,r));return root?targets.get(root)+p.slice(root.length):p;};
    // Preserve emptied source directories as well as the moved subtree.
    s.folders=[...new Set(dirs.map(map))];
    for(const file of s.files) file.path=map(file.path);
    s.entry=map(s.entry);validate(s);
  }
  function remove(s,values) {
    const selected=roots(values),included=p=>selected.some(r=>under(p,r));
    if(s.entry && included(s.entry)) throw Error("Choose another startup file before deleting this selection.");
    s.folders=folders(s).filter(p=>!included(p));s.files=s.files.filter(f=>!included(f.path));
  }
  return {path,under,folders,validate,addFolder,roots,relocate,remove};
})();
if(typeof module!=="undefined") module.exports=ProjectTree;
