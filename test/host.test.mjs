import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {installBridge, fingerprint, HOST_FINGERPRINT} from '../src/host-bridge.js';

import {requireHostRoot} from '../scripts/host-path.mjs';
const root=requireHostRoot();
const {LlmRuntime,isAgentLoopRequest,markAgentLoopRequest}=await import(pathToFileURL(root+'/node_modules/@deepseek-ai/dsh-llm/lib/index.js'));
const originalDescriptor=Object.getOwnPropertyDescriptor(LlmRuntime.prototype,'adapterStream');
const owner=Symbol.for('dsh-replay-reset.adapter-bridge.v1');
const deferred=()=>Promise.withResolvers();
function fixture({marked=true,dispatch,project,getGate}={}) {
  const prototype=Object.create(LlmRuntime.prototype);
  Object.defineProperty(prototype,'adapterStream',originalDescriptor);
  const runtime=Object.create(prototype), adapter={};
  runtime.adapters=new Map([['agentrouter',{adapter}]]);
  let rebinds=0,projections=0,dispatches=0,seen;
  runtime.registration=()=>{rebinds++;throw new Error('prepared dispatch must not rebind');};
  runtime.forAdapter=function(options,actual){assert.equal(this,runtime);assert.equal(actual,adapter);return options;};
  const signal=new AbortController().signal;
  const options=Object.freeze({provider:'agentrouter',model:'gpt-6-astra',sessionId:'root',messages:Object.freeze([]),tools:Object.freeze([]),signal});
  if(marked) markAgentLoopRequest(options);
  const prepared={registration:{adapter},config:options,modelInfo:{},dispatch:options=>{
    dispatches++;seen=options;
    return dispatch ? dispatch(options) : (async function*(){yield {type:'finish',reason:{kind:'stop'}};})();
  }};
  const dispose=installBridge({prototype,isMarked:isAgentLoopRequest,mark:markAgentLoopRequest,getGate:getGate??(()=>undefined),project:options=>{projections++;return project?project(options):options;}});
  return {prototype,runtime,options,prepared,dispose,stats:()=>({rebinds,projections,dispatches,seen})};
}

test('real host method fingerprint and descriptor match the pinned seam',()=>{
  assert.equal(fingerprint(originalDescriptor.value),HOST_FINGERPRINT);
  assert.equal(originalDescriptor.configurable,true);
  assert.equal(originalDescriptor.value.constructor.name,'AsyncGeneratorFunction');
});

test('prepared registration, this, signal and unchanged options reach exactly one dispatch',async()=>{
  const f=fixture();
  try {
    const chunks=[];
    for await(const chunk of f.runtime.adapterStream(f.options,f.prepared)) chunks.push(chunk);
    assert.equal(chunks.length,1);
    assert.equal(f.stats().dispatches,1);
    assert.equal(f.stats().rebinds,0);
    assert.equal(f.stats().seen,f.options);
    assert.equal(f.stats().seen.signal,f.options.signal);
  }finally{f.dispose();}
});

test('actual streamWithRegistration traverses middleware once without recursion',async()=>{
  const f=fixture({project:options=>Object.freeze({...options,messages:Object.freeze([...options.messages])})});
  let calls=0;
  f.runtime.ctx={waterfall(subject,event,options,next){calls++;assert.equal(subject,f.runtime);assert.equal(event,'llm/stream');assert.equal(options,f.options);return next();}};
  try {
    for await(const _ of f.runtime.streamWithRegistration(f.options,f.prepared)) {}
    assert.equal(calls,1);
    assert.equal(f.stats().dispatches,1);
    assert.equal(f.stats().projections,1);
    assert.notEqual(f.stats().seen,f.options);
    assert.equal(f.stats().seen.signal,f.options.signal);
    assert.equal(f.stats().seen.tools,f.options.tools);
    assert.equal(isAgentLoopRequest(f.stats().seen),true,'WeakSet mark must be reapplied to copied options');
  }finally{f.dispose();}
});

