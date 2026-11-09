import {registerHooks,createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {requireHostRoot} from './host-path.mjs';
const root=requireHostRoot();
const requireHost=createRequire(join(root,'package.json'));
const prefix=pathToFileURL(root).href.replace(/\/$/,'')+'/';
let resolving=false;
registerHooks({resolve(specifier,context,next){
  const hostPackage=specifier.startsWith('@deepseek-ai/')||specifier.startsWith('@earendil-works/')||specifier==='zod';
  if(!resolving&&!context.parentURL?.startsWith(prefix)&&hostPackage) {
    let resolved;resolving=true;
    try{resolved=requireHost.resolve(specifier);}finally{resolving=false;}
    return next(pathToFileURL(resolved).href,context);
  }
  return next(specifier,context);
}});
