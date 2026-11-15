'use strict';

// The first model reading is a reading of the chosen material, not a replay of
// whichever sentences happened to match the offline observation rules.
const AdvisorFirstContext = (() => {
  const Store = typeof module !== 'undefined' && module.exports ? require('./core.js') : window.AdvisorStore;
  // Match the existing portrait reader's privacy boundaries. These are content
  // exclusions, not topic or outcome rules.
  const secrets = /密码|口令|密钥|验证码|校验码|授权码|助记词|恢复码|安全码|私钥|\b(?:otp|pin|password|passwd|passcode|bearer|api[ _-]?key|secret[ _-]?key|private[ _-]?key|access[ _-]?token|refresh[ _-]?token|recovery (?:code|phrase)|seed phrase|verification code|security code|one[ -]time (?:code|password))\b|\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{15,}|AKIA[A-Z0-9]{16}|eyJ[\w-]{8,}\.[\w-]+\.[\w-]+)\b|\b(?:your|login|sign[ -]?in) code\b|\btoken\s*[:=]/i;
  const privateRequest = /别(?:把.{0,18})?记|不要(?:把.{0,18})?记|别写进画像|不要写进画像|不要存|只聊这一次|don['’]t (?:save|remember|store)|do not (?:save|remember|store)|off the record/i;
  const forwarded = /^(?:-{2,}\s*(?:original message|forwarded message|转发邮件)|On [^\n]+ wrote:\s*$|在[^\n]{1,150}写道[：:]\s*$)/im;
  const qualifier = /^(?:但|不过|除非|前提|条件是|也可能|还(?:没|没有|未)(?:最后)?决定|并没|其实没|but\b|unless\b|only if\b|provided\b|that depends\b|I haven['’]t decided\b)/i;
  const norm = text => String(text || '').replace(/[ \t\r\n\f\v]+/g,' ').replace(/^ | $/g,'');
  const safe = text => typeof text === 'string' && !!text.trim() && !secrets.test(text) && !privateRequest.test(text);
  const spansOf = fact => fact.evidence?.length ? fact.evidence : fact.sourceId ? [fact] : [];
  const intersects = (a,b) => a.start < b.end && b.start < a.end;
  function dateOnly(value) {
    const text=String(value || '');
    if(text==='日期未注明')return text;
    return /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(text) ? text : '';
  }
  // Synchronous SHA-256 keeps the mutation before removeSource atomic. These
  // low-entropy fingerprints are suppression identifiers, not anonymisation.
  function sha256(text) {
    const bytes=new TextEncoder().encode(text), length=bytes.length;
    const data=new Uint8Array(Math.ceil((length+9)/64)*64);data.set(bytes);data[length]=128;
    const view=new DataView(data.buffer);view.setUint32(data.length-8,Math.floor(length/0x20000000));view.setUint32(data.length-4,length*8);
    const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    const rotr=(n,b)=>(n>>>b)|(n<<(32-b)),w=new Uint32Array(64);
    for(let offset=0;offset<data.length;offset+=64) {
      for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);
      for(let i=16;i<64;i++)w[i]=(w[i-16]+(rotr(w[i-15],7)^rotr(w[i-15],18)^(w[i-15]>>>3))+w[i-7]+(rotr(w[i-2],17)^rotr(w[i-2],19)^(w[i-2]>>>10)))>>>0;
      let [a,b,c,d,e,f,g,j]=h;
      for(let i=0;i<64;i++) {
        const t1=(j+(rotr(e,6)^rotr(e,11)^rotr(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0;
        const t2=((rotr(a,2)^rotr(a,13)^rotr(a,22))+((a&b)^(a&c)^(b&c)))>>>0;
        j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
      }
      [a,b,c,d,e,f,g,j].forEach((value,i)=>{h[i]=(h[i]+value)>>>0;});
    }
    return h.map(n=>n.toString(16).padStart(8,'0')).join('');
  }
  const fingerprint=(kind,text)=>sha256('quest:first-reading:'+kind+':v1\0'+norm(text));


  function sentenceSpans(text, offset = 0) {
    const spans=[]; let start=0, depth=0, quoted=false;
    for(let i=0;i<text.length;i++) {
      const c=text[i];
      if('“「『'.includes(c))depth++;
      else if('”」』'.includes(c) && depth)depth--;
      else if(c==='"')quoted=!quoted;
      if(depth || quoted)continue;
      if('\n。！？!?'.includes(c) || (c==='.' && (i+1===text.length || /\s/.test(text[i+1])))) {
        spans.push({start:offset+start,end:offset+i+1});start=i+1;
      }
    }
    if(start<text.length)spans.push({start:offset+start,end:offset+text.length});
    return spans;
  }

  function sourcePassages(source) {
    const text=source.text, end=text.search(forwarded), limit=end<0?text.length:end;
    let spans=[];
    if(source.origin==='ai-export') {
      // The importer prefixes each original user line. Assistant and unknown
      // roles remain outside personal evidence, including their first person.
      const lines=text.slice(0,limit).split('\n'); let offset=0;
      for(const line of lines) {
        const owner=line.match(/^我（([^）\n]*)）：/);
        if(owner)for(const span of sentenceSpans(line.slice(owner[0].length),offset+owner[0].length)) {
          spans.push({...span,kind:'self',statedAt:dateOnly(owner[1])});
        }
        offset+=line.length+1;
      }
    } else spans=sentenceSpans(text.slice(0,limit)).map(span=>({...span,kind:source.kind || 'file'}));
    const result=[];
    for(let i=0;i<spans.length;i++) {
      let span={...spans[i]}, next=spans[i+1];
      const components=[{...span}];
      // Keep a following qualification attached to what it limits. Do not
      // stitch two distinct speakers or user messages together.
      while(next && next.kind===span.kind && next.statedAt===span.statedAt &&
        !/\S/.test(text.slice(span.end,next.start)) && qualifier.test(text.slice(next.start,next.end).trim())) {
        components.push({...next});span.end=next.end;next=spans[++i+1];
      }
      const raw=text.slice(span.start,span.end), quote=raw.trim();
      if(!quote)continue;
      span.start+=raw.indexOf(quote);span.end=span.start+quote.length;
      const lineStart=text.lastIndexOf('\n',Math.max(0,span.start-1))+1;
      if(/^\s*>/.test(text.slice(lineStart,span.end)))continue;
      const parts=Store.independentStatements(span.kind,quote);
      if(parts) {
        let from=span.start;
        for(const part of parts) {
          const start=text.indexOf(part,from);result.push({...span,start,end:start+part.length});from=start+part.length;
        }
      } else result.push({...span,...(components.length>1?{components}: {})});
    }
    return result;
  }

  function refs(state) {
    const sources=state.sources || [], facts=state.facts || [], dismissed=state.dismissed || [];
    const bySource=new Map(sources.map(s=>[s.id,s])), documents=new Map(), documentIds=new Map();
    for(const source of sources) {
      if(!documents.has(source.text))documents.set(source.text,source.id);
      documentIds.set(source.id,documents.get(source.text));
    }
    const forbidden=new Map(), oldText=new Map();
    const documentHashes=new Map(sources.map(source=>[source.id,fingerprint('document',source.text)]));
    const suppressed=new Set((state.readingSuppressions || []).filter(row=>row.version===1).map(row=>row.documentHash+':'+row.passageHash));
    function exclude(span) {
      const source=bySource.get(span.sourceId);
      if(!source || !Number.isInteger(span.start) || !Number.isInteger(span.end))return;
      const doc=documentIds.get(source.id);
      if(!forbidden.has(doc))forbidden.set(doc,[]);
      forbidden.get(doc).push(span);
      const hash=documentHashes.get(source.id);
      if(!oldText.has(hash))oldText.set(hash,new Set());
      const text=norm(source.text.slice(span.start,span.end));if(text)oldText.get(hash).add(text);
    }
    for(const span of dismissed)exclude(span);
    for(const fact of facts)if(fact.confirmed) {
      for(const span of spansOf(fact))exclude(span);
    }
    const currentBySource=new Map();
    for(const fact of facts)if(!fact.confirmed && fact.sourceId) {
      if(!currentBySource.has(fact.sourceId))currentBySource.set(fact.sourceId,[]);
      currentBySource.get(fact.sourceId).push(fact);
    }
    const rows=[];
    for(const fact of facts)if(fact.confirmed) {
      if(!safe(fact.text) || secrets.test(fact.quote || ''))continue;
      const spans=spansOf(fact);
      if(spans.some(span=>{
        const source=bySource.get(span.sourceId);
        return !source || !Number.isInteger(span.start) || !Number.isInteger(span.end) ||
          source.text.slice(span.start,span.end)!==span.quote || privateRequest.test(source.text) ||
          secrets.test(span.quote) || privateRequest.test(span.quote) ||
          dismissed.some(d=>d.sourceId===span.sourceId && intersects(d,span));
      }))continue;
      const source=spans[0] && bySource.get(spans[0].sourceId);
      rows.push({key:'f:'+fact.id,id:fact.id,version:fact.version || 1,quote:fact.text,text:fact.text,kind:'self',
        provenance:fact.history?.length?'user-correction':'user-confirmation',sourceBacked:false,
        sourceId:source?.id || null,sourceTitle:safe(source?.title)?source.title:'',start:null,end:null,
        documentIds:[...new Set(spans.map(span=>documentIds.get(span.sourceId)).filter(Boolean))],statedAt:dateOnly(fact.at)});
    }
    // Explicitly retained interpretations have no original quotation. They can
    // be considered as such, never relabelled as a newly read personal source.
    for(const fact of facts)if(fact.retainedReading && !fact.sourceId && !fact.confirmed && safe(fact.text) && !secrets.test(fact.quote || '')) {
      rows.push({key:'f:'+fact.id,id:fact.id,version:fact.version || 1,quote:fact.text,text:fact.text,kind:'retained',
        provenance:'retained-reading',sourceBacked:false,sourceId:null,sourceTitle:'',start:null,end:null,documentIds:[],statedAt:dateOnly(fact.at)});
    }
    const emitted=new Set();
    for(const source of sources) {
      if(!['self','mail','file'].includes(source.kind) || typeof source.text!=='string' || privateRequest.test(source.text) ||
        ['cancelled','moved'].includes(source.calendarChange?.kind))continue;
      const documentId=documentIds.get(source.id), blocks=forbidden.get(documentId) || [], documentHash=documentHashes.get(source.id);
      const isSuppressed=span=>{
        const quote=source.text.slice(span.start,span.end), normalized=norm(quote);
        return blocks.some(block=>intersects(block,span)) ||
          [...(oldText.get(documentHash) || [])].some(old=>normalized.includes(old)) ||
          suppressed.has(documentHash+':'+fingerprint('passage',quote));
      };
      // A later correction to a separate qualification must not erase the
      // untouched sentence before it. Keep complete sentence components, never
      // cut an arbitrary substring out of a conditional sentence.
      const passages=sourcePassages(source).flatMap(span=>span.components && isSuppressed(span) ? span.components : [span]);
      for(const original of passages) {
        const text=source.text.slice(original.start,original.end), quote=text.trim();
        const span={...original,start:original.start+text.indexOf(quote)};span.end=span.start+quote.length;
        if(!safe(quote) || isSuppressed(span))continue;
        const identity=documentId+':'+span.start+':'+span.end;
        if(emitted.has(identity))continue;
        emitted.add(identity);
        const existing=(currentBySource.get(source.id) || []).find(fact=>spansOf(fact).some(e=>e.sourceId===source.id && e.quote===quote && e.start===span.start && e.end===span.end));
        rows.push({key:existing?'f:'+existing.id:'r:'+source.id+':'+span.start+':'+span.end,
          ...(existing?{id:existing.id}:{}),version:existing?.version || 1,quote,text:quote,kind:span.kind,
          provenance:span.kind+'-quote',sourceBacked:true,sourceId:source.id,
          sourceTitle:safe(source.title)?source.title:'',start:span.start,end:span.end,documentIds:[documentId],
          ...(span.statedAt?{statedAt:span.statedAt}:{})});
      }
    }
    return rows;
  }

  function rememberSuppressed(state,sourceId) {
    const source=(state.sources || []).find(row=>row.id===sourceId);
    if(!source)return;
    const ranges=(state.dismissed || []).filter(span=>span.sourceId===sourceId).map(span=>({...span}));
    for(const fact of state.facts || [])if(fact.confirmed && fact.history?.length) {
      ranges.push(...spansOf(fact).filter(span=>span.sourceId===sourceId));
    }
    if(!ranges.length)return;
    const rows=state.readingSuppressions || [], known=new Set(rows.filter(row=>row.version===1).map(row=>row.documentHash+':'+row.passageHash));
    const documentHash=fingerprint('document',source.text), passages=sourcePassages(source);
    function remember(quote) {
      if(!norm(quote))return;
      const passageHash=fingerprint('passage',quote), key=documentHash+':'+passageHash;
      if(!known.has(key)){rows.push({version:1,documentHash,passageHash});known.add(key);}
    }
    for(const range of ranges) {
      if(!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start<0 || range.end>source.text.length || range.end<=range.start)continue;
      remember(source.text.slice(range.start,range.end));
      for(const passage of passages)if(intersects(passage,range)) {
        remember(source.text.slice(passage.start,passage.end));
        // The reader may separate an unaffected sentence from its changed
        // qualification. A whole-group withdrawal must also suppress every
        // component actually touched by that withdrawal, or splitting revives it.
        for(const component of passage.components || [])if(intersects(component,range))remember(source.text.slice(component.start,component.end));
      }
    }
    state.readingSuppressions=rows;
  }

  function coverage(state) {
    const sources=state.sources || [];
    const info={excludedPrivateSources:0,credentialPassages:0,quotedOrForwardedSources:0,aiRoleRestrictedSources:0,oldCalendarSources:0,notices:[]};
    for(const source of sources) {
      if(privateRequest.test(source.text)){info.excludedPrivateSources++;continue;}
      if(source.origin==='ai-export')info.aiRoleRestrictedSources++;
      else if(forwarded.test(source.text) || /^\s*>/m.test(source.text))info.quotedOrForwardedSources++;
      if(['cancelled','moved'].includes(source.calendarChange?.kind)){info.oldCalendarSources++;continue;}
      info.credentialPassages+=sourcePassages(source).filter(span=>secrets.test(source.text.slice(span.start,span.end))).length;
    }
    if(info.excludedPrivateSources)info.notices.push('标注为不记忆的 '+info.excludedPrivateSources+' 份资料没有列入这次阅读。');
    if(info.credentialPassages)info.notices.push('含密码、密钥或验证码的 '+info.credentialPassages+' 段文字没有列入。');
    if(info.quotedOrForwardedSources)info.notices.push(info.quotedOrForwardedSources+' 份资料中的转发旧邮件和行首带 > 的引文没有列入；本次只读当前正文。');
    if(info.aiRoleRestrictedSources)info.notices.push('导出的 AI 对话只列出你本人角色的原话，其他角色的发言没有列入。');
    if(info.oldCalendarSources)info.notices.push('已取消或改期日程的旧文本没有列入。');
    return info;
  }

  function identity(ref) {
    return JSON.stringify([ref.key,ref.id || null,ref.version,ref.quote,ref.kind,ref.provenance,ref.sourceBacked,
      ref.sourceId,ref.start,ref.end,ref.documentIds || [],ref.statedAt || '']);
  }
  function matches(state, selected) {
    if(!Array.isArray(selected))return false;
    const available=new Map(refs(state).map(ref=>[ref.key,identity(ref)]));
    return selected.every(ref=>ref && available.get(ref.key)===identity(ref));
  }
  function payload(selected) {
    const documents=[...new Set(selected.flatMap(ref=>ref.documentIds || []))];
    return selected.map(ref=>({key:ref.key,...(ref.id?{id:ref.id}:{}),version:ref.version,quote:ref.quote,
      kind:ref.kind,provenance:ref.provenance,sourceBacked:ref.sourceBacked,
      sources:(ref.documentIds || []).map(id=>documents.indexOf(id)+1),
      ...(ref.statedAt?{statedAt:ref.statedAt}:{})}));
  }
  return {refs,matches,payload,rememberSuppressed,fingerprint,coverage};
})();
if(typeof window!=='undefined')window.AdvisorFirstContext=AdvisorFirstContext;
if(typeof module!=='undefined')module.exports=AdvisorFirstContext;
