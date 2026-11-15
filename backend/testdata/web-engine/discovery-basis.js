"use strict";

// A discovery is a source-backed adviser interpretation, never a confirmed
// personal statement merely because the user uses it to plan a goal.
const AdvisorDiscoveries = (() => {
  const Store=typeof module!=="undefined" && module.exports?require('./core.js'):window.AdvisorStore;
  const Context=typeof module!=="undefined" && module.exports?require('./first-reading-context.js'):window.AdvisorFirstContext;
  const clone=value=>JSON.parse(JSON.stringify(value));
  function capture(state,task) {
    state.discoveries ||= [];
    if(!task?.result || !['complete','corrected'].includes(task.status) || !Context.matches(state,task.result.citations))throw Error('这条发现的依据已变化，请重新查看。');
    let row=state.discoveries.find(item=>item.id===task.discoveryId);
    if(!row) {
      row={id:Store.uid('discovery'),version:1,taskId:task.id,attemptId:task.attemptId || '',status:task.status==='corrected'?'corrected':'proposed',
        title:task.result.title,body:task.result.body,kind:task.result.kind,citations:clone(task.result.citations),at:new Date().toISOString(),
        ...(task.correctionId?{correctionId:task.correctionId}:{})};
      state.discoveries.push(row);task.discoveryId=row.id;
    }
    return row;
  }
  function resolve(state,id) {
    const row=(state.discoveries || []).find(item=>item.id===id);if(!row)return null;
    if(row.status==='stale')return {...row,citations:[],title:'',body:''};
    if(row.correctionId) {
      const ref=Context.refs(state).find(item=>item.id===row.correctionId && /^user-/.test(item.provenance));
      if(!ref)return {...row,status:'stale',title:'',body:'',citations:[]};
      const prior=row.citations.find(item=>item.id===row.correctionId);
      return {...row,status:'corrected',version:row.version+Math.max(0,ref.version-(prior?.version || ref.version)),title:ref.quote,body:'',citations:[clone(ref)]};
    }
    return Context.matches(state,row.citations)?{...row,citations:clone(row.citations)}:{...row,status:'stale',title:'',body:'',citations:[]};
  }
  function prune(state) {
    for(const row of state.discoveries || []) {
      const current=resolve(state,row.id);
      if(current.status==='stale' && row.status!=='stale')current.version=row.version+1;
      Object.assign(row,current);
    }
    return state;
  }
  function reference(state,id) {
    const current=resolve(state,id);if(!current || current.status==='stale')throw Error('这条依据已变化，请查看现在的说法。');
    return {kind:'discovery',id:current.id,version:current.version};
  }
  function correct(state,id,text,expectedVersion) {
    const current=resolve(state,id);if(!current || current.status==='stale' || (expectedVersion!==undefined && current.version!==expectedVersion))throw Error('这条依据已经变化，请重新打开后再改。');
    text=String(text).trim();if(!text || text.length>1000)throw Error('请写下不超过1000字的当前说法。');
    const fact=state.facts.find(row=>row.id===current.correctionId) || Store.fact(state,text,'本人对顾问的更正','');
    Store.changeFact(state,fact.id,text,fact.version);
    const ref=Context.refs(state).find(row=>row.id===fact.id && /^user-/.test(row.provenance));
    if(!ref)throw Error('这段说法不能作为当前记忆，请检查内容。');
    const row=state.discoveries.find(item=>item.id===id);
    Object.assign(row,{version:current.version+1,status:'corrected',correctionId:fact.id,title:text,body:'',kind:'finding',citations:[clone(ref)]});
    return fact;
  }
  function review(state,ref) {
    const row=resolve(state,ref.id);if(!row || row.status==='stale')return null;
    return {kind:'discovery',id:row.id,version:row.version,token:'d:'+row.id+':'+row.version,text:row.title,
      source:row.status==='corrected'?'本人更正的说法':row.kind==='question'?'顾问提出的问题':'顾问提出的判断',
      quote:row.citations.map(item=>item.quote).join('\n'),citations:row.citations,body:row.body,discoveryKind:row.kind,mode:row.status};
  }
  return {capture,resolve,prune,reference,correct,review};
})();
if(typeof window!=='undefined')window.AdvisorDiscoveries=AdvisorDiscoveries;
if(typeof module!=='undefined')module.exports=AdvisorDiscoveries;
