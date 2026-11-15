/* 任意小应用 · 通用渲染器
 * 后端已过四条围栏（体积/不出网/不拉外部代码/数据只走存取口），
 * 这里再上第二道：沙盒 iframe（无同源、无弹窗、无顶层导航）+ 严格 CSP。
 * 内置小运行时（默认样式、store 存取、高度回报）由渲染器注入，
 * 模型只填内容，省 token。
 * 任何前端都可以用：OQApp.mount(容器, artifactXML, appId)
 */
(function () {
  "use strict";

  /* 小应用配色随宿主：读宿主的 --accent/--ink（亮暗都跟），读不出退回默认。 */
  function hostToken(name, fallback) {
    try {
      var v = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) return v;
    } catch (e) {}
    return fallback;
  }

  /* 宿主的阴影是一层暖色方向光，整串借过来，小应用和宿主落在同一层光里。 */
  function hostRaw(name, fallback) {
    try {
      var v = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      if (v && v.length < 160 && v.indexOf("url(") === -1 && v.indexOf(";") === -1 && v.indexOf("}") === -1) return v;
    } catch (e) {}
    return fallback;
  }

  function hexToRgba(hex, alpha) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  /* 给 rgba(var(--x-rgb), 透明度) 用的三元组，别从 rgba() 字符串里截，会少一位。 */
  function hexRgb(hex) {
    return parseInt(hex.slice(1, 3), 16) + "," + parseInt(hex.slice(3, 5), 16) + "," + parseInt(hex.slice(5, 7), 16);
  }

  /* 宿主当前这一套令牌，挂载时注入，系统换主题时再递一次。 */
  function themeTokens() {
    var accent = hostToken("--accent", "#2F4FE0");
    var ink = hostToken("--ink", "#1B1C2A");
    var inkRgb = hexRgb(ink);
    return {
      accent: accent,
      accentRgb: hexRgb(accent),
      ink: ink,
      inkRgb: inkRgb,
      shadow1: hostRaw("--shadow-1", "0 1px 2px rgba(" + inkRgb + ",.12),0 2px 8px rgba(" + inkRgb + ",.08)"),
      shadow2: hostRaw("--shadow-2", "0 2px 6px rgba(" + inkRgb + ",.16),0 10px 28px rgba(" + inkRgb + ",.12)")
    };
  }

  /* 每个小应用自己长自己的样：运行时只递设计变量和存取口，不给共享骨架。
   * 复位层是「底子」不是「风格」：好字体、等宽数字、能用的焦点环、
   * 图片不撑破、动效可关，这些不决定长相，但每个应用都白得。 */
  function runtimeCss() {
    var t = themeTokens();
    /* 两级浮起：方向朝下、近深远浅，模型直接引用就有体面层次。
     * 宿主有自己的一套暖色方向光，优先整串借用；读不到才用墨色现调。 */
    return [
      "*{box-sizing:border-box;margin:0}",
      ":root{--accent:" + t.accent + ";--accent-rgb:" + t.accentRgb + ";" +
        "--ink:" + t.ink + ";--ink-rgb:" + t.inkRgb + ";" +
        "--shadow-1:" + t.shadow1 + ";" +
        "--shadow-2:" + t.shadow2 + "}",
      "html{-webkit-text-size-adjust:100%}",
      "body{font:15px/1.6 -apple-system,BlinkMacSystemFont,'MiSans','HarmonyOS Sans SC','PingFang SC','Noto Sans CJK SC','Noto Sans SC','Segoe UI',sans-serif;" +
        "color:var(--ink);padding:14px;background:transparent;" +
        "-webkit-font-smoothing:antialiased;font-feature-settings:'tnum' 1}",
      "img,svg,video,canvas{max-width:100%}",
      "button,input,select,textarea{font:inherit;color:inherit}",
      "button{cursor:pointer}",
      ":focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
      "::selection{background:rgba(var(--accent-rgb),.22)}",
      "@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;" +
        "animation-iteration-count:1!important;transition-duration:.01ms!important}}"
    ].join("");
  }

  function runtimeJS(dataLiteral) {
    /* 存储契约：键 ≤64、值 ≤4000 字符，keys()/remove() 供列表类应用枚举和删。
     * 宿主侧另有总量护栏。 */
    return "(function(){var DATA=" + dataLiteral + ";" +
      "window.store={get:function(k,fb){return Object.prototype.hasOwnProperty.call(DATA,k)?DATA[k]:fb;}," +
      "set:function(k,v){if(typeof k!==\"string\"||k.length>64)return;" +
      "if(typeof v===\"number\"){if(!isFinite(v))return;}" +
      "else if(typeof v===\"string\"){if(v.length>4000)v=v.slice(0,4000);}" +
      "else if(v!==true&&v!==false)return;" +
      "DATA[k]=v;try{parent.postMessage({__oqapp:1,cmd:\"set\",key:k,value:v},\"*\");}catch(e){}}," +
      "keys:function(){return Object.keys(DATA);}," +
      "remove:function(k){delete DATA[k];try{parent.postMessage({__oqapp:1,cmd:\"del\",key:k},\"*\");}catch(e){}}};" +
      "function report(){try{parent.postMessage({__oqapp:1,cmd:\"size\",h:Math.max(48,document.body.scrollHeight)},\"*\");}catch(e){}}" +
      /* 宿主正规接口（1114）：定位与拍照走宿主通道，应用自己碰不到这些权限。
       * 回调只响一次，20 秒没回音按 null 算，功能自行降级不卡界面。 */
      "var CB={},RID=0;" +
      "function ask(cmd,cb){RID++;var id=\"r\"+RID;CB[id]=cb;" +
      "try{parent.postMessage({__oqapp:1,cmd:cmd,rid:id},\"*\");}catch(e){delete CB[id];cb(null);return;}" +
      "setTimeout(function(){if(CB[id]){delete CB[id];cb(null);}},20000);}" +
      /* 系统换亮暗时宿主会再递一套令牌；只改运行时那一层，
       * 应用自己在 :root 里改写过的配色仍然盖得住。 */
      "function setTheme(t){var el=document.getElementById(\"oq-tokens\");if(!el||!t)return;" +
      "el.textContent=\":root{--accent:\"+t.accent+\";--accent-rgb:\"+t.accentRgb+\";--ink:\"+t.ink+\";--ink-rgb:\"+t.inkRgb+\";--shadow-1:\"+t.shadow1+\";--shadow-2:\"+t.shadow2+\"}\";}" +
      "window.addEventListener(\"message\",function(e){" +
      "var d=e.data;if(!d||d.__oqapp!==1)return;" +
      "if(d.cmd===\"theme\"){setTheme(d.theme);return;}" +
      "if(!d.rid)return;var cb=CB[d.rid];" +
      "if(cb){delete CB[d.rid];cb(d.data===undefined?null:d.data);}});" +
      "window.oq={loc:function(cb){ask(\"loc\",cb)},shot:function(cb){ask(\"shot\",cb)}};" +
      "window.addEventListener(\"load\",report);" +
      "document.addEventListener(\"DOMContentLoaded\",report);" +
      "setInterval(report,800);})();";
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function dataLiteralFor(saved) {
    var json;
    try { json = JSON.stringify(saved || {}); } catch (e) { json = "{}"; }
    var ls = String.fromCharCode(8232), ps = String.fromCharCode(8233);
    return json
      .split("<").join("\\u003c")
      .split(ls).join("\\u2028")
      .split(ps).join("\\u2029");
  }

  function storageKey(appId) { return "oq.app.data:" + appId; }

  function loadSaved(appId) {
    try { return JSON.parse(localStorage.getItem(storageKey(appId)) || "{}"); } catch (e) { return {}; }
  }

  function saveAll(appId, map) {
    try { localStorage.setItem(storageKey(appId), JSON.stringify(map)); } catch (e) { /* 满了就算了 */ }
  }

  function parseAppXML(xml) {
    var doc = null;
    try { doc = new DOMParser().parseFromString(xml, "application/xml"); } catch (e) { return null; }
    if (!doc || doc.getElementsByTagName("parsererror").length) return null;
    var pick = function (tag) {
      var rows = doc.getElementsByTagName(tag);
      return rows.length ? (rows[0].textContent || "") : "";
    };
    return {
      title: pick("title"),
      purpose: pick("purpose"),
      request: pick("request"),
      html: pick("html"),
      degraded: pick("degraded") === "1",
      pending: pick("status") === "pending",
      madeAt: pick("made-at")
    };
  }

  /* 静态双保险：后端拒过的字样，渲染前再扫一遍（防手工塞库）。
   * 大改革后网络与外码放行，仍拦真危险项：跳转、嵌套帧、动态代码、直存、伪造宿主通道。 */
  function secondLook(html) {
    var lower = html.toLowerCase();
    var bans = ["srcdoc", "<iframe", "import(", "eval(", "new function", "location", "<a ", "<form", "<base", "<meta", "localstorage", "document.cookie", "postmessage", "<embed", "<object"];
    for (var i = 0; i < bans.length; i++) {
      if (lower.indexOf(bans[i]) !== -1) return false;
    }
    return true;
  }

  function hostStyles() {
    if (document.getElementById("oq-app-styles")) return;
    var css = ".oq-app{border-radius:14px;overflow:hidden}" +
      ".oq-app-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:0 2px 6px}" +
      ".oq-app-title{font-size:13px;font-weight:600;opacity:.85}" +
      ".oq-app-purpose{font-size:12px;opacity:.55}" +
      ".oq-app-reset{font-size:12px;opacity:.5;background:none;border:none;cursor:pointer;color:inherit;padding:0}" +
      ".oq-app-acts{display:flex;gap:10px;align-items:baseline;flex:none}" +
      ".oq-app-act{font-size:12px;opacity:.6;background:none;border:none;cursor:pointer;color:inherit;padding:0}" +
      ".oq-fs-back{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}" +
      ".oq-fs-sheet{width:100%;max-width:780px;height:100%;display:flex;flex-direction:column;background:var(--ground,#F4EDE1)}" +
      ".oq-fs-bar{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:calc(10px + env(safe-area-inset-top)) 14px 8px}" +
      ".oq-fs-title{font-size:14px;font-weight:600;color:var(--ink,#1B1C2A)}" +
      ".oq-fs-close{font-size:13px;color:var(--accent-ink,#FFFFFF);background:var(--accent,#2F4FE0);border:none;border-radius:999px;padding:7px 16px;cursor:pointer}" +
      ".oq-fs-frame{flex:1;width:100%;border:0;background:transparent}" +
      ".oq-app-frame{width:100%;border:0;display:block;background:" + hexToRgba(hostToken("--ink", "#1B1C2A"), ".04") + ";border-radius:12px}" +
      ".oq-app-note{font-size:13px;opacity:.7;line-height:1.6}" +
      ".oq-app-pending .oq-app-note{opacity:.45;font-style:italic}";
    var st = document.createElement("style");
    st.id = "oq-app-styles";
    st.textContent = css;
    document.head.appendChild(st);
  }

  function mount(container, xml, appId, options) {
    options = options || {};
    hostStyles();
    var box = document.createElement("div");
    box.className = "oq-app";
    container.appendChild(box);
    var app = parseAppXML(xml);
    if (!app) { app = { title: "小应用", purpose: "", request: "", html: "", degraded: true }; }

    var head = document.createElement("div");
    head.className = "oq-app-head";
    var title = document.createElement("span");
    title.className = "oq-app-title";
    title.textContent = app.title || "小应用";
    var purpose = document.createElement("span");
    purpose.className = "oq-app-purpose";
    purpose.textContent = app.purpose || "";
    head.appendChild(title);
    head.appendChild(purpose);
    box.appendChild(head);

    /* 异步在途：占位卡，不建帧。轮询到成品后原位换真应用。 */
    if (app.pending) {
      box.classList.add("oq-app-pending");
      var note = document.createElement("p");
      note.className = "oq-app-note";
      note.textContent = "正在现做，做好自动出现在这儿。";
      box.appendChild(note);
      return { box: box };
    }

    if (app.degraded || !app.html.trim() || !secondLook(app.html)) {
      var note = document.createElement("p");
      note.className = "oq-app-note";
      note.textContent = app.degraded
        ? "这次没做成能跑的小应用，先把这句话记在这儿。"
        : "这份小应用没过安全检查，先不运行。";
      box.appendChild(note);
      return { box: box };
    }

    var frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("title", app.title || "小应用");
    frame.className = "oq-app-frame";
    frame.style.height = "120px";
    box.appendChild(frame);

    var acts = document.createElement("span");
    acts.className = "oq-app-acts";
    if (typeof options.onRedo === "function") {
      var redo = document.createElement("button");
      redo.type = "button";
      redo.className = "oq-app-act";
      redo.textContent = "重做";
      redo.addEventListener("click", function () {
        options.onRedo({ id: appId, title: app.title, request: app.request, madeAt: app.madeAt });
      });
      acts.appendChild(redo);
    }
    var expand = document.createElement("button");
    expand.type = "button";
    expand.className = "oq-app-act";
    expand.textContent = "全屏";
    var reset = document.createElement("button");
    reset.type = "button";
    reset.className = "oq-app-act";
    reset.textContent = "重置";
    acts.appendChild(expand);
    acts.appendChild(reset);
    head.appendChild(acts);

    attachHost(frame, appId, {});
    frame.setAttribute("srcdoc", frameDoc(app, appId));

    reset.addEventListener("click", function () {
      try { localStorage.removeItem(storageKey(appId)); } catch (e) {}
      frame.setAttribute("srcdoc", frameDoc(app, appId));
    });
    expand.addEventListener("click", function () {
      openFullscreen(app, appId, expand);
    });

    return { box: box, frame: frame };
  }

  /* 帧文档（卡片与全屏共用一份）：应用自己的 CSP（大改革后开网），
   * 可引 https 库与图、可连 http(s) 接口，仍禁嵌套帧与插件；
   * srcdoc 同时继承宿主页策略，宿主页已同步开放。 */
  function frameDoc(app, appId) {
    return "<!doctype html><html><head><meta charset=\"utf-8\">" +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline' https:; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:; connect-src http: https:; object-src 'none'; base-uri 'none'; form-action 'none'\">" +
      "<style id=\"oq-tokens\">" + runtimeCss() + "</style></head><body><script>" +
      runtimeJS(dataLiteralFor(loadSaved(appId))) +
      "</script>" + app.html + "</body></html>";
  }

  /* 宿主侧通道：存取护栏 + 高度回报 + 定位/拍照正规接口（1114）。 */
  function attachHost(frame, appId, opts) {
    function onMessage(e) {
      var d = e.data;
      if (!d || d.__oqapp !== 1 || e.source !== frame.contentWindow) return;
      if (d.cmd === "size" && typeof d.h === "number") {
        if (!opts.noSizeCap) frame.style.height = Math.max(60, Math.min(720, d.h)) + "px";
        return;
      }
      if (d.cmd === "del" && typeof d.key === "string" && d.key.length <= 64) {
        var map2 = loadSaved(appId);
        delete map2[d.key];
        saveAll(appId, map2);
        return;
      }
      if (d.cmd === "set" && typeof d.key === "string" && d.key.length <= 64) {
        var v = d.value;
        var ok = typeof v === "number" || typeof v === "boolean" ||
          (typeof v === "string" && v.length <= 4096);
        if (!ok) return;
        var map = loadSaved(appId);
        var keys = 0;
        var total = 0;
        for (var k in map) {
          if (Object.prototype.hasOwnProperty.call(map, k)) {
            keys++;
            total += (typeof map[k] === "string" ? map[k].length : 8) + k.length;
          }
        }
        /* 总量护栏：键数 256、总量约 160KB，超出不再收。 */
        if (!Object.prototype.hasOwnProperty.call(map, d.key) && keys >= 256) return;
        if (total + String(v).length + d.key.length > 160000) return;
        map[d.key] = v;
        saveAll(appId, map);
        return;
      }
      if (d.cmd === "loc" && typeof d.rid === "string") {
        hostLocation(function (pos) { reply(frame, d.rid, pos); });
        return;
      }
      if (d.cmd === "shot" && typeof d.rid === "string") {
        hostShot(function (pic) { reply(frame, d.rid, pic); });
      }
    }
    window.addEventListener("message", onMessage);

    /* 系统亮暗切换时，帧里的注入令牌不会自己变；宿主再递一套，
     * 应用自己的纸面和它自己的 :root 覆盖都保留。 */
    var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    function sendTheme() {
      var t = themeTokens();
      frame.style.background = "rgba(" + t.inkRgb + ",.04)";
      try { frame.contentWindow.postMessage({ __oqapp: 1, cmd: "theme", theme: t }, "*"); } catch (e) {}
    }
    frame.addEventListener("load", sendTheme);
    if (mq) {
      if (mq.addEventListener) mq.addEventListener("change", sendTheme);
      else if (mq.addListener) mq.addListener(sendTheme);
    }

    /* 全屏帧收起时把监听一起撤掉，开合多次不堆监听。 */
    return function dispose() {
      window.removeEventListener("message", onMessage);
      frame.removeEventListener("load", sendTheme);
      if (mq) {
        if (mq.removeEventListener) mq.removeEventListener("change", sendTheme);
        else if (mq.removeListener) mq.removeListener(sendTheme);
      }
    };
  }

  function reply(frame, rid, data) {
    try { frame.contentWindow.postMessage({ __oqapp: 1, rid: rid, data: data }, "*"); } catch (e) {}
  }

  /* 定位：沙盒里的应用没有定位权限，宿主拿一次坐标递进去；
   * 拿不到（拒绝/不支持/超时）一律 null，应用自己降级。 */
  function hostLocation(cb) {
    if (!navigator.geolocation) { cb(null); return; }
    navigator.geolocation.getCurrentPosition(function (p) {
      cb({
        lat: +p.coords.latitude.toFixed(5),
        lon: +p.coords.longitude.toFixed(5),
        acc: Math.round(p.coords.accuracy)
      });
    }, function () { cb(null); }, { timeout: 12000, maximumAge: 60000 });
  }

  /* 拍照：宿主起相机（桌面退化为选图），压到长边 1280 再递给应用；
   * 原图几 MB 应用拿不动，也存不进 store，当次用掉。 */
  function hostShot(cb) {
    var inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.setAttribute("capture", "environment");
    inp.style.position = "fixed";
    inp.style.left = "-9999px";
    inp.addEventListener("change", function () {
      if (inp.parentNode) inp.parentNode.removeChild(inp);
      var f = inp.files && inp.files[0];
      if (!f) { cb(null); return; }
      var rd = new FileReader();
      rd.onload = function () {
        var img = new Image();
        img.onload = function () {
          var s = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
          var cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(img.naturalWidth * s));
          cv.height = Math.max(1, Math.round(img.naturalHeight * s));
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          cb({ img: cv.toDataURL("image/jpeg", 0.85), w: cv.width, h: cv.height });
        };
        img.onerror = function () { cb(null); };
        img.src = String(rd.result);
      };
      rd.onerror = function () { cb(null); };
      rd.readAsDataURL(f);
    });
    document.body.appendChild(inp);
    inp.click();
  }

  /* 全屏模式：同一份应用文档铺满屏幕，Esc/收起退回，焦点有去有回。 */
  function openFullscreen(app, appId, fromBtn) {
    var back = document.createElement("div");
    back.className = "oq-fs-back";
    var sheet = document.createElement("div");
    sheet.className = "oq-fs-sheet";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-label", (app.title || "小应用") + " 全屏");
    var bar = document.createElement("div");
    bar.className = "oq-fs-bar";
    var title = document.createElement("span");
    title.className = "oq-fs-title";
    title.textContent = app.title || "小应用";
    var close = document.createElement("button");
    close.type = "button";
    close.className = "oq-fs-close";
    close.textContent = "收起";
    bar.appendChild(title);
    bar.appendChild(close);
    var frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("title", app.title || "小应用");
    frame.className = "oq-fs-frame";
    sheet.appendChild(bar);
    sheet.appendChild(frame);
    back.appendChild(sheet);
    document.body.appendChild(back);
    var dispose = attachHost(frame, appId, { noSizeCap: true });
    frame.setAttribute("srcdoc", frameDoc(app, appId));
    function shut() {
      if (back.parentNode) back.parentNode.removeChild(back);
      document.removeEventListener("keydown", onKey);
      dispose();
      if (fromBtn) fromBtn.focus();
    }
    function onKey(e) { if (e.key === "Escape") shut(); }
    document.addEventListener("keydown", onKey);
    close.addEventListener("click", shut);
    close.focus();
  }

  window.OQApp = { mount: mount };
})();
