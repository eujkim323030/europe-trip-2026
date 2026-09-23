import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import seeds from '../netlify/data/seeds.json' with {type:'json'};
import { createHandler } from '../netlify/lib/api.mjs';

const entries=new Map();let counter=0;
const store={
  async getWithMetadata(key){return structuredClone(entries.get(key)||null);},
  async setJSON(key,data,options={}){
    const old=entries.get(key);
    if((options.onlyIfNew&&old)||(options.onlyIfMatch&&old?.etag!==options.onlyIfMatch))return {modified:false};
    const etag=String(++counter);entries.set(key,{data:structuredClone(data),etag});return {modified:true,etag};
  },
};
const handler=createHandler({store,seeds,pin:'3141592653',secret:'local-development-only-secret-not-production',secure:false});
const root=path.resolve('dist');
createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1:8787');
    if(url.pathname.startsWith('/api/trip/')) {
      let body='';for await(const chunk of req){body+=chunk;if(body.length>520000){res.writeHead(413);res.end();return;}}
      const result=await handler(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body})}),{ip:'local'});
      res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());return;
    }
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname)+(url.pathname.endsWith('/')?'index.html':''));
    if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json'};
    const contents=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(contents);
  }catch{res.writeHead(404);res.end('Not found');}
}).listen(8787,'127.0.0.1',()=>console.log('Local editor preview: http://127.0.0.1:8787 (in-memory test storage)'));
