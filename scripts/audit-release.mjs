import {execFileSync} from 'node:child_process';
import {readFile,readdir,stat} from 'node:fs/promises';
import {dirname,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const excluded=new Set(['node_modules','.git','.wrangler','test-results','release']);
async function walk(dir){const list=[];for(const e of await readdir(dir,{withFileTypes:true})){if(excluded.has(e.name)||e.name.startsWith('.runtime'))continue;const p=join(dir,e.name);if(e.isDirectory())list.push(...await walk(p));else list.push(relative(root,p).replaceAll('\\','/'));}return list;}
let files;try{files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0').filter(Boolean);if(!files.length)files=await walk(root);}catch{files=await walk(root);}
const findings=[];
const patterns=[['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['GitHub token',/\bgh[pousr]_[A-Za-z0-9]{30,}/],['Airtable token',/\bpat[A-Za-z0-9]{12,}\.[A-Za-z0-9]{25,}/],['database credentials',/postgres(?:ql)?:\/\/[^\s:/]+:[^\s@]+@/],['home path',/[A-Za-z]:[\\/]Users[\\/][^\s/\\]+/]];
for(const f of files){
 if(/(^|\/)(?:\.runtime[^/]*|\.env[^/]*|\.dev\.vars|node_modules|test-results|release)(\/|$)/.test(f)&&!f.endsWith('.env.example'))findings.push({file:f,rule:'private/generated path'});
 const bytes=await readFile(join(root,f));if(bytes.length>10*1024*1024)findings.push({file:f,rule:'unexpected large file'});
 if(/\.(png|jpg|webp|zip|xlsx|ico)$/i.test(f))continue;
 const text=bytes.toString('utf8');for(const [rule,pattern] of patterns)if(pattern.test(text))findings.push({file:f,rule});
}
console.log(JSON.stringify({files:files.length,findings},null,2));
if(findings.length)process.exitCode=1;

