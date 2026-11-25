import {Readable} from "node:stream";
import mongoAccounts from "../src/server/mongo-accounts.cjs";

// Read the signed webhook bytes before any JSON parsing.
export async function POST(request) {
  const req=request.body?Readable.fromWeb(request.body):Readable.from([]);
  Object.assign(req,{method:"POST",url:request.url,headers:Object.fromEntries(request.headers)});
  let status=500,headers={},body;
  const response={
    writeHead(code,values){status=code;headers=values;return this;},
    end(value){body=value;}
  };
  const handle=await mongoAccounts();
  await handle("github-hook",req,response);
  return new Response(body,{status,headers});
}
