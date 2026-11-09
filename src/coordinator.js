import {capture,identity,assertBalanced,assertSurfacePairing,mergePolicy,validatePolicy,sessionRecord} from './policy.js';
import {API_VERSION,ReplayResetError,errorCode,errorMessage} from './errors.js';

/** Keep known refusals and cancellation distinct from native stage failures. */
function stageError(error,code,signal) {
  if(error instanceof ReplayResetError)return error;
  const cancelled=signal?.aborted||error?.name==='AbortError'||error?.name==='TimeoutError'||errorCode(error,'')==='CANCELLED';
  return new ReplayResetError(cancelled?'CANCELLED':code,errorMessage(error),{cause:error});
}

export class ResetCoordinator {
  constructor({ctx,table,providers,derive,foldSurface,lifetime}) {Object.assign(this,{ctx,table,providers,derive,foldSurface,lifetime});this.pending=null;this.active=null;}
  gate(){return this.pending;}
  policy() {
    try{return this.table.get('policy');}
    catch(error){throw stageError(error,'SESSION_READ_FAILED',this.lifetime);}
  }
  async snapshot(id,signal) {
    try {
      signal.throwIfAborted();
      const live=this.ctx.sessions.get(id);
      if(live) {
        const observation=await this.ctx.sessionQuery.observeSession(id,{signal,projectionMode:'none'});
        try{return {header:observation.header,inheritedEventCount:observation.inheritedEventCount,events:[...observation.events],live};}
        finally{observation[Symbol.dispose]();}
      }
      const handle=await this.ctx.sessionPersistence.open(id,'read',{signal});
      try{const read=await handle.read(0,undefined,{signal});return {header:handle.header,inheritedEventCount:handle.inheritedEventCount,events:[...read.events],live:null};}
      finally{await handle.close();}
    } catch(error){throw stageError(error,'SESSION_READ_FAILED',signal);}
  }
  selection(snapshot) {
    const current=this.ctx.agents.get(snapshot.header.id)?.model?.current();
    if(current) return current;
    let selected;
    for(const event of snapshot.events) {
      if(event.type==='model/selection') selected=event.data;
      else if(event.type==='request/header') selected=event.data.header.config;
    }
    return selected;
  }
  async status(sessionId,signal) {
    try {
      const s=await this.snapshot(sessionId,signal);
      const route=this.selection(s);
      const supported=this.providers.includes(route?.provider);
      const busy=this.active!==null||this.ctx.agents.get(sessionId)?.status==='running';
      const record=sessionRecord(this.policy().sessions,sessionId);
      return {apiVersion:API_VERSION,sessionId,supported,ready:supported&&!busy,busy,reasonCode:busy?'BUSY':supported?'READY':'UNSUPPORTED_PROVIDER',reason:busy?'请先等待当前运行结束':supported?'点击只重置现有旧回放状态；新推理照常保留':'第一版仅支持 AgentRouter 的 Responses 会话',resetCount:record?.entries.length??0};
    } catch(error){throw stageError(error,'SESSION_READ_FAILED',signal);}
  }
  async descendants(rootId,signal) {
    try {
      const rows=await this.ctx.subagents.listDescendants(rootId,signal);
      if(rows.some(x=>x.kind==='diagnostic'||x.mode==='external'||x.mode==='unknown')) throw new ReplayResetError('SUBAGENT_UNAVAILABLE','有关联子代理无法安全读取或不受支持，未重置任何会话');
      if(rows.length>64) throw new ReplayResetError('SUBAGENT_LIMIT','关联子代理超过本版本安全上限');
      return rows;
    } catch(error){throw stageError(error,'SUBAGENT_UNAVAILABLE',signal);}
  }
  async locks(agents,index,signals,job) {
    if(index===agents.length) return job(AbortSignal.any(signals));
    let entered=false,maintenanceSignal;
    try {
      return await agents[index].runMaintenance(signal=>{
        entered=true;maintenanceSignal=signal;
        return this.locks(agents,index+1,[...signals,signal],job);
      });
    } catch(error){
      const aborted=maintenanceSignal?.aborted?maintenanceSignal:signals.find(signal=>signal.aborted);
      throw stageError(error,entered?'SESSION_READ_FAILED':'SESSION_BUSY',aborted);
    }
  }
  async reset(rootId,operationId) {
    const previous=this.policy().operations.find(x=>x.id===operationId);
    if(previous) {if(previous.rootId!==rootId) throw new ReplayResetError('OPERATION_CONFLICT','操作标识属于其他会话');return this.result(previous);}
    if(this.active) throw new ReplayResetError('SESSION_BUSY','已有重置正在处理，请稍后重试');
    let release;
    this.pending=new Promise(resolve=>{release=resolve;});this.active=operationId;
    const signal=AbortSignal.any([this.lifetime,AbortSignal.timeout(30000)]);
    try {
      const descendants=await this.descendants(rootId,signal);
      const ids=[...new Set([rootId,...descendants.map(x=>x.id)])];
      const agents=ids.map(id=>this.ctx.agents.get(id)).filter(Boolean).sort((a,b)=>a.id.localeCompare(b.id));
      const liveBefore=new Map(ids.map(id=>[id,this.ctx.sessions.get(id)]));
      return await this.locks(agents,0,[signal],async lockedSignal=>{
        const snapshots=[];
        for(const id of ids) {
          const s=await this.snapshot(id,lockedSignal);
          assertBalanced(s.events);
          try {
            const surface=this.foldSurface(s.events,this.ctx.sessions.messageProjections);
            assertSurfacePairing(surface.nodes.map(seq=>this.derive(s.events[seq],surface.projectedMessages)).filter(Boolean));
          } catch(error){throw stageError(error,'UNBALANCED_HISTORY',lockedSignal);}
          if(id!==rootId) {
            const row=descendants.find(x=>x.id===id);
            if(s.header.origin!=='subagent'||s.header.parentSession!==row.parentId||(row.childCreatedAt!==undefined&&s.header.createdAt!==row.childCreatedAt)) throw new ReplayResetError('IDENTITY_CHANGED','子代理关联身份发生变化，未执行重置');
          }
          snapshots.push(s);
        }
        if(!this.providers.includes(this.selection(snapshots[0])?.provider)) throw new ReplayResetError('UNSUPPORTED_PROVIDER','当前会话不使用受支持的 AgentRouter Responses 连接');
        const again=await this.descendants(rootId,lockedSignal);
        if(JSON.stringify(again.map(x=>[x.id,x.parentId]).sort())!==JSON.stringify(descendants.map(x=>[x.id,x.parentId]).sort())) throw new ReplayResetError('TOPOLOGY_CHANGED','子代理列表在检查期间发生变化，请重试');
        for(const s of snapshots) {
          const current=this.ctx.sessions.get(s.header.id);
          if(current!==liveBefore.get(s.header.id)) throw new ReplayResetError('SESSION_CHANGED','会话在检查期间启动或重新加载，请稍后重试');
          if(current) {
            if(current.seq!==s.events.length||identity(current.header,current.inheritedEventCount)!==identity(s.header,s.inheritedEventCount)) throw new ReplayResetError('SESSION_CHANGED','会话在检查期间发生变化，请重试');
          } else {
            const check=await this.snapshot(s.header.id,lockedSignal);
            if(check.events.length!==s.events.length||identity(check.header,check.inheritedEventCount)!==identity(s.header,s.inheritedEventCount)) throw new ReplayResetError('SESSION_CHANGED','已保存会话在检查期间发生变化，请重试');
          }
        }
        lockedSignal.throwIfAborted();
        const captures=snapshots.map(s=>capture(s,this.providers));
        const merged=mergePolicy(this.policy(),captures,operationId,rootId);
        const nextPolicy=validatePolicy(merged.policy);
        try{await this.table.put('policy',nextPolicy);}
        catch(error){throw stageError(error,'STORAGE_WRITE_FAILED',lockedSignal);}
        return this.result(merged.operation);
      });
    } catch(error){throw stageError(error,'SESSION_READ_FAILED',signal);}
    finally {this.active=null;this.pending=null;release();}
  }
  result(operation) {
    const record=sessionRecord(this.policy().sessions,operation.rootId);
    return {apiVersion:API_VERSION,sessionId:operation.rootId,ok:true,changed:operation.added>0,operationId:operation.id,sessions:operation.sessions,addedCount:operation.added,resetCount:record?.entries.length??0,message:operation.added ? `已重置 ${operation.added} 条旧回放状态（${operation.sessions.length} 个会话）；历史未改，可以继续发送消息` : '没有新增的旧回放状态需要重置；历史未改，可以继续发送消息'};
  }
}
