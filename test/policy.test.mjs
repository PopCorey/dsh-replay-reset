import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {EMPTY_POLICY,canonical,hash,identity,replayOf,capture,assertBalanced,assertSurfacePairing,mergePolicy,validatePolicy,createProjector,sessionRecord} from '../src/policy.js';
import {ReplayResetError} from '../src/errors.js';

function coded(code,pattern) {
  return error=>{
    assert.ok(error instanceof ReplayResetError);
    assert.equal(error.code,code);
    if(pattern)assert.match(error.message,pattern);
    return true;
  };
}

function freeze(value){if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;}
const header=(id='root',extra={})=>({id,version:4,createdAt:100,cwd:'C:/synthetic',isSeeded:false,...extra});
function assistant(tag='old',{id='local_'+tag,provider='agentrouter',model='gpt-6-astra',api='openai-responses',tool=true}={}) {
  const content=[{type:'reasoning',text:'private-'+tag},{type:'text',text:'visible-'+tag}];
  if(tool)content.push({type:'tool-call',id:'call_'+tag+'|fc_'+tag,name:'read',arguments:JSON.stringify({path:tag+'.txt'})});
  return freeze({id,role:'assistant',content,source:{kind:'model',provider,model,replayState:{response:{kind:'pi-ai',version:2,api,provider,model,stopReason:tool?'toolUse':'stop'},blocks:[{type:'reasoning',thinkingSignature:JSON.stringify({type:'reasoning',id:'rs_'+tag,encrypted_content:'fake-encrypted-'+tag,summary:[]})},{type:'text',textSignature:JSON.stringify({v:1,id:'msg_'+tag})},...(tool?[{type:'tool-call'}]:[])]}}});
}
const event=(m,seq=0)=>({type:'assistant/message',seq,time:100+seq,surfaceOp:'append',data:{turn:1,step:1,message:m,stream:[]}});
const snapshot=(messages,id='root',extra={})=>({header:header(id,extra),inheritedEventCount:0,events:messages.map(event)});
function setup(messages=[assistant()],id='root',extra={}) {
  const s=snapshot(messages,id,extra),c=capture(s,['agentrouter']);
  const {policy}=mergePolicy(EMPTY_POLICY,[c],'op-1',id);
  const sessions=new Map([[id,{id,header:s.header,inheritedEventCount:s.inheritedEventCount}]]);
  const project=createProjector(()=>policy,id=>sessions.get(id));
  return {s,c,policy,sessions,project};
}
const request=(messages,id='root',extra={})=>freeze({provider:'agentrouter',model:'gpt-6-astra',sessionId:id,messages,...extra});

test('canonical digest is key-order independent and changes with replay state',()=>{
  assert.equal(canonical({b:2,a:1,missing:undefined}),'{"a":1,"b":2}');
  assert.equal(hash({a:1,b:2}),hash({b:2,a:1}));
  assert.notEqual(hash({a:1}),hash({a:2}));
});

test('capture includes only supported provider and Responses replay records',()=>{
  const wanted=assistant(),other=assistant('other',{provider:'different'}),chat=assistant('chat',{api:'openai-completions'});
  const s=snapshot([wanted,other,chat]);s.events.push({type:'assistant/attempt',data:{message:wanted}});
  const c=capture(s,['agentrouter']);
  assert.equal(c.entries.length,1);assert.equal(c.entries[0].id,wanted.id);
  assert.equal(replayOf(chat),undefined);
  const serialized=JSON.stringify(c);
  for(const secret of ['private-old','visible-old','fake-encrypted-old'])assert.equal(serialized.includes(secret),false);
});

test('capture rejects mismatched source and replay provider/model',()=>{
  const bad=structuredClone(assistant());bad.source.replayState.response.model='other-model';
  assert.throws(()=>capture(snapshot([bad]),['agentrouter']),/不一致/);
});

test('capture deduplicates identical identified replay records',()=>{
  const old=assistant(),c=capture(snapshot([old,old]),['agentrouter']);
  assert.equal(c.entries.length,1);assert.equal(c.cutoff,2);
});