test('real prepareCall handle stays one-shot across adapter replacement',async()=>{
  const f=fixture({project:options=>Object.freeze({...options,messages:Object.freeze([...options.messages])})});
  let preparations=0,dispatches=0;
  const oldAdapter={prepareCall:async(provider,model,signal)=>{
    preparations++;assert.equal(signal,f.options.signal);
    return {model:{provider,id:model,name:model},stream:async function*(options){dispatches++;assert.equal(options.signal,f.options.signal);yield {generation:'old'};}};
  }};
  const registration={provider:{id:'agentrouter'},adapter:oldAdapter,retryPolicy:{}};
  f.runtime.adapters.set('agentrouter',registration);
  f.runtime.registration=()=>registration;
  f.runtime.forAdapter=function(options,adapter){assert.equal(this,f.runtime);assert.equal(adapter,oldAdapter);return options;};
  f.runtime.ctx={waterfall(_subject,_event,_options,next){return next();}};
  try {
    const call=await f.runtime.prepareCall({provider:'agentrouter',model:'gpt-6-astra'},f.options.signal);
    f.runtime.registration=()=>{throw Error('new registration must not be consulted');};
    f.runtime.adapters.set('agentrouter',{provider:{id:'agentrouter'},adapter:{prepareCall(){throw Error('new adapter must not prepare');}}});
    const options=markAgentLoopRequest(Object.freeze({...call.config,messages:Object.freeze([]),sessionId:'root',signal:f.options.signal}));
    const values=[];for await(const value of call.stream(options))values.push(value);
    assert.deepEqual(values,[{generation:'old'}]);assert.equal(preparations,1);assert.equal(dispatches,1);
    assert.throws(()=>call.stream(options),error=>error.code==='INVALID_PREPARED_CALL');
    assert.equal(dispatches,1);
  }finally{f.dispose();}
});

test('modified prepared config is rejected by the original boundary before dispatch',async()=>{
  const f=fixture({project:options=>({...options,model:'changed-model'})});
  try {
    const output=(await f.runtime.adapterStream(f.options,f.prepared).next()).value;
    assert.equal(output.type,'finish');assert.equal(output.reason.kind,'error');
    assert.equal(output.reason.failure.code,'INVALID_PREPARED_CALL');assert.equal(f.stats().dispatches,0);
  }finally{f.dispose();}
});

test('non-agent requests never consult policy or gate and retain identity',async()=>{
  const f=fixture({marked:false,project:()=>{throw Error('must not project');},getGate:()=>{throw Error('must not gate');}});
  try {
    for await(const _ of f.runtime.adapterStream(f.options,f.prepared)) {}
    assert.equal(f.stats().seen,f.options);
    assert.equal(f.stats().projections,0);
  }finally{f.dispose();}
});

test('startup gate defers projection and dispatch until policy is ready',async()=>{
  const ready=deferred();let version='before';
  const f=fixture({getGate:()=>ready.promise,project:options=>({...options,policyVersion:version})});
  try {
    const stream=f.runtime.adapterStream(f.options,f.prepared),next=stream.next();
    await Promise.resolve();
    assert.equal(f.stats().dispatches,0);assert.equal(f.stats().projections,0);
    version='after';ready.resolve();
    assert.equal((await next).done,false);
    assert.equal(f.stats().seen.policyVersion,'after');
    await stream.return();
  }finally{ready.resolve();f.dispose();}
});

test('aborting a waiting startup gate rejects without projection or dispatch',async()=>{
  const ready=deferred(),abort=new AbortController(),reason=new Error('test cancellation');
  const f=fixture({getGate:()=>ready.promise});
  const options=markAgentLoopRequest({...f.options,signal:abort.signal});
  try {
    const stream=f.runtime.adapterStream(options,f.prepared),next=stream.next();
    abort.abort(reason);
    await assert.rejects(next,e=>e===reason);
    assert.equal(f.stats().dispatches,0);assert.equal(f.stats().projections,0);
  }finally{ready.resolve();f.dispose();}
});

test('failed startup gate never dispatches a request with stale policy',async()=>{
  const ready=deferred(),reason=new Error('policy load failed');
  const f=fixture({getGate:()=>ready.promise});
  try {
    const next=f.runtime.adapterStream(f.options,f.prepared).next();
    ready.reject(reason);await assert.rejects(next,e=>e===reason);
    assert.equal(f.stats().dispatches,0);
  }finally{f.dispose();}
});

