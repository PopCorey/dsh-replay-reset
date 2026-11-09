import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {ResetCoordinator} from '../src/coordinator.js';
import {EMPTY_POLICY,hash,validatePolicy} from '../src/policy.js';
import {API_VERSION,ReplayResetError} from '../src/errors.js';
import {Session,deriveEventMessage,foldSurface} from '@deepseek-ai/dsh-session';

function coded(code,pattern) {
  return error=>{
    assert.ok(error instanceof ReplayResetError);
    assert.equal(error.code,code);
    if(pattern)assert.match(error.message,pattern);
    return true;
  };
}
function appendReply(session,tag) {
  session.append('assistant/message',{turn:1,step:1,stream:[],message:{id:'new-'+tag,role:'assistant',content:[{type:'text',text:'new reply'}],source:{kind:'model',provider:'agentrouter',model:'gpt-6-astra',replayState:{response:{kind:'pi-ai',version:2,api:'openai-responses',provider:'agentrouter',model:'gpt-6-astra',stopReason:'stop'},blocks:[{type:'text',textSignature:'msg_new_'+tag}]}}}},{surfaceOp:'append'});
}
function fixture({child=false,storageFails=false,rootId='root',lifetime=new AbortController().signal}={}) {
  const states=new Map();
  function make(id,parent) {
    const header={id,version:4,createdAt:10,cwd:tmpdir(),isSeeded:false,...(parent?{origin:'subagent',parentSession:parent}: {})};
    const session=Session.create(id,undefined,header);
    session.append('model/selection',{provider:'agentrouter',model:'gpt-6-astra'});
    session.append('assistant/message',{turn:1,step:1,stream:[],message:{id:'m-'+id,role:'assistant',content:[{type:'text',text:'hello'}],source:{kind:'model',provider:'agentrouter',model:'gpt-6-astra',replayState:{response:{kind:'pi-ai',version:2,api:'openai-responses',provider:'agentrouter',model:'gpt-6-astra',stopReason:'stop'},blocks:[{type:'text',textSignature:'msg_old_'+id}]}}}},{surfaceOp:'append'});
    const agent={id,status:'idle',model:{current:()=>({provider:'agentrouter',model:'gpt-6-astra'})},async runMaintenance(job){if(this.locked||this.status!=='idle')throw new Error('busy');this.locked=true;try{return await job(new AbortController().signal);}finally{this.locked=false;}}};
    states.set(id,{session,agent});return session;
  }
  make(rootId);if(child)make('child',rootId);
  let policy=structuredClone(EMPTY_POLICY),writes=0;
  const table={get:()=>policy,async put(key,value){if(storageFails)throw new Error('disk failure');writes++;policy=value;}};
  const ctx={sessions:{get:id=>states.get(id)?.session,messageProjections:[]},agents:{get:id=>states.get(id)?.agent},
    sessionQuery:{async observeSession(id){const s=states.get(id).session;return{header:s.header,inheritedEventCount:s.inheritedEventCount,events:s.snapshotEvents(),[Symbol.dispose](){}};}},
    subagents:{async listDescendants(){return child?[{id:'child',parentId:rootId,kind:'child',mode:'continuable'}]:[];}}};
  const c=new ResetCoordinator({ctx,table,providers:['agentrouter'],derive:deriveEventMessage,foldSurface,lifetime});
  return{c,ctx,states,table,policy:()=>policy,writes:()=>writes,reloadPolicy:()=>policy=validatePolicy(JSON.parse(JSON.stringify(policy)))};
}
test('one click persists all targets atomically and never alters session events',async()=>{
  const f=fixture({child:true});const before=[...f.states.values()].map(x=>hash(x.session.snapshotEvents()));
  const r=await f.c.reset('root','operation-1');assert.equal(r.apiVersion,API_VERSION);assert.equal(r.sessionId,'root');assert.equal(r.addedCount,2);assert.equal(r.resetCount,1);assert.equal(f.writes(),1);assert.equal(Object.keys(f.policy().sessions).length,2);
  assert.deepEqual([...f.states.values()].map(x=>hash(x.session.snapshotEvents())),before);
  assert.ok([...f.states.values()].every(x=>!x.agent.locked));assert.equal(f.c.gate(),null);
});
test('same operation is idempotent and second click without new state adds nothing',async()=>{
  const f=fixture();await f.c.reset('root','operation-1');const p=f.policy();await f.c.reset('root','operation-1');assert.equal(f.policy(),p);assert.equal(f.writes(),1);
  const r=await f.c.reset('root','operation-2');assert.equal(r.changed,false);assert.equal(r.addedCount,0);assert.equal(r.resetCount,1);
});
test('running child refuses before writing and releases all acquired maintenance locks',async()=>{
  const f=fixture({child:true});f.states.get('child').agent.status='running';await assert.rejects(f.c.reset('root','operation-1'),coded('SESSION_BUSY',/busy/));assert.equal(f.writes(),0);assert.equal(f.c.gate(),null);
});
test('storage failure keeps old policy and releases gate',async()=>{
  const f=fixture({storageFails:true});await assert.rejects(f.c.reset('root','operation-1'),coded('STORAGE_WRITE_FAILED',/disk failure/));assert.equal(f.policy().revision,0);assert.equal(f.c.gate(),null);
});
test('diagnostic branch rejects without partial marking',async()=>{
  const f=fixture();f.ctx.subagents.listDescendants=async()=>[{kind:'diagnostic',id:'unknown'}];await assert.rejects(f.c.reset('root','operation-1'),coded('SUBAGENT_UNAVAILABLE',/子代理/));assert.equal(f.writes(),0);
});
test('open turn rejects without changing the session',async()=>{
  const f=fixture();f.states.get('root').session.append('turn/start',{turn:2});await assert.rejects(f.c.reset('root','operation-1'),coded('UNBALANCED_HISTORY',/未闭合/));assert.equal(f.writes(),0);
});
test('a replaced session identity refuses without overriding previous policy',async()=>{
  const f=fixture();await f.c.reset('root','operation-1');const old=f.policy();f.states.get('root').session=Session.create('root',undefined,{id:'root',version:4,createdAt:20,isSeeded:false});
  await assert.rejects(f.c.reset('root','operation-2'),coded('IDENTITY_CHANGED',/身份/));assert.equal(f.policy(),old);
});