test('only old captured message loses replay; fresh message and original history are unchanged',()=>{
  const old=assistant(),fresh=assistant('fresh'),f=setup([old]);
  const options=request([old,fresh]),before=JSON.stringify(options),out=f.project(options);
  assert.notEqual(out,options);assert.equal(JSON.stringify(options),before);
  assert.equal(out.messages[0].id,old.id);assert.equal(out.messages[0].content,old.content);
  const {replayState,...source}=old.source;assert.deepEqual(out.messages[0].source,source);
  assert.equal(out.messages[1],fresh);assert.equal(out.messages[1].source.replayState,fresh.source.replayState);
  assert.equal(Object.isFrozen(out),true);assert.equal(Object.isFrozen(out.messages),true);
  assert.equal(Object.isFrozen(out.messages[0]),true);assert.equal(Object.isFrozen(out.messages[0].source),true);
});

test('same message id with changed digest is not cleared',()=>{
  const old=assistant(),changed=assistant('different',{id:old.id}),f=setup([old]),options=request([changed]);
  assert.equal(f.project(options),options);
});

test('identical ids and digest in unrelated session do not inherit another policy',()=>{
  const old=assistant(),f=setup([old]);
  f.sessions.set('unrelated',{id:'unrelated',header:header('unrelated'),inheritedEventCount:0});
  const options=request([old],'unrelated');assert.equal(f.project(options),options);
});

test('absent session is untouched, not attributed by message id',()=>{
  const old=assistant(),f=setup([old]),options=request([old],'absent');
  assert.equal(f.project(options),options);
});

test('session identity mismatch fails closed even when ids match',()=>{
  const old=assistant(),f=setup([old]);
  f.sessions.set('root',{id:'root',header:header('root',{createdAt:101}),inheritedEventCount:0});
  assert.throws(()=>f.project(request([old])),/身份不一致/);
});

test('identity binds fork prefix length and origin, not just session id',()=>{
  const h=header();assert.notEqual(identity(h,0),identity(h,1));
  assert.notEqual(identity(h),identity({...h,origin:'subagent'}));
});

test('independent conversation forks are not implicitly assigned parent policy',()=>{
  const old=assistant(),f=setup([old]);
  f.sessions.set('fork',{id:'fork',header:header('fork',{isSeeded:true,parentSession:'root'}),inheritedEventCount:1});
  const options=request([old],'fork');assert.equal(f.project(options),options);
});

test('future uncaptured seeded subagent stays untouched with either live or cold parent',()=>{
  const old=assistant(),fresh=assistant('child-new'),f=setup([old]);
  f.sessions.set('child',{id:'child',header:header('child',{origin:'subagent',isSeeded:true,parentSession:'root'}),inheritedEventCount:1});
  const options=request([old,fresh],'child');
  assert.equal(f.project(options),options);
  f.sessions.delete('root');
  assert.equal(f.project(options),options);
});

test('explicitly captured existing child remains effective after policy reload with parent cold',()=>{
  const old=assistant(),childOld=assistant('child-old'),childNew=assistant('child-new'),root=setup([old]);
  const child=snapshot([old,childOld],'child',{origin:'subagent',isSeeded:true,parentSession:'root'});
  child.inheritedEventCount=1;
  const merged=mergePolicy(root.policy,[capture(child,['agentrouter'])],'op-2','root');
  const restored=validatePolicy(JSON.parse(JSON.stringify(merged.policy)));
  const sessions=new Map([['child',{id:'child',header:child.header,inheritedEventCount:1}]]);
  const project=createProjector(()=>restored,id=>sessions.get(id));
  const messages=[old,childOld,childNew].map(m=>freeze(structuredClone(m))),before=JSON.stringify(messages);
  const output=project(request(messages,'child'));
  assert.equal(output.messages[0].source.replayState,undefined);
  assert.equal(output.messages[1].source.replayState,undefined);
  assert.equal(output.messages[2],messages[2]);
  assert.equal(JSON.stringify(messages),before);
  assert.deepEqual(restored.sessions.child.entries.map(x=>x.id),[old.id,childOld.id]);
});

test('projection is idempotent and reconstruction uses stable ids and digests',()=>{
  const old=assistant(),f=setup([old]),out=f.project(request([old]));
  assert.equal(f.project(out),out);
  assert.deepEqual(f.project(request([freeze(structuredClone(old))])),out);
});

test('route without matching captured provider remains unchanged',()=>{
  const old=assistant(),f=setup([old]),options=request([old],'root',{provider:'other'});
  assert.equal(f.project(options),options);
});

