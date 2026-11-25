const test=require("node:test");
const assert=require("node:assert/strict");
const tree=require("../src/public/project-tree.js");
const {pack,unpack}=require("../src/server/archives.cjs");

test("moving and renaming nested folders preserves empty folders and the startup path",()=>{
  const s={files:[{path:"src/pkg/main.py",text:"pass"}],entry:"src/pkg/main.py"};
  tree.addFolder(s,"dest");
  tree.relocate(s,["src/pkg","src/pkg/main.py"],"dest");
  assert.equal(s.entry,"dest/pkg/main.py");
  assert.ok(tree.folders(s).includes("src"));
  tree.relocate(s,["dest/pkg"],"dest","app");
  assert.equal(s.files[0].path,"dest/app/main.py");
  assert.throws(()=>tree.relocate(s,["dest"],"dest/app"));
  assert.throws(()=>tree.remove(s,["dest"]));
  tree.remove(s,["src"]);
  assert.ok(!tree.folders(s).includes("src"));
});
test("ZIP round trip preserves binary bytes, UTF-8 text and empty folders",async()=>{
  const files=[{path:"src/main.py",text:"print('hello')\n"},{path:"data.bin",binary:true,data:"AP8="}];
  const folders=["src","empty"];
  assert.deepEqual(await unpack(pack(files,folders),"zip"),{files,folders});
  assert.throws(()=>pack([{path:"../main.py",text:""}]));
  assert.throws(()=>pack([{path:"x",text:"a".repeat(262145)}]));
});
test("RAR 5 fixture extracts a text file",async()=>{
  const fixture="UmFyIRoHAQAzkrXlCgEFBgAFAQGAgADVYRziJQIDC4oABIoAICXQLzuAAAAJaGVsbG8udHh0CgMCv/iF7Qh93QFyYXIgc2FtcGxlHXdWUQMFBAA=";
  assert.deepEqual(await unpack(fixture,"rar"),{folders:[],files:[{path:"hello.txt",text:"rar sample"}]});
});
