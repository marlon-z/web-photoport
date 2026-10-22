import {handleSignup} from '../../lib/waitlist.mjs';
export const onRequest=context=>handleSignup(context.request,context.env);