test('merging policy preserves old immutable state and operation retry is idempotent',()=>{
  const old=assistant(),f=setup([old]);freeze(f.policy);
  const before=JSON.stringify(f.policy),fresh=assistant('fresh');
  const result=mergePolicy(f.policy,[capture(snapshot([old,fresh]),['agentrouter'])],'op-2','root');
  assert.equal(result.operation.added,1);assert.equal(result.policy.sessions.root.entries.length,2);
  assert.equal(JSON.stringify(f.policy),before);assert.equal(result.policy.revision,f.policy.revision+1);
  const retry=mergePolicy(result.policy,[],'op-2','root');
  assert.equal(retry.policy,result.policy);assert.equal(retry.operation,result.operation);
  assert.throws(()=>mergePolicy(result.policy,[],'op-2','other'),/其他会话/);
});

test('merge refuses reusing a durable session id with a different identity',()=>{
  const old=assistant(),f=setup([old]);
  const changed=capture(snapshot([old],'root',{createdAt:999}),['agentrouter']);
  assert.throws(()=>mergePolicy(f.policy,[changed],'op-2','root'),/身份/);
});

test('open turns and missing tool results are rejected without mutating events',()=>{
  const old=assistant(),events=[{type:'turn/start'},event(old)];
  const before=JSON.stringify(events);assert.throws(()=>assertBalanced(events),/未闭合/);
  assert.equal(JSON.stringify(events),before);
  events.push({type:'tool/result',data:{message:{toolCallId:old.content[2].id}}},{type:'turn/end'});
  assert.doesNotThrow(()=>assertBalanced(events));
});

test('surface pairing rejects orphan results, missing results, and duplicate pending ids',()=>{
  const old=assistant(),callId=old.content[2].id;
  const result={role:'tool',toolCallId:callId,content:[{type:'text',text:'result'}]};
  assert.doesNotThrow(()=>assertSurfacePairing([old,result]));
  assert.throws(()=>assertSurfacePairing([result,old]),/缺少对应调用/);
  assert.throws(()=>assertSurfacePairing([old]),/缺少结果/);
  assert.throws(()=>assertSurfacePairing([old,old,result]),/重复/);
});

test('policy revision changes invalidate cached indexes and newly captured messages match',()=>{
  const old=assistant(),fresh=assistant('fresh'),f=setup([old]);let policy=f.policy;
  const project=createProjector(()=>policy,id=>f.sessions.get(id));
  const options=request([fresh]);assert.equal(project(options),options);
  policy=mergePolicy(policy,[capture(snapshot([old,fresh]),['agentrouter'])],'op-2','root').policy;
  assert.equal(project(options).messages[0].source.replayState,undefined);
});

test('valid policy validates, malformed version and digest reject',()=>{
  const f=setup();assert.equal(validatePolicy(f.policy),f.policy);
  assert.throws(()=>validatePolicy({...f.policy,version:2}));
  const bad=structuredClone(f.policy);bad.sessions.root.entries[0].digest='not-a-digest';
  assert.throws(()=>validatePolicy(bad));
});

test('corrupt manifest sessions must be a JSON record, not a boolean or number',()=>{
  for(const sessions of [true,1,42])assert.throws(()=>validatePolicy({version:1,revision:0,sessions,operations:[]}),'non-record sessions must fail closed');
});

test('corrupt manifest operations must contain valid operation records',()=>{
  for(const operation of [null,{},'operation'])assert.throws(()=>validatePolicy({version:1,revision:0,sessions:{},operations:[operation]}),'invalid operation must fail before policy publication');
});

test('negative capture cutoff is rejected at policy load',()=>{
  const bad=structuredClone(setup().policy);bad.sessions.root.cutoff=-1;
  assert.throws(()=>validatePolicy(bad));
});

test('empty policy has a safe dictionary without changing its version-1 JSON shape',()=>{
  assert.equal(Object.getPrototypeOf(EMPTY_POLICY.sessions),null);
  const restored=JSON.parse(JSON.stringify(EMPTY_POLICY));
  assert.deepEqual(restored,{version:1,revision:0,sessions:{},operations:[]});
  assert.equal(validatePolicy(restored),restored);
  for(const id of ['constructor','toString','__proto__'])assert.equal(sessionRecord(restored.sessions,id),undefined);
});