test('status has versioned reasons and cumulative counts without writing',async()=>{
  const f=fixture(),signal=new AbortController().signal;
  const ready=await f.c.status('root',signal);
  assert.deepEqual(Object.keys(ready).sort(),['apiVersion','sessionId','supported','ready','busy','reasonCode','reason','resetCount'].sort());
  assert.equal(ready.apiVersion,2);assert.equal(ready.sessionId,'root');assert.equal(ready.reasonCode,'READY');assert.equal(ready.resetCount,0);
  const agent=f.states.get('root').agent;
  agent.status='running';
  const busy=await f.c.status('root',signal);assert.equal(busy.reasonCode,'BUSY');assert.equal(busy.ready,false);
  agent.status='idle';agent.model.current=()=>({provider:'other',model:'model'});
  const unsupported=await f.c.status('root',signal);assert.equal(unsupported.reasonCode,'UNSUPPORTED_PROVIDER');assert.equal(unsupported.supported,false);
  assert.equal(f.writes(),0);
});

test('root cumulative count stays distinct from subtree additions and receipt retries never write',async()=>{
  const f=fixture({child:true}),signal=new AbortController().signal;
  const first=await f.c.reset('root','count-op-1');
  assert.equal(first.addedCount,2);assert.equal(first.resetCount,1);
  assert.equal((await f.c.status('child',signal)).resetCount,1);
  appendReply(f.states.get('root').session,'root-later');
  const next=await f.c.reset('root','count-op-2');
  assert.equal(next.addedCount,1);assert.equal(next.resetCount,2);assert.equal(next.sessionId,'root');
  const noop=await f.c.reset('root','count-op-3');
  assert.equal(noop.addedCount,0);assert.equal(noop.resetCount,2);assert.equal(noop.changed,false);
  const before=f.policy(),writes=f.writes(),retry=await f.c.reset('root','count-op-1');
  assert.equal(retry.operationId,first.operationId);assert.equal(retry.addedCount,first.addedCount);assert.equal(retry.resetCount,2);
  assert.equal(f.policy(),before);assert.equal(f.writes(),writes);
  assert.equal((await f.c.status('root',signal)).resetCount,2);
  assert.equal((await f.c.status('child',signal)).resetCount,1);
  await assert.rejects(f.c.reset('other','count-op-1'),coded('OPERATION_CONFLICT',/其他会话/));
  assert.equal(f.writes(),writes);
});

for(const rootId of ['constructor','toString','__proto__']) {
  test(`coordinator owns only the ${rootId} record across JSON reload and no-op`,async()=>{
    const descriptor=Object.getOwnPropertyDescriptor(Object.prototype,rootId),f=fixture({rootId}),signal=new AbortController().signal;
    assert.equal((await f.c.status(rootId,signal)).resetCount,0);
    const first=await f.c.reset(rootId,'reserved-coordinator-op-1');
    assert.equal(first.sessionId,rootId);assert.equal(first.addedCount,1);assert.equal(first.resetCount,1);
    assert.equal(Object.getPrototypeOf(f.policy().sessions),null);assert.equal(Object.hasOwn(f.policy().sessions,rootId),true);
    f.reloadPolicy();assert.equal(Object.getPrototypeOf(f.policy().sessions),Object.prototype);
    assert.equal((await f.c.status(rootId,signal)).resetCount,1);
    const noop=await f.c.reset(rootId,'reserved-coordinator-op-2');
    assert.equal(noop.addedCount,0);assert.equal(noop.resetCount,1);assert.equal(Object.getPrototypeOf(f.policy().sessions),null);
    const writes=f.writes();await f.c.reset(rootId,'reserved-coordinator-op-1');assert.equal(f.writes(),writes);
    assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype,rootId),descriptor);
  });
}

