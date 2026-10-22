import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {dirname,join,resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {handleSignup,handleRemoval} from './lib/waitlist.mjs';
const root=dirname(fileURLToPath(import.meta.url)),data=join(root,'../.runtime-site');await mkdir(data,{recursive:true});
const sql=new DatabaseSync(join(data,'preview.sqlite'));sql.exec(await readFile(join(root,'schema.sql'),'utf8'));
const prepare=query=>({bind:(...args)=>({run:async()=>({meta:{changes:Number(sql.prepare(query).run(...args).changes)}}),execute:()=>({meta:{changes:Number(sql.prepare(query).run(...args).changes)}})})});
const db={prepare,batch:async items=>{sql.exec('BEGIN');try{const r=items.map(i=>i.execute());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.xml':'application/xml','.txt':'text/plain'};
const server=http.createServer(async(req,res)=>{
 try{const url=new URL(req.url,'http://127.0.0.1:4182');if(['/api/waitlist','/api/remove'].includes(url.pathname)){
 const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>8192){res.writeHead(413);res.end();return;}chunks.push(c);}const request=new Request(url,{method:req.method,headers:{...req.headers,'cf-connecting-ip':'127.0.0.1'},...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
 const r=await(url.pathname==='/api/waitlist'?handleSignup:handleRemoval)(request,{WAITLIST:db,SIGNUPS_OPEN:'true'});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return;}
 let path=url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname;if(!extname(path))path+='.html';const file=resolve(root,'public','.'+path);if(!file.startsWith(resolve(root,'public')+'/')&&!file.startsWith(resolve(root,'public')+'\\'))throw Error();
 const bytes=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
 }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(4182,'127.0.0.1',()=>console.log('Website preview: http://127.0.0.1:4182'));
process.on('SIGINT',()=>server.close(()=>{sql.close();process.exit(0);}));

