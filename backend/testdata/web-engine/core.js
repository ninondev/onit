'use strict';

const AdvisorStore = (() => {
  const stamp = () => new Date().toISOString();
  const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
  const clean = (s, max = 1000) => String(s ?? '').trim().slice(0, max);
  // 常用单位只是建议，不是白名单（发起人 2026-11-10：一切可塑，单位随目标定）。
  const units = ['次', '分钟', '页', '公里', '元'];
  // 单位预填：从目标文字猜一个常用单位垫在输入框里，猜错随手改、可清空
  //（建议层，不锁定；发起人 2026-11-10：一切可塑，但也要尽可能好用）。
  function inferUnit(title, step = '') {
    const t = String(title||'') + String(step||'');
    if (/(书|读|章|回)/.test(t)) return '页';
    if (/(跑|走|骑|步)/.test(t)) return '公里';
    if (/(口语|说|练|听|写|弹|画|琴)/.test(t)) return '分钟';
    if (/(钱|存|攒|基金|省|花|攒)/.test(t)) return '元';
    return '次';
  }
  const kinds = new Set(['self', 'mail', 'file']);

  const personalSignal = /每(?:个)?(?:[天晚周月年]|星期)|习惯|通常|经常|总是|一直|练习|准备|打算|考虑|希望|我想|想要|想学|尝试|学习|正在|目标|最想|计划|喜欢|偏好|在意|重视|擅长|担心|困扰|很难|没时间|不想|宁愿|工作|职业|住在|现住|搬家|我的名字|我叫|我是一[名位个]|\b(every|usually|often|always|habit|routine|favou?rite|prefer|love|like|want|hope|plan|planning|considering|goal|value|practice|practise|struggle|worry|worried|work|working|live|living|learning|study|studying|trained|training|enjoy|enjoys)\b|important to me|hard for me|my name is|I(?: am|[’']m) (?:an? |based in )/i;
  const ownerStatement = /^(我|本人|(?:最近|现在|以前|目前|平时|有时|当时|去年|每(?:天|周|晚))，?我|I(?:\s|['’])|My\s|(?:usually|lately|recently|currently|these days),?\s+I\b)/i;
  const eventSignal = /改期|取消|预约|会议|航班|截止|交付|邀请|\b(meeting|appointment|flight|rescheduled|postponed|deadline|invitation|cancelled|canceled)\b/i;
  const privateOrNoise = /验证码|一次性密码|授权码|退订|忽略.{0,8}(指令|提示)|\b(?:password|passcode|api[_ -]?key|bearer|unsubscribe)\b|verification code|ignore (?:all |any )?(?:previous|prior|instructions)|https?:\/\//i;

  const categoryPeople = /外婆|奶奶|爷爷|父母|爸|妈|妈妈|爸爸|父亲|母亲|妻子|丈夫|伴侣|室友|朋友|同事|主管|老板|老师|导师|孩子|女儿|儿子|表哥|表姐|表弟|表妹|堂兄|堂弟|堂姐|堂妹|哥哥|姐姐|弟弟|妹妹|舅舅|舅妈|姑妈|伯父|叔叔|侄子|侄女|外孙|孙女|孙子|\b(grandmother|grandfather|mother|father|mom|dad|wife|husband|partner|roommate|friend|colleague|manager|mentor|child|daughter|son|cousin|brother|sister|uncle|aunt|niece|nephew)\b/i;
  const testFraming = /测试|考考你|试一试|试试看|只是.{0,6}(试|测试)|\b(memory test|just a test)\b/i;
  function metaJudgement(text) {
    return testFraming.test(String(text ?? '')) ? '本人说明这是测试性陈述，可能不是真实偏好。' : '';
  }
  const categoryTech = /代码|编程|开发|软件|模型|服务器|数据库|接口|脚本|终端|安卓|电脑|\b(python|golang|rust|javascript|typescript|linux|android|ios|model|server|database|api|code|coding|software|git)\b/i;
  const categoryAccounts = /会员|订阅|账号|账户|年费|付费|\b(premium|subscription|account)\b/i;
  const categoryIdentity = /我叫|我的名字|我是一[名位个]|职业|住在|现住|工作是|定居|\b(my name is|I am an?|I'm an?|based in|live in|living in|work as)\b/i;
  const categoryPreferences = /喜欢|偏好|讨厌|不想|宁愿|习惯|在意|重视|最爱|\b(prefer|love|like|dislike|hate|value|enjoy|enjoys|favorite|favourite)\b/i;
  const categoryInterests = /大提琴|钢琴|木工|陶艺|观鸟|徒步|露营|画画|摄影|看书|话剧|登山|法语|动画|棋|\b(cello|piano|loom|weaving|pottery|ceramics|paint|sketch|hiking|camping|chess|animation|french|photography)\b/i;
  const categoryEpisodes = /改期|取消|预约|会议|航班|截止|交付|邀请|上周|去年|当时|\b(meeting|appointment|flight|rescheduled|postponed|deadline|invitation|cancelled|canceled|last week|last year)\b/i;

  function inferCategory(text, kind = 'self') {
    const s = String(text ?? '');
    if (categoryPeople.test(s)) return 'people';
    if (categoryTech.test(s)) return 'tech';
    if (categoryAccounts.test(s)) return 'accounts';
    if (categoryIdentity.test(s)) return 'identity';
    if (categoryInterests.test(s)) return 'interests';
    if (categoryPreferences.test(s)) return 'preferences';
    if (categoryEpisodes.test(s) || kind === 'mail') return 'episodes';
    return 'state';
  }

  function inferAttribution(kind = 'self', confirmed = false) {
    if (confirmed) return 'confirmed';
    return kinds.has(kind) ? kind : 'self';
  }

  function evidenceText(kind, quote) {
    if (kind === 'self') return quote;
    if (/\p{Script=Han}/u.test(quote)) {
      return kind === 'mail' ? `来信中写道「${quote}」` : `文件中写道「${quote}」`;
    }
    return kind === 'mail' ? `The email says “${quote}”` : `The file says “${quote}”`;
  }

  function visitSentences(text, visit) {
    let start = 0;
    let depth = 0;
    let doubleQuote = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '“' || ch === '「' || ch === '『') depth++;
      else if ((ch === '”' || ch === '」' || ch === '』') && depth > 0) depth--;
      else if (ch === '"') doubleQuote = !doubleQuote;
      if (depth > 0 || doubleQuote) continue;
      const next = i + 1;
      let boundary = '\n。！？!?'.includes(ch);
      if (ch === '.' && (next === text.length || /\s/.test(text[next]))) boundary = true;
      if (boundary) {
        if (visit(text.slice(start, next).trim()) === false) return;
        start = next;
      }
    }
    if (start < text.length) visit(text.slice(start).trim());
  }

  function readMaterial(kind, text) {
    const findings = [];
    if (!kinds.has(kind) || typeof text !== 'string') return findings;
    const seen = new Set();
    visitSentences(text, quote => {
      const len = [...quote].length;
      if (len < 4 || len > 600 || seen.has(quote) || privateOrNoise.test(quote) ||
          quote.startsWith('>') || quote.endsWith('?') || quote.endsWith('？')) {
        return true;
      }
      const parts = independentStatements(kind, quote);
      const relevant = kind === 'self'
        ? personalSignal.test(quote) && ownerStatement.test(quote)
        : personalSignal.test(quote) || eventSignal.test(quote);
      for (const part of parts || (relevant ? [quote] : [])) {
        if (seen.has(part)) continue;
        const statement = evidenceText(kind, part);
        findings.push({
          text: statement,
          quote: part,
          category: inferCategory(statement, kind),
          attribution: inferAttribution(kind, false),
        });
        seen.add(part);
      }
      return true;
    });
    return findings;
  }

  // Two independent assertions in a dated personal note can have different lifetimes.
  // Keep their verbatim ranges. Other sentence shapes retain the original interpretation.
  const datedSchedule = /^(?:我)?(?:(?:下|本|这)?(?:周|星期)[一二三四五六日天]|明天|今天|后天)(?:上午|下午|早上|早晨|中午|晚上)?\s*(?:[一二两三四五六七八九十〇零\d]+[点时]|\d{1,2}[:：]\d{2})/u;
  const personalIntention = /^我(?:原本|本来|现在|曾经|之前|当时)?(?:想|希望|打算|计划|准备|考虑)/u;
  function independentStatements(kind, sentence) {
    if (kind !== 'self' || /[“”「」『』"？?\n]|如果|假如|假设|要是|只要|除非|倘若|的话|才会|也许|可能/.test(sentence)) return null;
    const fields = sentence.split(/[;；]/u).map(part => part.trim());
    if (fields.length > 1 && fields.length <= 6) {
      const labels = fields.map(part => part.match(/^([\p{L}][\p{L} ]{0,23})[:：]\s*\S/u)?.[1].trim().toLowerCase());
      if (labels.every(Boolean) && new Set(labels).size === fields.length) return fields;
    }
    const time = sentence.match(datedSchedule);
    if (!time) return null;
    const clauses = sentence.split(/[,，;；]/u).map(part => part.trim());
    const action = clauses[0].slice(time[0].length).trim();
    if (clauses.length !== 2 || !personalIntention.test(clauses[1]) ||
        action.length < 2 || /^[零〇一二两三四五六七八九十\d分刻半钟整点前后左右上下大约过刚的时候\s]+$/u.test(action) ||
        /[。.!！\n]/u.test(clauses[0]) || /[。.!！\n]./u.test(clauses[1])) return null;
    return clauses;
  }

  function empty() {
    return {version: 2, name: '', sources: [], facts: [], discoveries: [], dismissed: [], goals: [], proposals: [], reports: [], artifacts: [], people: [], profile: null, conversation: [], model: null};
  }

  function restore(saved) {
    if (!saved) return empty();
    if (saved.version !== 1 && saved.version !== 2) throw Error('无法读取这个版本的存档。');
    const state = {...empty(), ...saved, version: 2};
    for (const s of state.sources) {
      s.kind = kinds.has(s.kind) ? s.kind : 'self';
      s.origin ??= '';
    }
    for (const f of state.facts) {
      f.history ??= [];
      f.confirmed ??= f.history.length > 0;
      f.version = Number.isInteger(f.version) && f.version >= 1 ? f.version : 1;
      f.alternatives ??= [];
      const src = state.sources.find(s => s.id === f.sourceId);
      const kind = src?.kind || 'self';
      f.category ??= inferCategory(f.text, kind);
      f.attribution ??= inferAttribution(kind, f.confirmed);
      if (!Array.isArray(f.evidence)) {
        f.evidence = f.sourceId && f.quote
          ? [{sourceId: f.sourceId, quote: f.quote, start: f.start ?? 0, end: f.end ?? f.quote.length}]
          : [];
      }
    }
    for (const proposal of state.proposals) {
      if (proposal.factIds || !proposal.basis) continue;
      const f = state.facts.find(item => item.id === proposal.basis);
      if (f && (f.text === proposal.title || f.history.some(h => h.text === proposal.title))) {
        proposal.titleFromFact = true;
        proposal.title = '';
      }
    }
    for (const report of state.reports) {
      // Version 1 reports stored labels in the same order as the goals, newest first.
      const goals = state.goals.filter(g => g.at <= report.at);
      for (const row of [...report.rows].reverse()) {
        const matches = g => row.goalId ? g.id === row.goalId :
          g.title === row.title && g.step === row.step && g.unit === row.unit;
        let index = goals.length - 1;
        while (index >= 0 && !matches(goals[index])) index--;
        if (index < 0) continue;
        const [goal] = goals.splice(index, 1);
        Object.assign(row, progress(goal, report.from, report.at), {goalId: goal.id});
      }
    }
    return state;
  }

  function importSource(state, title, text, origin = '', kind = 'self') {
    title = clean(title, 140);
    origin = clean(origin, 140);
    kind = kinds.has(kind) ? kind : 'self';
    if (!title || typeof text !== 'string' || !text.trim()) throw Error('请写下资料名称和原文。');
    const existing = state.sources.find(s => (s.origin || '') === origin && (s.kind || 'self') === kind && s.title === title && s.text === text);
    if (existing) return existing;
    const source = {id: uid(), kind, title, text, origin, at: stamp()};
    state.sources.push(source);
    return source;
  }

  function removeSource(state, sourceId, keepConfirmedIds = [], retainedReadings = new Map()) {
    if (!state.sources.some(s => s.id === sourceId)) return;
    const firstContext=typeof module!=='undefined' && module.exports?require('./first-reading-context.js'):window.AdvisorFirstContext;
    firstContext?.rememberSuppressed(state,sourceId);
    const keep = new Set(keepConfirmedIds);
    const removed = new Set();
    const affected = new Set();
    state.facts = state.facts.flatMap(f => {
      const spans = Array.isArray(f.evidence) ? f.evidence : [];
      const touchesPrimary = f.sourceId === sourceId;
      const touchesSpan = spans.some(sp => sp.sourceId === sourceId);
      if (!touchesPrimary && !touchesSpan) return [f];
      const remaining = spans.filter(sp => sp.sourceId !== sourceId);
      if (remaining.length > 0) {
        const primary = remaining[0];
        const nextSource = state.sources.find(s => s.id === primary.sourceId);
        return [{
          ...f,
          sourceId: primary.sourceId,
          source: nextSource ? nextSource.title : f.source,
          quote: primary.quote,
          start: primary.start,
          end: primary.end,
          evidence: remaining,
          version: (f.version || 1) + 1,
        }];
      }
      affected.add(f.id);
      const retained = !f.confirmed && retainedReadings.get(f.id);
      if ((f.confirmed && keep.has(f.id)) || retained) {
        return [{
          id: f.id,
          text: retained || f.text,
          source: retained ? '已断开的资料' : '本人确认',
          quote: '',
          category: f.category || inferCategory(f.text, 'self'),
          attribution: retained ? f.attribution : 'confirmed',
          confirmed: !!f.confirmed,
          ...(retained ? {retainedReading: true} : {}),
          version: (f.version || 1) + 1,
          alternatives: [],
          evidence: [],
          history: [],
          at: f.at,
        }];
      }
      removed.add(f.id);
      return [];
    });
    state.proposals = state.proposals.filter(p => !p.titleFromFact || !removed.has(p.basis));
    for (const p of state.proposals) {
      if (removed.has(p.basis)) p.basis = null;
      if (p.factIds) p.factIds = p.factIds.filter(id => !removed.has(id));
    }
    state.sources = state.sources.filter(s => s.id !== sourceId);
    state.conversation = state.conversation.filter(m=>m.kind!=='calendar-change' || m.sourceId!==sourceId);
    state.dismissed = state.dismissed.filter(item => item.sourceId !== sourceId);
    removeReplies(state, affected);
    state.profile = null;
  }

  function removeReplies(state, ids) {
    state.conversation = state.conversation.filter(message =>
      message.role !== 'assistant' || !message.factIds?.some(id => ids.has(id)));
  }

  function makeFact(text, source, quote, kind) {
    text = clean(text);
    if (!text) throw Error('请先写下一件事。');
    return {
      id: uid(),
      text,
      source: clean(source, 140),
      quote: clean(quote),
      category: inferCategory(text, kind),
      attribution: inferAttribution(kind, false),
      confirmed: false,
      version: 1,
      alternatives: [],
      evidence: [],
      history: [],
      at: stamp(),
    };
  }

  function fact(state, text, source, quote = text, kind = 'self') {
    const f = makeFact(text, source, quote, kind);
    const meta = metaJudgement(text);
    if (meta) f.meta = meta;
    state.facts.unshift(f);
    state.profile = null;
    return f;
  }

  function claimSpan(source, quote, position) {
    if (typeof quote !== 'string') throw Error('这条发现缺少引用的原句。');
    quote = quote.trim();
    const start = position ?? source.text.indexOf(quote);
    if (!quote || !Number.isInteger(start) || start < 0 || !source.text.startsWith(quote, start)) {
      throw Error('在这份资料里找不到引用的原句。');
    }
    return {sourceId: source.id, quote, start, end: start + quote.length};
  }

  function sourceFact(source, text, span) {
    const f = makeFact(text,source.title,span.quote,source.kind || 'self');
    return Object.assign(f,span,{evidence:[span]});
  }

  function addClaim(state, sourceId, text, quote, position) {
    const source = state.sources.find(s => s.id === sourceId);
    if (!source) throw Error('找不到这份资料。');
    if (typeof text !== 'string' || !text.trim()) throw Error('这条发现没有内容。');
    const span = claimSpan(source, quote, position);
    const {start,end} = span;
    quote = span.quote;
    text = clean(text);
    const overlaps = item => item.sourceId === sourceId && item.start < end && start < item.end;
    if (state.dismissed.some(overlaps)) return null;
    const matches = state.facts.filter(overlaps);
    // A model may later cite the entire sentence. Attaching that reading to an
    // arbitrary child would again make a change of plans overwrite the appointment.
    if (independentStatements(source.kind, quote) && matches.length > 1) {
      return matches.find(item => item.text === text) || null;
    }
    const existing = matches[0];
    if (existing) {
      if (!existing.confirmed && existing.text !== text) {
        existing.alternatives ??= [];
        if (!existing.alternatives.some(alt => alt.text === text && alt.quote === quote)) {
          existing.alternatives.push({text, quote});
          existing.start = Math.min(existing.start, start);
          existing.end = Math.max(existing.end, end);
          existing.version = (existing.version || 1) + 1;
        }
      }
      return existing;
    }
    const f = sourceFact(source,text,span);
    state.facts.unshift(f);
    state.profile = null;
    return f;
  }

  function addReadings(state, source, readings) {
    if (!readings.length) return [];
    if (readings.some(r => typeof r.text !== 'string' || !r.text.trim())) throw Error('这条发现没有内容。');
    const existing = state.facts.filter(f => f.sourceId === source.id);
    const dismissed = state.dismissed.some(f => f.sourceId === source.id);
    const spans = readings.map(r => claimSpan(source,r.quote,r.start));
    const ordered = spans.every((s,i) => i === 0 || s.start >= spans[i-1].end);
    if (!dismissed && ordered && existing.length === spans.length) {
      const byStart = new Map(existing.map(f => [f.start,f]));
      const matches = spans.map(s => byStart.get(s.start));
      if (matches.every((f,i) => f && f.end === spans[i].end && f.quote === spans[i].quote &&
          (f.confirmed || f.text === clean(readings[i].text)))) return matches;
    }
    if (existing.length || dismissed || !ordered) {
      return readings.map(r => addClaim(state,source.id,r.text,r.quote,r.start)).filter(Boolean);
    }
    // Fresh, non-overlapping readings can be inserted together in their original order.
    const findings = readings.map((r,i) => sourceFact(source,r.text,spans[i]));
    state.facts = findings.slice().reverse().concat(state.facts);
    state.profile = null;
    return findings;
  }

  function addCrossClaim(state, text, spans) {
    text = clean(text);
    if (!text || !Array.isArray(spans) || spans.length === 0) throw Error('请提供判断正文和至少一处原文依据。');
    const verified = spans.map(raw => {
      const source = state.sources.find(s => s.id === raw?.sourceId);
      if (!source) throw Error('找不到这份资料。');
      const quote = String(raw?.quote ?? '').trim();
      const start = source.text.indexOf(quote);
      if (!quote || start < 0) throw Error('在这份资料里找不到引用的原句。');
      const end = start + quote.length;
      if (state.dismissed.some(item => item.sourceId === source.id && item.start < end && start < item.end)) {
        throw Error('这处依据已被用户排除。');
      }
      return {sourceId: source.id, title: source.title, kind: source.kind || 'self', quote, start, end};
    });
    const primary = verified[0];
    const f = fact(state, text, primary.title, primary.quote, primary.kind);
    Object.assign(f, {
      sourceId: primary.sourceId,
      quote: primary.quote,
      start: primary.start,
      end: primary.end,
      evidence: verified.map(({sourceId, quote, start, end}) => ({sourceId, quote, start, end})),
    });
    return f;
  }

  function previewFactRange(state, id, edit) {
    const f = state.facts.find(item => item.id === id);
    if (!f) throw Error('这条记忆已经移除。');
    if (!edit || !Number.isInteger(edit.version) || edit.version !== (f.version || 1) || edit.text !== f.text) {
      throw Error('这条记忆已更新，请关闭后重新打开。');
    }
    const {start, end, original, replacement} = edit;
    const boundary = i => !(i > 0 && i < f.text.length && /[\uD800-\uDBFF]/.test(f.text[i-1]) && /[\uDC00-\uDFFF]/.test(f.text[i]));
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > f.text.length ||
        !boundary(start) || !boundary(end) || typeof original !== 'string' || f.text.slice(start, end) !== original ||
        typeof replacement !== 'string') throw Error('请重新选出要改的原话。');
    const next = f.text.slice(0, start) + replacement + f.text.slice(end);
    if (!next.trim()) throw Error('记忆不能为空。');
    if (next.length > 1000) throw Error('保存后的记忆太长，请把新说法写短一些。');
    return next;
  }

  function changeFactRange(state, id, edit) {
    return applyFactChange(state, id, previewFactRange(state, id, edit), edit.version, true);
  }

  function changeFact(state, id, next, expectedVersion) {
    return applyFactChange(state, id, next, expectedVersion, false);
  }

  function applyFactChange(state, id, next, expectedVersion, exact) {
    const f = state.facts.find(item => item.id === id);
    if (!f) throw Error('这条记忆已经移除。');
    if (expectedVersion !== undefined && (f.version || 1) !== expectedVersion) {
      throw Error('这条记忆已更新，请先刷新后再改。');
    }
    if (next !== null) {
      next = exact ? next : clean(next);
      if (!next) throw Error('记忆不能为空。');
      if (!exact && Array.isArray(f.alternatives)) {
        const picked = f.alternatives.find(alt => alt.text === next);
        if (picked) f.quote = picked.quote;
      }
      if (next !== f.text) {
        f.history.push({text: f.text, at: f.at});
        f.text = next;
        for (const message of state.conversation) {
          if (message.role === 'assistant' && message.factIds?.includes(id)) message.basisCorrected = true;
        }
      }
      f.category = inferCategory(next, 'self');
      const meta = metaJudgement(next);
      if (meta) f.meta = meta; else delete f.meta;
      f.attribution = 'confirmed';
      f.confirmed = true;
      f.alternatives = [];
      f.version = (f.version || 1) + 1;
      f.at = stamp();
    } else {
      const spans = Array.isArray(f.evidence) && f.evidence.length > 0
        ? f.evidence
        : (f.sourceId ? [{sourceId: f.sourceId, start: f.start, end: f.end}] : []);
      for (const sp of spans) {
        state.dismissed.push({sourceId: sp.sourceId, start: sp.start, end: sp.end});
      }
      state.facts = state.facts.filter(item => item.id !== id);
      removeReplies(state, new Set([id]));
      state.proposals = state.proposals.filter(p => !p.titleFromFact || p.basis !== id);
      for (const p of state.proposals) {
        if (p.basis === id) p.basis = null;
        if (p.factIds) p.factIds = p.factIds.filter(key => key !== id);
      }
    }
    state.profile = null;
    return f;
  }

  function propose(state, title, basis = null, options = {}) {
    const text = String(title ?? '').trim();
    if (!text) throw Error('请写下你想做成的事。');
    const requested = new Set((Array.isArray(basis) ? basis : [basis]).filter(item=>typeof item==='string'));
    const discoveryRefs=(Array.isArray(basis)?basis:[basis]).filter(item=>item?.kind==='discovery');
    const factIds = state.facts.filter(f => requested.has(f.id)).map(f => f.id);
    const p = {id:uid(), title:clean(text,160), basis:factIds[0] || null, factIds, at:stamp()};
    if(discoveryRefs.length) {
      const discoveries=typeof module!=='undefined' && module.exports?require('./discovery-basis.js'):window.AdvisorDiscoveries;
      p.basisRefs=discoveryRefs.map(ref=>{const current=discoveries.reference(state,ref.id);if(current.version!==ref.version)throw Error('目标依据已经变化，请重新查看。');return current;});
    }
    if (options.manual) p.manual = true;
    if (options.fromReply) {
      p.fromReply = true;
      if (text.length <= 300) p.replyStep = text;
    }
    if (options.titleFromFact && factIds.length === 1) {
      p.titleFromFact = true;
      p.title = '';
    }
    state.proposals.unshift(p);
    return p;
  }

  function accept(state, id, title, step, unit, selection, currentReview) {
    const p = state.proposals.find(item => item.id === id);
    if (!p) throw Error('这份提案已处理。');
    const approvedBasis = [], approvedMethods = [];
    if (selection) {
      const review = currentReview(state, p);
      if (p.titleFromFact && !review.facts.length) throw Error('这条依据已移除，请重新写下目标。');
      if (selection.offeredTitle !== undefined && selection.offeredTitle !== review.title && title === selection.offeredTitle) {
        throw Error('提议依据已更新，请看一下现在的目标。');
      }
      for (const token of new Set(selection.basis)) {
        const f = review.facts.find(option => option.token === token);
        if (!f) throw Error('选中的依据已变动，请按现在的内容重新选择。');
        approvedBasis.push({...(f.kind==='discovery'?{kind:'discovery'}:{}),id:f.id, version:f.version});
      }
      for (const key of new Set(selection.methods)) {
        const method = review.methods.find(option => option.key === key);
        if (!method) throw Error('选中的做法已变动，请再选一次。');
        approvedMethods.push(method.factId
          ? {origin:'fact', factId:method.factId, version:method.version, text:method.text}
          : {origin:'reply', text:method.text});
      }
      if (step?.trim()) approvedMethods.push({origin:'custom', text:clean(step,300)});
    }
    title = clean(title, 160);
    unit = clean(unit, 12);
    step = clean(step, 300) || approvedMethods[0]?.text;
    // 单位可空：里程碑型目标（如「搬去旧金山」）不计数，一切可塑。
    if (!title || !step) throw Error('请选一个做法，或写下你愿意走的第一步。');
    // 原版 quest 富字段（F-050）：截止日（冲刺型）、例行安排、参与度
    // （记录型/分析型）、主题（色系与美术的稳定来源）。
    const g = {id: uid(), title, step, unit, entries: [], at: stamp(),
      theme: ['forest','teal','grape','sky'][state.goals.length % 4]};
    const due = clean(arguments[7]?.dueDate || '', 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(due)) g.dueDate = due;
    g.routine = routineRows(arguments[7]?.routine);
    const inv = arguments[7]?.involvement;
    g.involvement = {tracking: inv ? inv.tracking !== false : true, analysis: !!inv?.analysis};
    if (selection) Object.assign(g, {proposalId:p.id, approvedBasis, approvedMethods});
    state.goals.unshift(g);
    state.proposals = state.proposals.filter(item => item.id !== id);
    return g;
  }

  function record(state, id, amount, note) {
    const g = state.goals.find(item => item.id === id);
    if (!g) throw Error('找不到这个目标。');
    const entry = {id: uid(), amount: validAmount(amount), note: clean(note, 280), at: stamp()};
    g.entries.unshift(entry);
    return entry;
  }

  // 人物记忆沿原版 PersonMemoryUpdate 的字段（F-066：name/description/
  // relationship/closeness/birthday/nickname/note），由本人录入或更正。
  function person(state, id) {
    return (state.people || []).find(item => item.id === id) || null;
  }
  function addPerson(state, fields) {
    const row = personFields(fields);
    row.id = uid();
    state.people ??= [];
    state.people.push(row);
    return row;
  }
  function updatePerson(state, id, fields) {
    const row = person(state, id);
    if (!row) throw Error('找不到这个人。');
    Object.assign(row, personFields({...row, ...fields}));
    return row;
  }
  // 删除面沿原版客户端能力（F-076 deleteQuest/deleteReport）：删除目标时
  // 一并移除它的当日卡片与练习入口，报告作为独立档案单独删除。
  function removeGoal(state, id) {
    const goal = state.goals.find(item => item.id === id);
    if (!goal) throw Error('找不到这个目标。');
    state.goals = state.goals.filter(item => item.id !== id);
    state.artifacts = (state.artifacts || []).filter(row => row.goalId !== id);
    // 关联小应用一并删除（发起人产品约定：目标的小应用属于目标）。
    state.miniApps = (state.miniApps || []).filter(app => app.goalId !== id);
    return goal;
  }
  function removeReport(state, id) {
    const before = state.reports.length;
    state.reports = state.reports.filter(item => item.id !== id);
    if (state.reports.length === before) throw Error('找不到这份回顾。');
  }

  function removePerson(state, id) {
    const before = (state.people || []).length;
    state.people = (state.people || []).filter(item => item.id !== id);
    if (state.people.length === before) throw Error('找不到这个人。');
  }
  // 原版隐私删除面（F-076）：地点/位置历史/公开画像/日程/上传件/语音备注
  // 都能从客户端删除，目标归档可导出。这里按同一动词族落地：日程对应已
  // 跟进的手机日历来源，上传件对应文件类资料，都删真实数据；地点沿人物
  // 记忆由本人录入；公开画像与语音备注先建模型，等连接器/语音落地即有数；
  // 位置历史本应用不收集，删除恒为 0 条并如实说明。
  // 照片记忆（原版 memories.photos 的本地对应，F-050）：照片作为记忆源
  // 导入，存储说明文字与导入时间；二进制不进 state（由文件系统管理）。
  function addPhoto(state, fields) {
    const note = clean(fields?.note, 280);
    if (!note) throw Error('请给这张照片写一句话说明。');
    const row = {id: uid(), note, at: stamp()};
    state.photos ??= [];
    state.photos.push(row);
    return row;
  }
  function removePhoto(state, id) {
    const before = (state.photos || []).length;
    state.photos = (state.photos || []).filter(item => item.id !== id);
    if (state.photos.length === before) throw Error('找不到这张照片。');
  }

  function placeFields(fields) {
    const name = clean(fields.name, 60);
    if (!name) throw Error('请写下这个地方的名字。');
    const row = {name};
    row.note = clean(fields.note, 200);
    return row;
  }
  function addKnownPlace(state, fields) {
    const row = placeFields(fields);
    row.id = uid();
    state.knownPlaces ??= [];
    state.knownPlaces.push(row);
    return row;
  }
  function removeKnownPlace(state, id) {
    const before = (state.knownPlaces || []).length;
    state.knownPlaces = (state.knownPlaces || []).filter(item => item.id !== id);
    if (state.knownPlaces.length === before) throw Error('找不到这个地方。');
  }
  function addPublicProfile(state, {url, label = ''}) {
    url = clean(url, 300);
    if (!/^https?:\/\/\S+$/.test(url)) throw Error('请填一个公开主页的完整网址。');
    state.publicProfiles ??= [];
    const existing = state.publicProfiles.find(item => item.url === url);
    if (existing) return existing;
    const row = {url, label: clean(label, 60), at: stamp()};
    state.publicProfiles.push(row);
    return row;
  }
  function removePublicProfile(state, url) {
    const before = (state.publicProfiles || []).length;
    state.publicProfiles = (state.publicProfiles || []).filter(item => item.url !== url);
    if (state.publicProfiles.length === before) throw Error('找不到这个公开主页。');
  }
  function removeSchedule(state, id) {
    const src = state.sources.find(item => item.id === id);
    if (!src || !src.calendar) throw Error('找不到这条日程跟进。');
    removeSource(state, id);
    return src;
  }
  function removeUploadedFile(state, id) {
    const src = state.sources.find(item => item.id === id);
    if (!src || src.kind !== 'file') throw Error('找不到这份上传的文件。');
    removeSource(state, id);
    return src;
  }
  function removeVoiceNote(state, id) {
    const before = (state.voiceNotes || []).length;
    state.voiceNotes = (state.voiceNotes || []).filter(item => item.id !== id);
    if (state.voiceNotes.length === before) throw Error('找不到这条语音备注。');
  }
  function deleteLocationHistory() {
    // 本应用不收集位置历史；返回删除条数 0，界面据此如实说明。
    return 0;
  }
  // 关系图（原版 Relationship Map，F-034）：人之间的边。
  // kind: family|work|friend|community|other

  // 了解度动态计算（原版 80% 解锁机制的本地等价）：
  // 五个维度各有上限，覆盖越多分越高。分数是真实数据的函数。
  function understandingScore(state) {
    const dims = {people: 0, facts: 0, goals: 0, sources: 0, activity: 0};
    const people = state.people || [];
    dims.people = Math.min(20, people.length * 4 + (state.relationships || []).length * 2);
    const facts = (state.facts || []).filter(f => f.confirmed);
    dims.facts = Math.min(25, facts.length * 2 + facts.filter(f => f.history?.length).length);
    const goals = (state.goals || []).filter(g => g.step !== '已达成收尾');
    dims.goals = Math.min(20, goals.length * 5 + goals.filter(g => g.entries?.length).length * 3);
    const sources = state.sources || [];
    const kinds = new Set(sources.map(s => s.kind));
    dims.sources = Math.min(20, sources.length * 3 + kinds.size * 4);
    const conv = (state.conversation || []).filter(m => m.role === 'user').length;
    const apps = (state.miniApps || []).filter(a => a.entries?.length).length;
    const photos = (state.photos || []).length;
    dims.activity = Math.min(15, Math.floor(conv / 3) + apps * 3 + photos * 2);
    const total = dims.people + dims.facts + dims.goals + dims.sources + dims.activity;
    return {total: Math.min(100, total), dims};
  }

  function addRelationship(state, fromId, toId, kind, note) {
    const from = state.people?.find(p => p.id === fromId);
    const to = state.people?.find(p => p.id === toId);
    if (!from || !to) throw Error('两个人都要先存在。');
    const valid = new Set(['family','work','friend','community','other']);
    const row = {id: uid(), fromId, toId, kind: valid.has(kind) ? kind : 'other', note: clean(note, 120)};
    state.relationships ??= [];
    state.relationships.push(row);
    return row;
  }
  function removeRelationship(state, id) {
    const before = (state.relationships || []).length;
    state.relationships = (state.relationships || []).filter(r => r.id !== id);
    if (state.relationships.length === before) throw Error('找不到这条关系。');
  }
  function relationshipsOf(state, personId) {
    return (state.relationships || []).filter(r => r.fromId === personId || r.toId === personId);
  }

  function removePersonAvatar() {
    // 人物还没有头像字段；等头像功能落地后这里删真实头像。
    throw Error('这个人还没有头像。');
  }
  // 通用小应用宿主（发起人纠偏令 2026-11-10）：mini app 由顾问在目标确立
  // 后按需生成（原版 F-050/F-054 提案→接受→quest+mini app），不是预置功能。
  // spec 是声明式定义（标题/栏位/动作/汇总），任何目标都能生成，宿主不认识
  // 任何具体应用；数据落 miniApp.entries 并镜像进目标进度。
  // 例行安排：[{weekdays:[3,5], note}]，输入为「周三,周五 晚饭后」式行的数组。
  function routineRows(lines) {
    if (!Array.isArray(lines)) return [];
    const dayWords={周一:1,周二:2,周三:3,周四:4,周五:5,周六:6,周日:0,周天:0};
    return lines.slice(0,7).map(line=>{
      const text=clean(line,80); if(!text)return null;
      const [daysPart, ...rest]=text.split(/\s+/);
      const weekdays=[...daysPart.matchAll(/周[一二三四五六日天]/g)].map(m=>dayWords[m[0]]).filter(n=>n!==undefined);
      if(!weekdays.length)return null;
      return {weekdays:[...new Set(weekdays)], note:clean(rest.join(' '),60)};
    }).filter(Boolean);
  }
  function updateGoalMeta(state, id, meta) {
    const goal = state.goals.find(g=>g.id===id);
    if (!goal) throw Error('找不到这个目标。');
    if (meta.dueDate !== undefined) {
      const due = clean(meta.dueDate, 10);
      if (due === '') delete goal.dueDate;
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw Error('截止日期要用 2026-12-31 这样的写法。');
      else goal.dueDate = due;
    }
    if (meta.routine !== undefined) goal.routine = routineRows(meta.routine);
    if (meta.involvement) goal.involvement = {tracking: meta.involvement.tracking !== false, analysis: !!meta.involvement.analysis};
    if (meta.theme && ['forest','teal','grape','sky'].includes(meta.theme)) goal.theme = meta.theme;
    return goal;
  }
  function miniAppFields(spec) {
    if (!spec || typeof spec.title !== 'string' || !spec.title.trim()) throw Error('小应用要有标题。');
    const title = clean(spec.title, 60);
    const brief = clean(spec.brief ?? '', 200);
    const fields = Array.isArray(spec.fields) ? spec.fields.slice(0, 6).map(f => ({
      key: clean(f?.key, 30).replace(/[^\w\u4e00-\u9fff-]/g, '') || 'f',
      label: clean(f?.label, 24) || '记录',
      kind: ['number','text','choice'].includes(f?.kind) ? f.kind : 'text',
      options: Array.isArray(f?.options) ? f.options.slice(0, 6).map(o => clean(o, 24)).filter(Boolean) : []
    })) : [];
    if (!fields.length || fields.some(f => f.kind === 'choice' && !f.options.length)) {
      throw Error('小应用的栏位不完整（选项栏要给出选项）。');
    }
    const seen = new Set();
    for (const f of fields) { if (seen.has(f.key)) throw Error('小应用的栏位名不能重复。'); seen.add(f.key); }
    const row = {title, brief, fields, unit: clean(spec.unit ?? '', 12)};
    row.actions = miniAppActions(spec); // 始终设置（含空数组），否则删最后一个动作后旧值不清
    const mirrorFrom = clean(spec.mirrorFrom ?? '', 30);
    const derivedTargets = new Set(row.actions.map(a => a.target).filter(Boolean));
    if (!mirrorFrom || fields.some(f => f.key === mirrorFrom) || derivedTargets.has(mirrorFrom)) row.mirrorFrom = mirrorFrom;
    return row;
  }
  // 通用模板生成器：从目标本身推导（计数/时长/页数/金额各得其所），
  // 不含任何具体应用的预设。目标带 target 时给进度条。
  function suggestMiniApp(goal) {
    const unit = goal.unit || '次';
    return {
      title: goal.title,
      brief: '记「' + goal.title + '」的每一步。',
      unit,
      fields: [
        {key:'amount', label:'本次'+unit, kind:'number'},
        {key:'note', label:'一句话记录', kind:'text'}
      ]
    };
  }
  function createMiniApp(state, goalId, spec) {
    const goal = state.goals.find(g => g.id === goalId);
    if (!goal) throw Error('先确立一个目标。');
    const app = {id: uid(), goalId, ...miniAppFields(spec), entries: [], createdAt: stamp(), updatedAt: stamp()};
    state.miniApps ??= [];
    state.miniApps.push(app);
    return app;
  }
  function updateMiniApp(state, id, spec) {
    const app = (state.miniApps || []).find(a => a.id === id);
    if (!app) throw Error('找不到这个小应用。');
    Object.assign(app, miniAppFields({...app, ...spec}), {updatedAt: stamp()});
    return app;
  }
  function removeMiniApp(state, id) {
    const before = (state.miniApps || []).length;
    state.miniApps = (state.miniApps || []).filter(a => a.id !== id);
    if (state.miniApps.length === before) throw Error('找不到这个小应用。');
  }
  function logMiniAppEntry(state, id, values) {
    const app = (state.miniApps || []).find(a => a.id === id);
    if (!app) throw Error('找不到这个小应用。');
    const row = {id: uid(), at: stamp(), values: {}};
    for (const f of app.fields) {
      const raw = values?.[f.key];
      if (f.kind === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 1e6) throw Error('「'+f.label+'」要填 0 到一百万之间的数。');
        row.values[f.key] = n;
      } else {
        const text = clean(raw ?? '', 280);
        if (f.kind !== 'text' || text) row.values[f.key] = text;
        if (f.kind !== 'number' && !row.values[f.key]) throw Error('「'+f.label+'」还没填。');
      }
    }
    runMiniAppActions(app.actions || [], row.values, app.fields);
    // 镜像进目标进度（先算好，record 抛错时整条不入档，不留半条数据）。
    const goal = state.goals.find(g => g.id === app.goalId);
    let mirrorAmount = 1, mirrorNote = '';
    if (goal) {
      const derived = new Set((app.actions || []).map(a => a.target).filter(Boolean));
      // mirrorFrom 优先；否则 multiply 派生值优先；再否则第一个数字栏；再否则记一次。
      const multiplyTarget = (app.actions || []).find(a => a.kind === 'multiply')?.target;
      const amountField = (app.mirrorFrom && (app.fields.some(f => f.key === app.mirrorFrom) || derived.has(app.mirrorFrom)))
        ? {key: app.mirrorFrom}
        : (multiplyTarget && row.values[multiplyTarget] !== undefined)
        ? {key: multiplyTarget}
        : app.fields.find(f => f.kind === 'number');
      mirrorAmount = amountField ? row.values[amountField.key] : 1;
      mirrorNote = String(row.values.note ?? row.values[app.fields.find(f=>f.kind!=='number')?.key] ?? '');
      record(state, goal.id, mirrorAmount, mirrorNote); // 可能抛错（如数量为 0），此时 entry 不落
    }
    app.entries.unshift(row);
    app.updatedAt = row.at;
    return row;
  }
  // 补丁式修改（写一次、反复执行）：模型只出变化的部分（重命名/改说明/
  // 换单位/改栏位名/加栏/删栏），未提到的部分原样保留，token 最省、零漂移。
  function applyMiniAppPatch(state, id, patch) {
    const app = (state.miniApps || []).find(a => a.id === id);
    if (!app) throw Error('找不到这个小应用。');
    if (!patch || typeof patch !== 'object') throw Error('补丁不是可用对象。');
    const next = JSON.parse(JSON.stringify({title:app.title, brief:app.brief, unit:app.unit, fields:app.fields, actions:app.actions, mirrorFrom:app.mirrorFrom}));
    const ops = ['title','brief','unit','relabel','addField','removeField','addAction','removeAction','mirrorFrom'];
    if (!ops.some(k => patch[k] !== undefined)) throw Error('补丁里没有可认的修改。');
    if (patch.title !== undefined) next.title = clean(patch.title, 60);
    if (patch.brief !== undefined) next.brief = clean(patch.brief, 200);
    if (patch.unit !== undefined) next.unit = clean(patch.unit, 12);
    if (patch.relabel && typeof patch.relabel === 'object') {
      for (const [key, label] of Object.entries(patch.relabel)) {
        // 模型可能用栏位 key 或栏位名，两个都试。
        const f = next.fields.find(x => x.key === key || x.label === key);
        if (f) f.label = clean(label, 24);
      }
    }
    if (Array.isArray(patch.addField)) {
      for (const raw of patch.addField.slice(0, 6)) {
        const fixed = normalizeMiniAppSpec({title:'x', fields:[raw]});
        if (fixed) next.fields.push({...fixed.fields[0]});
      }
    } else if (patch.addField && typeof patch.addField === 'object') {
      const fixed = normalizeMiniAppSpec({title:'x', fields:[patch.addField]});
      if (fixed) next.fields.push({...fixed.fields[0]});
    }
    if (patch.addAction !== undefined) {
      const extra = miniAppActions({actions: Array.isArray(patch.addAction) ? patch.addAction : [patch.addAction]});
      next.actions = [...(next.actions || []), ...extra].slice(0, 4);
    }
    if (patch.removeAction !== undefined) {
      const keys = Array.isArray(patch.removeAction) ? patch.removeAction : [patch.removeAction];
      next.actions = (next.actions || []).filter(a => !keys.includes(a.target) && !keys.includes(a.label) && !keys.includes(a.kind));
    }
    if (patch.removeField !== undefined) {
      const keys = Array.isArray(patch.removeField) ? patch.removeField : [patch.removeField];
      next.fields = next.fields.filter(f => !keys.includes(f.key));
    }
    if (next.fields.length > 6) next.fields.length = 6;
    Object.assign(app, miniAppFields(next), {updatedAt: stamp()});
    return app;
  }

  // 动作原语（发起人「像微信小程序」+研究结论定调）：模型可给应用声明
  // 安全的派生动作，宿主照定义执行——无任意 JS。词汇三枚：points（选项
  // 记分）、multiply（两栏相乘）、streak（连续天数）。mirrorFrom 指定镜像
  // 进目标进度的栏位。
  const actionKinds = new Set(['points', 'multiply', 'streak']);
  function miniAppActions(spec) {
    const list = Array.isArray(spec?.actions) ? spec.actions : [];
    const out = [];
    for (const a of list.slice(0, 4)) {
      if (!a || typeof a !== 'object') continue;
      if (a.kind === 'points') {
        const target = clean(a.target ?? a.field ?? 'score', 30).replace(/[^\w\u4e00-\u9fff-]/g, '');
        // 兼容两种格式：map 对象（我们的契约）和 rules 数组（模型自然输出）
        let map = null;
        if (a.map && typeof a.map === 'object') {
          map = Object.fromEntries(Object.entries(a.map).slice(0, 8).map(([k, v]) => [clean(k, 24), Number(v) || 0]));
        } else if (Array.isArray(a.rules)) {
          map = Object.fromEntries(a.rules.slice(0, 8).map(r => [clean(r.value ?? r.option ?? '', 24), Number(r.points ?? r.score) || 0]));
        }
        if (target && map && Object.keys(map).length) out.push({kind: 'points', target, from: clean(a.from ?? a.field ?? '', 30), map, label: clean(a.label ?? '得分', 12)});
      } else if (a.kind === 'multiply') {
        const target = clean(a.target, 30).replace(/[^\w\u4e00-\u9fff-]/g, '');
        if (target && a.a && a.b) out.push({kind: 'multiply', target, a: String(a.a), b: String(a.b), label: clean(a.label ?? '合计', 12)});
      } else if (a.kind === 'streak') {
        out.push({kind: 'streak', label: clean(a.label ?? '连续', 12)});
      }
    }
    return out;
  }
  function runMiniAppActions(actions, values, fields) {
    for (const a of actions) {
      if (a.kind === 'points') {
        const source = values[a.from ?? fields.find(f => f.kind === 'choice')?.key];
        values[a.target] = a.map[String(source)] ?? 0;
      } else if (a.kind === 'multiply') {
        values[a.target] = (Number(values[a.a]) || 0) * (Number(values[a.b]) || 0);
      }
    }
  }
  function miniAppStreak(app, now = new Date()) {
    const days = new Set((app.entries || []).map(e => e.at.slice(0, 10)));
    let streak = 0;
    const d = new Date(now);
    if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1); // 今天没记不算断
    while (days.has(d.toISOString().slice(0, 10))) { streak++; d.setDate(d.getDate() - 1); }
    return streak;
  }

  // 模型回包的确定性修剪（发起人 2026-11-10：智能、省 token、不出 slop）：
  // 常见毛病（控件名同义、标签超长、栏位/选项过多、choice 没给选项）在
  // 代码里修掉而不是让模型重答——一次生成，修剪即用。
  function normalizeMiniAppSpec(spec) {
    if (!spec || typeof spec.title !== 'string' || !spec.title.trim()) return null;
    const kindMap = {number:'number', 'int':'number', 'float':'number', amount:'number',
      text:'text', textarea:'text', string:'text', note:'text',
      choice:'choice', select:'choice', options:'choice', radio:'choice'};
    let fields = Array.isArray(spec.fields) ? spec.fields : [];
    fields = fields.map(f => {
      if (!f || typeof f !== 'object') return null;
      const kind = kindMap[String(f.kind||'').toLowerCase()];
      if (!kind) return null; // 宿主不认识的控件直接剪掉，不留残骸
      const label = clean(f.label ?? f.name ?? f.title, 24);
      if (!label) return null;
      const key = clean(f.key ?? f.id ?? label, 30).replace(/[^\w\u4e00-\u9fff-]/g, '') || 'f';
      const options = Array.isArray(f.options)
        ? f.options.map(o => clean(o ?? '', 24)).filter(Boolean).slice(0, 6) : [];
      return {key, label, kind: kind === 'choice' && !options.length ? 'text' : kind, options};
    }).filter(Boolean).slice(0, 6);
    // key 去重：后到者加序号
    const seen = new Set();
    for (const f of fields) { let k = f.key, i = 2; while (seen.has(k)) k = f.key + (i++); f.key = k; seen.add(k); }
    if (!fields.length) return null;
    const normalized = {title: clean(spec.title, 60), brief: clean(spec.brief ?? '', 200), unit: clean(spec.unit ?? '', 12), fields};
    const actions = miniAppActions(spec);
    if (actions.length) normalized.actions = actions;
    if (spec.mirrorFrom && fields.some(f => f.key === clean(spec.mirrorFrom, 30))) normalized.mirrorFrom = clean(spec.mirrorFrom, 30);
    return normalized;
  }

  // 顾问回包 → spec：取第一段平衡大括号里的 JSON；解析失败返回 null，
  // 由调用方如实提示（不猜）。
  function miniAppFromModelText(text) {
    const raw = String(text ?? '');
    const start = raw.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < raw.length && i - start < 20000; i++) {
      if (raw[i] === '{') depth++;
      else if (raw[i] === '}') {
        depth--;
        if (depth === 0) {
          try { const spec = JSON.parse(raw.slice(start, i + 1)); return typeof spec?.title === 'string' ? spec : null; }
          catch { return null; }
        }
      }
    }
    return null;
  }
  function questArchive(state, id) {
    const goal = state.goals.find(item => item.id === id);
    if (!goal) throw Error('找不到这个目标。');
    return {
      slug: goal.id,
      title: goal.title,
      step: goal.step,
      unit: goal.unit,
      createdAt: goal.at,
      exportedAt: stamp(),
      entries: (goal.entries || []).map(entry => ({amount: entry.amount, note: entry.note, at: entry.at})),
      reports: state.reports
        .filter(report => report.rows.some(row => row.goalId === goal.id))
        .map(report => ({at: report.at, from: report.from, rows: report.rows.filter(row => row.goalId === goal.id)}))
    };
  }
  function personFields(fields) {
    const name = clean(fields.name, 40);
    if (!name) throw Error('请写下这个人怎么称呼。');
    const row = {name};
    row.description = clean(fields.description, 200);
    row.relationship = clean(fields.relationship, 40);
    row.closeness = clean(fields.closeness, 20);
    row.birthday = clean(fields.birthday, 20);
    row.nickname = clean(fields.nickname, 40);
    row.note = clean(fields.note, 400);
    for (const key of Object.keys(row)) if (key !== 'name' && !row[key]) delete row[key];
    return row;
  }

  function validAmount(amount) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > 100000) throw Error('请填写大于 0 且不超过 100000 的进度。');
    return value;
  }

  function changeEntry(state, goalId, entryId, amount, note) {
    const goal = state.goals.find(g => g.id === goalId);
    const index = goal?.entries.findIndex(e => e.id === entryId);
    if (!goal || index < 0) throw Error('找不到这条进度记录。');
    const entry = goal.entries[index];
    if (amount === null) goal.entries.splice(index, 1);
    else {
      entry.amount = validAmount(amount);
      if (note !== undefined) entry.note = clean(note, 280);
    }
    for (const report of state.reports) {
      if (entry.at < report.from || entry.at > report.at) continue;
      for (const row of report.rows) {
        if (row.goalId === goalId) Object.assign(row, progress(goal, report.from, report.at));
      }
    }
  }

  function progress(goal, from, until) {
    const entries = goal.entries.filter(e => e.at >= from && e.at <= until);
    return {count: entries.length, amount: total(entries), notes: entries.map(e => e.note).filter(Boolean)};
  }

  function week(state, now = new Date()) {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).toISOString();
    const at = now.toISOString();
    const rows = state.goals.map(g => ({goalId: g.id, title: g.title, step: g.step, unit: g.unit, ...progress(g, from, at)}));
    if (!rows.some(row => row.count)) throw Error('先在目标里记一次进展，就能回顾这一周。');
    return {id: uid(), at, from, rows};
  }

  function total(entries) {
    const list = Array.isArray(entries) ? entries : (entries && Array.isArray(entries.entries) ? entries.entries : []);
    return Math.round(list.reduce((sum, e) => sum + e.amount, 0) * 1000) / 1000;
  }

  const generalRecall=/^(?:我的画像|关于我|你对我了解多少|(?:你|顾问)?(?:还)?(?:记得|记住了|知道|了解)(?:关于我|我)?(?:说过|的)?(?:些|了)?(?:什么|哪些事|多少)|what (?:do you (?:remember|know)|can you (?:recall|tell me)) about me|my portrait|show (?:me )?my (?:portrait|memories))$/i;
  const fillers=/你还记得|你记得|还记得|说过|你知不知道|你知道|请告诉我|请问|我之前|之前|现在|我的|我在|我是|我会|自己|关于|这件事|的时候|什么时候|在哪里|为什么|什么|哪些|多少|怎样|如何|怎么|[你我吗呢么啊呀了的]/g;
  const stopWords=new Set('a an about am are as at be can did do does for from have how i in is it know me my now of on recall remember tell that the to was what when where which who why with would you your'.split(' '));
  function generalQuestion(q) {return generalRecall.test(q.trim().replace(/[ ？?。！!.]+$/g,''));}
  function questionTerms(question) {
    const terms=new Set();
    const words=String(question).toLowerCase().replace(fillers,' ').match(/[\p{Script=Han}]+|[\p{L}\p{N}]+/gu) || [];
    for (const word of words) {
      if (!/\p{Script=Han}/u.test(word) || word.length===1) {
        if (!stopWords.has(word)) terms.add(word);
      } else for(let i=1;i<word.length;i++) terms.add(word.slice(i-1,i+1));
    }
    for(const generic of ['喜欢','想要','打算','like','prefer']) if(terms.size>1) terms.delete(generic);
    return [...terms];
  }
  function subjectTerms(question) {
    const q=question.trim().replace(/[？?。.！!]+$/,'').trim();
    const inquiry=/\b(?:where|when|which|what|who|how|why|remember|remind)\b|^(?:do|did|is|are|can|could)\b/i.test(q);
    const english=inquiry && (q.match(/\bmy\s+([\p{L}\p{N}][^?!.]*)/iu) ||
      q.match(/\b(?:the|an?)\s+([\p{L}\p{N}][^?!.]*)/iu) ||
      q.match(/\bwhere\s+(?:(?:do|did|should|can)\s+I\s+(?:usually\s+)?\w+|is|are|was|were)\s+(.+)$/i));
    if (english) {
      const noun=english[1].split(/\s+(?:I|is|are|was|were|do|does|did|can|should|will|for|at|in|on|from|again|now|usually|located|stored|kept)\b/i)[0];
      return questionTerms(noun);
    }
    const topic=q.replace(/^(?:(?:你还记得|你记得|你知道|请告诉我|请问)[，, ]*)+/,'')
      .replace(/^(?:我(?:平时|通常|上次|一般|之前|会)?把(?:我的)?|我的)/,'');
    const named=topic.match(/^([^，,。？！?]+?)(?:通常|平时|一般|上次|现在)?(?:(?:放|搁|收|摆|藏|存|挂|锁|放置|收到|保存)?(?:在|到|着|了|进|去)*(?:哪[里儿个]|哪$|什么地方|什么位置)|是(?:什么|哪|谁)|怎么|用来|呢$)/);
    if (named) return questionTerms(named[1]);
    const action=topic.match(/^(?:我)?(?:周[一二三四五六日天]|星期[一二三四五六日天]|今天|明天|昨天|上午|下午|晚上)(?:还|需要|会|要|应该|得|在)*([^，,。？！?]+?)吗$/);
    return action?questionTerms(action[1]):[];
  }
  function textScore(text,terms,required=[]) {
    const value=String(text ?? '').toLowerCase();
    const words=new Set(value.match(/[\p{L}\p{N}]+/gu) || []);
    const matches=term=>/\p{Script=Han}/u.test(term)?value.includes(term):words.has(term);
    if (!required.every(matches)) return 0;
    return terms.reduce((score,term)=>score+Number(matches(term)),0);
  }

  function context(state, question = '') {
    const superseded = new Set();
    for (const f of state.facts) {
      if (f.confirmed && Array.isArray(f.history)) {
        for (const h of f.history) {
          if (h?.text) superseded.add(String(h.text).toLowerCase());
        }
      }
    }
    let facts = state.facts.filter(f => f.confirmed || !superseded.has(String(f.text ?? '').toLowerCase()));
    const broad=!question || generalQuestion(question);
    const terms=questionTerms(question);
    const subject=subjectTerms(question);
    facts=facts.map(f=>{
      const current=textScore(f.text,terms,subject);
      const past=(f.history || []).reduce((best,h)=>Math.max(best,textScore(h.text,terms,subject)),textScore(f.quote,terms,subject));
      return {f,score:current*3+past};
    }).filter(row=>broad || row.score>0)
      .sort((a,b)=>b.score-a.score || Number(b.f.confirmed)-Number(a.f.confirmed) || String(b.f.at).localeCompare(String(a.f.at)))
      .slice(0,24).map(row=>row.f);
    const asksGoals=/我的目标|长期目标|正在跟进|my (?:current )?goals/i.test(question) &&
      subject.every(term=>['目标','长期','期目','正在','在跟','跟进','current','goals'].includes(term));
    const goals=state.goals.map(g=>({g,score:textScore(g.title+' '+g.step,terms,subject)}))
      .filter(row=>broad || asksGoals || row.score>0).sort((a,b)=>b.score-a.score).slice(0,12).map(row=>row.g);
    return {
      name: state.name,
      facts: facts.map(f => ({
        id: f.id,
        text: f.text,
        source: f.source,
        category: f.category || inferCategory(f.text, 'self'),
        attribution: f.attribution || inferAttribution('self', Boolean(f.confirmed)),
        confirmed: Boolean(f.confirmed),
      })),
      goals: goals.map(g => ({id: g.id, title: g.title, next: g.step, amount: total(g.entries), unit: g.unit})),
    };
  }

  return {
    generalQuestion, questionTerms, subjectTerms, textScore, empty, restore, importSource, removeSource, readMaterial, independentStatements, inferCategory, inferAttribution,
    addClaim, addReadings, addCrossClaim, fact, changeFact, previewFactRange, changeFactRange, propose, accept, record, changeEntry, week, person, addPerson, updatePerson, removePerson, removeGoal, removeReport,
    updateGoalMeta,
    addKnownPlace, removeKnownPlace, addRelationship, removeRelationship, relationshipsOf, addPhoto, understandingScore, removePhoto, addPublicProfile, removePublicProfile, removeSchedule, removeUploadedFile, removeVoiceNote, deleteLocationHistory, removePersonAvatar, questArchive,
    suggestMiniApp, createMiniApp, updateMiniApp, removeMiniApp, logMiniAppEntry, miniAppFromModelText, normalizeMiniAppSpec, applyMiniAppPatch, miniAppStreak, applyMiniAppPatch,
    total, context, units, inferUnit, clean, uid,
  };
})();
if (typeof window !== 'undefined') window.AdvisorStore = AdvisorStore;
if (typeof module !== 'undefined') module.exports = AdvisorStore;