test('native snapshot and subagent failures retain cause and get stage-specific codes',async()=>{
  const signal=new AbortController().signal;
  const read=fixture(),readError=new Error('synthetic history read failed');
  read.ctx.sessionQuery.observeSession=async()=>{throw readError;};
  await assert.rejects(read.c.snapshot('root',signal),error=>{coded('SESSION_READ_FAILED',/history read/)(error);assert.equal(error.cause,readError);return true;});
  const children=fixture(),childError=new Error('synthetic catalog read failed');
  children.ctx.subagents.listDescendants=async()=>{throw childError;};
  await assert.rejects(children.c.reset('root','native-catalog'),error=>{coded('SUBAGENT_UNAVAILABLE',/catalog read/)(error);assert.equal(error.cause,childError);return true;});
  assert.equal(children.writes(),0);assert.equal(children.c.gate(),null);
});

test('cold snapshot failure closes its read lease and preserves its native cause',async()=>{
  const f=fixture(),session=f.states.get('root').session,error=new Error('cold read failed');let closes=0;
  f.ctx.sessions.get=()=>undefined;
  f.ctx.sessionPersistence={async open(id,access){assert.equal(id,'root');assert.equal(access,'read');return{header:session.header,inheritedEventCount:0,async read(){throw error;},async close(){closes++;}};}};
  await assert.rejects(f.c.snapshot('root',new AbortController().signal),failure=>{coded('SESSION_READ_FAILED',/cold read/)(failure);assert.equal(failure.cause,error);return true;});
  assert.equal(closes,1);assert.equal(f.writes(),0);
});

test('known ReplayResetError is not recoded by snapshot, maintenance or storage wrappers',async()=>{
  for(const stage of ['snapshot','maintenance','storage']) {
    const f=fixture(),error=new ReplayResetError('IDENTITY_CHANGED','既有身份拒绝');
    if(stage==='snapshot')f.ctx.sessionQuery.observeSession=async()=>{throw error;};
    if(stage==='maintenance')f.states.get('root').agent.runMaintenance=async()=>{throw error;};
    if(stage==='storage')f.table.put=async()=>{throw error;};
    await assert.rejects(f.c.reset('root','known-'+stage),failure=>failure===error);
    assert.equal(f.c.gate(),null);assert.equal(f.writes(),0);
  }
});

test('abort and timeout errors remain cancellation rather than generic stage failures',async()=>{
  for(const stage of ['snapshot','maintenance','storage']) {
    const f=fixture(),error=new DOMException('synthetic cancellation',stage==='snapshot'?'TimeoutError':'AbortError');
    if(stage==='snapshot')f.ctx.sessionQuery.observeSession=async()=>{throw error;};
    if(stage==='maintenance')f.states.get('root').agent.runMaintenance=async()=>{throw error;};
    if(stage==='storage')f.table.put=async()=>{throw error;};
    await assert.rejects(f.c.reset('root','cancel-'+stage),failure=>{coded('CANCELLED',/cancellation/)(failure);assert.equal(failure.cause,error);return true;});
    assert.equal(f.c.gate(),null);assert.equal(f.writes(),0);
  }
});

test('aborted lifetime and maintenance signals preserve non-DOM cancellation reasons',async()=>{
  const lifetime=new AbortController(),reason=new Error('lifetime ended'),f=fixture({lifetime:lifetime.signal});
  lifetime.abort(reason);
  await assert.rejects(f.c.reset('root','aborted-lifetime'),error=>{coded('CANCELLED',/lifetime ended/)(error);assert.equal(error.cause,reason);return true;});
  const maintenance=fixture(),maintenanceReason=new Error('maintenance ended');
  maintenance.states.get('root').agent.runMaintenance=async job=>{const controller=new AbortController();controller.abort(maintenanceReason);return job(controller.signal);};
  await assert.rejects(maintenance.c.reset('root','aborted-maintenance'),error=>{coded('CANCELLED',/maintenance ended/)(error);assert.equal(error.cause,maintenanceReason);return true;});
  assert.equal(f.c.gate(),null);assert.equal(maintenance.c.gate(),null);
  assert.equal(f.writes(),0);assert.equal(maintenance.writes(),0);
});

