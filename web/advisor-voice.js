/* Onit · 手机私人顾问（2026-11-14 全新界面）
   Chrome 74 安全写法：不使用 ??、?.、replaceAll、Object.hasOwn 或 .at()。 */

(function () {
  "use strict";

  var THEME_KEY = "advisor_voice_theme_v2";
  var SOURCES_KEY = "advisor_voice_sources_v2";

  function makeDefaultArtifacts() {
    return {
      isDemo: true,
      dateText: "11月13日 周五",
      today: {
        id: "today-2026-11-13",
        date: "11月13日",
        money: "¥1,840",
        moneyDue: "明日扣款 · 11月14日",
        sentence: "明天还这张招行卡，别让它从活期里硬扣。",
        originalSentence: "明天还这张招行卡，别让它从活期里硬扣。",
        fate: "pending",
        sourceName: "短信",
        evidence: {
          title: "招商银行信用卡账单短信",
          origin: "短信 · 11月11日 09:14",
          before: "【招商银行】您个人信用卡本月人民币应还金额 ",
          highlight: "1,840.00元，最后还款日11月14日",
          after: "。当前已开通关联储蓄卡自动全额还款，如活期余额不足将产生滞纳金。"
        }
      },
      secondary: {
        id: "sec-2026-11-13",
        date: "11月13日",
        acknowledged: false,
        sentence: "家里百兆宽带后天到期，按原价续要贵出四十。",
        sourceName: "短信",
        evidence: {
          title: "宽带续约到期提醒",
          origin: "短信 · 11月12日 14:20",
          before: "尊敬的客户，您尾号9916的宽带包年套餐将于11月15日到期，",
          highlight: "到期后将按标准月资费108元/月自动续延（原优惠月均68元）",
          after: "。如需继续享受老用户续费优惠，请在到期前确认。"
        }
      },
      history: [
        {
          id: "hist-1",
          date: "11月12日",
          fate: "confirmed",
          sentence: "十月电费比九月多出八十六块，多半是书房暖风机忘关。",
          sourceName: "短信",
          evidence: {
            title: "国网电费出账通知",
            origin: "短信 · 11月12日 08:05",
            before: "您户号3301**48十月用电量312度，应缴 ",
            highlight: "214.60元（较上月128.40元增加86.20元）",
            after: "。峰段用电占比上升明显。"
          }
        },
        {
          id: "hist-2",
          date: "11月10日",
          fate: "rewritten",
          oldSentence: "周六去把季度体检预约掉，早上要空腹。",
          sentence: "下周二早上去做常规体检，前一天晚上十点后不喝水。",
          sourceName: "日历",
          evidence: {
            title: "日历待办备注",
            origin: "日历 · 11月09日 20:40",
            before: "日程标题：年度体检窗口期。备注：",
            highlight: "需提前三天选定空腹抽血时段，避开周末排队",
            after: "。"
          }
        },
        {
          id: "hist-3",
          date: "11月08日",
          fate: "dropped",
          sentence: "楼下健身房季卡月底到期，先停一停别自动续。",
          sourceName: "通知",
          evidence: {
            title: "健身卡到期通知",
            origin: "通知 · 11月08日 18:12",
            before: "你的90天次卡还有22天到期，",
            highlight: "开启自动续费可立减30元",
            after: "。"
          }
        },
        {
          id: "hist-4",
          date: "11月05日",
          fate: "confirmed",
          sentence: "车险下周进入续保窗口，旧保单里的玻璃险今年没必要留。",
          sourceName: "相册",
          evidence: {
            title: "去年车险电子保单截图",
            origin: "相册 · 11月05日 11:02",
            before: "商业险明细：车损险、三者险300万、",
            highlight: "附加单独玻璃破碎险 340元",
            after: "。保期至本月中旬。"
          }
        },
        {
          id: "hist-5",
          date: "11月03日",
          fate: "confirmed",
          sentence: "燃气表余量跌破十五方了，趁周末去物业圈存两百。",
          sourceName: "短信",
          evidence: {
            title: "燃气余量低额提醒",
            origin: "短信 · 11月03日 10:18",
            before: "尊敬的燃气用户，您当前表内剩余气量 ",
            highlight: "13.4立方米，已低于常规半月用量",
            after: "，请及时购气并插卡圈存。"
          }
        },
        {
          id: "hist-6",
          date: "10月29日",
          fate: "rewritten",
          oldSentence: "下月小区地面停车月卡按单月续。",
          sentence: "车位月卡直接续到年底两个月，能少跑一趟物业前台。",
          sourceName: "通知",
          evidence: {
            title: "车场月卡续费提示",
            origin: "通知 · 10月29日 19:05",
            before: "您的地上临停包月有效期至10月31日，",
            highlight: "连续续费两月免收工本手续费",
            after: "。"
          }
        }
      ]
    };
  }

  var DEFAULT_SOURCES = [
    { id: "sms", name: "短信" },
    { id: "photos", name: "相册" },
    { id: "notifs", name: "通知" },
    { id: "calendar", name: "日历" }
  ];

  var state = {
    data: makeDefaultArtifacts(),
    sources: loadSources(),
    theme: loadTheme(),
    showForgotten: false,
    previewSilence: false,
    rewriting: false,
    rewriteError: "",
    rewriteDraft: "",
    lastDropped: null,
    undoTimer: null,
    liveApps: [],
    redo: null,
    make: null,
    modelCfg: null,
    activeView: "today",
    booted: false,
    acting: false
  };

  var live = { mode: "", token: "", voice: null, model: null, pollTimer: null, pollFails: 0, failed: null, redoBase: {},
    worldSources: null, notifyStatus: null, photoOpen: false, photoData: "", photoNote: "", photoError: "" };

  /* ---- 数据与持久化 ---- */
  function detectLiveMode() {
    if (window.AndroidStorage && typeof window.AndroidStorage.proactiveTick === "function") return "bridge";
    if (String(window.location.search || "").indexOf("live=1") !== -1) return "http";
    return "";
  }

  function todaySlug() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }

  function todayTextCN() {
    var d = new Date();
    var weeks = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + weeks[d.getDay()];
  }

  function loadTheme() {
    try {
      var v = window.localStorage.getItem(THEME_KEY);
      if (v === "light" || v === "dark" || v === "auto") return v;
    } catch (e) {}
    return "auto";
  }

  function saveTheme(val) {
    state.theme = val;
    try { window.localStorage.setItem(THEME_KEY, val); } catch (e) {}
    applyTheme();
  }

  function applyTheme() {
    var root = document.documentElement;
    if (state.theme === "light" || state.theme === "dark") {
      root.setAttribute("data-theme", state.theme);
    } else {
      root.removeAttribute("data-theme");
    }
  }

  function loadSources() {
    var copy = [];
    for (var i = 0; i < DEFAULT_SOURCES.length; i++) {
      copy.push({ id: DEFAULT_SOURCES[i].id, name: DEFAULT_SOURCES[i].name, enabled: false });
    }
    try {
      var raw = window.localStorage.getItem(SOURCES_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        for (var j = 0; j < copy.length; j++) {
          if (parsed && typeof parsed[copy[j].id] === "boolean") copy[j].enabled = parsed[copy[j].id];
        }
      }
    } catch (e) {}
    return copy;
  }

  function saveSources() {
    var map = {};
    for (var i = 0; i < state.sources.length; i++) map[state.sources[i].id] = !!state.sources[i].enabled;
    try { window.localStorage.setItem(SOURCES_KEY, JSON.stringify(map)); } catch (e) {}
  }

  function countEnabledSources() {
    var n = 0;
    for (var i = 0; i < state.sources.length; i++) if (state.sources[i].enabled) n++;
    return n;
  }

  function isReducedMotion() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /* ---- DOM 构造 ---- */
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === "string") node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  var ICON_STROKES = {
    check: ["M5 12.5l4.5 4.5L19 7.5"],
    pencil: ["M15.2 4.8l4 4L8 20H4v-4L15.2 4.8z", "M13.4 6.6l4 4"],
    x: ["M6.5 6.5l11 11M17.5 6.5l-11 11"],
    undo: ["M5 9h9a5.5 5.5 0 0 1 0 11H9", "M9 5L5 9l4 4"],
    chevron: ["M8 10l4 4 4-4"],
    moon: ["M20 14.2A8.6 8.6 0 0 1 9.8 4 8.6 8.6 0 1 0 20 14.2z"],
    plus: ["M12 5v14M5 12h14"],
    quote: ["M5 5.5h5v5.4c0 2.6-1.4 4.5-4 5.4l-1-1.8c1.4-.5 2-1.4 2.1-2.7H5V5.5z",
      "M13.5 5.5h5v5.4c0 2.6-1.4 4.5-4 5.4l-1-1.8c1.4-.5 2-1.4 2.1-2.7h-2.1V5.5z"]
  };

  function svgIcon(name) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "ic");
    svg.setAttribute("aria-hidden", "true");
    var fill = name === "quote";
    var paths = ICON_STROKES[name] || [];
    for (var i = 0; i < paths.length; i++) {
      var p = document.createElementNS(ns, "path");
      p.setAttribute("d", paths[i]);
      if (fill) {
        p.setAttribute("fill", "currentColor");
      } else {
        p.setAttribute("fill", "none");
        p.setAttribute("stroke", "currentColor");
        p.setAttribute("stroke-width", "2");
        p.setAttribute("stroke-linecap", "round");
        p.setAttribute("stroke-linejoin", "round");
      }
      svg.appendChild(p);
    }
    return svg;
  }

  function button(className, text, label) {
    var b = el("button", className, text);
    b.type = "button";
    if (label) b.setAttribute("aria-label", label);
    return b;
  }

  function proofButton(handler) {
    var b = button("proof-trigger", "", "看原文");
    var g = el("span", "proof-glyph");
    g.appendChild(svgIcon("quote"));
    b.appendChild(g);
    b.addEventListener("click", handler);
    return b;
  }

  /* ---- DOM 引用 ---- */
  var dateLineEl = document.getElementById("dateLine");
  var demoMarkEl = document.getElementById("demoMark");
  var silencePreviewBtn = document.getElementById("silencePreviewBtn");
  var liveBannerEl = document.getElementById("liveBanner");
  var liveBannerTextEl = document.getElementById("liveBannerText");
  var liveRetryBtn = document.getElementById("liveRetryBtn");
  var liveGenRetryBtn = document.getElementById("liveGenRetryBtn");
  var todayMount = document.getElementById("todayMount");
  var historyMount = document.getElementById("historyMount");
  var sourcesMount = document.getElementById("sourcesMount");
  var settingsMount = document.getElementById("settingsMount");
  var appMain = document.getElementById("appMain");
  var viewTrack = document.getElementById("viewTrack");
  var viewToday = document.getElementById("viewToday");
  var viewHistory = document.getElementById("viewHistory");
  var viewSources = document.getElementById("viewSources");
  var todayScroll = document.getElementById("todayScroll");
  var historyScroll = document.getElementById("historyScroll");
  var sourcesScroll = document.getElementById("sourcesScroll");
  var tabbar = document.querySelector(".tabbar");
  var tabIndicator = document.getElementById("tabIndicator");
  var tabToday = document.getElementById("tabToday");
  var tabHistory = document.getElementById("tabHistory");
  var tabSources = document.getElementById("tabSources");
  var evidenceBackdrop = document.getElementById("evidenceBackdrop");
  var evidenceSheet = document.getElementById("evidenceSheet");
  var sheetGrabArea = document.getElementById("sheetGrabArea");
  var sheetTitleEl = document.getElementById("sheetTitle");
  var sheetOriginEl = document.getElementById("sheetOrigin");
  var sheetBodyEl = document.getElementById("sheetBody");
  var sheetCloseBtn = document.getElementById("sheetCloseBtn");
  var undoBarEl = document.getElementById("undoBar");
  var undoTextEl = document.getElementById("undoText");
  var undoActionBtn = document.getElementById("undoActionBtn");

  function scrollPositions() {
    return { today: todayScroll.scrollTop, history: historyScroll.scrollTop, sources: sourcesScroll.scrollTop };
  }

  function restoreScroll(pos) {
    todayScroll.scrollTop = pos.today;
    historyScroll.scrollTop = pos.history;
    sourcesScroll.scrollTop = pos.sources;
  }

  function renderAll() {
    var pos = scrollPositions();
    renderChrome();
    renderToday();
    renderHistory();
    renderSources();
    restoreScroll(pos);
    state.booted = true;
  }

  function renderChrome() {
    dateLineEl.textContent = state.data.dateText;
    demoMarkEl.hidden = !state.data.isDemo;
    if (state.previewSilence) {
      silencePreviewBtn.textContent = "回来";
      silencePreviewBtn.setAttribute("aria-label", "回到今天");
    } else {
      silencePreviewBtn.textContent = "安静";
      silencePreviewBtn.setAttribute("aria-label", "安静一天");
    }
  }

  /* ---- 今天 ---- */
  function renderToday() {
    clear(todayMount);
    var t = state.data.today;
    var inSilence = state.previewSilence || !t || t.fate === "dropped";

    if (inSilence) {
      todayMount.appendChild(buildSilenceCard(t));
      /* 没有每日一句的日子，做过的小应用也要够得着；实时态还留一个
         「做一个小应用」的入口，第一张卡就是从这里开始的。 */
      if (live.mode) todayMount.appendChild(buildAppsSection());
    } else {
      todayMount.appendChild(buildHeroCard(t));
      if (state.data.secondary && state.data.secondary.sentence) {
        todayMount.appendChild(buildSecondaryCard(state.data.secondary));
      }
      todayMount.appendChild(buildQuickGrid());
      if (live.mode) todayMount.appendChild(buildAppsSection());
    }
  }

  function buildSilenceCard(t) {
    var card = el("article", "hero-card is-silence");
    if (!state.booted) card.classList.add("is-entering");
    var mark = el("div", "silence-mark");
    mark.setAttribute("aria-hidden", "true");
    mark.appendChild(svgIcon("moon"));
    card.appendChild(mark);
    card.appendChild(el("h1", "silence-title", "今天没事。"));

    var acts = el("div", "silence-actions");
    if (state.previewSilence) {
      var back = button("btn btn-primary", "回来");
      back.addEventListener("click", function () {
        state.previewSilence = false;
        renderAll();
      });
      acts.appendChild(back);
    } else if (state.lastDropped) {
      var restore = button("btn btn-secondary", "撤回");
      restore.addEventListener("click", undoLastDrop);
      acts.appendChild(restore);
    }
    var hist = button("btn btn-quiet", "记忆");
    hist.addEventListener("click", function () { switchView("history", true); });
    acts.appendChild(hist);
    card.appendChild(acts);
    return card;
  }

  function buildHeroCard(t) {
    var card = el("article", "hero-card");
    if (!state.booted) card.classList.add("is-entering");

    if (t.money) {
      var ledger = el("div", "hero-ledger");
      var fig = el("h1", "money-figure");
      fig.appendChild(el("span", "money-sym", "¥"));
      fig.appendChild(el("span", "money-num", String(t.money).replace(/^¥\s*/, "")));
      ledger.appendChild(fig);
      var facts = el("div", "hero-facts");
      if (t.moneyDue) facts.appendChild(el("p", "money-sub", t.moneyDue));
      ledger.appendChild(facts);
      card.appendChild(ledger);
    }

    if (t.fate === "rewritten" && t.oldSentence) {
      var oldP = el("p", "hero-old");
      oldP.appendChild(el("del", "", t.oldSentence));
      card.appendChild(oldP);
      card.appendChild(el(t.money ? "p" : "h1", "hero-sentence is-new", t.sentence));
    } else {
      card.appendChild(el(t.money ? "p" : "h1", "hero-sentence", t.sentence));
    }

    var meta = el("div", "hero-meta");
    meta.appendChild(el("span", "hero-source", t.sourceName));
    if (t.evidence) {
      var proof = proofButton(function () { openEvidenceSheet(t.evidence, proof); });
      meta.appendChild(proof);
    }
    card.appendChild(meta);

    if (t.fate === "confirmed") {
      var strip = el("div", "status-strip");
      strip.appendChild(el("span", "", "已记下"));
      var undo = button("", "撤销");
      undo.addEventListener("click", function () {
        t.fate = "pending";
        renderAll();
      });
      strip.appendChild(undo);
      card.appendChild(strip);
    }

    if (state.rewriting) {
      card.appendChild(buildRewriteForm(t));
    } else {
      card.appendChild(buildHeroActions(t));
    }
    return card;
  }

  function buildHeroActions(t) {
    var row = el("div", "hero-actions");
    if (t.fate !== "confirmed") {
      var ok = button("hero-action is-primary");
      ok.appendChild(svgIcon("check"));
      ok.appendChild(document.createTextNode("记下"));
      ok.setAttribute("aria-label", "猜对了");
      ok.addEventListener("click", confirmToday);
      row.appendChild(ok);
    }

    var edit = button("hero-action");
    edit.appendChild(svgIcon("pencil"));
    edit.appendChild(document.createTextNode("改写"));
    edit.setAttribute("aria-label", "改写");
    edit.addEventListener("click", openRewriteBox);
    row.appendChild(edit);

    var drop = button("hero-action");
    drop.appendChild(svgIcon("x"));
    drop.appendChild(document.createTextNode("忘掉"));
    drop.setAttribute("aria-label", "忘掉");
    drop.addEventListener("click", dropToday);
    row.appendChild(drop);

    if (t.fate === "confirmed") row.className = "hero-actions is-two";
    return row;
  }

  function buildRewriteForm(t) {
    var form = el("div", "rewrite-form");
    var ta = el("textarea", "rewrite-input");
    ta.id = "rewriteTextarea";
    ta.setAttribute("aria-label", "改写这句话");
    ta.value = state.rewriteDraft;
    ta.addEventListener("input", function () {
      state.rewriteDraft = ta.value;
      if (state.rewriteError && ta.value.trim()) {
        state.rewriteError = "";
        var errEl = form.querySelector(".rewrite-error");
        if (errEl) { errEl.textContent = ""; errEl.hidden = true; }
      }
    });
    form.appendChild(ta);

    var err = el("p", "rewrite-error", state.rewriteError || "");
    err.setAttribute("role", "alert");
    if (!state.rewriteError) err.hidden = true;
    form.appendChild(err);

    var btns = el("div", "rewrite-btns");
    var save = button("btn btn-primary", "保存");
    save.addEventListener("click", function () { submitRewrite(ta, err); });
    btns.appendChild(save);
    var cancel = button("btn btn-quiet", "取消");
    cancel.addEventListener("click", function () {
      state.rewriting = false;
      state.rewriteError = "";
      renderAll();
    });
    btns.appendChild(cancel);
    form.appendChild(btns);
    return form;
  }

  function buildSecondaryCard(sec) {
    var card = el("article", "secondary-card");
    if (!state.booted) card.classList.add("is-entering");
    if (sec.acknowledged) {
      var line = el("div", "acknowledged-line");
      line.appendChild(el("span", "", "已记下"));
      var open = button("text-action", "展开");
      open.addEventListener("click", function () {
        sec.acknowledged = false;
        renderAll();
      });
      line.appendChild(open);
      card.appendChild(line);
      return card;
    }

    card.appendChild(el("p", "secondary-sentence", sec.sentence));
    var foot = el("div", "secondary-foot");
    foot.appendChild(el("span", "secondary-date", ""));
    var acts = el("div", "secondary-actions");
    var ack = button("ack-button", "知道");
    ack.setAttribute("aria-label", "知道了");
    ack.addEventListener("click", function () {
      sec.acknowledged = true;
      renderAll();
    });
    acts.appendChild(ack);
    if (sec.evidence) {
      var proof = proofButton(function () { openEvidenceSheet(sec.evidence, proof); });
      acts.appendChild(proof);
    }
    foot.appendChild(acts);
    card.appendChild(foot);
    return card;
  }

  function buildQuickGrid() {
    var grid = el("div", "quick-grid");

    var src = button("quick-card quick-sources");
    if (!state.booted) src.classList.add("is-entering");
    if (live.mode === "bridge") {
      var collected = (live.worldSources || []).length;
      src.setAttribute("aria-label", "已收录来源 " + collected + " 条");
      src.appendChild(el("span", "quick-label", "来源"));
      src.appendChild(el("span", "quick-value", String(collected)));
    } else {
      src.setAttribute("aria-label", "去开关来源");
      src.appendChild(el("span", "quick-label", "来源"));
      src.appendChild(el("span", "quick-value", countEnabledSources() + "/" + state.sources.length));
    }
    src.addEventListener("click", function () { switchView("sources", true); });
    grid.appendChild(src);

    var histList = getHistoryList();
    var activeCount = 0;
    for (var h = 0; h < histList.length; h++) {
      if (histList[h].fate !== "dropped") activeCount++;
    }
    var hist = button("quick-card quick-history");
    if (!state.booted) hist.classList.add("is-entering");
    hist.setAttribute("aria-label", "看全部记忆");
    hist.appendChild(el("span", "quick-label", "记忆"));
    hist.appendChild(el("span", "quick-value", String(activeCount)));
    hist.addEventListener("click", function () { switchView("history", true); });
    grid.appendChild(hist);
    return grid;
  }

  /* ---- 小应用：重做入口与异步轮询 ---- */
  function runeLen(s) {
    return String(s == null ? "" : s).replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "_").length;
  }

  function xmlUnescape(s) {
    return String(s == null ? "" : s)
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }

  function appMadeAt(xml) {
    var m = /<made-at>([^<]*)<\/made-at>/.exec(String(xml || ""));
    return m ? m[1] : "";
  }

  function appRequest(xml) {
    var m = /<request>([\s\S]*?)<\/request>/.exec(String(xml || ""));
    return m ? xmlUnescape(m[1]) : "";
  }

  function appIsPending(xml) {
    return String(xml || "").indexOf("<status>pending</status>") !== -1;
  }

  function findLiveApp(id) {
    for (var i = 0; i < state.liveApps.length; i++) {
      if (state.liveApps[i].id === id) return state.liveApps[i];
    }
    return null;
  }

  function replaceLiveApp(id, artifact) {
    for (var i = 0; i < state.liveApps.length; i++) {
      if (state.liveApps[i].id === id) {
        state.liveApps[i] = artifact;
        return true;
      }
    }
    return false;
  }

  function openAppRedo(app) {
    stopAppsPoll();
    state.redo = { id: app.id, draft: app.request || "", error: "", busy: false };
    renderAll();
    var input = document.getElementById("appRedoInput");
    if (input) {
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
    }
  }

  function closeAppRedo() {
    state.redo = null;
    renderAll();
    if (hasPendingApps()) scheduleAppsPoll();
  }

  function hasPendingApps() {
    for (var i = 0; i < state.liveApps.length; i++) {
      if (appIsPending(state.liveApps[i].xml)) return true;
    }
    return false;
  }

  function buildRedoForm() {
    var form = el("div", "app-redo");
    var label = el("label", "app-redo-label", "想改成什么样");
    label.setAttribute("for", "appRedoInput");
    form.appendChild(label);
    var input = el("textarea", "app-redo-input");
    input.id = "appRedoInput";
    input.rows = 3;
    input.maxLength = 240;
    input.value = state.redo.draft;
    input.setAttribute("aria-describedby", "appRedoHint");
    var hint = el("p", "app-redo-hint", runeLen(state.redo.draft) + " / 240");
    hint.id = "appRedoHint";
    input.addEventListener("input", function () {
      state.redo.draft = input.value;
      hint.textContent = runeLen(input.value) + " / 240";
    });
    form.appendChild(input);
    form.appendChild(hint);
    var acts = el("div", "app-redo-acts");
    var submit = button("btn btn-primary", state.redo.busy ? "正在提交" : "开始重做");
    submit.disabled = !!state.redo.busy;
    var cancel = button("btn btn-quiet", "取消");
    cancel.disabled = !!state.redo.busy;
    submit.addEventListener("click", submitAppRedo);
    cancel.addEventListener("click", closeAppRedo);
    acts.appendChild(submit);
    acts.appendChild(cancel);
    form.appendChild(acts);
    if (state.redo.error) form.appendChild(el("p", "app-redo-error", state.redo.error));
    return form;
  }

  /* ---- 做一个小应用 ---- */
  function openMakeForm(prefill) {
    stopAppsPoll();
    state.make = { draft: prefill || "", error: "", busy: false };
    renderAll();
    var input = document.getElementById("appMakeInput");
    if (input) {
      input.focus();
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) {}
    }
  }

  function closeMakeForm() {
    state.make = null;
    renderAll();
    if (hasPendingApps()) scheduleAppsPoll();
  }

  function buildMakeEntry() {
    if (state.make) return buildMakeForm();
    var row = el("div", "app-make-entry");
    var open = button("app-make-open");
    open.appendChild(svgIcon("plus"));
    open.appendChild(el("span", "", "做一个小应用"));
    open.addEventListener("click", function () { openMakeForm(""); });
    row.appendChild(open);
    return row;
  }

  function buildMakeForm() {
    var form = el("div", "app-redo app-make");
    var label = el("label", "app-redo-label", "想做什么");
    label.setAttribute("for", "appMakeInput");
    form.appendChild(label);
    var input = el("textarea", "app-redo-input");
    input.id = "appMakeInput";
    input.rows = 3;
    input.maxLength = 240;
    input.value = state.make.draft;
    input.placeholder = "一句话说想要的小应用，比如：记每天喝了几杯水";
    input.setAttribute("aria-describedby", "appMakeHint");
    var hint = el("p", "app-redo-hint", runeLen(state.make.draft) + " / 240");
    hint.id = "appMakeHint";
    input.addEventListener("input", function () {
      state.make.draft = input.value;
      hint.textContent = runeLen(input.value) + " / 240";
    });
    form.appendChild(input);
    form.appendChild(hint);
    var acts = el("div", "app-redo-acts");
    var submit = button("btn btn-primary", state.make.busy ? "正在提交" : "开始做");
    submit.disabled = !!state.make.busy;
    var cancel = button("btn btn-quiet", "取消");
    cancel.disabled = !!state.make.busy;
    submit.addEventListener("click", submitAppMake);
    cancel.addEventListener("click", closeMakeForm);
    acts.appendChild(submit);
    acts.appendChild(cancel);
    form.appendChild(acts);
    if (state.make.error) form.appendChild(el("p", "app-redo-error", state.make.error));
    return form;
  }

  function appErrorText(code) {
    if (code === "app_limit_reached") return "今天做得够多了，明天再来。";
    if (code === "model_not_configured") return "先在来源页填好模型地址和名字。";
    if (code === "model_destination_changed") return "模型设置变了，刷新后再试。";
    if (code === "app_not_found") return "这个应用找不到了。";
    if (code === "invalid_input") return "这句话不行，换一句。";
    return "没提交上，再试一次。";
  }

  function bridgeAppCall(fn, onOk, onErr) {
    var raw = "";
    try { raw = fn(); } catch (e) { raw = ""; }
    var payload = null;
    try { payload = JSON.parse(raw); } catch (e2) { payload = null; }
    if (!payload) { onErr("本机没应答，再试一次。"); return; }
    if (payload.ok && payload.app) { onOk(payload.app, payload.status); return; }
    onErr(appErrorText(payload.error));
  }

  function postAppMake(request, onOk, onErr) {
    if (live.mode === "bridge") {
      bridgeAppCall(function () { return window.AndroidStorage.appMake(request, todaySlug()); }, onOk, onErr);
      return;
    }
    fetchModel().then(function (m) {
      return fetch("/v1/apps/make", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + live.token },
        body: JSON.stringify({ endpoint: m.endpoint, model: m.model, request: request, apiKey: "" })
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (res.status === 202 || res.status === 200) {
          if (!payload || !payload.app) throw new Error("回包不完整，再试一次。");
          onOk(payload.app, payload.status);
          return;
        }
        throw new Error(appErrorText(payload && payload.error));
      });
    }).catch(function (e) {
      onErr(e && e.message ? e.message : "没提交上，再试一次。");
    });
  }

  function submitAppMake() {
    if (!state.make || state.make.busy) return;
    var request = String(state.make.draft || "").trim();
    if (!request) {
      state.make.error = "写一句想做什么。";
      renderAll();
      return;
    }
    if (runeLen(request) > 240) {
      state.make.error = "最多 240 个字。";
      renderAll();
      return;
    }
    state.make.busy = true;
    state.make.error = "";
    renderAll();
    postAppMake(request, function (artifact) {
      state.make = null;
      live.failed = null;
      if (!replaceLiveApp(artifact.id, artifact)) state.liveApps.push(artifact);
      renderAll();
      liveRetryBtn.hidden = true;
      liveGenRetryBtn.hidden = true;
      liveBannerEl.hidden = false;
      if (appIsPending(artifact.xml)) {
        liveBannerTextEl.textContent = "正在现做，几分钟。";
        scheduleAppsPoll();
      } else {
        liveBannerTextEl.textContent = "这个小应用今天已经做好了。";
      }
    }, function (message) {
      if (!state.make) state.make = { draft: request, error: "", busy: false };
      state.make.busy = false;
      state.make.error = message || "没提交上，再试一次。";
      renderAll();
    });
  }

  function fetchModel() {
    if (live.model) return Promise.resolve(live.model);
    return fetch("/v1/model", {
      headers: { Accept: "application/json", Authorization: "Bearer " + live.token }
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }).then(function (m) {
      if (!m || !m.endpoint || !m.model) throw new Error("模型还没配好。");
      live.model = m;
      return m;
    });
  }

  function postAppUpdate(id, request, onOk, onErr) {
    if (live.mode === "bridge") {
      bridgeAppCall(function () { return window.AndroidStorage.appUpdate(id, request, todaySlug()); }, onOk, onErr);
      return;
    }
    fetchModel().then(function (m) {
      return fetch("/v1/apps/update", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + live.token },
        body: JSON.stringify({ endpoint: m.endpoint, model: m.model, id: id, request: request, apiKey: "" })
      });
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (res.status === 202 || res.status === 200) {
          if (!payload || !payload.app) throw new Error("回包不完整，再试一次。");
          onOk(payload.app);
          return;
        }
        throw new Error(appErrorText(payload && payload.error));
      });
    }).catch(function (e) {
      onErr(e && e.message ? e.message : "没提交上，再试一次。");
    });
  }

  function submitAppRedo() {
    if (!state.redo || state.redo.busy) return;
    var request = String(state.redo.draft || "").trim();
    if (!request) {
      state.redo.error = "写一句想改成什么样。";
      renderAll();
      return;
    }
    if (runeLen(request) > 240) {
      state.redo.error = "最多 240 个字。";
      renderAll();
      return;
    }
    var liveApp = findLiveApp(state.redo.id);
    if (!liveApp) {
      state.redo.error = "这个应用找不到了。";
      renderAll();
      return;
    }
    var baseMadeAt = appMadeAt(liveApp.xml);
    state.redo.busy = true;
    state.redo.error = "";
    renderAll();
    postAppUpdate(liveApp.id, request, function (artifact) {
      live.redoBase[liveApp.id] = { madeAt: baseMadeAt, request: request };
      state.redo = null;
      live.failed = null;
      replaceLiveApp(liveApp.id, artifact);
      renderAll();
      scheduleAppsPoll();
      liveGenRetryBtn.hidden = true;
      liveRetryBtn.hidden = true;
      liveBannerEl.hidden = false;
      liveBannerTextEl.textContent = "正在重做，做好自动换上来。";
    }, function (message) {
      if (!state.redo) state.redo = { id: liveApp.id, draft: request, error: "", busy: false };
      state.redo.busy = false;
      state.redo.error = message || "没提交上，再试一次。";
      renderAll();
    });
  }

  function scheduleAppsPoll() {
    if (!live.mode || live.pollTimer || state.redo || state.make) return;
    live.pollTimer = window.setTimeout(function () {
      live.pollTimer = null;
      if (live.mode === "bridge") loadBridgeLive(true);
      else loadHttpLive(true);
    }, 6000);
  }

  function stopAppsPoll() {
    if (live.pollTimer) {
      window.clearTimeout(live.pollTimer);
      live.pollTimer = null;
    }
  }

  function buildAppsSection() {
    var section = el("section", "apps-section");
    for (var i = 0; i < state.liveApps.length && i < 8; i++) {
      (function (app) {
        var card = el("article", "app-card");
        var slot = el("div", "");
        card.appendChild(slot);
        section.appendChild(card);
        if (window.OQApp) {
          /* 两种实时态都能重做：HTTP 走 /v1/apps/update，安卓桥走
             原生密钥加 app-update 操作。 */
          var mountOpts = {};
          if (live.mode) {
            mountOpts.onRedo = function (appData) { openAppRedo(appData); };
          }
          window.OQApp.mount(slot, app.xml, app.id, mountOpts);
        }
        if (state.redo && state.redo.id === app.id) card.appendChild(buildRedoForm());
      })(state.liveApps[i]);
    }
    section.appendChild(buildMakeEntry());
    return section;
  }

  /* ---- 记忆 ---- */
  function getHistoryList() {
    var list = [];
    var t = state.data.today;
    if (t && t.fate !== "pending") {
      list.push({
        id: t.id,
        date: t.date,
        fate: t.fate,
        oldSentence: t.oldSentence || "",
        sentence: t.sentence,
        sourceName: t.sourceName,
        evidence: t.evidence,
        isToday: true
      });
    }
    var old = state.data.history || [];
    for (var i = 0; i < old.length; i++) list.push(old[i]);
    return list;
  }

  function cycleHistoryFate(entry) {
    if (entry.isToday && state.data.today) {
      if (state.data.today.live) {
        if (entry.fate === "dropped") {
          sendVoiceAct("confirm", "", function () {
            state.data.today.fate = "confirmed";
            renderAll();
          });
        } else {
          sendVoiceAct("drop", "", function () {
            state.data.today.fate = "dropped";
            renderAll();
          });
        }
        return;
      }
      state.data.today.fate = entry.fate === "dropped" ? "confirmed" : "dropped";
      renderAll();
      return;
    }
    entry.fate = entry.fate === "dropped" ? "confirmed" : "dropped";
    renderAll();
  }

  function buildMemoryProof(entry) {
    var panel = el("div", "memory-proof");
    panel.id = "memory-proof-" + entry.id;
    panel.setAttribute("aria-hidden", "true");
    var inner = el("div", "memory-proof-inner");
    var quote = el("p", "memory-proof-quote");
    var ev = entry.evidence || {};
    if (ev.before) quote.appendChild(document.createTextNode(ev.before));
    if (ev.highlight) quote.appendChild(el("mark", "memory-proof-mark", ev.highlight));
    if (ev.after) quote.appendChild(document.createTextNode(ev.after));
    inner.appendChild(quote);
    panel.appendChild(inner);
    return panel;
  }

  function toggleMemoryProof(buttonEl, panel) {
    var open = !panel.classList.contains("is-open");
    panel.classList.toggle("is-open", open);
    panel.setAttribute("aria-hidden", open ? "false" : "true");
    buttonEl.setAttribute("aria-expanded", open ? "true" : "false");
    buttonEl.setAttribute("aria-label", open ? "收起原文" : "看原文");
  }

  function renderHistory() {
    var all = getHistoryList();
    var active = [];
    var dropped = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].fate === "dropped") dropped.push(all[i]);
      else active.push(all[i]);
    }

    clear(historyMount);
    if (!active.length && !dropped.length) {
      historyMount.appendChild(el("p", "empty-card", "还没有"));
    }

    for (var k = 0; k < active.length; k++) {
      (function (entry, index) {
        var classes = index === 0 ? "memory-card memory-item is-featured" : "memory-row memory-item";
        if (index === active.length - 1) classes += " is-last";
        var card = el("article", classes + " is-" + entry.fate);
        var meta = el("div", "memory-meta");
        meta.appendChild(el("span", "memory-source", entry.sourceName));
        meta.appendChild(el("span", "memory-date", entry.date));
        card.appendChild(meta);

        if (entry.fate === "rewritten" && entry.oldSentence) {
          var oldP = el("p", "memory-old");
          oldP.appendChild(el("del", "", entry.oldSentence));
          card.appendChild(oldP);
        }
        card.appendChild(el("p", "memory-sentence", entry.sentence));

        var foot = el("div", "memory-foot");
        var toggle = button("orb-icon", "", "忘掉这句话");
        toggle.appendChild(svgIcon("x"));
        toggle.addEventListener("click", function () { cycleHistoryFate(entry); });
        foot.appendChild(toggle);

        var acts = el("div", "memory-actions");
        var proofPanel = null;
        if (entry.evidence) {
          proofPanel = buildMemoryProof(entry);
          var proof = proofButton(function () { toggleMemoryProof(proof, proofPanel); });
          proof.setAttribute("aria-expanded", "false");
          proof.setAttribute("aria-controls", proofPanel.id);
          acts.appendChild(proof);
        }
        foot.appendChild(acts);
        card.appendChild(foot);
        if (proofPanel) card.appendChild(proofPanel);
        historyMount.appendChild(card);
      })(active[k], k);
    }

    if (dropped.length) {
      var disclosure = button("memory-forgotten-toggle", "");
      disclosure.setAttribute("aria-expanded", state.showForgotten ? "true" : "false");
      disclosure.setAttribute("aria-label", "已忘掉 " + dropped.length + " 句");
      var forgottenLabel = el("span", "memory-forgotten-label");
      forgottenLabel.appendChild(svgIcon("undo"));
      forgottenLabel.appendChild(el("span", "memory-forgotten-count", String(dropped.length)));
      disclosure.appendChild(forgottenLabel);
      disclosure.appendChild(svgIcon("chevron"));
      disclosure.addEventListener("click", function () {
        state.showForgotten = !state.showForgotten;
        renderHistory();
      });
      historyMount.appendChild(disclosure);

      if (state.showForgotten) {
        for (var d = 0; d < dropped.length; d++) {
          (function (entry) {
            var row = el("article", "memory-forgotten-row");
            var meta = el("div", "memory-meta");
            meta.appendChild(el("span", "memory-source", entry.sourceName));
            meta.appendChild(el("span", "memory-date", entry.date));
            row.appendChild(meta);
            row.appendChild(el("p", "memory-sentence is-forgotten", entry.sentence));

            var foot = el("div", "memory-foot");
            var restore = button("orb-icon", "", "捡回这句话");
            restore.appendChild(svgIcon("undo"));
            restore.addEventListener("click", function () { cycleHistoryFate(entry); });
            foot.appendChild(restore);

            var acts = el("div", "memory-actions");
            var proofPanel = null;
            if (entry.evidence) {
              proofPanel = buildMemoryProof(entry);
              var proof = proofButton(function () { toggleMemoryProof(proof, proofPanel); });
              proof.setAttribute("aria-expanded", "false");
              proof.setAttribute("aria-controls", proofPanel.id);
              acts.appendChild(proof);
            }
            foot.appendChild(acts);
            row.appendChild(foot);
            if (proofPanel) row.appendChild(proofPanel);
            historyMount.appendChild(row);
          })(dropped[d]);
        }
      }
    }
  }

  /* ---- 来源与设置 ---- */
  function renderSources() {
    clear(sourcesMount);
    if (live.mode === "bridge") {
      renderBridgeSourceRows();
    } else {
      for (var i = 0; i < state.sources.length; i++) {
        (function (src) {
          var row = button("source-row");
          row.setAttribute("role", "switch");
          row.setAttribute("aria-checked", src.enabled ? "true" : "false");
          var copy = el("span", "source-copy");
          copy.appendChild(el("span", "source-name", src.name));
          row.appendChild(copy);
          var track = el("span", "switch-track");
          track.appendChild(el("span", "switch-thumb"));
          row.appendChild(track);
          row.addEventListener("click", function () {
            src.enabled = !src.enabled;
            saveSources();
            renderAll();
          });
          sourcesMount.appendChild(row);
        })(state.sources[i]);
      }
    }

    clear(settingsMount);
    var fs = el("fieldset", "theme-group");
    fs.appendChild(el("legend", "theme-legend", "外观"));
    var seg = el("div", "theme-segmented");
    var opts = [
      { value: "auto", label: "跟随系统" },
      { value: "light", label: "浅色" },
      { value: "dark", label: "深色" }
    ];
    for (var o = 0; o < opts.length; o++) {
      (function (opt) {
        var checked = state.theme === opt.value;
        var lbl = el("label", "theme-opt" + (checked ? " is-checked" : ""));
        var inp = document.createElement("input");
        inp.type = "radio";
        inp.name = "advisorTheme";
        inp.value = opt.value;
        inp.checked = checked;
        inp.addEventListener("change", function () {
          if (inp.checked) {
            saveTheme(opt.value);
            renderAll();
          }
        });
        lbl.appendChild(inp);
        lbl.appendChild(el("span", "", opt.label));
        seg.appendChild(lbl);
      })(opts[o]);
    }
    fs.appendChild(seg);
    settingsMount.appendChild(fs);

    if (live.mode !== "bridge") {
      var actions = el("div", "settings-actions");
      var allBtn = button("ghost-link", countEnabledSources() > 0 ? "全部断开" : "全部接通");
      allBtn.addEventListener("click", function () {
        var next = countEnabledSources() === 0;
        for (var s = 0; s < state.sources.length; s++) state.sources[s].enabled = next;
        saveSources();
        renderAll();
      });
      actions.appendChild(allBtn);

      var reset = button("ghost-link", "重置");
      reset.addEventListener("click", resetDemo);
      actions.appendChild(reset);
      settingsMount.appendChild(actions);
    }

    /* 设备阶段：小应用生成要一个 HTTP 模型地址。浏览器实时态由服务端
       配置管，这里只给安装包用。 */
    if (live.mode === "bridge") settingsMount.appendChild(buildModelSettings());
  }

  /* ---- 设备上的真实来源（桥模式） ----
   * 通知走系统监听授权，相册走系统选择器加一句备注，日历走系统日程
   * 选择器。短信受系统限制先不开放。收录都经 source-add 进档案库。 */

  function refreshBridgeSources(rerender) {
    if (live.mode !== "bridge") return;
    if (window.AndroidStorage && typeof window.AndroidStorage.sources === "function") {
      var parsed = null;
      try { parsed = JSON.parse(window.AndroidStorage.sources()); } catch (e) { parsed = null; }
      live.worldSources = parsed && parsed.sources ? parsed.sources : [];
    }
    if (window.AndroidNotifications && typeof window.AndroidNotifications.status === "function") {
      var status = null;
      try { status = JSON.parse(window.AndroidNotifications.status()); } catch (e2) { status = null; }
      live.notifyStatus = status;
    }
    if (rerender) renderAll();
  }

  function bridgeKindCount(kind) {
    var rows = live.worldSources || [];
    var n = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].kind === kind) n++;
    return n;
  }

  function bridgeSourceAdd(kind, origin, title, text, onOk, onFail) {
    var raw = "";
    try { raw = window.AndroidStorage.sourceAdd(kind, origin, title, text); } catch (e) { raw = ""; }
    var reply = null;
    try { reply = JSON.parse(raw); } catch (e2) { reply = null; }
    if (reply && reply.ok) { onOk(reply); return; }
    var code = reply && reply.error ? reply.error : "storage_error";
    if (code === "empty_world") onFail("档案还没建好，先在首页完成第一次解读，再收录外部材料。");
    else if (code === "invalid_input") onFail("内容没写或太长，改一改再收。");
    else onFail("本机没应答，稍后再试。");
  }

  function renderBridgeSourceRows() {
    var enabled = !!(live.notifyStatus && live.notifyStatus.enabled);
    var noticeCount = live.notifyStatus ? (live.notifyStatus.count || 0) : 0;
    var photoCount = bridgeKindCount("photo");
    var calendarCount = bridgeKindCount("calendar");

    var notif = button("source-row source-action");
    notif.appendChild(bridgeRowCopy("通知", enabled
      ? (noticeCount > 0 ? "已收录 " + noticeCount + " 条通知" : "已授权，来新通知会自动收录")
      : "点这行去系统设置，允许 Onit 读取通知"));
    notif.appendChild(bridgeRowAffordance(enabled ? "已授权" : "未授权", !enabled));
    notif.addEventListener("click", function () {
      try { window.AndroidNotifications.openSettings(); } catch (e) {}
    });
    sourcesMount.appendChild(notif);

    var photos = button("source-row source-action");
    photos.appendChild(bridgeRowCopy("相册", photoCount > 0
      ? "已收录 " + photoCount + " 条照片备注" : "选一张照片，写一句话说明"));
    photos.appendChild(bridgeRowAffordance("选照片", false));
    photos.addEventListener("click", function () {
      live.photoOpener = photos;
      try { window.AndroidPhotos.pick(); } catch (e) {}
    });
    sourcesMount.appendChild(photos);
    if (live.photoOpen && live.photoData) sourcesMount.appendChild(buildPhotoNotePanel());

    var calendar = button("source-row source-action");
    calendar.appendChild(bridgeRowCopy("日历", calendarCount > 0
      ? "已收录 " + calendarCount + " 条日程" : "从系统日历选几条日程进来"));
    calendar.appendChild(bridgeRowAffordance("选日程", false));
    calendar.addEventListener("click", function () {
      try { window.AndroidAdvisor.chooseCalendarEvents(); } catch (e) {}
    });
    sourcesMount.appendChild(calendar);

    var sms = button("source-row source-action");
    sms.disabled = true;
    sms.appendChild(bridgeRowCopy("短信", "系统暂不开放读取，接入方案在定"));
    sms.appendChild(bridgeRowAffordance("暂未开放", true));
    sourcesMount.appendChild(sms);
  }

  function bridgeRowCopy(name, sub) {
    var copy = el("span", "source-copy");
    copy.appendChild(el("span", "source-name", name));
    copy.appendChild(el("span", "source-sub", sub));
    return copy;
  }

  function bridgeRowAffordance(word, muted) {
    return el("span", "source-affordance" + (muted ? " is-muted" : ""), word);
  }

  function buildPhotoNotePanel() {
    var panel = el("div", "photo-note");
    var img = document.createElement("img");
    img.className = "photo-note-img";
    img.src = live.photoData;
    img.alt = "选中的照片预览";
    panel.appendChild(img);
    var field = el("label", "model-field photo-note-field");
    field.setAttribute("for", "photoNoteInput");
    field.appendChild(el("span", "model-field-label", "这张照片是什么"));
    var input = document.createElement("input");
    input.className = "model-input";
    input.id = "photoNoteInput";
    input.type = "text";
    input.maxLength = 140;
    input.placeholder = "写一句，比如：房东说下周来修热水器";
    input.value = live.photoNote;
    input.addEventListener("input", function () {
      live.photoNote = input.value;
      if (!live.photoError) return;
      live.photoError = "";
      var line = panel.querySelector(".photo-note-error");
      if (line) line.hidden = true;
    });
    field.appendChild(input);
    panel.appendChild(field);
    var error = el("p", "model-error photo-note-error");
    error.hidden = true;
    panel.appendChild(error);
    var acts = el("div", "settings-actions");
    var keep = button("btn btn-primary", "收录进顾问");
    keep.addEventListener("click", function () {
      var note = String(live.photoNote || "").trim();
      if (!note) {
        error.textContent = "先写一句说明，照片本身不会存进档案。";
        error.hidden = false;
        input.focus();
        return;
      }
      keep.disabled = true;
      bridgeSourceAdd("photo", "相册", note, note, function () {
        live.photoOpen = false;
        live.photoData = "";
        live.photoNote = "";
        refreshBridgeSources(true);
        if (live.photoOpener && typeof live.photoOpener.focus === "function") {
          try { live.photoOpener.focus(); } catch (e) {}
        }
      }, function (message) {
        keep.disabled = false;
        error.textContent = message;
        error.hidden = false;
      });
    });
    acts.appendChild(keep);
    var cancel = button("ghost-link", "不收了");
    cancel.addEventListener("click", function () {
      live.photoOpen = false;
      live.photoData = "";
      live.photoNote = "";
      live.photoError = "";
      renderAll();
      if (live.photoOpener && typeof live.photoOpener.focus === "function") {
        try { live.photoOpener.focus(); } catch (e) {}
      }
    });
    acts.appendChild(cancel);
    panel.appendChild(acts);
    if (live.photoError) {
      error.textContent = live.photoError;
      error.hidden = false;
    }
    return panel;
  }

  /* 相册桥把选好的照片送回这里；只开面板，收录要等用户写完备注。 */
  window.__oqPhoto = function (dataUrl) {
    if (live.mode !== "bridge") return;
    if (!dataUrl) {
      if (live.photoOpen && !live.photoData) live.photoOpen = false;
      return;
    }
    live.photoData = String(dataUrl);
    live.photoOpen = true;
    live.photoNote = "";
    live.photoError = "";
    renderAll();
    var input = document.getElementById("photoNoteInput");
    if (input) input.focus();
  };

  /* 日历选择器把选中的日程送回这里，转成一条「日历」类来源。 */
  window.advisorCalendar = function (payload) {
    if (live.mode !== "bridge" || !payload || payload.error) return;
    var events = payload.events || [];
    var lines = [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var title = String(ev.title || "").trim();
      if (!title) continue;
      var when = "";
      var begin = new Date(Number(ev.begin));
      if (!isNaN(begin.getTime())) {
        when = (begin.getMonth() + 1) + "月" + begin.getDate() + "日";
        if (!ev.allDay) {
          var hh = String(begin.getHours());
          var mm = String(begin.getMinutes());
          when += " " + (mm === "0" ? hh + "点" : hh + ":" + (mm.length < 2 ? "0" + mm : mm));
        }
      }
      lines.push(when ? when + " " + title : title);
    }
    if (!lines.length) return;
    bridgeSourceAdd("calendar", "日历", "日历日程", lines.join("\n"), function () {
      refreshBridgeSources(true);
    }, function (message) {
      liveBannerEl.hidden = false;
      liveBannerTextEl.textContent = message;
      liveRetryBtn.hidden = true;
    });
  };

  /* ---- 模型设置（设备阶段） ---- */
  var modelFormNode = null;

  function loadModelConfig() {
    if (live.mode !== "bridge" || typeof window.AndroidStorage.modelConfig !== "function") return;
    var raw = "";
    try { raw = window.AndroidStorage.modelConfig(); } catch (e) { raw = ""; }
    var cfg = null;
    try { cfg = JSON.parse(raw); } catch (e2) { cfg = null; }
    if (cfg && cfg.ok) state.modelCfg = cfg;
  }

  function modelStatusText() {
    var cfg = state.modelCfg;
    if (!cfg || !cfg.endpoint || !cfg.model) return "还没填模型地址，小应用做不了。";
    return "已连上 " + cfg.model + (cfg.hasKey ? "" : "（没有密钥，局域网模型可以不填）");
  }

  function buildModelSettings() {
    if (!modelFormNode) {
      var fs = el("fieldset", "model-group");
      fs.appendChild(el("legend", "model-legend", "模型"));
      var status = el("p", "model-status");
      status.id = "modelStatus";
      fs.appendChild(status);
      var fields = [
        { id: "modelEndpoint", label: "地址", type: "url", placeholder: "https://…/v1/chat/completions" },
        { id: "modelName", label: "模型名", type: "text", placeholder: "模型名称" },
        { id: "modelKey", label: "密钥", type: "password", placeholder: "没有就留空" }
      ];
      for (var i = 0; i < fields.length; i++) {
        (function (f) {
          var label = el("label", "model-field");
          label.setAttribute("for", f.id);
          label.appendChild(el("span", "model-field-label", f.label));
          var input = document.createElement("input");
          input.className = "model-input";
          input.id = f.id;
          input.type = f.type;
          input.placeholder = f.placeholder;
          input.autocomplete = "off";
          input.spellcheck = false;
          label.appendChild(input);
          fs.appendChild(label);
        })(fields[i]);
      }
      var acts = el("div", "settings-actions");
      var save = button("btn btn-primary model-save", "保存模型");
      save.addEventListener("click", saveModelSettings);
      acts.appendChild(save);
      fs.appendChild(acts);
      var error = el("p", "model-error");
      error.id = "modelError";
      error.hidden = true;
      fs.appendChild(error);
      modelFormNode = fs;
      fillModelInputs();
    }
    var statusNode = modelFormNode.querySelector("#modelStatus");
    if (statusNode) statusNode.textContent = modelStatusText();
    return modelFormNode;
  }

  function fillModelInputs() {
    if (!modelFormNode) return;
    var cfg = state.modelCfg || {};
    var ep = modelFormNode.querySelector("#modelEndpoint");
    var name = modelFormNode.querySelector("#modelName");
    if (ep && !ep.value) ep.value = cfg.endpoint || "";
    if (name && !name.value) name.value = cfg.model || "";
  }

  function saveModelSettings() {
    if (!modelFormNode) return;
    var ep = String(modelFormNode.querySelector("#modelEndpoint").value || "").trim();
    var name = String(modelFormNode.querySelector("#modelName").value || "").trim();
    var key = String(modelFormNode.querySelector("#modelKey").value || "").trim();
    var error = modelFormNode.querySelector("#modelError");
    function fail(msg) {
      if (error) { error.textContent = msg; error.hidden = false; }
    }
    if (!ep || !name) { fail("地址和模型名都要填。"); return; }
    if (error) error.hidden = true;
    var settings = {};
    try {
      var raw = window.AndroidStorage.read("openquest.advisor.settings.v2");
      if (raw) settings = JSON.parse(raw) || {};
    } catch (e) { settings = {}; }
    settings.endpoint = ep;
    settings.model = name;
    settings.modelMode = "cloud";
    var ok = false;
    try { ok = window.AndroidStorage.write("openquest.advisor.settings.v2", JSON.stringify(settings)); } catch (e2) { ok = false; }
    if (!ok) { fail("没存上，再试一次。"); return; }
    if (key) {
      var saved = false;
      try { saved = window.AndroidAdvisor.saveModelKey(ep, key); } catch (e3) { saved = false; }
      if (!saved) { fail("地址要 https，或本机、局域网的 http。"); return; }
      var keyInput = modelFormNode.querySelector("#modelKey");
      if (keyInput) keyInput.value = "";
    }
    loadModelConfig();
    var statusNode = modelFormNode.querySelector("#modelStatus");
    if (statusNode) statusNode.textContent = "已保存。" + modelStatusText();
  }

  /* ---- 三屏：1:1 跟手拖动 + 底部入口 ---- */
  var VIEW_ORDER = ["today", "history", "sources"];

  function viewIndex(name) {
    var idx = VIEW_ORDER.indexOf(name);
    return idx < 0 ? 0 : idx;
  }

  function tabWidth() {
    var w = tabToday.offsetWidth;
    if (!w) w = Math.max(56, ((tabbar ? tabbar.clientWidth : 300) - 10) / 3);
    return w;
  }

  function setTabIndicator(progress, animate) {
    if (!tabIndicator) return;
    var w = tabWidth();
    var base = tabToday.offsetLeft - 5;
    tabIndicator.style.width = w + "px";
    tabIndicator.style.transition = animate && !isReducedMotion() ? "" : "none";
    tabIndicator.style.transform = "translate3d(" + (base + progress * w).toFixed(1) + "px, 0, 0)";
  }

  function setViewDepth(progress, animate) {
    var views = [viewToday, viewHistory, viewSources];
    for (var i = 0; i < views.length; i++) {
      var d = Math.min(1, Math.abs(i - progress));
      var scale = 1 - 0.055 * d;
      var op = 1 - 0.45 * d;
      views[i].style.transition = animate && !isReducedMotion()
        ? "transform 280ms cubic-bezier(0.16, 1, 0.3, 1), opacity 280ms cubic-bezier(0.16, 1, 0.3, 1)"
        : "none";
      views[i].style.transform = "scale(" + scale.toFixed(3) + ")";
      views[i].style.opacity = op.toFixed(3);
    }
  }

  function setTrackPosition(index, animate) {
    var width = appMain.clientWidth || window.innerWidth || 360;
    viewTrack.style.transition = animate && !isReducedMotion()
      ? "transform 280ms cubic-bezier(0.16, 1, 0.3, 1)"
      : "none";
    viewTrack.style.transform = "translate3d(" + (-index * width).toFixed(1) + "px, 0, 0)";
  }

  function switchView(name, focusTab, animate) {
    state.activeView = name;
    var views = { today: viewToday, history: viewHistory, sources: viewSources };
    var tabs = { today: tabToday, history: tabHistory, sources: tabSources };
    for (var i = 0; i < VIEW_ORDER.length; i++) {
      var key = VIEW_ORDER[i];
      var active = key === name;
      views[key].classList.toggle("is-active", active);
      views[key].setAttribute("aria-hidden", active ? "false" : "true");
      tabs[key].classList.toggle("is-active", active);
      tabs[key].setAttribute("aria-selected", active ? "true" : "false");
    }
    setTrackPosition(viewIndex(name), animate !== false);
    setTabIndicator(viewIndex(name), animate !== false);
    setViewDepth(viewIndex(name), animate !== false);
    if (animate !== false) {
      appMain.classList.add("is-peeking");
      window.setTimeout(function () { appMain.classList.remove("is-peeking"); }, isReducedMotion() ? 0 : 300);
    }
    if (focusTab) {
      try { tabs[name].focus({ preventScroll: true }); } catch (e) { tabs[name].focus(); }
    }
  }

  var pager = {
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastT: 0,
    vx: 0,
    dx: 0,
    moved: false,
    width: 0
  };
  var suppressPagerClick = false;

  function pagerCanStart(target) {
    if (!target || !target.closest) return true;
    return !target.closest("button, a, input, textarea, label, select, [role='switch'], [data-no-drag='1']");
  }

  appMain.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!pagerCanStart(e.target)) return;
    pager.active = true;
    pager.pointerId = e.pointerId;
    pager.startX = e.clientX;
    pager.startY = e.clientY;
    pager.lastX = e.clientX;
    pager.lastT = performance.now();
    pager.vx = 0;
    pager.dx = 0;
    pager.moved = false;
    pager.width = appMain.clientWidth || window.innerWidth || 360;
    viewTrack.style.transition = "none";
  });

  appMain.addEventListener("pointermove", function (e) {
    if (!pager.active || e.pointerId !== pager.pointerId) return;
    var dx = e.clientX - pager.startX;
    var dy = e.clientY - pager.startY;
    if (!pager.moved) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        pager.active = false;
        return;
      }
      pager.moved = true;
      appMain.classList.add("is-peeking");
      appMain.classList.add("is-dragging");
      try { appMain.setPointerCapture(e.pointerId); } catch (err) {}
    }
    var now = performance.now();
    var dt = now - pager.lastT;
    if (dt > 0) pager.vx = (e.clientX - pager.lastX) / dt;
    pager.lastX = e.clientX;
    pager.lastT = now;
    pager.dx = dx;

    var idx = viewIndex(state.activeView);
    var offset = -idx * pager.width + dx;
    if (idx === 0 && dx > 0) offset = dx * 0.34;
    if (idx === VIEW_ORDER.length - 1 && dx < 0) offset = -idx * pager.width + dx * 0.34;
    viewTrack.style.transform = "translate3d(" + offset.toFixed(1) + "px, 0, 0)";
    var progress = -offset / pager.width;
    setTabIndicator(progress, false);
    setViewDepth(progress, false);
    if (e.cancelable) e.preventDefault();
  });

  function endPager(e) {
    if (!pager.active || e.pointerId !== pager.pointerId) return;
    pager.active = false;
    try { appMain.releasePointerCapture(e.pointerId); } catch (err) {}
    appMain.classList.remove("is-dragging");
    if (!pager.moved) {
      appMain.classList.remove("is-peeking");
      return;
    }
    var idx = viewIndex(state.activeView);
    var next = idx;
    var threshold = pager.width * 0.18;
    if (pager.dx < -threshold || pager.vx < -0.45) next = idx + 1;
    else if (pager.dx > threshold || pager.vx > 0.45) next = idx - 1;
    if (next < 0) next = 0;
    if (next > VIEW_ORDER.length - 1) next = VIEW_ORDER.length - 1;
    suppressPagerClick = true;
    window.setTimeout(function () { suppressPagerClick = false; }, 420);
    switchView(VIEW_ORDER[next], false, true);
    window.setTimeout(function () { appMain.classList.remove("is-peeking"); }, isReducedMotion() ? 0 : 300);
  }

  appMain.addEventListener("pointerup", endPager);
  appMain.addEventListener("pointercancel", endPager);

  document.addEventListener("click", function (e) {
    if (!suppressPagerClick) return;
    suppressPagerClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  window.addEventListener("resize", function () {
    var idx = viewIndex(state.activeView);
    setTrackPosition(idx, false);
    setTabIndicator(idx, false);
    setViewDepth(idx, false);
  });

  /* ---- 原文抽屉 ---- */
  var lastSheetOpener = null;
  var sheetDrag = { active: false, pointerId: null, startY: 0, deltaY: 0, lastY: 0, lastT: 0, vy: 0 };

  function openEvidenceSheet(evData, opener) {
    if (!evData) return;
    lastSheetOpener = opener || document.activeElement;
    sheetTitleEl.textContent = evData.title || "原文";
    sheetOriginEl.textContent = evData.origin || "";
    clear(sheetBodyEl);
    var p = document.createElement("p");
    if (evData.before) p.appendChild(document.createTextNode(evData.before));
    if (evData.highlight) {
      var mk = document.createElement("mark");
      mk.textContent = evData.highlight;
      p.appendChild(mk);
    }
    if (evData.after) p.appendChild(document.createTextNode(evData.after));
    sheetBodyEl.appendChild(p);
    evidenceSheet.style.transition = "";
    evidenceSheet.style.transform = "translate3d(0, 0, 0)";
    evidenceBackdrop.hidden = false;
    sheetCloseBtn.focus();
  }

  function closeEvidenceSheet() {
    evidenceBackdrop.hidden = true;
    evidenceSheet.style.transition = "";
    evidenceSheet.style.transform = "";
    if (lastSheetOpener && typeof lastSheetOpener.focus === "function") {
      try { lastSheetOpener.focus(); } catch (e) {}
    }
    lastSheetOpener = null;
  }

  sheetGrabArea.addEventListener("pointerdown", function (e) {
    if (e.button && e.button !== 0) return;
    sheetDrag.active = true;
    sheetDrag.pointerId = e.pointerId;
    sheetDrag.startY = e.clientY;
    sheetDrag.deltaY = 0;
    sheetDrag.lastY = e.clientY;
    sheetDrag.lastT = performance.now();
    sheetDrag.vy = 0;
    evidenceSheet.style.transition = "none";
    try { sheetGrabArea.setPointerCapture(e.pointerId); } catch (err) {}
  });

  sheetGrabArea.addEventListener("pointermove", function (e) {
    if (!sheetDrag.active || e.pointerId !== sheetDrag.pointerId) return;
    var raw = e.clientY - sheetDrag.startY;
    var dy = raw < 0 ? raw * 0.2 : raw;
    sheetDrag.deltaY = dy;
    var now = performance.now();
    var dt = now - sheetDrag.lastT;
    if (dt > 0) sheetDrag.vy = (e.clientY - sheetDrag.lastY) / dt;
    sheetDrag.lastY = e.clientY;
    sheetDrag.lastT = now;
    evidenceSheet.style.transform = "translate3d(0, " + dy.toFixed(1) + "px, 0)";
  });

  function endSheetDrag(e) {
    if (!sheetDrag.active || e.pointerId !== sheetDrag.pointerId) return;
    sheetDrag.active = false;
    try { sheetGrabArea.releasePointerCapture(e.pointerId); } catch (err) {}
    var shouldClose = sheetDrag.deltaY > 96 || sheetDrag.vy > 0.45;
    evidenceSheet.style.transition = isReducedMotion() ? "none" : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)";
    if (shouldClose) {
      evidenceSheet.style.transform = "translate3d(0, 100%, 0)";
      window.setTimeout(closeEvidenceSheet, isReducedMotion() ? 0 : 210);
    } else {
      evidenceSheet.style.transform = "translate3d(0, 0, 0)";
    }
  }

  sheetGrabArea.addEventListener("pointerup", endSheetDrag);
  sheetGrabArea.addEventListener("pointercancel", endSheetDrag);
  sheetCloseBtn.addEventListener("click", closeEvidenceSheet);
  evidenceBackdrop.addEventListener("click", function (e) {
    if (e.target === evidenceBackdrop) closeEvidenceSheet();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !evidenceBackdrop.hidden) closeEvidenceSheet();
  });

  /* ---- 命运操作 ---- */
  function cardIsLive() {
    return !!(state.data.today && state.data.today.live);
  }

  function liveActFailed() {
    state.acting = false;
    liveBannerEl.hidden = false;
    liveBannerTextEl.textContent = "没记上，再试一次。";
    liveRetryBtn.hidden = true;
  }

  function animateHeroExit(kind, done) {
    var card = todayMount.querySelector(".hero-card");
    if (!card || isReducedMotion()) { done(); return; }
    card.classList.add(kind === "drop" ? "is-dropping" : "is-stamping");
    window.setTimeout(done, kind === "drop" ? 200 : 180);
  }

  function sendVoiceAct(action, text, onDone) {
    var memId = state.data.today && state.data.today.memoryId;
    if (!memId) { liveActFailed(); return; }
    if (live.mode === "bridge") {
      var raw = "";
      try { raw = window.AndroidStorage.voiceAct(memId, action, text || ""); } catch (e) { raw = ""; }
      var ok = false;
      try { ok = !!JSON.parse(raw).ok; } catch (e2) { ok = false; }
      if (ok) onDone();
      else liveActFailed();
      return;
    }
    fetch("/v1/voice-act", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + live.token },
      body: JSON.stringify({ memoryId: memId, action: action, text: text || "" })
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (payload) {
        if (payload && payload.ok) onDone();
        else liveActFailed();
      })
      .catch(function () { liveActFailed(); });
  }

  function confirmToday() {
    if (!state.data.today || state.acting) return;
    state.acting = true;
    if (cardIsLive()) {
      sendVoiceAct("confirm", "", function () {
        animateHeroExit("stamp", function () {
          state.data.today.fate = "confirmed";
          state.rewriting = false;
          state.rewriteError = "";
          state.acting = false;
          renderAll();
        });
      });
      return;
    }
    animateHeroExit("stamp", function () {
      state.data.today.fate = "confirmed";
      state.rewriting = false;
      state.rewriteError = "";
      state.acting = false;
      renderAll();
    });
  }

  function openRewriteBox() {
    if (!state.data.today) return;
    state.rewriting = true;
    state.rewriteError = "";
    state.rewriteDraft = state.data.today.sentence;
    renderAll();
    var ta = document.getElementById("rewriteTextarea");
    if (ta) {
      try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  function submitRewrite(ta, errEl) {
    var next = ta.value.replace(/\s+/g, " ").trim();
    if (!next) {
      state.rewriteError = "先写几句再保存";
      errEl.textContent = state.rewriteError;
      errEl.hidden = false;
      ta.focus();
      return;
    }
    var t = state.data.today;
    if (state.acting) return;
    state.acting = true;
    if (cardIsLive()) {
      sendVoiceAct("rewrite", next, function () {
        animateHeroExit("stamp", function () {
          if (!t.oldSentence) t.oldSentence = t.originalSentence || t.sentence;
          t.sentence = next;
          t.fate = "rewritten";
          state.rewriting = false;
          state.rewriteError = "";
          state.acting = false;
          renderAll();
        });
      });
      return;
    }
    animateHeroExit("stamp", function () {
      if (!t.oldSentence) t.oldSentence = t.originalSentence || t.sentence;
      t.sentence = next;
      t.fate = "rewritten";
      state.rewriting = false;
      state.rewriteError = "";
      state.acting = false;
      renderAll();
    });
  }

  function dropToday() {
    var t = state.data.today;
    if (!t || t.fate === "dropped" || state.acting) return;
    state.acting = true;
    if (cardIsLive()) {
      sendVoiceAct("drop", "", function () {
        animateHeroExit("drop", function () {
          t.fate = "dropped";
          state.rewriting = false;
          state.rewriteError = "";
          state.acting = false;
          renderAll();
          showUndoBar("已忘掉");
        });
      });
      return;
    }
    state.lastDropped = {
      previousFate: t.fate,
      previousSentence: t.sentence,
      previousOld: t.oldSentence || ""
    };
    animateHeroExit("drop", function () {
      t.fate = "dropped";
      state.rewriting = false;
      state.rewriteError = "";
      state.acting = false;
      renderAll();
      showUndoBar("已忘掉");
    });
  }

  function showUndoBar(msg) {
    if (state.undoTimer) { window.clearTimeout(state.undoTimer); state.undoTimer = null; }
    undoTextEl.textContent = msg;
    undoBarEl.hidden = false;
    state.undoTimer = window.setTimeout(function () {
      undoBarEl.hidden = true;
      state.undoTimer = null;
    }, 6000);
  }

  function undoLastDrop() {
    if (!state.lastDropped || !state.data.today) return;
    var snap = state.lastDropped;
    state.lastDropped = null;
    state.data.today.fate = snap.previousFate;
    state.data.today.sentence = snap.previousSentence;
    state.data.today.oldSentence = snap.previousOld;
    if (state.undoTimer) { window.clearTimeout(state.undoTimer); state.undoTimer = null; }
    undoBarEl.hidden = true;
    renderAll();
  }

  function resetDemo() {
    state.data = makeDefaultArtifacts();
    state.previewSilence = false;
    state.rewriting = false;
    state.rewriteError = "";
    state.lastDropped = null;
    state.showForgotten = false;
    state.liveApps = [];
    state.acting = false;
    live.voice = null;
    undoBarEl.hidden = true;
    renderAll();
    switchView("today", false);
  }

  /* ---- live 接入 ---- */
  function parseVoiceXML(xmlText) {
    try {
      var doc = new DOMParser().parseFromString(xmlText, "text/xml");
      if (!doc || !doc.documentElement) return null;
      if (doc.getElementsByTagName("parsererror").length) return null;
      var root = doc.documentElement;
      function pick(tag) {
        var nodes = root.getElementsByTagName(tag);
        return nodes.length ? (nodes[0].textContent || "").trim() : "";
      }
      var message = pick("message");
      if (!message) return null;
      return {
        badge: pick("badge"), message: message, quote: pick("quote"), sourceId: pick("source-id"),
        memoryId: pick("memory-id"), due: pick("due"), sentAt: pick("sent-at")
      };
    } catch (e) { return null; }
  }

  function applyVoiceCard(v) {
    if (!v || !v.message) return false;
    /* 轮询会反复送同一张 voice 卡：同一句话保留用户已经做过的确认或忘掉，
       只有句子换了（新的一天）才回到待确认。 */
    var prev = state.data.today;
    var fate = prev && prev.live && prev.sentence === v.message ? prev.fate : "pending";
    state.data.isDemo = false;
    state.data.dateText = todayTextCN();
    state.data.today = {
      id: "voice-" + (v.memoryId || todaySlug()),
      date: todayTextCN().split(" ")[0],
      money: "",
      sentence: v.message,
      originalSentence: v.message,
      fate: fate,
      sourceName: v.badge || "每日一句",
      evidence: v.quote ? {
        title: "这句的原话",
        origin: (v.sourceId ? v.sourceId + " · " : "") + (v.sentAt || v.due || ""),
        before: "",
        highlight: v.quote,
        after: ""
      } : null,
      memoryId: v.memoryId || "",
      live: true,
      due: v.due || ""
    };
    live.voice = v;
    return true;
  }

  function applyLivePayload(payload) {
    var got = false;
    if (payload && payload.voice && payload.voice.message) got = applyVoiceCard(payload.voice);
    var arts = payload ? payload.artifacts : null;
    var apps = [];
    if (arts && arts.length) {
      for (var i = 0; i < arts.length; i++) {
        var a = arts[i];
        if (!a) continue;
        if (a.type === "app") apps.push(a);
        else if (a.type === "voice" && !got) {
          var v = parseVoiceXML(a.xml);
          if (v) got = applyVoiceCard(v);
        }
      }
    }

    /* 上一轮还在做、这一轮不见了的任务：成品接上了算成功，原地退回旧卡
     * 算重做失败，什么都没回来算生成失败。pending 消失就是后端的失败信号。 */
    var prevPending = {};
    for (var pp = 0; pp < state.liveApps.length; pp++) {
      if (appIsPending(state.liveApps[pp].xml)) prevPending[state.liveApps[pp].id] = state.liveApps[pp];
    }
    var failure = null;
    for (var id in prevPending) {
      if (!Object.prototype.hasOwnProperty.call(prevPending, id)) continue;
      var still = null;
      for (var k = 0; k < apps.length; k++) {
        if (apps[k].id === id) { still = apps[k]; break; }
      }
      if (still && appIsPending(still.xml)) continue;
      var base = live.redoBase[id];
      var pendingReq = appRequest(prevPending[id].xml);
      var stillReq = still ? appRequest(still.xml) : "";
      if (!still) {
        failure = { kind: "make", id: id, request: pendingReq };
      } else if (base && appMadeAt(still.xml) === base.madeAt) {
        failure = { kind: "redo", id: id, request: base.request, baseMadeAt: base.madeAt };
      } else if (!base && pendingReq && stillReq && stillReq !== pendingReq) {
        /* 页面刷新后重做基线丢了：退回的旧卡需求对不上在途需求，也算失败。 */
        failure = { kind: "redo", id: id, request: pendingReq, baseMadeAt: appMadeAt(still.xml) };
      }
      delete live.redoBase[id];
    }

    state.liveApps = apps;
    if (live.mode && !got && !state.previewSilence) {
      state.data.isDemo = false;
      state.data.dateText = todayTextCN();
      state.data.today = null;
      state.data.secondary = null;
      state.data.history = [];
    }
    if (failure) live.failed = failure;
    else if (apps.length) live.failed = null;
    renderAll();

    var anyPending = false;
    for (var ap = 0; ap < apps.length; ap++) {
      if (appIsPending(apps[ap].xml)) anyPending = true;
    }
    if (anyPending) scheduleAppsPoll();
    else stopAppsPoll();

    if (live.failed) {
      liveBannerEl.hidden = false;
      liveBannerTextEl.textContent = live.failed.kind === "redo"
        ? "重做没成功，原来的还在。"
        : "这次没做成，模型没应答。";
      liveRetryBtn.hidden = live.failed.kind !== "make";
      liveGenRetryBtn.hidden = live.failed.kind !== "redo";
      return;
    }
    liveGenRetryBtn.hidden = true;
    if (state.data.today) {
      liveBannerEl.hidden = apps.length === 0;
      liveRetryBtn.hidden = true;
      if (apps.length) {
        var pending = 0;
        for (var pi = 0; pi < apps.length; pi++) {
          if (appIsPending(apps[pi].xml)) pending++;
        }
        var doneN = apps.length - pending;
        liveBannerTextEl.textContent = doneN
          ? (doneN + " 个小应用" + (pending ? " · " + pending + " 个在做" : ""))
          : ("正在做 " + pending + " 个，几分钟。");
      }
    } else {
      liveBannerEl.hidden = true;
    }
  }

  function loadBridgeLive(quiet) {
    if (!quiet) {
      liveBannerEl.hidden = false;
      liveBannerTextEl.textContent = "正在读取…";
      liveRetryBtn.hidden = true;
    }
    /* 首次进来跑一轮每日引擎（带出每日一句）；轮询只读当日卡，
       不每 6 秒重跑一次引擎。 */
    var raw = "";
    try {
      if (quiet && typeof window.AndroidStorage.appArtifacts === "function") {
        raw = window.AndroidStorage.appArtifacts(todaySlug());
      } else {
        raw = window.AndroidStorage.proactiveTick();
      }
    } catch (e) { raw = ""; }
    var payload = null;
    try { payload = JSON.parse(raw); } catch (e2) { payload = null; }
    /* 每日引擎按进程时区算日期（安卓上是 UTC）；卡片列表改按页面本地
       日期读，跨日时段首次进入也不会看到错日子的卡。 */
    if (payload && payload.ok && !quiet && typeof window.AndroidStorage.appArtifacts === "function") {
      var dayRaw = "";
      try { dayRaw = window.AndroidStorage.appArtifacts(todaySlug()); } catch (e4) { dayRaw = ""; }
      var dayPayload = null;
      try { dayPayload = JSON.parse(dayRaw); } catch (e5) { dayPayload = null; }
      if (dayPayload && dayPayload.ok && dayPayload.artifacts) payload.artifacts = dayPayload.artifacts;
    }
    if (!payload || !payload.ok) {
      if (quiet) {
        live.pollFails++;
        if (live.pollFails < 5) { scheduleAppsPoll(); return; }
      }
      liveBannerEl.hidden = false;
      liveBannerTextEl.textContent = "本机没应答，先看示例。";
      liveRetryBtn.hidden = false;
      return;
    }
    live.pollFails = 0;
    applyLivePayload(payload);
  }

  function loadHttpLive(quiet) {
    var m = /[?&]t=([A-Za-z0-9._~=-]{24,200})/.exec(String(window.location.search || ""));
    if (m) {
      live.token = m[1];
      try { window.localStorage.setItem("oq.live.token", live.token); } catch (e) {}
    } else {
      try { live.token = window.localStorage.getItem("oq.live.token") || ""; } catch (e2) { live.token = ""; }
    }
    if (!live.token) {
      liveBannerEl.hidden = false;
      liveBannerTextEl.textContent = "缺令牌，先看示例。";
      return;
    }
    if (!quiet) {
      liveBannerEl.hidden = false;
      liveBannerTextEl.textContent = "正在读取…";
      liveRetryBtn.hidden = true;
      liveGenRetryBtn.hidden = true;
    }
    fetch("/v1/artifacts/" + todaySlug(), {
      headers: { Accept: "application/json", Authorization: "Bearer " + live.token }
    })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (payload) {
        /* 桥的 tick 回包带 ok；HTTP 的 /v1/artifacts 只回 artifacts，两种都收。 */
        if (!payload || (!payload.ok && !payload.artifacts)) throw new Error("bad payload");
        live.pollFails = 0;
        applyLivePayload(payload);
      })
      .catch(function () {
        if (quiet) {
          live.pollFails++;
          if (live.pollFails < 5) { scheduleAppsPoll(); return; }
        }
        liveBannerEl.hidden = false;
        liveBannerTextEl.textContent = "本机没应答，先看示例。";
        liveRetryBtn.hidden = false;
        liveGenRetryBtn.hidden = true;
      });
  }

  /* ---- 事件绑定 ---- */
  silencePreviewBtn.addEventListener("click", function () {
    state.previewSilence = !state.previewSilence;
    state.rewriting = false;
    state.rewriteError = "";
    renderAll();
    switchView("today", false);
  });

  undoActionBtn.addEventListener("click", undoLastDrop);

  tabToday.addEventListener("click", function () { switchView("today", false); });
  tabHistory.addEventListener("click", function () { switchView("history", false); });
  tabSources.addEventListener("click", function () { switchView("sources", false); });

  liveRetryBtn.addEventListener("click", function () {
    /* 生成失败的重试：把失败的那句话放回做应用的输入框，改一改再交；
       本机没应答的重试才是重新读一次。 */
    var f = live.failed;
    if (f && f.kind === "make") {
      live.failed = null;
      openMakeForm(f.request || "");
      return;
    }
    if (live.mode === "bridge") loadBridgeLive();
    else if (live.mode === "http") loadHttpLive();
  });

  liveGenRetryBtn.addEventListener("click", function () {
    var f = live.failed;
    if (!f || f.kind !== "redo") return;
    live.failed = null;
    liveGenRetryBtn.hidden = true;
    liveRetryBtn.hidden = true;
    liveBannerEl.hidden = false;
    liveBannerTextEl.textContent = "正在重做，做好自动换上来。";
    postAppUpdate(f.id, f.request, function (artifact) {
      live.redoBase[f.id] = { madeAt: f.baseMadeAt || "", request: f.request };
      replaceLiveApp(f.id, artifact);
      renderAll();
      scheduleAppsPoll();
    }, function (message) {
      live.failed = f;
      liveBannerEl.hidden = false;
      liveBannerTextEl.textContent = message || "没提交上，再试一次。";
      liveGenRetryBtn.hidden = false;
    });
  });

  document.addEventListener("keydown", function () {
    document.body.classList.add("is-keyboard");
  }, true);

  document.addEventListener("pointerdown", function () {
    document.body.classList.remove("is-keyboard");
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest(".theme-segmented")) return;
    var order = ["today", "history", "sources"];
    var idx = order.indexOf(state.activeView);
    if (idx === -1) return;
    var next = e.key === "ArrowRight" ? Math.min(order.length - 1, idx + 1) : Math.max(0, idx - 1);
    if (next !== idx) switchView(order[next], true);
  });

  /* ---- 初始化 ---- */
  /* 安卓返回键：先收原文抽屉，再回今天页，最后才退出。 */
  window.advisorBack = function () {
    if (!evidenceBackdrop.hidden) { closeEvidenceSheet(); return true; }
    if (state.activeView !== "today") { switchView("today", false); return true; }
    return false;
  };

  /* 配对深链（openquest://pair?server=…&token=…）：原生侧先入队，
   * 页面就绪后取一次；带 payload 直接调也认。 */
  window.advisorPairLink = function (payload) {
    var bridge = window.AndroidSession;
    if (!bridge || typeof bridge.save !== "function") return;
    var data = payload || null;
    var entryId = 0;
    if (!data) {
      var raw = "";
      try { if (typeof bridge.takePendingPair === "function") raw = bridge.takePendingPair(); } catch (e) { raw = ""; }
      if (!raw) return;
      var env = null;
      try { env = JSON.parse(raw); } catch (e2) { env = null; }
      if (!env) return;
      entryId = env.id || 0;
      if (env.kind === "error") {
        liveBannerEl.hidden = false;
        liveBannerTextEl.textContent = env.message || "这条配对链接无法处理。";
        liveRetryBtn.hidden = true;
        if (entryId && typeof bridge.ackPendingPair === "function") { try { bridge.ackPendingPair(entryId); } catch (e3) {} }
        return;
      }
      data = env.payload || null;
    }
    if (!data || !data.server || !data.token) return;
    var ok = false;
    try { ok = bridge.save(String(data.server), String(data.token), String(data.sandbox || "")); } catch (e4) { ok = false; }
    if (entryId && typeof bridge.ackPendingPair === "function") { try { bridge.ackPendingPair(entryId); } catch (e5) {} }
    liveBannerEl.hidden = false;
    liveBannerTextEl.textContent = ok ? "已通过链接完成配对。" : "链接里的地址或令牌不合规，没有配上。";
    liveRetryBtn.hidden = true;
    if (ok) loadBridgeLive();
  };

  live.mode = detectLiveMode();
  if (live.mode === "bridge") {
    loadModelConfig();
    refreshBridgeSources(false);
    /* 从系统授权页回来时刷新通知开关状态；备注面板开着时不重画，免得打断输入。 */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      refreshBridgeSources(state.activeView === "sources" && !live.photoOpen);
    });
  }
  applyTheme();
  renderAll();
  switchView("today", false);
  if (live.mode === "bridge") {
    loadBridgeLive();
    window.advisorPairLink();
  } else if (live.mode === "http") loadHttpLive();
})();
