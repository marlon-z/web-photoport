import {createServer} from '../../server.mjs';
const app=await createServer({runtime:process.argv[2],port:0,concurrency:8});
console.log(app.origin);
