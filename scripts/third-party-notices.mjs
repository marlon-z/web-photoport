import {readFile,writeFile} from 'node:fs/promises';
const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
const rows=[];
for(const [path,p] of Object.entries(lock.packages)){if(!path||p.dev)continue;const name=path.split('node_modules/').at(-1);rows.push([name,p.version,p.license||'See package license']);}
rows.sort((a,b)=>a[0].localeCompare(b[0]));
await writeFile(new URL('../THIRD_PARTY_NOTICES.md',import.meta.url),'# Third-party notices\n\nThe PhotoPort source is MIT-licensed. Dependencies retain their own copyright and license notices, shipped inside their installed npm packages. This list is derived from the locked dependency manifest; consult each package LICENSE for full terms.\n\nDemo product artwork was generated for this project; no customer images are included.\n\n| Package | Version | License |\n|---|---|---|\n'+rows.map(r=>'| '+r.map(s=>String(s).replaceAll('|','\\|')).join(' | ')+' |').join('\n')+'\n');
console.log('Recorded licenses for '+rows.length+' locked dependency entries.');

