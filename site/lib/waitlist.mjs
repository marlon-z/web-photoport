export const CONSENT_VERSION='2026-10-22';
export const CAPS={total:1000,daily:100,ipHourly:5};
export const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
export const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
export async function sha(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
const token=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');

async function readBody(request){
  if(request.method!=='POST')throw Object.assign(new Error('method'),{status:405});
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('x-photoport-form')!=='1')throw Object.assign(new Error('origin'),{status:403});
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw Object.assign(new Error('type'),{status:415});
  if(Number(request.headers.get('content-length')||0)>4096)throw Object.assign(new Error('large'),{status:413});
  if(!request.body)throw Object.assign(new Error('body'),{status:400});
  const reader=request.body.getReader();let size=0;const chunks=[];
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096){await reader.cancel();throw Object.assign(new Error('large'),{status:413});}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw Object.assign(new Error('json'),{status:400});}
}

export async function handleSignup(request,env,{now=Date.now()}={}){
  try{
    if(!env.WAITLIST||env.SIGNUPS_OPEN!=='true')return json({error:'Registration is temporarily unavailable. Please try again later.'},503);
    const body=await readBody(request);
    if(body.website)return json({ok:true}); // A hidden field catches basic automated submissions; nothing is stored.
    const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
    if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||body.consent!==true||!['products','clients','archive','other'].includes(body.scenario)||!['under-1','1-10','over-10','unknown'].includes(body.batch)||!['yes','maybe','no','unknown'].includes(body.price))return json({error:'Check the email, selections and consent box.'},400);
    if(typeof body.need!=='string'||body.need.length>500)return json({error:'Please keep the description under 500 characters.'},400);
    const seconds=Math.floor(now/1000),day=Math.floor(seconds/86400),hour=Math.floor(seconds/3600);
    const ip=request.headers.get('cf-connecting-ip');
    if(!ip)return json({error:'Registration is temporarily unavailable.'},503);
    const ipKey='ip:'+hour+':'+await sha(day+':'+ip),dayKey='day:'+day;
    const id=crypto.randomUUID(),removeToken=token(),hash=await sha(removeToken);
    const db=env.WAITLIST;
    const upsert=(key,expiry)=>db.prepare('INSERT INTO limits(key,attempts,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1').bind(key,expiry);
    const results=await db.batch([
      db.prepare("DELETE FROM limits WHERE expires_at < ? AND key != 'total'").bind(seconds),
      upsert('total',253402300799),upsert(dayKey,(day+2)*86400),upsert(ipKey,(hour+2)*3600),
      db.prepare("INSERT INTO waitlist(id,email,scenario,batch_size,price_interest,need,consent_version,created_at,delete_hash) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT attempts FROM limits WHERE key='total')<=? AND (SELECT attempts FROM limits WHERE key=?)<=? AND (SELECT attempts FROM limits WHERE key=?)<=?").bind(id,email,body.scenario,body.batch,body.price,body.need.trim(),CONSENT_VERSION,seconds,hash,CAPS.total,dayKey,CAPS.daily,ipKey,CAPS.ipHourly)
    ]);
    if(results[4].meta.changes!==1)return json({error:'Registration is paused or too many attempts were made. Please try again later.'},429);
    return json({ok:true,removeToken},201);
  }catch(error){return json({error:error.status?'Invalid registration request.':'Registration could not be saved. Please try again later.'},error.status||503);}
}

export async function handleRemoval(request,env){
  try{
    if(!env.WAITLIST)return json({error:'Please try again later.'},503);
    const body=await readBody(request);
    if(typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token))return json({error:'Invalid removal link.'},400);
    await env.WAITLIST.prepare('DELETE FROM waitlist WHERE delete_hash=?').bind(await sha(body.token)).run();
    return json({ok:true}); // Same response whether an entry existed or had already been removed.
  }catch(error){return json({error:'The request could not be completed. Please try again.'},error.status||503);}
}

