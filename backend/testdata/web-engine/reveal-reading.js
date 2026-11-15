'use strict';

const AdvisorReveal = (() => {
  const Store = typeof module !== 'undefined' && module.exports ? require('./core.js') : window.AdvisorStore;
  const han = /\p{Script=Han}/u;
  const secrets = /密码|口令|密钥|验证码|校验码|授权码|助记词|恢复码|安全码|私钥|\b(?:otp|pin|password|passwd|passcode|bearer|api[ _-]?key|secret[ _-]?key|private[ _-]?key|access[ _-]?token|refresh[ _-]?token|recovery (?:code|phrase)|seed phrase|verification code|security code|one[ -]time (?:code|password))\b|\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{15,}|AKIA[A-Z0-9]{16}|eyJ[\w-]{8,}\.[\w-]+\.[\w-]+)\b|\b(?:your|login|sign[ -]?in) code\b|\btoken\s*[:=]/i;
  const noise = /https?:\/\/|退订|取消订阅|unsubscribe|view in (?:your )?browser|忽略.{0,8}(?:指令|提示)|ignore (?:all |any )?(?:previous|prior|instructions)/i;
  const privateRequest = /别(?:把.{0,18})?记|不要(?:把.{0,18})?记|别写进画像|不要写进画像|不要存|只聊这一次|don['’]t (?:save|remember|store)|do not (?:save|remember|store)|off the record/i;
  const aspiration = /打算|考虑|想要|想学|我(?:还|最)?想|你(?:还|最)?想|希望|梦想|愿望|目标|计划|\b(?:want|hope|dream|wish|intend|considering|plan(?:ning)?|goal|would like|might|thinking about)\b/i;
  const friction = /弱点|短板|不擅长|做不到|很难|难以|卡在|打断|中断|重读|吃力|担心|困扰|没时间|来不及|分心|做不完|\b(?:struggle|struggling|difficult|distraction|distracted|interrupt\w*|reread|worr(?:y|ied)|can['’]t|cannot)\b|(?:not|never|no longer) (?:very )?(?:good|great|skilled) at|hard for me/i;
  const strength = /擅长|拿手|强项|优势是|最在行|做得好|\b(?:good|great|skilled) at\b|my strength/i;
  const approach = /先.{1,65}(?:再|然后)|通过.{2,30}(?:学会|弄懂)|一边.{1,24}一边|\bfirst\b.{1,90}\bthen\b|\blearn\w* (?:best )?by\b/i;
  const rhythm = /每(?:个)?(?:天|晚|早|周|星期|月|年|逢|次)|通常|经常|总会|习惯|\b(?:every|usually|often|daily|weekly|monthly|routine|always)\b/i;
  const preference = /喜欢|偏好|讨厌|不想|宁愿|在意|重视|更愿意|最爱|\b(?:prefer|love|like|enjoy|dislike|hate|value|favou?rite)\b/i;
  const personalAction = /练|修好|修完|修过|终于|学会|弄懂|报名|留在|决定|搬去|搬到|最常|一到|才能|睡不着|做完|完成|周末|平日|每天|早晨|晚上|轮班|值班|\b(?:repair|build|teach|swim|design|volunteer)\b|\b(?:learn\w*|repaired|fixed|finished|decided|moved|move|booked|chose|signed up|managed to)\b/i;
  const event = /预约|会议|改期|截止|预订|预定|订票|取票|排练|开课|报名|签收|包裹|到货|发货|配送|面试|行程|订位|讲座|航班|改为|提早|延后|\b(?:appointment|meeting|deadline|book(?:ing|ed)|reservations?|tickets?|deliver(?:y|ed)|shipment|registrations?|interview|workshop|rehearsal|itinerary|moved to|your order)\b/i;
  const direct = /^(?:我|本人)|^(?:最近|现在|以前|目前|平时|当时|去年|明年|如果|只要|每(?:天|周|晚)|为了)[^“「」”"。!？]{0,65}我|^(?:I\b|I['’]|my\b)|^(?:if|when|unless|these days|usually|last|after|before|to)\b[^“”"!?]{0,90}\bI\b/i;
  const impliedNote = /^(?:每(?:个)?(?:周[一二三四五六日天]|星期[一二三四五六日天]|天|晚|月)(?:早上|下午|晚上)?|周末)(?:都)?(?:练|学|跑|弹|读|去|写|做|游|画|看|陪)|^(?:正在学习|打算去|想要学|希望能)/;
  const forwarded = /^(?:-{2,}\s*(?:original message|forwarded message|转发邮件)|On [^\n]+ wrote:\s*$|在[^\n]{1,150}写道[：:]\s*$)/im;
  const qualifier = /^(?:但|不过|除非|前提|条件是|也可能|还(?:没|没有|未)(?:最后)?决定|并没|其实没|but\b|unless\b|only if\b|provided\b|that depends\b|I haven['’]t decided\b)/i;

  // Leave a quoted speaker inside the sentence that introduces them.
  function sentences(text) {
    const result = [];
    let start = 0;
    let depth = 0;
    let doubleQuote = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if ('“「『'.includes(c)) depth++;
      else if ('”」』'.includes(c) && depth) depth--;
      else if (c === '"') doubleQuote = !doubleQuote;
      if (depth || doubleQuote) continue;
      if ('\n。！？!?'.includes(c) || (c === '.' && (i + 1 === text.length || /\s/.test(text[i + 1])))) {
        if (text.slice(start, i + 1).trim()) result.push({start, end: i + 1});
        start = i + 1;
      }
    }
    if (text.slice(start).trim()) result.push({start, end: text.length});
    return result;
  }

  function readMaterial(kind, text) {
    if (!['self', 'mail', 'file'].includes(kind) || typeof text !== 'string' || privateRequest.test(text)) return [];
    const threadEnd = text.search(forwarded);
    const current = (threadEnd < 0 ? text : text.slice(0, threadEnd)).replace(/^[ \t]*>[^\n]*/gm, line => ' '.repeat(line.length));
    const spans = sentences(current);
    const findings = [];
    const seen = new Set();
    for (let i = 0; i < spans.length; i++) {
      const {start, end} = spans[i];
      const next = spans[i + 1];
      let passage = current.slice(start, end);
      if (next && qualifier.test(current.slice(next.start, next.end).trim())) {
        passage = current.slice(start, next.end);
        i++;
      }
      const quote = passage.trim();
      const position = start + passage.indexOf(quote);
      if (quote.length < 4 || quote.length > 600 || seen.has(quote) || secrets.test(quote) ||
          noise.test(quote) || /[?？]$/.test(quote) || !text.startsWith(quote, position)) continue;
      const statements = Store.independentStatements(kind, quote);
      if (statements) {
        for (const part of statements) {
          if (!seen.has(part)) findings.push({text:part,quote:part,start:position+quote.indexOf(part),category:Store.inferCategory(part,kind),attribution:kind});
          seen.add(part);
        }
        continue;
      }
      const known = Store.readMaterial(kind, quote).length > 0;
      const signal = aspiration.test(quote) || friction.test(quote) || strength.test(quote) ||
        approach.test(quote) || personalAction.test(quote) || event.test(quote) || (kind === 'mail' && recipientObservation(quote));
      if (kind === 'self') {
        const situation = !/[“”「」『』"？?]/.test(quote) && (ruleMarker.test(quote) || reservedObject.test(quote) || hardBound.test(quote) || commitment.test(quote) || decisionWords.test(quote));
        if (!situation && ((!direct.test(quote) && !impliedNote.test(quote)) || (!known && !signal && !impliedNote.test(quote)))) continue;
      } else if (!known && !signal) continue;
      const attributed = kind === 'self' ? quote : externalText(kind, quote);
      findings.push({text: attributed, quote, start:position, category: Store.inferCategory(quote, kind), attribution: kind});
      seen.add(quote);
    }
    return findings;
  }

  function externalText(kind, quote) {
    if (han.test(quote)) return (kind === 'mail' ? '来信中写道' : '文件中写道') + '「' + quote + '」';
    return (kind === 'mail' ? 'The email says ' : 'The file says ') + '“' + quote + '”';
  }

  function observerVoice(text) {
    if (/[「『“”"]|(?:你|您)|\byou(?:r|rs|rself)?\b/i.test(text)) {
      return han.test(text) ? '你写道「' + text + '」' : 'You wrote “' + text + '”';
    }
    if (impliedNote.test(text)) return '你' + text;
    if (han.test(text)) {
      return text.replace(/自我|忘我|无我|真我|本我|敌我|我国|我们|我俩|本人|我/g, word =>
        ({我: '你', 本人: '你', 我们: '你们', 我俩: '你们俩'})[word] || word);
    }
    const addressed = text.replace(/\bI(?: am|'m|’m)\b/gi, 'you are')
      .replace(/\bI was\b/gi, 'you were').replace(/\bI wasn(['’])t\b/gi, "you weren't")
      .replace(/\bI\b/g, 'you').replace(/\bmyself\b/gi, 'yourself')
      .replace(/\bmy\b/gi, 'your').replace(/\bme\b/gi, 'you').replace(/\bmine\b/gi, 'yours');
    return addressed.charAt(0).toUpperCase() + addressed.slice(1);
  }

  function recipientObservation(text) {
    return /^(?:(?:我发现|我注意到|我觉得|我欣赏|最佩服|我记得)[，,]?\s*)?(?:你|您)(?:每次|每周|总是|总能|很擅长|擅长|最擅长|很拿手|习惯|通常|很在意)|^(?:(?:I noticed|I've noticed|I remember|I admire how)\s+(?:that\s+)?)?you (?:always|usually|tend to|excel at|are (?:so |really )?good at)\b/i.test(text);
  }

  function facetOf(text, kind) {
    if (kind === 'mail' && !recipientObservation(text)) return 'correspondence';
    if (kind === 'file') return 'document';
    if (/^(?:我|你)的?(?:朋友|同事|室友|父亲|母亲|老师|家人)|^(?:My|Your) (?:friend|colleague|teacher|roommate|mother|father)\b/i.test(text) ||
        /(?:说|写道|告诉我|said|wrote)\s*[：:“「"]/i.test(text)) return 'life';
    if (/并不担心|从不担心|不觉得.{0,10}(?:难|吃力)|not (?:worried|difficult)|never struggle/i.test(text)) return 'life';
    if (friction.test(text)) return 'friction';
    if (aspiration.test(text)) return 'aspiration';
    if (approach.test(text)) return 'approach';
    if (strength.test(text)) return 'strength';
    if (rhythm.test(text) || /总能|\btend to\b/i.test(text)) return 'rhythm';
    if (preference.test(text)) return 'preference';
    return 'life';
  }

  function key(text) {
    return String(text || '').trim().toLowerCase().replace(/[。.!！\s]+$/, '');
  }

  function titleFor(item) {
    const chinese = han.test(item.text);
    if (item.kind === 'mail' && recipientObservation(item.quote)) {
      return shortTitle(item.quote.replace(/^(?:我发现|我注意到|我觉得)[，,]?\s*/, ''));
    }
    if (item.kind !== 'self') {
      return (chinese ? (item.kind === 'mail' ? '来信 · ' : '文件 · ') :
        (item.kind === 'mail' ? 'From your inbox · ' : 'From a file · ')) + shortTitle(item.subject || item.quote);
    }
    const sentence = item.text.replace(/[。.!！]+$/, '');
    // Keep a condition, a past date or an unfinished intention with its claim.
    const conditional = sentence.match(/^(?:如果|只要|除非)(.{1,30})[，,]/);
    if (conditional) {
      const plan = sentence.match(/[，,]\s*你(?:才会|打算|想要|想|会考虑)([^。！？,，]{2,24})/);
      if (plan) return shortTitle(plan[1] + '的前提');
      return shortTitle(sentence.slice(0, sentence.indexOf(conditional[1]) + conditional[1].length));
    }
    if (/^(?:if|when|unless)\s/i.test(sentence)) return shortTitle(sentence);
    const clause = sentence.split(/[。！？!?]|\.\s|[，,；;]/)[0].trim();
    if (chinese) {
      const practice = clause.match(/^你(每(?:个)?(?:周[一二三四五六日天]|星期[一二三四五六日天]|天|晚|早|月|年)(?:清晨|早上|上午|中午|下午|晚上)?)(?:都)?(?:去)?(?:练习|练|学习|学)([^，。]{2,16})$/);
      if (practice) return shortTitle(practice[1] + '的' + practice[2]);
      const subject = clause.replace(/^你(?=[^的们俩].{2,})/, '');
      if (!/^写道/.test(subject)) return shortTitle(subject);
    } else {
      const skill = clause.match(/^you(?: are|'re) (?:good|great|skilled) at (.+)$/i);
      if (skill) return shortTitle(skill[1][0].toUpperCase() + skill[1].slice(1));
    }
    return shortTitle(clause || sentence);
  }

  function shortTitle(value) {
    const stripped = value.trim().replace(/[。.!！?？]+$/, '');
    const limit = han.test(stripped) ? 26 : 72;
    const chars = Array.from(stripped);
    if (chars.length <= limit) return stripped;
    const snippet = chars.slice(0, limit).join('');
    return (han.test(snippet) ? snippet : snippet.replace(/\s+\S*$/, '')) + '…';
  }

  const segmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('zh', {granularity: 'word'}) : null;
  const common = new Set(('我们 你们 自己 本人 每天 每周 以前 现在 最近 时间 时候 工作 开始 觉得 已经 有时 因为 所以 ' +
    '想要 打算 希望 学习 练习 考虑 需要 喜欢 比较 还是 宁愿 准备 如果 之后 可能 经常 有点 每次 问题 计划 ' +
    'every usually would could should about before after wanted prefer always today using first other there ' +
    'something because really enjoy their where which needed think still started learning learn often plans').split(' '));

  function termsOf(text) {
    let words;
    if (han.test(text) && globalThis.AndroidAdvisor?.chineseWordSegments) {
      words = globalThis.AndroidAdvisor.chineseWordSegments(text.slice(0,1200)).split('\n');
    } else {
      words = segmenter ? Array.from(segmenter.segment(text), part => part.segment) :
        text.match(/[a-z]{5,}|[\p{Script=Han}]{2,}/giu) || [];
    }
    const terms=new Set(words.map(w => w.toLowerCase()).filter(w =>
      (/^[a-z]{5,}$/.test(w) || /^[\p{Script=Han}]{2,}$/u.test(w)) && !common.has(w)));
    // Some system dictionaries split the name of a craft into single characters.
    // Preserve an explicitly named activity at the end of a clause as a whole.
    const named=text.match(/.*(?:练习|制作|研究|练|做|学)([\p{Script=Han}]{2,8})[。！]?$/u);
    if (named && !/[的了能会想把让来去]|这个|那个|东西|自己|什么|起来/.test(named[1])) terms.add(named[1]);
    return terms;
  }

  function readingOf(item) {
    if (item.confirmed) return item.text;
    if (item.kind === 'mail' && recipientObservation(item.quote)) {
      const origin = item.subject ? '《' + item.subject + '》' : '这封信';
      return han.test(item.quote) ? '在' + origin + '里，对方这样形容你。「' + item.quote + '」' :
        'In ' + (item.subject ? '“' + item.subject + '”' : 'this email') + ', the sender wrote “' + item.quote + '”';
    }
    if (item.kind !== 'self') {
      if (!item.subject) return item.text;
      if (han.test(item.text)) return '《' + item.subject + '》里写道「' + item.quote + '」';
      return '“' + item.subject + '” says “' + item.quote + '”';
    }
    const purpose = item.text.match(/^你((?:每[^，,。]{1,14})?(?:练习|学习|练|学)[^，,。]{1,24}?)[，,]?(?:是)?为了([^。！？]+)[。！]?$/);
    if (purpose) return '你想' + purpose[2] + '。' + purpose[1] + '，是你为这件事做的准备。';
    const practice = item.text.match(/^你(每(?:个)?(?:周[一二三四五六日天]|星期[一二三四五六日天]|天|晚|早|月|年)(?:清晨|早上|上午|中午|下午|晚上)?)(?:都)?(练习|学习|练|学)([^，,。！？]{1,22})[，,](打算|想要|希望|想)([^。！？]+)[。！]?$/);
    if (practice) return practice[1] + '，你都会' + practice[2] + practice[3] + '。你' + practice[4] + practice[5] + '。';
    return item.text;
  }

  function portraitBody(members, lead) {
    const ordered = [lead, ...members.filter(item => item !== lead)];
    const statements = [...new Set(ordered.map(readingOf))];
    const parts = statements.map(s => /[。！？.!?」”]$/.test(s) ? s : s + (han.test(s) ? '。' : '.'));
    return parts.reduce((prev, next) => prev + (prev && !(han.test(prev) && han.test(next)) ? ' ' : '') + next, '');
  }

  function ownerLine(source, span) {
    if (source?.origin !== 'ai-export') return null;
    const from = source.text.lastIndexOf('\n', span.start - 1) + 1;
    return source.text.slice(from, span.start).match(/^我（([^）\n]*)）：/);
  }

  function contextualQuote(source, span, boundaries) {
    if (source.origin === 'ai-export') return span.quote;
    const text = source.text;
    let left = span.start;
    let right = span.end;
    while (left > 0 && /[ \t]/.test(text[left - 1])) left--;
    while (right < text.length && /[ \t]/.test(text[right])) right++;
    const fullStart = left === 0 || /[\n。！？.!?]/.test(text[left - 1]);
    const fullEnd = right === text.length || /[\n。！？.!?]/.test(text[right]) || /[。！？.!?]$/.test(span.quote);
    if (fullStart && fullEnd) return span.quote;

    // Older model readings sometimes cited only the verb after a negation or condition.
    if (!boundaries.has(source.id)) boundaries.set(source.id, sentences(text));
    const sentence = boundaries.get(source.id).find(s => s.start <= span.start && s.end >= span.end);
    if (!sentence) return '';
    const full = text.slice(sentence.start, sentence.end).trim();
    if (Store.independentStatements(source.kind, full)?.includes(span.quote)) return span.quote;
    return full.length <= 600 && !noise.test(full) && !secrets.test(full) && !privateRequest.test(full) ? full : '';
  }

  function portraitItems(state) {
    const sources = new Map(state.sources.map(source => [source.id, source]));
    const blocked = new Set(state.sources.filter(source => privateRequest.test(source.text)).map(source=>source.id));
    const suppressed=new Set((state.readingSuppressions || []).filter(row=>row.version===1).map(row=>row.documentHash+':'+row.passageHash));
    const firstContext=suppressed.size?(typeof module!=='undefined' && module.exports?require('./first-reading-context.js'):window.AdvisorFirstContext):null;
    const documentHashes=new Map(firstContext?state.sources.map(source=>[source.id,firstContext.fingerprint('document',source.text)]):[]);
    const threadEnds=new Map(state.sources.map(src=>[src.id,src.text.search(forwarded)]));
    const documents = new Map();
    const documentIds = new Map();
    for (const source of state.sources) {
      if (!documents.has(source.text)) documents.set(source.text,source.id);
      documentIds.set(source.id,documents.get(source.text));
    }
    const boundaries = new Map();
    const superseded = new Set();
    for (const removed of state.dismissed) {
      const source = sources.get(removed.sourceId);
      if (source) superseded.add(key(source.text.slice(removed.start, removed.end)));
    }
    for (const f of state.facts) {
      if (!f.confirmed || !f.history?.length) continue;
      for (const past of f.history) superseded.add(key(past.text || past));
      if (f.quote) superseded.add(key(f.quote));
    }
    const items = [];
    for (const f of [...state.facts].reverse()) {
      if (!f.text || secrets.test(f.text) || secrets.test(f.quote) || privateRequest.test(f.text)) continue;
      if (!f.confirmed && (superseded.has(key(f.text)) || superseded.has(key(f.quote)))) continue;
      const allSpans = f.evidence?.length ? f.evidence : (f.sourceId ? [f] : []);
      const spans=f.confirmed ? allSpans : allSpans.filter(span=>{
        const change=sources.get(span.sourceId)?.calendarChange?.kind;
        return change!=='cancelled' && change!=='moved';
      });
      if (!f.confirmed && !spans.length) {
        if(f.retainedReading && !f.sourceId) {
          items.push({factId:f.id,version:f.version,text:f.text,confirmed:false,kind:'retained',quote:'',
            category:f.category,subject:'',facet:facetOf(f.text,'file')});
        }
        continue;
      }
      if (spans.some(sp => {
        const src = sources.get(sp.sourceId);
        if (!src || !sp.quote || src.text.slice(sp.start, sp.end) !== sp.quote) return true;
        if(!f.confirmed && firstContext && suppressed.has(documentHashes.get(src.id)+':'+firstContext.fingerprint('passage',sp.quote)))return true;
        const threadEnd=threadEnds.get(src.id);
        const lineStart=src.text.lastIndexOf('\n',Math.max(0,sp.start-1))+1;
        return (threadEnd>=0 && sp.end>threadEnd) || /^\s*>/.test(src.text.slice(lineStart,sp.end)) ||
          blocked.has(src.id) || secrets.test(sp.quote) || privateRequest.test(sp.quote) || noise.test(sp.quote) ||
          state.dismissed.some(d => d.sourceId === sp.sourceId && d.start < sp.end && sp.start < d.end);
      })) continue;
      const span = spans[0];
      const source = span && sources.get(span.sourceId);
      const quote = span ? contextualQuote(source, span, boundaries) : '';
      if (span && !quote && !f.confirmed) continue;
      let kind = source?.kind || 'self';
      const owner = span && ownerLine(source, span);
      if (owner) kind = 'self';
      if (source?.origin === 'ai-export' && !owner && !f.confirmed) continue;
      const corrected = f.confirmed && (f.history?.length || !source);
      if (corrected) kind = 'self';
      let observation = corrected || (f.confirmed && f.text !== quote) ? f.text :
        (kind === 'self' ? observerVoice(quote) : externalText(kind, quote));
      const date = owner?.[1].match(/^\d{4}-\d{2}-\d{2}\b/)?.[0];
      if (date && !corrected) {
        observation = han.test(quote) ? date + ' 的对话里，你写道「' + quote + '」' :
          'In your ' + date + ' conversation, you wrote “' + quote + '”';
      }
      let previousEnd=span?.start;
      while (previousEnd>0 && /\s/.test(source.text[previousEnd-1])) previousEnd--;
      const subject = source?.title && !secrets.test(source.title) && !noise.test(source.title) ? source.title : '';
      items.push({factId: f.id, version: f.version, text: observation, currentText:f.text,
        provenance:f.confirmed ? (f.history?.length ? 'user-correction' : 'user-confirmation') : kind+'-quote',
        documentIds:[...new Set(spans.map(sp=>documentIds.get(sp.sourceId)).filter(Boolean))],
        category: Store.inferCategory(corrected ? f.text : quote, kind),
        confirmed: !!f.confirmed, kind, quote, subject, sourceId: source?.id, previousEnd,start:span?.start,end:span?.end,sourceText:source?.text,documentId:documentIds.get(source?.id), facet: facetOf(corrected ? f.text : quote, kind)});
    }

    return items;
  }

  function buildPortrait(state) {
    const items = portraitItems(state);
    const groups = [];
    const byTerm = new Map();
    for (const item of items) {
      const content = item.confirmed ? item.text : item.quote;
      const terms = termsOf(content);
      item.terms = terms;
      const voice = item.kind === 'mail' && recipientObservation(item.quote) ? 'recipient' : item.kind;
      const scores = new Map();
      for (const term of terms) {
        const existing = byTerm.get(voice + ':' + term);
        if (existing && existing.members.length < 3) scores.set(existing, (scores.get(existing) || 0) + 1);
      }
      let group = [...scores.keys()].sort((a, b) => scores.get(b) - scores.get(a))[0];
      if (!group) {
        group = {members: [], terms};
        groups.push(group);
      }
      group.members.push(item);
      // The headline stays about the first subject even if a later note mentions a second topic.
      for (const term of group.terms) byTerm.set(voice + ':' + term, group);
    }

    const cards = groups.map(({members}) => {
      const lead = members.find(item => item.confirmed) || members.find(item => item.facet === 'strength') || members[0];
      return {id: members[0].factId, facet: lead.facet, category: lead.category, title: titleFor(lead),
        body: portraitBody(members, lead), factIds: members.map(item => item.factId)};
    });
    const observations = items.map(({factId, text, category, confirmed}) => ({factId, text, category, confirmed}));
    const firstReader=typeof module!=='undefined' && module.exports?require('./first-reading.js'):window.AdvisorFirstReading;
    const discovery=firstReader?.opening(state);
    if (!items.length) return {observations, cards,...(discovery?{opening:discovery}:{})};
    const saved = state.reveal?.opening;
    const adopted = saved && validateOpening(saved.title, saved.body, saved.citations, excerptsFor(items,true));
    const local=pathChapters(futurePath(items));
    const opening = adopted ? {...adopted, mode:'adopted'} : discovery || quantityOpening(items) || local.opening || offlineOpening(items);
    const stored=state.reveal?.future;
    const accepted=stored && validateFuture(items,stored.title,stored.citations);
    const future=accepted ? {...accepted,mode:'adopted'} : local.future;
    return {observations, cards, opening,...(future?{future}:{})};
  }

  function excerptsFor(items, includeDocumentId = false) {
    // Confirmed facts quote the user's current statement, never the old evidence or history.
    // The original document identities remain provenance, not extra corroboration of a correction.
    return items.filter(item => item.confirmed || (item.sourceId && item.quote)).map(item=>({
      id:item.factId, version:item.version, sourceId:item.sourceId || null, sourceTitle:item.subject,
      kind:item.confirmed ? 'self' : item.kind, quote:item.confirmed ? item.currentText : item.quote,
      text:item.confirmed ? item.currentText : item.text, provenance:item.provenance, sourceBacked:!item.confirmed,
      ...(includeDocumentId ? {documentId:item.documentId || null,documentIds:item.documentIds || []} : {})
    }));
  }

  function portraitExcerpts(state) {
    return excerptsFor(portraitItems(state),true);
  }

  function readingLabel(ref) {
    return ({'self-quote':'本人原话','mail-quote':'邮件原文','file-quote':'文件原文',
      'user-correction':'本人后续更正','user-confirmation':'本人当前确认'})[ref.provenance] || '资料原文';
  }

  function canReadTogether(refs, kind = 'opening') {
    if (new Set(refs.map(ref=>key(ref.quote))).size < 2) return false;
    const documents = ref => ref.documentIds || (ref.documentId ? [ref.documentId] : []);
    const independent = refs.some((ref,i)=>documents(ref).length && refs.slice(i+1).some(other=>
      documents(other).length && !documents(ref).some(id=>documents(other).includes(id))));
    if (independent) return true;
    // Two different sentences the person wrote can describe one decision in a single note.
    // Selecting passages from renamed copies must not turn one note into independent accounts.
    // Current confirmations can inform the decision but are not another original document.
    return kind === 'opening' && refs.every(ref=>ref.kind === 'self') &&
      (refs.every(ref=>ref.sourceId === refs[0].sourceId) ||
       refs.some(ref=>/^user-/.test(ref.provenance || '')));
  }

  function goalProposalReview(state, proposal) {
    const ids = new Set(proposal.factIds || (proposal.basis ? [proposal.basis] : []));
    const items = portraitItems(state).filter(item => ids.has(item.factId));
    const facts = [], methods = [];
    let title = proposal.title;
    if (proposal.replyStep) methods.push({key:'reply', text:proposal.replyStep, source:'你刚才在对话里说'});
    for (const item of items) {
      if (!item.sourceId && !item.confirmed) continue;
      const source = item.confirmed ? '你确认的说法' : item.subject || '已连接的资料';
      const quote = item.confirmed ? item.text : item.quote;
      const token = item.factId + ':' + item.version;
      facts.push({id:item.factId, version:item.version, token, quote, source, text:item.text});
      if (proposal.titleFromFact) title = item.text;
      const wish = proposal.fromReply && personalWish(item);
      if (wish) title = wish.aim;
      if (item.kind !== 'self' || !['approach','rhythm'].includes(item.facet) ||
          uncertain.test(quote) || /[「」“”"]/.test(quote)) continue;
      if (!/^(?:我(?:先|通常|习惯|每(?:天|周|月|次)|经常)|I (?:first|start by|usually|always|often)\b)/i.test(quote) ||
          quote.length > 300 || methods.some(m => key(m.text) === key(quote))) continue;
      methods.push({key:token, text:quote, source, factId:item.factId, version:item.version});
    }
    const discoveries=typeof module!=='undefined' && module.exports?require('./discovery-basis.js'):window.AdvisorDiscoveries;
    for(const ref of proposal.basisRefs || [])if(ref.kind==='discovery'){const row=discoveries.review(state,ref);if(row)facts.push(row);}
    return {proposalId:proposal.id, facts, methods, title};
  }

  function modelExcerpts(state, sourceId) {
    return portraitExcerpts(state).filter(ref=>ref.sourceId===sourceId);
  }

  function singleOpening(item) {
    const statement = readingOf(item);
    if (!item.confirmed && item.kind === 'self') {
      const practice = item.text.match(/^你(每(?:个)?(?:周[一二三四五六日天]|星期[一二三四五六日天]|天|晚|月)(?:早上|上午|中午|下午|晚上|清晨)?)(?:都)?(练习|学习|练|学)([^，。！？]{1,22})[，,](?:是)?为了([^。！？]{2,60})[。！]?$/);
      if (practice) {
        const [, time, verb, subject, reason] = practice;
        return {mode:'single', title:'你想' + reason, body:time + '，你会' + verb + subject + '。', factIds:[item.factId]};
      }
    }
    // A single observation can stand alone without a second paraphrase masquerading as an explanation.
    const compact = Array.from(statement).length <= (han.test(statement) ? 46 : 110);
    return {mode:'single', title:compact ? statement : titleFor(item),
      body:compact ? '' : statement, factIds:[item.factId]};
  }

  const weakSubjects = new Set(('一直 有个 可能 怎么 有点 还是 弄懂 发现 最好 好像 出来 起来 觉得 能够 '+
    '早上 上午 下午 晚上 每晚 晚饭 下班 周末 明年 一起 打算 最后 做到 只能 擅长 最擅长 想要 '+
    'something anything doing working things works starts start normally really early before later sometimes trying').split(' '));

  const uncertain = /如果|除非|未定|考虑|还没决定|还没有决定|原本|以前|从前|曾经|不再|并不想|没想|不打算|放弃|取消|\b(?:if|unless|might|considering|used to|no longer|not sure|gave up|decided against)\b/i;
  const questionWords = new Set(('如果 下次 下一次 将来 有人 时候 第一步 哪个 哪种 哪一步 一步 一点 怎么 怎样 愿意 想过 试试 机会 选择 对方 起来 '+
    'would could should which first next small step start begin change choose closer happen might becoming together something').split(' '));

  function personalWish(item) {
    if (item.kind!=='self' || uncertain.test(item.text) || /[「」“”"]/.test(item.text)) return null;
    const text=(item.confirmed?item.text:item.quote).trim().replace(/[。.!！]+$/,'');
    if (!text || text.length>210 || /[。！？.!?]\s*\S|^[我你]想(?:起|到|问|知道|过|不通)|但是|不过|没想好|还没决定|当时|\b(?:but|back then)\b/i.test(text)) return null;
    const zh=text.match(/^(?:我|你)(?:(?:最|很|也|特别)?(?:希望|想要|想|打算|计划)(?:有一天|以后|将来)?(?:能够|能)?(.+))$/) ||
      text.match(/^[我你].{2,100}?[，,]?(?:是)?为了(.+)$/);
    if (zh && zh[1].length>=3 && zh[1].length<=70) {
      const statement=observerVoice('我想'+zh[1]);
      return {zh:true, aim:statement.slice(2), statement};
    }
    const en=text.match(/^(?:I|you) (?:want|hope|plan|intend|would like) to (.+)$/i) ||
      text.match(/^(?:I|you) .{2,135}?\b(?:so (?:that )?(?:I|you) can|in order to) (.+)$/i);
    if (en && en[1].length<=120) {
      const statement=observerVoice('I want to '+en[1]);
      return {zh:false, aim:statement.slice('You want to '.length), statement};
    }
    return null;
  }

  // Get the action from what the person says they actually do. A location or a shared name alone cannot link two records.
  function practiceVerb(item) {
    const text=(item.confirmed?item.text:item.quote).trim();
    if (uncertain.test(text) || /[「」“”"]/.test(text) || item.kind!=='self' ||
        !['approach','rhythm','strength','friction'].includes(item.facet)) return '';
    if (/^[我你]先把/.test(text)) return '';
    const zh=text.match(/^[我你](?:最?擅长(?:的(?:是)?)?|先(?:把)?|常常|通常|习惯|每(?:个)?(?:周[一二三四五六日天]?|星期[一二三四五六日天]?|天|晚|月)(?:早上|晚上|清晨|下午)?(?:都|会)?|(?:很难|很难再|很难继续|总是很难))([\p{Script=Han}])/u);
    if (zh && !'去来在有能做会是把让用给对从看成跟'.includes(zh[1])) return zh[1];
    const en=text.match(/^(?:I|you) (?:(?:am|are) (?:really |very )?(?:good|skilled|great) at |(?:first|usually|often|always) |struggle (?:with |to )?)?([a-z]{3,})\b/i);
    if (!en) return '';
    const verb=en[1].toLowerCase().replace(/(?:ing|ed)$/,'').replace(/e$/,'');
    return /^(?:am|are|use|hav|want|hop|lik|work|can|see|tak|mak)$/.test(verb)?'':verb;
  }

  function mentionsAction(text, verb) {
    if (!verb) return false;
    if (han.test(verb)) return text.includes(verb);
    return new RegExp('\\b'+verb+'(?:e|s|es|ing|ed)?\\b','i').test(text);
  }

  function topical(item, term) {
    const text=item.confirmed?item.text:item.quote;
    const word = term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return han.test(term) ? !new RegExp('(?:路过|经过|途经|靠近)'+word+'|'+word+'(?:里|旁边|附近|对面|门口|隔壁)').test(text) :
      !new RegExp('\\b(?:near|beside|past|opposite|called|named) (?:the |a )?'+word+'\\b','i').test(text);
  }

  function anchoredTopic(wish, basis, verb) {
    if (!verb || !mentionsAction(wish.text,verb)) return '';
    const shared=[...basis.terms].filter(t=>wish.terms.has(t) && topical(wish,t) && topical(basis,t) &&
      !weakSubjects.has(t) && !questionWords.has(t) &&
      !mentionsAction(t,verb) && !/学习|有人|帮助|教会|希望|以后|东西|\b(?:helping|people|students|visitors|others|before|after|every|doing)\b/i.test(t));
    if (shared.length) return shared.sort((a,b)=>b.length-a.length)[0];
    // Short object nouns (e.g. a material or an instrument) can support an already matching, explicit action.
    if (han.test(verb)) return '';
    const shortNouns=text=>(text.toLowerCase().match(/\b[a-z]{3,4}\b/g)||[]).filter(t=>
      !/^(?:the|that|this|with|from|more|each|some|have|into|when|your|then|them|same|very|want|will|can|could|not|out|for|and|one|two|was|are|has|had|all|our|too|new|like|kind|less|just)$/.test(t));
    const prior=new Set(shortNouns(basis.confirmed?basis.text:basis.quote));
    return shortNouns(wish.text).find(t=>prior.has(t) && !mentionsAction(t,verb) && topical(wish,t) && topical(basis,t)) || '';
  }

  function neighboringWish(wish, basis, verb) {
    if (basis.sourceId!==wish.sourceId || basis.end!==wish.previousEnd || !Number.isInteger(basis.end)) return false;
    const target=(wish.confirmed?wish.text:wish.quote);
    if (/(?:把|用|学会|教会|照着)(?:这个|这套|这种)(?:方法|做法|手艺|技术)|\b(?:this|that) (?:technique|method|skill|process)\b/i.test(target)) return true;
    if (!mentionsAction(target,verb)) return false;
    return han.test(verb) ? new RegExp('(?:来|去|一起|自己|教.{0,8})'+verb+'(?:东西|这些|这个|它们|它)').test(target) :
      /\b(?:things|these|it|them|their own)\b/i.test(target);
  }

  function futurePath(items) {
    const practices=items.filter(item=>item.kind==='self' && item.sourceId &&
      ['approach','strength','rhythm','friction'].includes(item.facet) && !uncertain.test(item.text) && !/[「」“”"]/.test(item.text))
      .map(item=>({item,verb:practiceVerb(item)}));
    const byTerm=new Map(),endingAt=new Map();
    for (const p of practices) endingAt.set(p.item.sourceId+'#'+p.item.end,p);
    for (const p of practices) for (const term of p.item.terms) {
      if (weakSubjects.has(term)) continue;
      const peers=byTerm.get(term) || [];
      peers.push(p);byTerm.set(term,peers);
    }
    let best=null;
    for (const wish of items) {
      const plan=personalWish(wish);
      if (!plan || !wish.sourceId) continue;
      const neighbor=endingAt.get(wish.sourceId+'#'+wish.previousEnd);
      const candidates=new Set(neighbor?[neighbor]:[]);
      for (const term of wish.terms) {
        for (const candidate of byTerm.get(term) || []) {
          if (candidate.item.sourceId!==wish.sourceId) candidates.add(candidate);
        }
      }
      for (const {item:basis,verb} of candidates) {
        if (basis.factId===wish.factId || han.test(basis.text)!==plan.zh) continue;
        const topic=anchoredTopic(wish,basis,verb);
        let companion=null, subject=topic;
        if (basis.documentId===wish.documentId) {
          if (!neighboringWish(wish,basis,verb)) continue;
          // A nearby wish can refer back to "this method". Require an independent account of that method as well.
          for (const t of [...basis.terms].sort((a,b)=>b.length-a.length)) {
            if (weakSubjects.has(t) || questionWords.has(t) || !topical(basis,t)) continue;
            const other=(byTerm.get(t)||[]).find(({item})=>item.documentId!==basis.documentId &&
              key(item.quote)!==key(basis.quote) && topical(item,t) && item.facet==='approach' && !personalWish(item));
            if (other) {companion=other.item;subject=t;break;}
          }
          if (!companion) continue;
        } else if (!topic || key(basis.quote)===key(wish.quote)) continue;
        const rank=(companion?8:0)+(basis.facet==='friction'?4:basis.facet==='approach'?3:1);
        if (!best || rank>best.rank) best={wish,plan,basis,companion,subject,rank};
      }
    }
    return best;
  }

  function pathChapters(path) {
    if (!path) return {};
    const {wish,plan,basis,companion,subject}=path;
    const facts=[...(companion?[companion]:[]),basis,wish];
    const support=facts.slice(0,-1),factIds=facts.map(item=>item.factId);
    const teach=plan.zh && plan.aim.match(/^让(.{1,32}?)也?(?:能够|能)?学会(.{1,42})$/);
    const lead=plan.zh && companion ? '说起'+subject+'，'+plan.statement : plan.statement;
    const title=teach ? '如果'+teach[1]+'要'+teach[2]+'，你愿意从哪一步教起？' :
      plan.zh ? '要离「'+plan.aim+'」近一点，你想先试哪一步？' :
      'What would be one small way to '+plan.aim+'?';
    const practice=companion || basis;
    const actual=practice.confirmed?practice.text:practice.quote;
    const body=plan.zh ? '你写下的心愿是「'+(wish.confirmed?wish.text:wish.quote)+'」'+
      '你也提到「'+actual+'」' :
      'You wrote, “'+(wish.confirmed?wish.text:wish.quote)+'” You also mentioned, “'+actual+'”';
    return {opening:{mode:'linked',title:lead,body:portraitBody(support,support[0]),factIds},
      future:{kind:'future',mode:'local',title,body,factIds}};
  }

  // Match current first-hand assertions across selected notes by a named subject
  // or a personal commitment at the same time. Pronouns still need their local
  // antecedent; a new document cannot make "it" refer to an earlier plan.
  const ruleMarker = /只能|只在|只有|只开|只收|只接受|仅(?:在|限|能|有)|最迟|最晚|必须|不得|需要|要求|不允许|不提供|不开放|不接受|不能|不许|才(?:能|可以|开放)|至少|至多|最多|没有|不够|不接|不收|开放|关闭|关门|闭馆|停用|停运|暂停|开门|营业|截止|开始|开课|安排在|定在|\b(?:only|available|unavailable|open(?:s)?|clos(?:e[ds]?|ing)|shut|requires?|must|needs?|cannot|can['’]t|do(?:es)? not (?:allow|accept|provide)|doesn['’]t (?:allow|accept|provide)|no longer|out of|starts?|runs?|scheduled|deadline)\b/i;
  const reservedObject = /(?:包[下了]|预[订定留]|订下|占[用满]|征用|租[下走]|借走|封闭)(?:了)?(?:整个|整座|整间|全部|所有|那(?:台|间|座|套))?([^，。；！？]{2,28})|\b(?:book(?:ed|s)?|reserv(?:ed|es)|occup(?:ies|ied)|blocked off|rented|commandeered) (?:the |all of the |entire )?(.+?)(?: on | from | until | for | at |$)/i;
  const hardBound = /(?:不能|只(?:准|许|限|允许)|不许|不得|不可|不应|不能够|最多|至少|至多|上限|下限|限额|限量|不超过|must not|no (?:more|less|longer|larger|heavier) than|at (?:most|least)|maximum|minimum)[^，。！？.!?]{0,45}(?:[零〇一二两三四五六七八九十百千万\d]|以内|以外|以下|以上)/i;
  const commitment = /(?:我|本人)(?:每[^，。]{0,12})?(?:要|得|必须|需要|负责|已经约好|约了|有(?:一场|个|约)|值班|上班|当班|轮班|陪|接送)|(?:I(?:['’]m| am)? (?:have to|need to|must|work(?:ing)?|on duty|on call|have (?:a|an|my)|am booked|take care of|pick up)|my (?:shift|appointment|meeting|reservation|booking|conference))\b/i;
  const decisionWords = /^(?:我|本人)(?:还|正在|在|正)?(?:考虑|犹豫要不要|拿不定主意要不要|想决定|想选|没决定)|^I(?: am|['’]m)? (?:considering|trying to (?:choose|decide)|deciding|wondering whether)\b/i;
  const withdrawn = /以前|原本|原来|当时|曾经|上周|上个月|去年|放弃|取消|不再(?:想|打算|需要|用)|不用(?:再)?(?:去|陪|值班|上班)|没(?:有)?打算|不想|不打算|无需|不必|\b(?:used to|last (?:week|month|year)|formerly|no longer (?:want|need|have to|work)|called off|cancelled|canceled|needn['’]t|gave up|decided against|don['’]t (?:want|need|have to))\b/i;
  const weekday = /(?:(上|本|这|下|每)(?:个)?)?(?:周|星期|礼拜)([一二三四五六日天末])|今天|明天|后天|\b(?:(next|this|last|every)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend)s?\b|\b(?:today|tomorrow)\b/gi;
  const periods = /凌晨|早上|早晨|清晨|上午|中午|午休|午间|下午|傍晚|晚上|夜里|夜间|\b(?:morning|afternoon|evening|night)s?\b/gi;
  const clockTime = /([〇零一二两三四五六七八九十\d]{1,3})(?:[点时](半|[〇零一二三四五六七八九十\d]{1,3}分)?|[:：](\d{2})|\s*([ap])\.?m\.?(?=\W|$))/gi;
  const dayValues = ['一','二','三','四','五','六','日','末'];
  const englishDays = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday','weekend'];
  const clockNumber = value => {
    if (!value) return 0;
    if (/^\d+$/.test(value)) return Number(value);
    const digit = ch => '零一二三四五六七八九'.indexOf(ch.replace('两','二').replace('〇','零'));
    const [tens, units] = value.split('十');
    return units === undefined ? digit(tens) : (tens ? digit(tens) : 1) * 10 + (units ? digit(units) : 0);
  };

  function clockBands(text) {
    const bands = [];
    const part = phrases => /凌晨|早上|早晨|清晨|上午|morning/i.test(phrases) ? [0,720] :
      /中午|午休|午间/.test(phrases) ? [690,840] : /下午|afternoon/i.test(phrases) ? [720,1080] : [1080,1440];
    const clock = [...text.matchAll(clockTime)];
    for (const m of clock) {
      let hour = clockNumber(m[1]);
      const minutes = m[2] === '半' ? 30 : clockNumber((m[2] || m[3] || '').replace('分',''));
      if (hour < 0 || hour > 23 || minutes < 0 || minutes > 59) continue;
      const qualifiers = [...text.slice(0,m.index).matchAll(periods)];
      const meridiem = (m[4] || text.slice(m.index+m[0].length).match(/^\s*([ap])\.?m\b/i)?.[1])?.toLowerCase();
      if ((meridiem === 'p' || (!meridiem && qualifiers.length && part(qualifiers.pop()[0])[0] >= 720)) && hour < 12) hour += 12;
      if (meridiem === 'a' && hour === 12) hour = 0;
      const minute = hour * 60 + minutes;
      bands.push([minute,minute + 1]);
    }
    if (bands.length === 2 && /[至到~～–]|\b(?:to|until)\b|\d\s*-\s*\d/i.test(text) && bands[0][0] < bands[1][0]) {
      bands[0][1] = bands.pop()[1] - 1;
    }
    if (!bands.length) for (const m of text.matchAll(periods)) bands.push(part(m[0]));
    return bands;
  }

  function noteTime(text) {
    const slots = [];
    const days = [...text.toLowerCase().matchAll(weekday)];
    for (const [i,m] of days.entries()) {
      const value = m[2] ? dayValues.indexOf(m[2].replace('天','日')) : englishDays.indexOf(m[4]);
      const week = ({下:'next',本:'this',这:'this',上:'last'})[m[1]] || m[3] || '';
      const tail = text.slice(m.index+m[0].length,days[i+1]?.index);
      const bands = clockBands(tail);
      if (!bands.length && days.length===1) bands.push(...clockBands(text.slice(0,m.index)));
      for (const day of value === 7 ? [5,6] : [value < 0 ? m[0] : value]) slots.push({day,week,bands});
    }
    return slots;
  }

  function absoluteDates(text) {
    const dates = [];
    const pattern = /(?:\b(\d{4})-(\d{1,2})-(\d{1,2})\b)|(?:(\d{4})年)?([〇零一二两三四五六七八九十\d]{1,3})月([〇零一二两三四五六七八九十\d]{1,3})[日号]?/g;
    for (const m of text.matchAll(pattern)) {
      const month = clockNumber(m[2] || m[5]), day = clockNumber(m[3] || m[6]);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      dates.push({year:m[1] || m[4] || '',month,day,offset:m.index});
    }
    return dates;
  }

  function compatibleDates(a, b) {
    const left = absoluteDates(a), right = absoluteDates(b);
    if (!left || !right) return false;
    if (!left.length && !right.length) return true;
    // A stated weekly duty applies to a dated occurrence. An unqualified weekday
    // in a different note does not establish which week the author meant.
    const recurring = text => /每(?:个)?(?:周|星期|礼拜)|\bevery (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\b(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)\b/i.test(text);
    if (!left.length) return recurring(a);
    if (!right.length) return recurring(b);
    if (left.length !== 1 || right.length !== 1) return false;
    return left[0].month === right[0].month && left[0].day === right[0].day &&
      (!left[0].year || !right[0].year || left[0].year === right[0].year);
  }

  function recordDateText(row) {
    const own = absoluteDates(row.text);
    if (!own || own.length) return row.text;
    // Date headings need not become memories to delimit the meaning of a note.
    const before = row.item.sourceText?.slice(0,row.item.start) || '';
    const dates = absoluteDates(before);
    if (!dates) return null;
    if (!dates.length) return row.text;
    const last = dates[dates.length-1];
    // Keep the source's original context. Moving a personal plan to a new
    // date must not silently move a separate, unchanged venue rule with it.
    const date = last;
    return (date.year ? date.year+'年' : '') + date.month+'月'+date.day+'日 '+row.text;
  }

  function recordDatesAgree(a, b, records) {
    // Each assertion may inherit its own source heading. Never borrow a date
    // from another document, or discard two conflicting headings.
    const left = recordDateText(a), right = recordDateText(b);
    return left !== null && right !== null && compatibleDates(left,right);
  }

  function sharesDay(x, y) {
    return x.day === y.day && (!x.week || !y.week || x.week === 'every' || y.week === 'every' || x.week === y.week);
  }

  function sharesTime(a, b) {
    return a.some(x => b.some(y => sharesDay(x,y) && (!x.bands.length || !y.bands.length ||
      x.bands.some(p => y.bands.some(q => p[0] < q[1] && q[0] < p[1])))));
  }

  function currentAssertion(item) {
    return (item.confirmed ? item.text : item.quote).trim().replace(/[。.!！]+$/,'');
  }

  function decisionAim(item, text) {
    const wish = personalWish(item);
    if (wish) return wish.aim;
    if (!decisionWords.test(text)) return '';
    return text.replace(/^(?:我|本人)(?:还|正在|在|正)?(?:考虑|犹豫要不要|拿不定主意要不要|想决定|想选|没决定)(?:要不要|是否)?|^I(?: am|['’]m)? (?:considering|trying to (?:choose|decide)|deciding|wondering whether)\s*/i,'').trim();
  }

  function personalDuty(text) {
    if (/我(?:的|家|们的)?(?:朋友|同事|室友|父母|家人|老师|[爸妈哥姐弟妹姑叔姨舅])|\bmy\s+[\w -]{1,35}['’]s\b/i.test(text) ||
        /我(?:不用|不必|没有|不需要)|不(?:用|需要)我|\b(?:I (?:do not|don['’]t|won['’]t)|I['’]m not|I am not)\b/i.test(text)) return false;
    const undated = text.replace(weekday,'').replace(periods,'').replace(clockTime,'').replace(/(我|本人)\s+/g,'$1');
    return commitment.test(undated);
  }

  function usesPlace(plan, noun, explicit = false) {
    const text = currentAssertion(plan).toLowerCase();
    const name = noun.toLowerCase();
    if (!text.includes(name)) return false;
    if (explicit && han.test(name)) {
      // Across documents require an explicit mention, rather than matching the
      // tail of another place's name (e.g. 新旧港展厅 versus 旧港展厅).
      const before = text.slice(0,text.indexOf(name));
      if (before && !/(?:去|在|到|进|用|向|从|坐|乘|搭|参观|预约|租|借|拍|录|买|把|的|[\s，。；：])$/.test(before)) return false;
    }
    return !['旁边','附近','对面','隔壁'].some(word=>text.includes(name+word)) &&
      !['路过','经过','靠近','near ','past ','beside ','opposite '].some(word=>
        text.includes(word+name) || text.includes(word+'the '+name));
  }

  function ruleSubjectMatches(plan, rule, text) {
    text = text.replace(/^(?:我|本人)(?:刚|已经|重新)?(?:查到|查过|问到|问过|问清楚了?|确认过?|了解到)(?:了)?[，,：:]?\s*|^I (?:found|learned|checked|confirmed|was told)(?: that)?\s+/i,'');
    const goal = currentAssertion(plan);
    const occupied = reservedObject.exec(text);
    if (occupied) {
      const noun = (occupied[1] || occupied[2]).replace(weekday,'').replace(clockTime,'')
        .replace(/(?:从|直到|要到|用于|来做|用来|去做).*$/,'').trim();
      return noun.length >= 2 && usesPlace(plan,noun,plan.sourceId !== rule.sourceId);
    }
    const mark = ruleMarker.exec(text);
    if (!mark) return false;
    const prefix = text.slice(0,mark.index).replace(weekday,' ').replace(periods,' ').replace(clockTime,' ')
      .replace(/^(?:我的|这个|这家|这间|the\s+|a\s+|an\s+)/i,'').trim()
      .replace(/(?:还是|都是|目前|现在|那天|当天|将会|会|是|的|从|在|每|都|\b(?:is|are|will be|was|on|at|from|currently|isn['’]t|is not))\s*$/i,'').trim();
    if (/^(?:它|它们|这里|那里|这门课|这个时段|这个地方|it|they|this (?:place|option|class))$/i.test(prefix) ||
        (!prefix && /^(?:它|这里|那里|it\b|this\b)/i.test(text))) {
      return !plan.confirmed && rule.sourceId === plan.sourceId && rule.previousEnd === plan.end &&
        (!rule.confirmed || /^(?:它|这里|那里|it\b|this\b)/i.test(rule.quote));
    }
    const ownResource = text.match(/^我(?:只能|仅能|只有|只在).{0,40}?(?:借到|借用|租到|拿到|用上|领到|取到|使用)([^，,。！？]{2,20})$/) ||
      text.match(/^I can only (?:borrow|use|collect|access|obtain) (?:the |a |my )?(.+?)(?: on | at | after | before | from | when |$)/i);
    if (ownResource) return goal.toLowerCase().includes(ownResource[1].toLowerCase());
    if (!prefix || personalDuty(text)) return false;
    if (han.test(text)) {
      const names = [prefix];
      // An explicitly named place/organization can own a part described by the
      // rule. Retain its complete name; shared suffixes are not identities.
      const part = prefix.match(/^(.{2,40}?)(?:的[^，。]{1,18}|这(?:条|家|间|座|个|处|所)[^，。]{1,12})$/);
      if (part) names.push(part[1]);
      return names.some(name=>name.length >= 2 && usesPlace(plan,name,true));
    }
    const phrase = prefix.toLowerCase().replace(/ (?:access|admission|entry|availability|rental)$/,'');
    const owner = phrase.match(/^(.+?)['’]s [a-z ]{2,30}$/)?.[1];
    return [phrase,...(owner?[owner]:[])].some(name=>name.length >= 3 &&
      (' '+goal.toLowerCase().replace(/[^\p{L}\d]+/gu,' ')+' ').includes(' '+name+' ') && usesPlace(plan,name));
  }

  function narrowsVisitDay(plan, rule, records) {
    // Only an exclusive, positive opening window can narrow an otherwise
    // unspecified visit time. A closing time is not an available appointment.
    if (!/(?:只在|仅在|\bonly\b)/i.test(rule.text) ||
        !/(?:开放|开门|营业|\bopen(?:s)?\b|\bavailable\b)/i.test(rule.text) ||
        /(?:关闭|关门|不|未|停用|\b(?:not|closed|unavailable|cannot)\b|n['’]t\b)/i.test(rule.text)) return false;
    if (plan.time.length !== 1 || rule.time.length !== 1 || plan.time[0].bands.length ||
        !rule.time[0].bands.length) return false;
    return sharesDay(plan.time[0],rule.time[0]) && recordDatesAgree(plan,rule,records);
  }

  function resourceForPlan(plan, row) {
    const own = /^(?:我|你|本人)(?:现在|目前|手头|家里|身边)?(?:只(?:有|能)|的[^，,。]{1,28}(?:需要|必须|只能))|^I (?:only have|can only use)|^my [^,.]{2,35} (?:requires?|needs?|can only)/i;
    if (!own.test(row.text) || /^(?:我|你)的[^，,。]{1,28}的|^my [^,.]{1,30}['’]s\b/i.test(row.text)) return false;
    const purpose = row.text.match(/(?:准备|打算)(?:把|用)?(.+)|(?:用来|用于)(.+)|\b(?:intend|plan) to (.+)|\b(?:use|using) (?:it|them|this|that) (?:for|to) (.+)/i);
    if (!purpose) return false;
    const action = purpose.slice(1).find(Boolean);
    return [...plan.item.terms].some(term=>row.item.terms.has(term) && action.toLowerCase().includes(term) &&
      !weakSubjects.has(term) && !questionWords.has(term) && !/(?:周[一二三四五六日天]|星期|日期|地点|事情|安排|准备|条件)|\d/.test(term));
  }

  function decisionOpening(items) {
    const records = [];
    for (const item of items) {
      if (!item.sourceId || item.kind !== 'self') continue;
      const text = currentAssertion(item);
      if (!text || text.length > 200 || /[「」“”"？?]/.test(text) || withdrawn.test(text)) continue;
      records.push({item,text,time:noteTime(text),aim:decisionAim(item,text)});
    }
    let best = null;
    for (const plan of records.filter(row=>row.aim)) {
      const others = records.filter(row=>!row.aim && han.test(row.text) === han.test(plan.text));
      const rules = others.filter(row => {
        if (!recordDatesAgree(plan,row,records) || !ruleSubjectMatches(plan.item,row.item,row.text)) return false;
        if (!reservedObject.test(row.text) || !plan.time.length || !row.time.length) return true;
        return plan.time.some(a=>row.time.some(b=>sharesDay(a,b)));
      });
      const obligations = others.filter(row=>personalDuty(row.text) && recordDatesAgree(plan,row,records));
      const windows = rules.filter(row=>narrowsVisitDay(plan,row,records));
      const options = windows.length ? windows : [plan,...rules];
      for (const option of options) {
        const duty = !/不可|不(?:能|许|开|提供)|关闭|停用|unavailable|closed|cannot/i.test(option.text) &&
          obligations.find(row=>row !== option && recordDatesAgree(option,row,records) && sharesTime(option.time,row.time));
        const rule = option !== plan ? option : null;
        if (!rule && !duty) continue;
        const resource = rule && others.find(row=>row !== rule && row !== duty &&
          recordDatesAgree(plan,row,records) && resourceForPlan(plan,row));
        const score = (rule ? 2 : 0) + (duty ? 3 : 0) + (resource ? 2 : 0);
        if (best && best.score >= score) continue;
        const bound = duty || rule;
        const condition = observerVoice(bound.text) + (resource ? (han.test(plan.text)?'。':'. ') + observerVoice(resource.text) : '');
        const timing = duty || rule.time.length || clockBands(rule.text).length;
        const title = han.test(plan.text) ? condition+'。'+(duty ?
          '要'+plan.aim+'，时间能错开吗？' :
          '如果'+plan.aim+'，'+(timing?'有合适的时段吗？':'这个条件能满足吗？')) :
          condition+'. '+(duty?'Would that leave time for your plan?':
            timing?'Does that leave a time that works for you?':'Would this condition affect your plan?');
        const evidence = [plan.item,...(resource?[resource.item]:[]),...(rule?[rule.item]:[]),...(duty?[duty.item]:[])];
        const context = rule && duty ? [plan.item,rule.item] : [plan.item];
        best = {score,opening:{mode:'linked',title,body:portraitBody(context,plan.item),factIds:evidence.map(item=>item.factId)}};
      }
    }
    return best?.opening;
  }

  // Deliberately small quantity grammar: simultaneous people and linear consumables.
  // It operates on current assertions, never on numbers recovered from old quotes.
  const quantityToken = '(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千]+)';
  const lengthToken = '(?:毫米|厘米|公分|米)';
  const quantityAmbiguousNumber = new RegExp('(?:[-−负]\\s*'+quantityToken+'|'+quantityToken+'\\s*[-~～至到]\\s*'+quantityToken+'|\\d[,，]\\d{3}|\\d+\\.\\d+\\.\\d+)\\s*(?:毫米|厘米|公分|米|个|件|份|张|条|本|枚|只|人|位|名|组|户)');
  const quantityDoubt = /如果|假如|假设|假定|除非|可能|大约|左右|估计|预计|不确定|不清楚|不知道|没量|未量|未确认|待确认|待定|待测|待检查|待核实|有待|需要(?:再|重新)?(?:确认|检查|核实|测量)|听说|据说|是否|至少|不到|超过|多于|少于/;
  const quantityThirdParty = /^(?:我|你)(?:的|家)?(?:朋友|同事|室友|父母|家人|老师|亲戚|[爸妈哥姐弟妹姑叔姨舅])|(?:替|帮).{0,12}(?:盘点|保管|保存)|属于别人|不是(?:我|你)的|替人保管/;
  const quantityEscape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Quantity extraction cannot decide the scope of negation or a reported
  // denial. Refuse the whole assertion instead of turning a mentioned number
  // into a positive fact. Only an explicit upper-bound spelling and a trailing
  // prohibition on adding people preserve the polarity of a capacity.
  function quantityUnclearAssertion(text, capacity=false) {
    if (capacity) text=text.replace(/不超过/g,'最多')
      .replace(/[，,](?:不能|不许|不得)(?:再)?增加人数[。！!]?$/,'');
    return /不|没|未|无|非|否认|否定|取消|作废|误记|写错|看错|或者|还是|或|二选一/.test(text);
  }

  function quantityNumber(text) {
    if (/^\d+(?:\.\d+)?$/.test(text)) {
      const n=Number(text);
      return Number.isFinite(n) && n>=0 && n<=1000000 ? n : null;
    }
    if (!/^[零〇一二两三四五六七八九十百千]+$/.test(text) || /[一二两三四五六七八九]{2}|[百千][一二两三四五六七八九]$/.test(text)) return null;
    const digits='零一二三四五六七八九';
    const normalized=text.replace(/〇/g,'零').replace(/两/g,'二');
    if (!/[十百千]/.test(normalized)) {
      if (normalized.length>1 && !normalized.includes('零')) return null; // 二三 is a range, not 23.
      return Number([...normalized].map(c=>digits.indexOf(c)).join(''));
    }
    let total=0, digit=0, last=10000;
    for (const c of normalized) {
      const unit=({十:10,百:100,千:1000})[c];
      if (!unit) { digit=digits.indexOf(c); continue; }
      if (unit>=last) return null;
      total+=(digit || 1)*unit; digit=0; last=unit;
    }
    return total+digit;
  }

  function quantityUnsafeNumber(text) {
    if (quantityAmbiguousNumber.test(text)) return true;
    // Scan the complete written number before a supported quantity unit. A
    // grammar that lacks 万/亿/Chinese decimals must not match their suffix.
    const written='[\\d零〇一二两三四五六七八九十百千万萬亿億兆点點廿卅卌壹贰貳叁參肆伍陆陸柒捌玖拾佰仟eE.+−-]+';
    const measured=new RegExp('('+written+')\\s*(?:毫米|厘米|公分|米|个|件|份|张|条|本|枚|只|人|位|名|组|户)','g');
    return [...text.matchAll(measured)].some(m=>quantityNumber(m[1])==null);
  }

  function quantityRows(items) {
    return items.filter(item=>item.kind==='self' && (item.sourceId || item.confirmed)).map(item=>({item,text:currentAssertion(item)}))
      .filter(row=>row.text && row.text.length<=600 && !/[「」“”"？?]/.test(row.text) && !withdrawn.test(row.text));
  }

  // A deictic time may use its immediately preceding current assertion. A named
  // place may use an earlier dated booking for that same place in this document.
  // Source text is not mined to restore a date or quantity that the user replaced.
  function quantityContext(row, rows, entity) {
    const dates=absoluteDates(row.text);
    if (!dates || dates.length>1) return null;
    if (dates.length) return {text:row.text,dates,bands:clockBands(row.text),refs:[row]};
    const before=rows.filter(other=>other!==row && row.item.sourceId && other.item.sourceId===row.item.sourceId &&
      other.item.start<row.item.start).sort((a,b)=>b.item.start-a.item.start);
    const anchor=before.find(other=>usesPlace(other.item,entity,true) ||
      (other.item.end===row.item.previousEnd && /这个(?:预约)?时段|这(?:一|个|段).{0,3}小时|当天|那天/.test(row.text)));
    if (anchor) {
      if (quantityUnclearAssertion(anchor.text) || quantityDoubt.test(anchor.text) || quantityThirdParty.test(anchor.text)) return null;
      const gapDates=absoluteDates(row.item.sourceText?.slice(anchor.item.end,row.item.start) || '');
      if (!gapDates || gapDates.length) return null;
      const ds=absoluteDates(anchor.text);
      if (!ds || ds.length>1) return null;
      if (ds.length===1) return {text:anchor.text+' '+row.text,dates:ds,bands:clockBands(anchor.text),refs:[row,anchor]};
    }
    // A heading or a replaced earlier sentence may delimit the source. Without
    // a current, citable date anchor, do not silently treat it as an undated rule.
    const rawDates=absoluteDates(row.item.sourceText?.slice(0,row.item.start) || '');
    if (!rawDates || rawDates.length) return null;
    return {text:row.text,dates:[],bands:clockBands(row.text),refs:[row]};
  }

  function quantitySameTime(left,right,scoped) {
    if (!left || !right) return false;
    if (left.dates.length && right.dates.length && !compatibleDates(left.text,right.text)) return false;
    if (right.dates.length && !left.dates.length) return false;
    if (scoped && (!left.dates.length || !right.dates.length)) return false;
    if (left.bands.length && right.bands.length &&
        !left.bands.some(a=>right.bands.some(b=>a[0]<b[1] && b[0]<a[1]))) return false;
    if (scoped && right.bands.length && !left.bands.length) return false;
    return true;
  }

  function quantityPlace(raw) {
    const name=raw.replace(/^(?:预约的|订好的|同一间|同一个|那间|这间|这个)/,'')
      .replace(/(?:里|内|中)$/,'').replace(/的(?:人数|容量)$/,'').replace(/(?:的)?(?:这次|该|这个)?预约(?:时段)?$/,'').trim();
    if (name.length<2 || name.length>24 || /[，,。；;]|这个时段|这一个小时|那天|当天|同时|全程|一直|轮流|分批|另一个|另一间|别人|最多|上限|\d+[点时]/.test(name)) return '';
    return name;
  }

  function quantityLocations(text) {
    const names=[];
    const verb=/待在|留在|进入|使用/.test(text) ? '(?:待在|留在|进入|使用)' : '在';
    for (const match of text.matchAll(new RegExp(verb+'([^，,。；;!?]{2,28}?)(?:里|内|中)?(?=[，,。；;!?]|$)','g'))) {
      const name=quantityPlace(match[1]);
      if (name && !/小时|分钟|时段|\d+年|\d+月/.test(name)) names.push(name);
    }
    return [...new Set(names)];
  }

  function quantityPresence(row) {
    if (quantityDoubt.test(row.text) || quantityUnclearAssertion(row.text) || quantityUnsafeNumber(row.text) || quantityThirdParty.test(row.text) ||
        !/同时|全程|一直|一起/.test(row.text) || /轮流|分批|依次|先后|分开|不(?:会|能|打算|准备)?(?:同时|一起)|只有部分|缺席/.test(row.text)) return null;
    if ([...row.text.matchAll(new RegExp(quantityToken+'(?:个)?人','g'))].length!==1) return null;
    const pattern=new RegExp('(?:(?:我|你)[、和与][^，,。]{0,28}?|(?:我们|你们)(?:一行|一共|总共|会有|共有)?)('+quantityToken+')(?:个)?人','g');
    const counts=[...row.text.matchAll(pattern)].map(m=>quantityNumber(m[1]));
    const places=quantityLocations(row.text);
    if (counts.length!==1 || !Number.isInteger(counts[0]) || counts[0]<1 || places.length!==1) return null;
    return {row,count:counts[0],entity:places[0]};
  }

  function quantityCapacity(row) {
    if (quantityDoubt.test(row.text.replace(/不超过/g,'最多')) || quantityUnclearAssertion(row.text,true) || quantityThirdParty.test(row.text) || quantityUnsafeNumber(row.text) || /除外|不包括|不计|工作人员|成年人|儿童|每批|每组/.test(row.text)) return null;
    const matches=[...row.text.matchAll(new RegExp('(?:最多|至多|上限(?:是|为)?|不超过)('+quantityToken+')(?:个)?人','g'))];
    if (matches.length!==1 || /(?:我|你)(?:想|希望|打算|计划)/.test(row.text)) return null;
    const match=matches[0],count=quantityNumber(match[1]);
    if (!Number.isInteger(count) || count<0) return null;
    const before=row.text.slice(0,match.index).replace(/^(?:我|你)(?:刚|已经)?(?:查到|查过|看到|确认过|问到)(?:了)?[，,：:]?/, '');
    // A group's own maximum attendance is not the venue's admission limit.
    if (/[我你他她](?:们)?[^，,。；;]*$/.test(before)) return null;
    const after=row.text.slice(match.index+match[0].length);
    // Keep the restricted quantity adjacent to its admission/location verb;
    // willingness or a prediction about entrants does not establish capacity.
    if (!/^(?:(?:同时|一起)?(?:进入|在|待在|留在|使用)|[，,。；;]|$)/.test(after)) return null;
    const following=quantityLocations(after);
    let entity=following.length===1 ? following[0] : '';
    if (!entity && !following.length) {
      const prefix=row.text.slice(0,match.index).split(/[，,]/).pop().replace(weekday,'').replace(periods,'').replace(clockTime,'')
        .replace(/(?:\d{4}年)?[零〇一二两三四五六七八九十\d]+月[零〇一二两三四五六七八九十\d]+[日号]?|\b\d{4}-\d{1,2}-\d{1,2}\b/g,'');
      entity=quantityPlace(prefix);
    }
    if (!entity || following.length>1) return null;
    return {row,count,entity,scoped:/预约|这个时段|该时段|这个小时/.test(row.text)};
  }

  function quantityReading(kind, title, records, arithmetic) {
    const evidence=[...new Map(records.map(row=>[row.item.factId,row.item])).values()];
    return {mode:'linked',title,body:'',factIds:evidence.map(item=>item.factId),
      factVersions:Object.fromEntries(evidence.map(item=>[item.factId,item.version])),
      derivation:{kind,...arithmetic}};
  }

  const lengthScale = unit => ({毫米:1,厘米:10,公分:10,米:1000})[unit];
  const quantityFormat = value => String(Math.round(value*1000000)/1000000);
  function quantityRates(row) {
    if (quantityDoubt.test(row.text) || quantityUnclearAssertion(row.text) || quantityUnsafeNumber(row.text) || quantityThirdParty.test(row.text) || /另需|另加|不含|不包括|缝份|损耗|余量/.test(row.text)) return [];
    const pattern=new RegExp('每(?:个|件|份|张|条|本|枚|只)([^，,。；;]{1,18}?)(?:都)?(?:需要|要用|消耗|用)('+quantityToken+')('+lengthToken+')(?:长的|的)?([^，,。；;]{1,18})','g');
    return [...row.text.matchAll(pattern)].map(m=>({row,product:m[1].trim(),amount:quantityNumber(m[2]),unit:m[3],resource:m[4].trim()}))
      .filter(rate=>rate.amount>0 && !/(?:这个|那种|这种|其他|剩下)/.test(rate.product) &&
        !/需要|每|还是|或者|和|或|与|的|即可|左右/.test(rate.resource));
  }

  function quantityPlan(row, rate) {
    if (quantityDoubt.test(row.text) || quantityUnclearAssertion(row.text) || quantityUnsafeNumber(row.text) || quantityThirdParty.test(row.text) ||
        !/(?:^|[，,；;])(?:我|你|我们|你们)(?:这次|现在)?(?:想|打算|计划|准备|决定)(?!知道|问|了解|听说)/.test(row.text)) return null;
    const product=quantityEscape(rate.product);
    const matches=[...row.text.matchAll(new RegExp('('+quantityToken+')(?:个|件|份|张|条|本|枚|只)([^，,。；;]{0,20}?'+product+')(?=[，,。；;]|$)','g'))];
    if (matches.length!==1) return null;
    const match=matches[0];
    // A shortened product name can be resolved only within the same note and
    // a single stated plan; it must not identify a similar item in another note.
    const alias=match[2]!==rate.product;
    if (/[、和与及]/.test(match[2]) || (alias && row.item.sourceId!==rate.row.item.sourceId)) return null;
    let count=quantityNumber(match[1]);
    const prefix=row.text.slice(0,match.index);
    if (/每(?:人|位|组|户)/.test(prefix)) {
      const distributed=prefix.match(new RegExp('('+quantityToken+')(?:位|名|个|组|户|人)[^，,。；;]{0,12}每(?:人|位|组|户)(?:送|给|做|准备|拿|带|领)?$'));
      if (!distributed) return null;
      const recipients=quantityNumber(distributed[1]);
      if (!Number.isInteger(recipients) || recipients<1) return null;
      count*=recipients;
    }
    if (!Number.isInteger(count) || count<1 || count>100000) return null;
    return {row,count,entity:rate.product};
  }

  function quantityStock(row, resource) {
    if (quantityDoubt.test(row.text) || quantityUnclearAssertion(row.text) || quantityUnsafeNumber(row.text) || quantityThirdParty.test(row.text) ||
        !/^(?:我|你|我们|你们)(?!的(?:朋友|同事|室友|[爸妈哥姐弟妹]))/.test(row.text) ||
        !/手头|可用|能用|库存|存量|还剩|剩下/.test(row.text) ||
        /预计|将有|会有|明天|下周|借给|留给|不能用|不可用|其中|部分|但|不过|却|用完|用掉|耗尽|耗完|借来的/.test(row.text)) return null;
    const resourcePattern=quantityEscape(resource);
    const measures=[...row.text.matchAll(new RegExp('('+quantityToken+')('+lengthToken+')','g'))];
    // A total plus a usable subset is not one inventory measurement.
    if (measures.length!==1) return null;
    const linked=measures.filter(m=>{
      const left=row.text.slice(0,m.index),right=row.text.slice(m.index+m[0].length);
      if (new RegExp('^(?:长的|的)?'+resourcePattern+'(?=[，,。；;]|$)').test(right)) return true;
      const named=left.match(new RegExp(resourcePattern+'([^。；;]{0,40})$'));
      const before=named && left.slice(0,named.index);
      if (before && !/(?:的|有|把|是|为|：|:|手头|库存|剩下|[，,])$/.test(before)) return false;
      const near=named?.[1];
      if (near==null || /[\d零〇一二两三四五六七八九十百千]/.test(near.replace(/一遍|一次/,''))) return false;
      return /^(?:都)?(?:量了?一遍|量过|盘点过)?[，,]?(?:现在|目前)?(?:能用的|可用的|可用|库存|存量|总长|总共|一共|还剩|剩下|共|有|是|为|的|只有)*$/.test(near);
    });
    if (linked.length!==1) return null;
    const match=linked[0],amount=quantityNumber(match[1]);
    if (amount==null) return null;
    return {row,amount:amount*lengthScale(match[2]),unit:match[2],entity:resource};
  }

  function quantityOpening(items) {
    const rows=quantityRows(items);
    const capacities=rows.map(quantityCapacity).filter(Boolean);
    for (const presence of rows.map(quantityPresence).filter(Boolean)) {
      const context=quantityContext(presence.row,rows,presence.entity);
      const compatible=capacities.filter(capacity=>capacity.entity===presence.entity &&
        quantitySameTime(context,quantityContext(capacity.row,rows,capacity.entity),capacity.scoped));
      if (!compatible.length) continue;
      if (new Set(compatible.map(row=>row.count)).size!==1) return quantityReading('quantity-uncertain',
        '关于'+presence.entity+'的人数上限，你记下了不同的数字。现在该按哪一条来安排？',
        [...context.refs,...compatible.flatMap(capacity=>quantityContext(capacity.row,rows,capacity.entity).refs)],{});
      const capacity=compatible[0];
      if (presence.count<=capacity.count) continue;
      const bound=quantityContext(capacity.row,rows,capacity.entity);
      return quantityReading('simultaneous-capacity',
        '你计划'+presence.count+'人同时在'+presence.entity+'，记录中的上限是'+capacity.count+'人；目前的安排多了'+(presence.count-capacity.count)+'人。',
        [...context.refs,...bound.refs],{participants:presence.count,limit:capacity.count});
    }
    const rates=rows.flatMap(quantityRates);
    for (const rate of rates) {
      const plans=rows.map(row=>quantityPlan(row,rate)).filter(Boolean);
      if (plans.length!==1) continue;
      const plan=plans[0];
      const rateDates=absoluteDates(rate.row.text),planDates=absoluteDates(plan.row.text);
      if (!rateDates || !planDates || (rateDates.length && planDates.length && !compatibleDates(rate.row.text,plan.row.text))) continue;
      const matchingRates=rates.filter(other=>other.product===rate.product && other.resource===rate.resource);
      if (new Set(matchingRates.map(other=>other.amount*lengthScale(other.unit))).size!==1) continue;
      const stocks=rows.map(row=>quantityStock(row,rate.resource)).filter(Boolean);
      if (!stocks.length) continue;
      if (new Set(stocks.map(stock=>stock.amount)).size!==1) return quantityReading('quantity-uncertain',
        '关于'+rate.resource+'的可用库存，你记下了不同的数量。现在该按哪一份来算？',
        [plan.row,rate.row,...stocks.map(stock=>stock.row)],{});
      const stock=stocks[0],needed=plan.count*rate.amount*lengthScale(rate.unit);
      if (!Number.isFinite(needed) || needed>1000000000 || stock.amount>=needed-1e-7) continue;
      const scale=lengthScale(rate.unit);
      return quantityReading('consumable-length',
        '按你记下的库存和用量，'+plan.count+'个'+rate.product+'需要'+quantityFormat(needed/scale)+rate.unit+rate.resource+'；现有'+quantityFormat(stock.amount/scale)+rate.unit+'，还差'+quantityFormat((needed-stock.amount)/scale)+rate.unit+'。',
        [plan.row,rate.row,stock.row],{count:plan.count,perItem:rate.amount,available:stock.amount/scale,needed:needed/scale,unit:rate.unit});
    }
    return null;
  }

  function offlineOpening(items) {
    // Only pair compatible observations from different documents around a shared concrete subject.
    // A sender's own wishes are not evidence of the recipient's goals or habits.
    const byTopic=new Map();
    let best=null;
    for (const item of items) {
      if (!item.sourceId || (item.kind!=='self' && !(item.kind==='mail' && recipientObservation(item.quote)))) continue;
      if (item.kind==='self' && /[「」“”"]|^(?:我|你)(?:的|家)?(?:朋友|同事|家人|室友|父亲|母亲|老师)|^(?:your|my) (?:friend|colleague|roommate|mother|father|teacher)\b/i.test(item.text)) continue;
      if (/如果|除非|未决定|没|不再|不想|不会|以前|原本|取消|只是考虑|\b(?:if|unless|not|never|used to|no longer|cancelled|canceled)\b|n['’]t\b/i.test(item.text)) continue;
      for (const term of item.terms) {
        if (weakSubjects.has(term) || /\d/.test(term) || !topical(item,term)) continue;
        if (item.facet!=='approach' && item.facet!=='strength') continue;
        if (!byTopic.has(term)) byTopic.set(term,new Map());
        const roles=byTopic.get(term);
        const candidates=roles.get(item.facet==='approach'?'strength':'approach') || [];
        const other=candidates.find(c=>c.documentId!==item.documentId && key(c.quote)!==key(item.quote) &&
          han.test(c.text)===han.test(item.text));
        if (other && (!best || term.length>best.score)) {
          const members=item.facet==='approach'?[item,other]:[other,item];
          const title=han.test(item.text)?'说起'+term+'，你能说清自己是怎么做的':'With '+term+', you can put your method into words';
          best={score:term.length,opening:{mode:'linked',title,
            body:portraitBody(members,members[0]),factIds:members.map(m=>m.factId)}};
        }
        const same=roles.get(item.facet) || [];
        if (!same.some(c=>c.documentId===item.documentId) && same.length<2) {
          same.push(item);
          roles.set(item.facet,same);
        }
      }
    }
    if (best) return best.opening;
    const decision = decisionOpening(items);
    if (decision) return decision;
    // A stated limit or reason usually says more about a decision than the order of the notes.
    const limit = /只有|只能|只接受|只方便|最多|至少|最迟|最晚|必须|才(?:能|可以)|前提|取决于|不能超过|上限|下限|不得|因为|为了|\b(?:only|at (?:most|least)|no (?:more|later) than|must|depends on|because|in order to)\b/i;
    const refersBack = /它(?:的|们)?|\b(?:it|its|them)\b/i;
    const measured = /(?:净[高宽深]|限[高宽重]|限额|限时|容量|限量|clearance|capacity|allowance).{0,10}[\d一二三四五六七八九十百千万两]|[\d一二三四五六七八九十百千万两](?:毫米|厘米|公分|米)[宽深高厚长]|\d\s*(?:mm|cm|metres?|meters?|inches|feet)\s+(?:wide|deep|high|thick|long)\b/i;
    const wishes = new Map();
    for (const item of items) {
      if (item.sourceId && item.end != null && personalWish(item)) wishes.set(item.sourceId+'#'+item.end,item);
    }
    for (const bound of items) {
      if (bound.kind !== 'self' || !(limit.test(bound.text) || measured.test(bound.text))) continue;
      const wish = wishes.get(bound.sourceId+'#'+bound.previousEnd);
      if (!wish || /[“「”」"]/.test(bound.text) || uncertain.test(bound.text)) continue;
      const current = currentAssertion(bound);
      const dimension = current.match(/^(.{2,32}?)(?:的净[高宽深]|的限[高宽重]|里面有|的容量|的限额|的上限|的下限| has (?:a )?(?:clearance|capacity))/i);
      const shared = dimension && currentAssertion(wish).toLowerCase().includes(dimension[1].toLowerCase());
      // A changed intention can refer to a different object. Its old neighbour is no longer evidence for that link.
      if (!shared && (!refersBack.test(bound.text) || wish.confirmed ||
          (bound.confirmed && !refersBack.test(bound.quote)))) continue;
      const title = portraitBody([wish,bound],wish);
      if (Array.from(title).length <= (han.test(title) ? 80 : 180)) {
        return {mode:'linked',title,body:'',factIds:[wish.factId,bound.factId]};
      }
    }
    // A written eligibility limit stands on its own even when the note never names
    // the connection between the person's plans and the regulated object.
    const restriction = items.find(item => item.kind === 'self' && !/[“「”」"]/.test(item.text) &&
      !withdrawn.test(currentAssertion(item)) && hardBound.test(currentAssertion(item)));
    if (restriction) return singleOpening(restriction);
    const lead = items.find(item => item.kind === 'self' && !/[“「”」"]/.test(item.text) &&
      !refersBack.test(item.text) && limit.test(item.text));
    return singleOpening(lead || items[0]);
  }

  function validProse(value, limit) {
    return typeof value==='string' && value.trim().length>1 && value.length<=limit &&
      !secrets.test(value) && !noise.test(value) && !privateRequest.test(value);
  }

  function quotesSource(ref, text) {
    const item = {kind:ref.kind, quote:ref.quote, subject:ref.sourceTitle, text:ref.text};
    return text === ref.text || text === readingOf(item);
  }

  function validateOpening(title, body, citations, available) {
    if (!validProse(title,110) || !validProse(body,700) || key(title)===key(body) ||
        !Array.isArray(citations) || citations.length<2 || citations.length>8) return null;
    const byId=new Map(available.map(ref=>[ref.id,ref]));
    const refs=[];
    for (const citation of citations) {
      const ref=byId.get(citation?.id);
      if (!ref || ref.version!==citation.version || ref.quote!==citation.quote ||
          (citation.sourceId!==undefined && ref.sourceId!==citation.sourceId) ||
          (citation.provenance!==undefined && ref.provenance!==citation.provenance) ||
          refs.some(prev=>prev.id===ref.id || key(prev.quote)===key(ref.quote))) return null;
      refs.push(ref);
    }
    if (!canReadTogether(refs)) return null;
    // A sender can describe the recipient. Their own wishes, or a file of unknown
    // authorship, can only be repeated here with their source still attached.
    const aboutOwner = ref => {
      if (ref.kind === 'self') return true;
      if (ref.kind !== 'mail' || !recipientObservation(ref.quote)) return false;
      const observation = ref.quote.slice(ref.quote.search(/你|您|\byou\b/i));
      return !/[「『“"]|我|本人|\b(?:I|my|mine|we|our)\b/i.test(observation);
    };
    if (refs.some(ref => !aboutOwner(ref)) &&
        ![title.trim(), body.trim()].every(line => refs.some(ref => quotesSource(ref, line)))) return null;
    const quotes=refs.map(ref=>ref.quote).join('\n');
    // A verbatim citation does not license adding a new measurement or date.
    const numbers=(title+' '+body).match(/\d+(?:[.,:]\d+)*(?:%|％)?/g) || [];
    const present=new Set(quotes.match(/\d+(?:[.,:]\d+)*(?:%|％)?/g) || []);
    if (numbers.some(n=>!present.has(n))) return null;
    return {title:title.trim(),body:body.trim(),factIds:refs.map(r=>r.id),
      citations:refs.map(({id,version,sourceId,quote,provenance})=>({id,version,sourceId,quote,provenance}))};
  }

  function decodeSuggestion(raw) {
    let value;
    try {
      value=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*|\s*```$/gi,''));
    } catch { throw Error('模型返回的内容无法读成画像。'); }
    return value;
  }

  function selectedItems(state, offered) {
    const selected=new Map(offered.map(ref=>[ref.id,ref]));
    return portraitItems(state).filter(item=>{
      const sent=selected.get(item.factId);
      const current=excerptsFor([item],true)[0];
      return current && sent && sent.sourceId===current.sourceId && sent.version===current.version &&
        sent.quote===current.quote && sent.provenance===current.provenance &&
        JSON.stringify(sent.documentIds)===JSON.stringify(current.documentIds);
    });
  }

  function suggestOpening(state, offered, raw) {
    const value=decodeSuggestion(raw);
    return value ? validateOpening(value.title,value.why,value.citations,excerptsFor(selectedItems(state,offered),true)) : null;
  }

  function validateFuture(items, title, citations) {
    if (!validProse(title,110) || !/[?？]$/.test(title) || /[。.!！]/.test(title) ||
        !/如果|下次|以后|将来|未来|[你您](?:想|愿意|会|打算|希望)|哪一步|能让|\b(?:would|could|might|will|next)\b/i.test(title) ||
        /已经|果然|天生|必然|注定|人格|天才|诊断|\b(?:already|proven|guarantee|destined|personality|diagnosis|genius)\b/i.test(title) ||
        !Array.isArray(citations) || citations.length<2 || citations.length>8) return null;
    const ids=new Set(citations.map(c=>c?.id));
    const cited=items.filter(item=>ids.has(item.factId)).map(item=>item.confirmed ?
      {...item,text:item.currentText,quote:item.currentText,kind:'self',terms:termsOf(item.currentText)} : {...item});
    if (!canReadTogether(excerptsFor(cited,true),'future')) return null;
    for (const item of cited) item.terms ||= termsOf(item.quote);
    const path=futurePath(cited);
    const future=pathChapters(path).future;
    if (!future || future.factIds.length!==citations.length || !future.factIds.every(id=>ids.has(id))) return null;

    // The model can reframe the question. Only the user's current sources supply the factual explanation.
    const sourceWords=new Set(cited.flatMap(item=>[...item.terms]));
    const words=termsOf(title);
    const originals=new Set(cited.flatMap(item=>item.quote.toLowerCase().match(/[a-z]+/g)||[]));
    const shortEnglish=title.toLowerCase().match(/\b[a-z]{1,4}\b/g) || [];
    if (shortEnglish.some(w=>!originals.has(w) &&
        !/^(?:a|an|the|your|you|ours|our|to|be|is|are|it|its|when|what|who|how|why|with|for|on|in|by|at|as|if|or|and|way|one|try|take|next|step|will|want|can|do|of)$/.test(w))) return null;
    if (![...words].some(word=>sourceWords.has(word) && !weakSubjects.has(word)) ||
        [...words].some(word=>!sourceWords.has(word) && !questionWords.has(word) && !weakSubjects.has(word))) return null;
    const grounding=validateOpening(title,future.body,citations,excerptsFor(cited,true));
    return grounding ? {...grounding,kind:'future'} : null;
  }

  function suggestFuture(state, offered, raw) {
    const value=decodeSuggestion(raw);
    return value ? validateFuture(selectedItems(state,offered),value.title,value.citations) : null;
  }

  function adoptFuture(state, suggestion) {
    const future=suggestion && validateFuture(portraitItems(state),suggestion.title,suggestion.citations);
    if (!future) throw Error('这些原句或心愿已经变化，请用现在的资料再读一次。');
    state.reveal ||= {};
    state.reveal.future={title:future.title,citations:future.citations};
    return future;
  }

  function dismissFuture(state) {
    if (state.reveal) delete state.reveal.future;
  }

  function adoptOpening(state, suggestion) {
    const opening=suggestion && validateOpening(suggestion.title,suggestion.body,suggestion.citations,excerptsFor(portraitItems(state),true));
    if (!opening) throw Error('这些原句或记忆已经变化，请用现在的资料再读一次。');
    state.reveal ||= {};
    state.reveal.opening={title:opening.title,body:opening.body,citations:opening.citations};
    return opening;
  }

  function dismissOpening(state) {
    if (state.reveal) delete state.reveal.opening;
  }

  function pruneOpening(state) {
    const externalIds = new Set(state.sources.filter(s => s.kind === 'mail' || s.kind === 'file').map(s => s.id));
    const pending = state.facts.filter(f => !f.confirmed && f.alternatives?.length && externalIds.has(f.sourceId));
    if (pending.length) {
      const refs = new Map(portraitExcerpts(state).map(ref => [ref.id, ref]));
      for (const fact of pending) {
        const ref = refs.get(fact.id);
        if (ref?.kind === 'self') continue;
        const retained = fact.alternatives.filter(alt => ref && alt.quote === ref.quote && quotesSource(ref, alt.text));
        if (retained.length !== fact.alternatives.length) {
          fact.alternatives = retained;
          fact.version++;
        }
      }
    }
    const saved=state.reveal?.opening;
    if (saved && !validateOpening(saved.title,saved.body,saved.citations,excerptsFor(portraitItems(state),true))) dismissOpening(state);
    const future=state.reveal?.future;
    if (future && !validateFuture(portraitItems(state),future.title,future.citations)) dismissFuture(state);
    return state;
  }

  function saveModelReadings(state, sourceId, offered, raw) {
    const value=JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*|\s*```$/gi,''));
    if (!Array.isArray(value?.findings)) throw Error('模型没有按约定返回解读，可以重新读取。');
    const current=new Map(modelExcerpts(state,sourceId).map(c=>[c.id,c]));
    const changed=[];
    for (const item of value.findings.slice(0,12)) {
      if (typeof item?.text!=='string' || typeof item.quote!=='string') continue;
      const text=item.text.trim();
      if (!text || text.length>500 || secrets.test(text) || privateRequest.test(text) || noise.test(text)) continue;
      const selected=offered.find(r=>r.quote===item.quote);
      const ref=selected && current.get(selected.id);
      if (!ref || !ref.sourceBacked || ref.version!==selected.version || ref.quote!==item.quote || text===ref.text ||
          (ref.kind!=='self' && !quotesSource(ref,text))) continue;
      const span=state.facts.find(f=>f.id===ref.id)?.evidence?.find(e=>e.sourceId===sourceId && e.quote===ref.quote);
      if (!span) continue;
      const added=Store.addClaim(state,sourceId,text,ref.quote,span.start);
      if (added?.id===ref.id && !changed.includes(ref.id)) changed.push(ref.id);
    }
    return changed;
  }
  return {readMaterial, buildPortrait, modelExcerpts, saveModelReadings, portraitExcerpts, readingLabel, canReadTogether, goalProposalReview,
    suggestOpening, adoptOpening, dismissOpening, pruneOpening, suggestFuture, adoptFuture, dismissFuture};
})();
if (typeof window !== 'undefined') window.AdvisorReveal = AdvisorReveal;
if (typeof module !== 'undefined') module.exports = AdvisorReveal;
