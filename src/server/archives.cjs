const {deflateRawSync,crc32}=require("node:zlib");
const tree=require("../public/project-tree.js");
const FILE_LIMIT=256*1024, TOTAL_LIMIT=3*1024*1024;
function fileRecord(path,bytes) {
  tree.path(path);
  if(bytes.length>FILE_LIMIT) throw Error("A file exceeds the 256 KB project limit.");
  try {
    const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
    if(!/[\x00-\x08\x0e-\x1f]/.test(text)) return {path,text};
  } catch {}
  return {path,binary:true,data:Buffer.from(bytes).toString("base64")};
}
function pack(files,folders=[]) {
  tree.validate({files,folders});
  const parts=[],central=[];let offset=0,total=0;
  const put=(name,raw)=>{
    total+=raw.length;
    if(raw.length>FILE_LIMIT || total>TOTAL_LIMIT) throw Error("Selection is too large to compress.");
    const body=deflateRawSync(raw),filename=Buffer.from(name);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);
    local.writeUInt16LE(8,8);local.writeUInt16LE(33,12);local.writeUInt32LE(crc32(raw),14);
    local.writeUInt32LE(body.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(filename.length,26);
    const entry=Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);local.copy(entry,6,4,30);
    entry.writeUInt32LE(name.endsWith("/")?16:0,38);entry.writeUInt32LE(offset,42);
    central.push(entry,filename);parts.push(local,filename,body);offset+=local.length+filename.length+body.length;
  };
  for(const dir of folders) put(dir+"/",Buffer.alloc(0));
  for(const f of files) put(f.path,f.binary?Buffer.from(f.data,"base64"):Buffer.from(f.text));
  const index=Buffer.concat(central),end=Buffer.alloc(22),count=files.length+folders.length;
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);
  end.writeUInt32LE(index.length,12);end.writeUInt32LE(offset,16);
  const bytes=Buffer.concat([...parts,index,end]);
  if(bytes.length>FILE_LIMIT) throw Error("The resulting ZIP exceeds the 256 KB file limit.");
  return bytes.toString("base64");
}
// Windows ships libarchive. This also lets an offline local preview read RAR files.
async function windowsRar(bytes) {
  const path=require("node:path"),fs=require("node:fs/promises");
  const exe=path.join(process.env.SystemRoot,"System32","tar.exe"),end=Date.now()+8000;
  const dir=await fs.mkdtemp(path.join(require("node:os").tmpdir(),"mzhost-rar-"));
  const archivePath=path.join(dir,"archive.rar");
  try {
    await fs.writeFile(archivePath,bytes,{flag:"wx"});
    return await extract();
  } finally {
    await fs.rm(archivePath,{force:true});
    await fs.rmdir(dir);
  }
  function read(args,maxBuffer) {
    return new Promise((resolve,reject)=>{
      if(Date.now()>=end) return reject(Error("Archive processing timed out."));
      const child=require("node:child_process").execFile(exe,args,{windowsHide:true,encoding:"buffer",maxBuffer,timeout:end-Date.now()},(error,out)=>{
        if(error) reject(Error("Could not read the RAR within project limits."));else resolve(out);
      });
      child.stdin.end();
    });
  }
  async function extract() {
    const listing=(await read(["-tf",archivePath],40000)).toString().split(/\r?\n/).filter(Boolean);
    if(listing.length>240) throw Error("Archive exceeds the project limits.");
    const files=[],folders=[],seen=new Set();let total=0;
    for(const item of listing) {
      const dir=item.endsWith("/"),name=tree.path(dir?item.slice(0,-1):item);
      if(seen.has(name)) throw Error("Archive contains duplicate names.");
      seen.add(name);
      if(dir) {folders.push(name);continue;}
      if(files.length>=80) throw Error("Archive exceeds the project file limit.");
      const raw=await read(["-xOf",archivePath,"--",name],FILE_LIMIT);
      total+=raw.length;if(total>TOTAL_LIMIT) throw Error("Archive exceeds the workspace size limit.");
      files.push(fileRecord(name,raw));
    }
    tree.validate({files,folders});return {files,folders};
  }
}
async function unpack(data,kind) {
  const bytes=Buffer.from(data,"base64"),files=[],folders=[],seen=new Set();
  if(bytes.length>FILE_LIMIT) throw Error("Choose an archive up to 256 KB.");
  let total=0;
  function header(raw,dir,size) {
    const name=tree.path(dir?raw.replace(/\/$/,""):raw);
    if(seen.has(name)) throw Error("Archive contains duplicate names.");
    seen.add(name);total+=size;
    if(!Number.isSafeInteger(size) || size<0 || size>FILE_LIMIT || total>TOTAL_LIMIT || seen.size>240) throw Error("Archive exceeds the project size limits.");
    if(dir) folders.push(name);
    return name;
  }
  if(kind==="rar") {
    if(!bytes.subarray(0,6).equals(Buffer.from("526172211a07","hex"))) throw Error("Invalid RAR archive.");
    let createExtractorFromData;
    try {({createExtractorFromData}=require("node-unrar-js"));}
    catch(error) {if(error.code==="MODULE_NOT_FOUND" && process.platform==="win32") return windowsRar(bytes);throw error;}
    const extractor=await createExtractorFromData({data:Uint8Array.from(bytes).buffer});
    for(const h of extractor.getFileList().fileHeaders) {
      if(h.flags.encrypted) throw Error("Password-protected archives are unsupported.");
      header(h.name.replaceAll("\\","/"),h.flags.directory,h.unpSize);
    }
    for(const item of extractor.extract().files) {
      if(!item.fileHeader.flags.directory) files.push(fileRecord(item.fileHeader.name.replaceAll("\\","/"),item.extraction));
    }
  } else if(kind==="zip") {
    const archive=await require("yauzl").fromBufferPromise(bytes,{lazyEntries:true,strictFileNames:true});
    try {
      for await(const entry of archive.eachEntry()) {
        if(entry.isEncrypted() || ((entry.externalFileAttributes>>>16)&0xf000)===0xa000) throw Error("Encrypted entries and symbolic links are unsupported.");
        const dir=entry.fileName.endsWith("/"),name=header(entry.fileName,dir,entry.uncompressedSize);
        if(dir) continue;
        const stream=await archive.openReadStreamPromise(entry), chunks=[];let length=0;
        for await(const chunk of stream) {length+=chunk.length;if(length>entry.uncompressedSize) throw Error("Invalid ZIP entry size.");chunks.push(chunk);}
        const body=Buffer.concat(chunks);
        if(crc32(body)!==entry.crc32) throw Error("ZIP checksum failed.");
        files.push(fileRecord(name,body));
      }
    } finally {archive.close();}
  } else throw Error("Choose a ZIP or RAR archive.");
  tree.validate({files,folders});return {files,folders};
}
async function archiveRequest(ctx) {
  const {req,send,store,oldToken,sameOrigin,secure,readBody}=ctx;
  if(req.method!=="POST" || !sameOrigin()) return send(403,{});
  const session=oldToken && await store.session(oldToken,Date.now());
  if((secure || process.env.NODE_ENV==="production") && !session) return send(401,{message:"Sign in to manage archives."});
  if(!await store.allowAttempt("archive:"+(session?.email||"local"),Date.now(),30)) return send(429,{message:"Retry in a minute."});
  const body=await readBody(req,4*1024*1024);
  try {
    if(body?.action==="compress") return send(200,{data:pack(body.files,body.folders)});
    if(body?.action==="extract" && typeof body.data==="string") return send(200,await unpack(body.data,body.kind));
    return send(400,{message:"Choose a supported archive action."});
  } catch(error) {
    if(error.code==="MODULE_NOT_FOUND") return send(503,{message:"Install the archive dependencies on the host."});
    return send(400,{message:error.message?.slice(0,180) || "Could not read this archive."});
  }
}
module.exports={archiveRequest,fileRecord,pack,unpack};