test('unknown-state storage rejection is attempted once and native quarantine remains authoritative',async()=>{
  const f=fixture(),error=Object.assign(new Error('native unknown commit state'),{code:'unknown-state'});let attempts=0,quarantined=false;
  f.table.get=()=>{if(quarantined)throw error;return f.policy();};
  f.table.put=async()=>{attempts++;quarantined=true;throw error;};
  await assert.rejects(f.c.reset('root','unknown-write'),failure=>{coded('STORAGE_WRITE_FAILED',/unknown commit/)(failure);assert.equal(failure.cause,error);return true;});
  await assert.rejects(f.c.reset('root','later-write'),failure=>{coded('SESSION_READ_FAILED',/unknown commit/)(failure);assert.equal(failure.cause,error);return true;});
  assert.equal(attempts,1);assert.equal(f.policy().revision,0);assert.equal(f.c.gate(),null);
});

test('concurrent reset refuses synchronously while the active gate stays owned',async()=>{
  const f=fixture(),entered=Promise.withResolvers(),release=Promise.withResolvers();
  f.ctx.subagents.listDescendants=async()=>{entered.resolve();await release.promise;return [];};
  const running=f.c.reset('root','active-op');await entered.promise;
  const gate=f.c.gate();
  try {
    await assert.rejects(f.c.reset('root','other-op'),coded('SESSION_BUSY',/已有重置/));
    assert.equal(f.c.gate(),gate);
    assert.equal((await f.c.status('root',new AbortController().signal)).reasonCode,'BUSY');
  } finally {release.resolve();}
  await running;assert.equal(f.c.gate(),null);assert.equal(f.writes(),1);
});

test('cancellation during atomic put drains one commit before releasing gate and maintenance lock',async()=>{
  const lifetime=new AbortController(),f=fixture({lifetime:lifetime.signal}),entered=Promise.withResolvers(),release=Promise.withResolvers(),put=f.table.put;
  f.table.put=async(...args)=>{entered.resolve();await release.promise;await put(...args);};
  const running=f.c.reset('root','commit-drain');await entered.promise;
  const gate=f.c.gate();
  lifetime.abort(new Error('unload while committing'));
  assert.equal(f.c.gate(),gate);assert.equal(f.states.get('root').agent.locked,true);assert.equal(f.writes(),0);
  release.resolve();const result=await running;
  assert.equal(result.ok,true);assert.equal(result.addedCount,1);assert.equal(result.resetCount,1);
  assert.equal(f.writes(),1);assert.equal(f.c.gate(),null);assert.equal(f.states.get('root').agent.locked,false);
});

test('unsupported root, too many children and changed topology have explicit refusal codes',async()=>{
  const unsupported=fixture();unsupported.states.get('root').agent.model.current=()=>({provider:'other',model:'model'});
  await assert.rejects(unsupported.c.reset('root','unsupported'),coded('UNSUPPORTED_PROVIDER',/AgentRouter/));
  const limit=fixture();limit.ctx.subagents.listDescendants=async()=>Array.from({length:65},(_,index)=>({kind:'child',mode:'continuable',id:'child-'+index,parentId:'root'}));
  await assert.rejects(limit.c.reset('root','limit'),coded('SUBAGENT_LIMIT',/上限/));
  const changed=fixture({child:true}),list=changed.ctx.subagents.listDescendants;let reads=0;
  changed.ctx.subagents.listDescendants=async()=>{const rows=await list();return ++reads===1?rows:[...rows,{kind:'child',mode:'continuable',id:'new-child',parentId:'root'}];};
  await assert.rejects(changed.c.reset('root','changed-tree'),coded('TOPOLOGY_CHANGED',/列表/));
  for(const f of [unsupported,limit,changed]){assert.equal(f.writes(),0);assert.equal(f.c.gate(),null);assert.ok([...f.states.values()].every(value=>!value.agent.locked));}
});

test('session replacement and native surface errors keep their own stage codes',async()=>{
  const changed=fixture(),observe=changed.ctx.sessionQuery.observeSession;
  changed.ctx.sessionQuery.observeSession=async id=>{const observation=await observe(id);changed.states.get(id).session=Session.create(id,undefined,observation.header);return observation;};
  await assert.rejects(changed.c.reset('root','changed-session'),coded('SESSION_CHANGED',/重新加载/));
  const surface=fixture(),error=new Error('surface fold failed');surface.c.foldSurface=()=>{throw error;};
  await assert.rejects(surface.c.reset('root','invalid-surface'),failure=>{coded('UNBALANCED_HISTORY',/surface fold/)(failure);assert.equal(failure.cause,error);return true;});
  assert.equal(changed.writes(),0);assert.equal(surface.writes(),0);assert.equal(changed.c.gate(),null);assert.equal(surface.c.gate(),null);
});
