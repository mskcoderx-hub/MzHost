"use strict";
const FileManager=(()=>{
  let owner="",scope="",selected=new Set();
  function items(s) {
    if(owner!==s.id || scope!==directory+"|"+filter) {owner=s.id;scope=directory+"|"+filter;selected.clear();}
    const query=filter.toLowerCase().trim();
    const visible=p=>query?p.toLowerCase().includes(query):p.startsWith(directory) && !p.slice(directory.length).includes("/");
    const dirs=ProjectTree.folders(s).filter(visible).map(path=>({path,folder:true}));
    return [...dirs,...s.files.filter(f=>visible(f.path)).sort((a,b)=>a.path.localeCompare(b.path))];
  }
  function rows(s) {
    const list=items(s);
    const visible=new Set(list.map(f=>f.path));
    selected=new Set([...selected].filter(p=>visible.has(p)));
    const check=(id,attrs,on)=>'<input type="checkbox" '+id+' '+attrs+(on?' checked':'')+'>';
    const toolbar='<div class="selection-tools"><label>'+check('id="select-all"','aria-label="Select all visible items"',list.length && selected.size===list.length)+'Select all</label><span>'+ (selected.size?selected.size+' selected':list.length+' items')+'</span>'+(selected.size?button("Move","fm-move")+button("Compress","fm-compress")+button("Delete","fm-delete","","danger"):"")+'</div>';
    return toolbar+list.map(f=>{
      const p=f.path,name=filter?p:p.split("/").pop(),open=f.folder?"directory":"open-file";
      const val=f.folder?p+"/":p;
      const archive=/\.(zip|rar)$/i.test(p) && !f.folder;
      const menu=button("Open",open,val)+button("Rename","fm-rename",p)+button("Move","fm-move",p)+button("Compress","fm-compress",p)+(archive?button("Extract","fm-extract",p):"")+(f.folder?"":button("Download","download",p))+(W.runnable(s.runtime,f) && p!==s.entry?button("Set as startup","set-entry",p):"")+button("Delete","fm-delete",p,"danger");
      return '<div class="file-row">'+check('data-file-select="'+escapeHTML(p)+'"','aria-label="Select '+escapeHTML(p)+'"',selected.has(p))+
        '<span class="file-symbol '+(f.folder?'folder-symbol':'')+'" aria-hidden="true"></span>'+button(name,open,val,"file-name")+
        (s.entry===p?'<span class="entry-tag">Startup</span>':'')+'<span class="file-size">'+(f.folder?'Folder':size(used(f)))+'</span>'+
        '<details class="file-menu"><summary aria-label="Actions for '+escapeHTML(p)+'">Actions</summary><div>'+menu+'</div></details></div>';
    }).join("")+(list.length?"":'<p class="empty">'+(filter?'No matching files or folders.':'This folder is empty. Create a file or upload your project.')+'</p>');
  }
  function render(s) {
    const dirs=ProjectTree.folders(s);
    if(directory && !dirs.includes(directory.slice(0,-1))) directory="";
    const crumbs=[button("Project root","directory","","file-name")];
    let prefix="";
    for(const part of directory.split("/").filter(Boolean)) {prefix+=part+"/";crumbs.push(button(part,"directory",prefix,"file-name"));}
    const launch=W.startup(s);
    const suggestion=!launch.selected && launch.suggested?button("Use "+launch.suggested.path,"set-entry",launch.suggested.path):"";
    return '<section class="box file-browser">'+head("Project files",button("Upload files","upload","","accent"))+
      '<div class="file-tools"><input id="file-search" class="file-search" aria-label="Search project" placeholder="Search files and folders" value="'+escapeHTML(filter)+'">'+
      button("New file","new-file")+button("New folder","fm-folder")+button("Upload folder","upload-folder")+'</div>'+
      '<nav class="file-crumbs" aria-label="Folder path">'+crumbs.join('<span>/</span>')+'</nav><div id="file-list">'+rows(s)+'</div></section>'+
      '<section class="box startup-strip">'+startupPicker(s)+suggestion+(launch.selected?'<code>'+escapeHTML(launch.command)+'</code>'+button("Edit startup file","open-file",s.entry):'')+'</section>';
  }
  function select(input,s) {
    const list=items(s);
    if(input.id==="select-all") selected=new Set(input.checked?list.map(item=>item.path):[]);
    else if(input.checked) selected.add(input.dataset.fileSelect);else selected.delete(input.dataset.fileSelect);
    $("file-list").innerHTML=rows(s);
    const focus=[...$("file-list").querySelectorAll("input")].find(el=>input.id?el.id===input.id:el.dataset.fileSelect===input.dataset.fileSelect);
    focus?.focus();
  }
  async function archive(body) {
    const response=await fetch("/api/archive",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const result=await response.json();
    if(!response.ok) throw Error(result.message||"Archive processing failed.");
    return result;
  }
  function action(kind,value,s) {
    const targets=value?[value]:ProjectTree.roots([...selected]);
    const inSelection=p=>targets.some(root=>ProjectTree.under(p,root));
    const dirs=ProjectTree.folders(s);
    const change=(operation,message)=>commit(server=>{
      if(server.id!==s.id) throw Error("The selected server changed.");
      operation(server);ProjectTree.validate(server);W.event(server,message);selected.clear();
    });
    if(kind==="fm-folder") return showModal("New folder",field("Folder name","name","","required maxlength=80"),"Create folder",data=>{
      const name=data.get("name").trim();if(name.includes("/")) throw Error("Enter a folder name.");
      change(server=>ProjectTree.addFolder(server,directory+name),"Created folder "+name);
    });
    if(!targets.length) throw Error("Select files or folders first.");
    if(kind==="fm-rename") return showModal("Rename",field("New name","name",value.split("/").pop(),"required maxlength=80"),"Rename",data=>{
      const parent=value.split("/").slice(0,-1).join("/");
      change(server=>ProjectTree.relocate(server,targets,parent,data.get("name").trim()),"Renamed "+value);
    });
    if(kind==="fm-move") {
      const choices=["",...dirs.filter(p=>!inSelection(p))];
      return showModal("Move "+targets.length+" item(s)",'<label>Destination folder<select name="destination">'+choices.map(p=>'<option value="'+escapeHTML(p)+'">'+escapeHTML(p||"Project root")+'</option>').join("")+'</select></label>',"Move here",data=>change(server=>ProjectTree.relocate(server,targets,data.get("destination")),"Moved "+targets.length+" item(s)"));
    }
    if(kind==="fm-delete") return showModal("Delete selected items?",'<p>'+escapeHTML(targets.slice(0,5).join(", "))+'</p><p>Selected folders and their contents will be removed.</p>',"Delete",()=>change(server=>ProjectTree.remove(server,targets),"Deleted "+targets.length+" item(s)"));
    if(kind==="fm-compress") {
      const prefix=directory && targets.every(p=>p.startsWith(directory))?directory:"";
      return showModal("Compress to ZIP",field("Archive name","name",targets.length===1?targets[0].split("/").pop()+".zip":"project.zip","required maxlength=80"),"Create ZIP",async data=>{
        let name=data.get("name").trim();if(name.includes("/")) throw Error("Enter an archive filename.");
        if(!/\.zip$/i.test(name)) name+=".zip";
        const result=await archive({action:"compress",files:s.files.filter(f=>inSelection(f.path)).map(f=>({...f,path:f.path.slice(prefix.length)})),folders:dirs.filter(inSelection).map(p=>p.slice(prefix.length))});
        change(server=>W.storeFile(server,{path:directory+name,binary:true,data:result.data}),"Created "+name);
      });
    }
    if(kind==="fm-extract") {
      const f=s.files.find(item=>item.path===value);
      return showModal("Extract archive",field("Extract into folder","folder",value.replace(/\.(zip|rar)$/i,"")+"-extracted","required maxlength=160"),"Extract",async data=>{
        const target=ProjectTree.path(data.get("folder").trim());
        const bytes=f.binary?f.data:await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(",")[1]);reader.onerror=reject;reader.readAsDataURL(new Blob([f.text]));});
        const result=await archive({action:"extract",kind:value.split(".").pop().toLowerCase(),data:bytes});
        change(server=>{
          ProjectTree.addFolder(server,target);
          for(const dir of result.folders) server.folders.push(target+"/"+dir);
          for(const file of result.files) W.storeFile(server,{...file,path:target+"/"+file.path});
        },"Extracted "+value);
        directory=target+"/";filter="";paint();
      });
    }
  }
  return {render,rows,select,action,clear:()=>selected.clear()};
})();
