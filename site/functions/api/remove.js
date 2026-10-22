import {handleRemoval} from '../../lib/waitlist.mjs';
export const onRequest=context=>handleRemoval(context.request,context.env);

