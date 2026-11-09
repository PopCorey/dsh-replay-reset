import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {requireHostRoot} from './host-path.mjs';
const root=requireHostRoot();
const {LlmRuntime}=await import(pathToFileURL(join(root,'node_modules/@deepseek-ai/dsh-llm/lib/index.js')));
const descriptor=Object.getOwnPropertyDescriptor(LlmRuntime.prototype,'adapterStream');
if(typeof descriptor?.value!=='function')throw new Error('Host adapterStream method not found');
console.log(JSON.stringify({descriptor:{writable:descriptor.writable,configurable:descriptor.configurable},sha256:createHash('sha256').update(Function.prototype.toString.call(descriptor.value)).digest('hex'),name:descriptor.value.name,length:descriptor.value.length},null,2));
