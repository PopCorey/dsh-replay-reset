import { createHash } from 'node:crypto';
import { ReplayResetError } from './errors.js';

export const EMPTY_POLICY = Object.freeze({version:1,revision:0,sessions:Object.create(null),operations:[]});
/** Read only an owned Session key, including after plain JSON reloads. */
export function sessionRecord(sessions, sessionId) {
  return Object.hasOwn(sessions, sessionId) ? sessions[sessionId] : undefined;
}
export const PROTOCOL = 'openai-responses';
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
}
export function hash(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
export function identity(header, inheritedEventCount = 0) {
  const {id,version,createdAt,cwd,isSeeded,parentSession,origin,delegationDepth}=header;
  return hash({id,version,createdAt,cwd,isSeeded,parentSession,origin,delegationDepth,inheritedEventCount});
}
export function replayOf(message) {
  const s=message?.source?.replayState;
  return s?.response?.kind==='pi-ai' && s.response.version===2 && s.response.api===PROTOCOL ? s : undefined;
}
export function capture(snapshot, providers) {
  const entries=[];
  for(const event of snapshot.events) {
    if(event.type!=='assistant/message') continue;
    const m=event.data?.message, replay=replayOf(m);
    if(!replay || !providers.includes(m.source.provider)) continue;
    if(!m.id || replay.response.provider!==m.source.provider || replay.response.model!==m.source.model) throw new ReplayResetError('INVALID_REPLAY_STATE','历史回放元数据不一致，未执行重置');
    entries.push({id:m.id,digest:hash(replay),provider:m.source.provider,model:m.source.model});
  }
  const unique=[...new Map(entries.map(x=>[x.id+':'+x.digest,x])).values()];
  return {identity:identity(snapshot.header,snapshot.inheritedEventCount),header:{id:snapshot.header.id,createdAt:snapshot.header.createdAt,parentSession:snapshot.header.parentSession??null,origin:snapshot.header.origin??null},cutoff:snapshot.events.length,entries:unique};
}
export function assertBalanced(events) {
  let turn=false,step=false;
  const pending=new Set();
  for(const e of events) {
    if(e.type==='turn/start') turn=true;
    if(e.type==='step/start') step=true;
    if(e.type==='step/end') step=false;
    if(e.type==='turn/end') {turn=false;step=false;}
    if(e.type==='assistant/message') for(const b of e.data.message.content) if(b.type==='tool-call') pending.add(b.id);
    if(e.type==='tool/result') pending.delete(e.data.message?.toolCallId ?? e.data.callId);
  }
  if(turn||step||pending.size) throw new ReplayResetError('UNBALANCED_HISTORY','会话仍有未闭合的运行或工具调用，请先在 DSH 中正常结束/恢复该轮，再重置');
}
export function assertSurfacePairing(messages) {
  const pending=new Set();
  for(const m of messages) {
    if(m.role==='assistant') for(const b of m.content) if(b.type==='tool-call') {if(pending.has(b.id)) throw new ReplayResetError('DUPLICATE_TOOL_CALL','工具调用标识重复');pending.add(b.id);}
    if(m.role==='tool') {if(!pending.delete(m.toolCallId)) throw new ReplayResetError('ORPHAN_TOOL_RESULT','历史工具结果缺少对应调用，未执行重置');}
  }
  if(pending.size) throw new ReplayResetError('MISSING_TOOL_RESULT','历史工具调用缺少结果，未执行重置');
}
export function mergePolicy(previous, captures, operationId, rootId) {
  const prior=previous.operations.find(x=>x.id===operationId);
  if(prior) {if(prior.rootId!==rootId) throw new ReplayResetError('OPERATION_CONFLICT','操作标识已用于其他会话');return {policy:previous,operation:prior};}
  const sessions=Object.assign(Object.create(null),previous.sessions); let added=0;
  for(const item of captures) {
    const old=sessionRecord(sessions,item.header.id);
    if(old && old.identity!==item.identity) throw new ReplayResetError('IDENTITY_CHANGED','会话身份发生变化，请检查后重试；旧策略未覆盖');
    const union=new Map((old?.entries??[]).map(x=>[x.id+':'+x.digest,x]));
    for(const entry of item.entries) {const key=entry.id+':'+entry.digest;if(!union.has(key)) {union.set(key,entry);added++;}}
    sessions[item.header.id]={...old,...item,header:{...old?.header,...item.header},entries:[...union.values()],updatedAt:Date.now()};
  }
  const operation={id:operationId,rootId,added,sessions:captures.map(x=>x.header.id),time:Date.now()};
  return {policy:{...previous,version:1,revision:previous.revision+1,sessions,operations:[...previous.operations,operation].slice(-100)},operation};
}
export function validatePolicy(raw) {
  const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null);
  const text=x=>typeof x==='string'&&x.length>0&&x.length<=256;
  const integer=x=>Number.isSafeInteger(x)&&x>=0;
  if(!record(raw)||raw.version!==1||!integer(raw.revision)||!record(raw.sessions)||!Array.isArray(raw.operations)||raw.operations.length>100||Object.keys(raw.sessions).length>4096) throw new ReplayResetError('INVALID_POLICY','重置策略格式无效');
  for(const [id,s] of Object.entries(raw.sessions)) {
    if(!text(id)||!record(s)||!record(s.header)||s.header.id!==id||!integer(s.header.createdAt)||!/^[a-f0-9]{64}$/.test(s.identity)||!Array.isArray(s.entries)||s.entries.length>50000||!integer(s.cutoff)) throw new ReplayResetError('INVALID_POLICY','重置策略会话记录无效');
    for(const e of s.entries) if(!record(e)||!text(e.id)||!text(e.provider)||!text(e.model)||!/^[a-f0-9]{64}$/.test(e.digest)) throw new ReplayResetError('INVALID_POLICY','重置策略消息记录无效');
  }
  const ids=new Set();
  for(const op of raw.operations) {
    if(!record(op)||!text(op.id)||!text(op.rootId)||!integer(op.added)||!integer(op.time)||!Array.isArray(op.sessions)||!op.sessions.length||!op.sessions.every(text)||ids.has(op.id))throw new ReplayResetError('INVALID_POLICY','重置策略操作记录无效');
    ids.add(op.id);
  }
  return raw;
}
export function createProjector(getPolicy,getSession) {
  let revision=-1; const indexes=new Map(),digests=new WeakMap(),copies=new WeakMap();
  return function project(options) {
    const policy=getPolicy();
    if(revision!==policy.revision) {indexes.clear();revision=policy.revision;}
    const session=getSession(options.sessionId);
    if(!session) return options;
    const record=sessionRecord(policy.sessions,session.id);
    if(!record)return options;
    if(record.identity!==identity(session.header,session.inheritedEventCount)) throw new ReplayResetError('IDENTITY_CHANGED','旧回放策略与当前会话身份不一致，已阻止发送');
    const records=[record];
    let changed=false;
    const messages=options.messages.map(m=>{
      const state=replayOf(m);
      if(m.role!=='assistant'||!state) return m;
      let digest=digests.get(state); if(!digest) {digest=hash(state);digests.set(state,digest);}
      const match=records.some(record=>{
        let index=indexes.get(record); if(!index) {index=new Set(record.entries.map(e=>e.provider+':'+e.id+':'+e.digest));indexes.set(record,index);}
        return index.has(options.provider+':'+m.id+':'+digest);
      });
      if(!match) return m;
      changed=true;
      let copy=copies.get(m);
      if(!copy) {const {replayState,...source}=m.source;copy=Object.freeze({...m,source:Object.freeze(source)});copies.set(m,copy);}
      return copy;
    });
    return changed ? Object.freeze({...options,messages:Object.freeze(messages)}) : options;
  };
}