for(const id of ['constructor','toString','__proto__']) {
  test(`reserved Session id ${id} is untouched before capture and survives merge/reload/project`,()=>{
    const prototype=Object.prototype,descriptor=Object.getOwnPropertyDescriptor(prototype,id);
    const old=assistant('reserved-'+id),fresh=assistant('fresh-'+id),s=snapshot([old],id);
    const live=new Map([[id,{id,header:s.header,inheritedEventCount:0}],['unrelated',{id:'unrelated',header:header('unrelated'),inheritedEventCount:0}]]);
    let policy=EMPTY_POLICY;
    const project=createProjector(()=>policy,key=>live.get(key));
    const options=request([old,fresh],id),before=JSON.stringify(options);
    assert.equal(project(options),options);
    assert.equal(sessionRecord(policy.sessions,id),undefined);
    policy=validatePolicy(JSON.parse(JSON.stringify(EMPTY_POLICY)));
    assert.equal(project(options),options,'plain JSON dictionaries must not inherit a policy');
    const emptyBefore=JSON.stringify(policy);
    const merged=mergePolicy(policy,[capture(s,['agentrouter'])],'reserved-op-1',id);
    assert.equal(JSON.stringify(policy),emptyBefore);
    policy=validatePolicy(merged.policy);
    assert.equal(policy.version,1);
    assert.equal(Object.getPrototypeOf(policy.sessions),null);
    assert.equal(Object.hasOwn(policy.sessions,id),true);
    assert.equal(sessionRecord(policy.sessions,id).entries.length,1);
    const first=project(options);
    assert.equal(first.messages[0].source.replayState,undefined);
    assert.equal(first.messages[0].content,old.content);
    assert.equal(first.messages[1],fresh);
    const restored=JSON.parse(JSON.stringify(policy));
    assert.equal(Object.getPrototypeOf(restored.sessions),prototype);
    assert.equal(validatePolicy(restored),restored,'validation must retain the caller reference');
    policy=restored;
    const restoredBefore=JSON.stringify(restored);
    const reconstructed=request([freeze(structuredClone(old)),freeze(structuredClone(fresh))],id);
    const output=project(reconstructed);
    assert.equal(output.messages[0].source.replayState,undefined);
    assert.equal(output.messages[1],reconstructed.messages[1]);
    const unrelated=request([old],'unrelated');
    assert.equal(project(unrelated),unrelated);
    const next=mergePolicy(policy,[capture(snapshot([old,fresh],id),['agentrouter'])],'reserved-op-2',id);
    assert.equal(next.operation.added,1);
    assert.equal(sessionRecord(next.policy.sessions,id).entries.length,2);
    assert.equal(Object.getPrototypeOf(next.policy.sessions),null);
    assert.equal(JSON.stringify(restored),restoredBefore);
    assert.equal(JSON.stringify(options),before);
    assert.equal(Object.getPrototypeOf({}),prototype);
    assert.deepEqual(Object.getOwnPropertyDescriptor(prototype,id),descriptor,'no prototype property may be changed');
  });
}

test('version-1 validation and merging preserve references, unknown fields and old entries',()=>{
  const old=assistant(),fresh=assistant('later'),raw=JSON.parse(JSON.stringify(setup([old]).policy));
  raw.futurePolicy={enabled:true};
  raw.sessions.root.futureSession={mode:'future'};
  raw.sessions.root.header.futureHeader='retained';
  raw.sessions.root.entries[0].futureEntry='retained';
  freeze(raw);
  const before=JSON.stringify(raw);
  assert.equal(validatePolicy(raw),raw);
  const merged=mergePolicy(raw,[capture(snapshot([old,fresh]),['agentrouter'])],'future-fields','root');
  assert.equal(merged.policy.version,1);
  assert.equal(merged.policy.futurePolicy,raw.futurePolicy);
  assert.equal(merged.policy.sessions.root.futureSession,raw.sessions.root.futureSession);
  assert.equal(merged.policy.sessions.root.header.futureHeader,'retained');
  assert.equal(merged.policy.sessions.root.entries[0],raw.sessions.root.entries[0]);
  assert.equal(merged.policy.sessions.root.entries[0].futureEntry,'retained');
  assert.equal(merged.policy.sessions.root.entries.length,2);
  assert.equal(JSON.stringify(raw),before);
  assert.equal(validatePolicy(merged.policy),merged.policy);
});