test('early return closes the real adapter iterator exactly once',async()=>{
  let closed=0;
  const f=fixture({dispatch:async function*(){try{yield {n:1};yield {n:2};}finally{closed++;}}});
  try {
    const stream=f.runtime.adapterStream(f.options,f.prepared);
    assert.deepEqual((await stream.next()).value,{n:1});
    await stream.return();await stream.return();
    assert.equal(closed,1);assert.equal(f.stats().dispatches,1);
  }finally{f.dispose();}
});

test('downstream throw preserves iterator cleanup and does not retry dispatch',async()=>{
  let closed=0;const failure=new Error('consumer failed');
  const f=fixture({dispatch:async function*(){try{yield {n:1};yield {n:2};}finally{closed++;}}});
  try {
    const stream=f.runtime.adapterStream(f.options,f.prepared);
    await stream.next();await assert.rejects(stream.throw(failure),e=>e===failure);
    assert.equal(closed,1);assert.equal(f.stats().dispatches,1);
  }finally{f.dispose();}
});

test('adapter errors and cancelled adapter errors keep native finish classification',async()=>{
  const abort=new AbortController();
  const f=fixture({dispatch:()=>{throw Error('synthetic adapter error');}});
  try {
    let outcome=(await f.runtime.adapterStream(f.options,f.prepared).next()).value;
    assert.equal(outcome.type,'finish');assert.equal(outcome.reason.kind,'error');
    abort.abort(new Error('cancelled'));
    const options=markAgentLoopRequest({...f.options,signal:abort.signal});
    outcome=(await f.runtime.adapterStream(options,f.prepared).next()).value;
    assert.equal(outcome.reason.kind,'aborted');assert.equal(f.stats().dispatches,2);
  }finally{f.dispose();}
});

test('fingerprint mismatch refuses installation without changing descriptors',()=>{
  const prototype=Object.create(LlmRuntime.prototype);
  Object.defineProperty(prototype,'adapterStream',originalDescriptor);
  assert.throws(()=>installBridge({prototype,expected:'0'.repeat(64)}),/版本/);
  assert.deepEqual(Object.getOwnPropertyDescriptor(prototype,'adapterStream'),originalDescriptor);
  assert.equal(Object.hasOwn(prototype,owner),false);
});

test('duplicate installation fails and ordinary disposal restores exact descriptor',()=>{
  const f=fixture();
  assert.throws(()=>installBridge({prototype:f.prototype}),/重复/);
  f.dispose();
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.prototype,'adapterStream'),originalDescriptor);
  assert.equal(Object.hasOwn(f.prototype,owner),false);
});

test('conflicting later wrapper remains installed while disposed bridge becomes inert',async()=>{
  const prototype=Object.create(LlmRuntime.prototype);
  Object.defineProperty(prototype,'adapterStream',originalDescriptor);
  const runtime=Object.create(prototype);runtime.forAdapter=x=>x;
  let projecting=0,gating=0,warnings=0,closed=false;
  const dispose=installBridge({prototype,isMarked:isAgentLoopRequest,mark:markAgentLoopRequest,getGate:()=>{gating++;if(closed)throw Error('closed policy');},project:o=>{projecting++;if(closed)throw Error('closed policy');return o;},warn:()=>{warnings++;}});
  const bridge=prototype.adapterStream;
  const later=function(...args){return bridge.apply(this,args);};
  Object.defineProperty(prototype,'adapterStream',{...originalDescriptor,value:later});
  dispose();closed=true;
  assert.equal(prototype.adapterStream,later);assert.equal(warnings,1);
  const options=markAgentLoopRequest({provider:'agentrouter',model:'gpt-6-astra',messages:[]});
  const prepared={registration:{adapter:{}},config:options,modelInfo:{},dispatch:async function*(){yield {ok:true};}};
  const next=await runtime.adapterStream(options,prepared).next();
  assert.equal(next.value.ok,true);
  assert.equal(projecting,0);assert.equal(gating,0);
});
