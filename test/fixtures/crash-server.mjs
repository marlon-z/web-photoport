import {createServer} from '../../server.mjs';
import {LocalDestination} from '../../lib/adapters.mjs';
// Hold later writes so the parent can always interrupt a partially completed job,
// even when the CI machine completes the first files between progress requests.
class InterruptedDestination extends LocalDestination {
  started=0;
  async put(key,bytes){
    if(++this.started>16)await new Promise(()=>{});
    return super.put(key,bytes);
  }
}
const app=await createServer({runtime:process.argv[2],port:0,concurrency:8,destinationFactory:(...args)=>new InterruptedDestination(...args)});
console.log(app.origin);