test('known policy refusals carry stable codes and retain their existing messages',()=>{
  const old=assistant(),f=setup([old]),callId=old.content[2].id;
  const result={role:'tool',toolCallId:callId,content:[{type:'text',text:'result'}]};
  const bad=structuredClone(old);bad.source.replayState.response.model='wrong-model';
  const changed=capture(snapshot([old],'root',{createdAt:999}),['agentrouter']);
  f.sessions.set('root',{id:'root',header:header('root',{createdAt:999}),inheritedEventCount:0});
  for(const [code,run,pattern] of [
    ['INVALID_REPLAY_STATE',()=>capture(snapshot([bad]),['agentrouter']),/不一致/],
    ['UNBALANCED_HISTORY',()=>assertBalanced([{type:'turn/start'}]),/未闭合/],
    ['DUPLICATE_TOOL_CALL',()=>assertSurfacePairing([old,old,result]),/重复/],
    ['ORPHAN_TOOL_RESULT',()=>assertSurfacePairing([result]),/缺少对应调用/],
    ['MISSING_TOOL_RESULT',()=>assertSurfacePairing([old]),/缺少结果/],
    ['OPERATION_CONFLICT',()=>mergePolicy(f.policy,[],'op-1','other'),/其他会话/],
    ['IDENTITY_CHANGED',()=>mergePolicy(f.policy,[changed],'changed-identity','root'),/身份/],
    ['IDENTITY_CHANGED',()=>f.project(request([old])),/身份不一致/],
    ['INVALID_POLICY',()=>validatePolicy({...f.policy,version:2}),/格式无效/],
  ])assert.throws(run,coded(code,pattern));
});

test('real Responses conversion drops old replay items, retains new items and tool pairing',{skip:process.env.DSH_UNIT_ONLY==='1'?'requires the real DSH runtime':false},async()=>{
  const {requireHostRoot}=await import('../scripts/host-path.mjs');
  const root=requireHostRoot();
  const modules=root+'/node_modules/';
  const {convertResponsesMessages}=await import(pathToFileURL(modules+'@earendil-works/pi-ai/dist/api/openai-responses-shared.js'));
  const {LlmError}=await import(pathToFileURL(modules+'@deepseek-ai/dsh-llm/lib/index.js'));
  const source=readFileSync(modules+'@deepseek-ai/dsh-llm-pi-ai/lib/index.js','utf8');
  const start=source.indexOf('function parseArguments('),end=source.indexOf('//#endregion',start);
  assert.ok(start>=0&&end>start,'known real serializer source boundary');
  const {toPiAssistant}=new Function('LlmError',source.slice(start,end)+'\nreturn {toPiAssistant};')(LlmError);
  const old=assistant(),fresh=assistant('fresh'),f=setup([old]),original=JSON.stringify([old,fresh]);
  const projected=f.project(request([old,fresh])).messages,native=[];
  for(const message of projected){native.push(toPiAssistant(message));for(const b of message.content)if(b.type==='tool-call')native.push({role:'toolResult',toolCallId:b.id,toolName:b.name,content:[{type:'text',text:'synthetic result'}],isError:false,timestamp:0});}
  const output=convertResponsesMessages({id:'gpt-6-astra',provider:'agentrouter',api:'openai-responses',input:['text','image'],reasoning:true},{messages:native},new Set(['openai','openai-codex','opencode']));
  const text=JSON.stringify(output),calls=output.filter(x=>x.type==='function_call'),results=output.filter(x=>x.type==='function_call_output');
  for(const id of ['rs_old','msg_old','fc_old'])assert.equal(output.some(x=>x.id===id),false);
  for(const id of ['rs_fresh','msg_fresh','fc_fresh'])assert.equal(output.some(x=>x.id===id),true);
  assert.equal(text.includes('fake-encrypted-old'),false);assert.equal(text.includes('private-old'),false);
  assert.equal(text.includes('fake-encrypted-fresh'),true);assert.equal(text.includes('visible-old'),true);
  assert.equal(calls.length,2);assert.deepEqual(calls.map(x=>x.call_id),results.map(x=>x.call_id));
  assert.equal(new Set(calls.map(x=>x.call_id)).size,2);
  assert.deepEqual(calls.map(x=>JSON.parse(x.arguments)),[{path:'old.txt'},{path:'fresh.txt'}]);
  assert.equal(JSON.stringify([old,fresh]),original);
});
