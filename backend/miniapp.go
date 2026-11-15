package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/dop251/goja"
)

// 任意小应用：模型按一句话生成巴掌大的本地应用，先过围栏再落库。
// 围栏 2026-11-13 深夜大改革（所有者令「全力以赴……大改革四条枷锁」）：
//   体积 6K→12K；网络与外码放开（应用可取公开资源/引 CDN 库，核心功能仍须离线可用）；
//   存储口升级（键 64、值 4K、keys/remove）；仍禁的只剩真危险项：
//   导航逃逸、嵌套帧、eval、绕过 store 的直存、伪造宿主通道。
// 2026-11-14 追加（所有者令「直接上48kb，且也要做全屏和接口」）：
//   体积 48K；应用可展开全屏（宿主侧）；宿主正规接口 window.oq.loc / window.oq.shot
//   （定位与拍照走宿主通道，应用自己不许碰 navigator 定位或伪造通道）；
//   同一请求当日去重（省重复生成费）。
// 失败重生成一次，再失败降级为文字卡。生成走异步任务（35 分钟预算）。

const (
	maxAppHTMLBytes  = 49152 // 应用主体字节上限（48K：所有者 1114 拍板）
	maxAppTitleRunes = 16
	maxAppPurpRunes  = 80
	maxAppReqRunes   = 240
	maxAppsPerDay    = 20
)

// bannedInAppHTML 是静态围栏：命中即拒，不猜意图。
// 改革后仍禁：导航逃逸（location/链接/表单/window.open）、嵌套帧（iframe/srcdoc）、
// 动态代码（eval/new Function/import）、Worker、绕过 store 的直存、
// 伪造宿主消息通道（postMessage 是宿主与应用之间的专用线）。
var bannedInAppHTML = []string{
	"srcdoc", "<iframe", "importmap", "import(", "eval(", "new function", "worker(",
	"location", "window.open", "<a ", "<a>", "target=", "<form", "<base", "<meta",
	"localstorage", "sessionstorage", "indexeddb", "document.cookie", "postmessage",
	"<embed", "<object",
}

type miniApp struct {
	Title    string `json:"title"`
	Purpose  string `json:"purpose"`
	HTML     string `json:"html"`
	Degraded bool   `json:"degraded"`
}

func validateMiniApp(app miniApp) error {
	if !bounded(app.Title, maxAppTitleRunes) {
		return fmt.Errorf("title 要 1-%d 个字", maxAppTitleRunes)
	}
	if !bounded(app.Purpose, maxAppPurpRunes) {
		return fmt.Errorf("purpose 要一句话（≤%d 字）", maxAppPurpRunes)
	}
	body := strings.TrimSpace(app.HTML)
	if body == "" || len(body) > maxAppHTMLBytes {
		return fmt.Errorf("html 要 1-%d 字节", maxAppHTMLBytes)
	}
	if !utf8.ValidString(body) {
		return errors.New("html 不是有效的 UTF-8")
	}
	lower := strings.ToLower(body)
	for _, ban := range bannedInAppHTML {
		if strings.Contains(lower, ban) {
			return fmt.Errorf("html 里不许出现 %q", ban)
		}
	}
	if err := validateMiniAppScripts(body); err != nil {
		return err
	}
	return nil
}

// validateMiniAppScripts 用真解析器查每个内联 script 的语法：
// 语法坏了的应用在浏览器里整份白屏，禁词围栏查不出来，不能落库。
// 带 src= 的是外部库，交浏览器管，不在本地解析。
var scriptBlock = regexp.MustCompile(`(?is)<script\b([^>]*)>(.*?)</script>`)

func validateMiniAppScripts(body string) error {
	for i, m := range scriptBlock.FindAllStringSubmatch(body, -1) {
		if strings.Contains(strings.ToLower(m[1]), "src=") {
			continue
		}
		if _, err := goja.Parse(fmt.Sprintf("script-%d", i), m[2]); err != nil {
			return fmt.Errorf("第 %d 个 script 语法错误：%v", i+1, err)
		}
	}
	return nil
}

// appInstruction 描述运行时契约与围栏。应用各自现做、各自长相，
// 运行时只注入设计变量和 store 口，不给共享骨架。生成是异步的，
// 想透再做，允许花好几分钟。
func appInstruction(request string, now time.Time) string {
	if appInstructionChinese(request) {
		return "你替一个熟人现做一个巴掌大的本地小应用，跑在他手机的隔离沙盒里。今天是 " +
			now.Format("2006-01-02") + "。生成不限时，想清楚再动手。\n" +
			"这个应用只属于这件事：版式、层级、字阶、控件长相、信息密度都按这件事定，做得像一位匠人单独为它画的。不许套通用仪表盘腔（大数字+进度条+柱状图的固定组合），除非这件事本身要它。\n" +
			"胆子放大：它可以长得像任何东西：一张当票、一枚表盘、一截胶卷、一张电费单、一只信封、一把尺子。先想出一个只属于这件事的视觉主意，再把它做绝；宁可破格，不要四平八稳。\n" +
			"完成度对标世界一流（Anthropic、Apple 这一档，还要再高一寸）：字阶拉开真层级，脚注、正文、大数、巨题各归其位，最重要的信息配最大的字；留白有节奏，密处成块、疏处敢空；主色一锤定音，只用在最要紧的一两处，不到处泼；圆角、描边、按压态、间距全套一致，数字等宽对齐；每个控件都有手感，按下有反馈、点中看得见。高级不等于扁平：界面要有真实的层次和厚度，卡片浮在底面上（阴影有方向、分两级，用注入的 --shadow-1/--shadow-2），控件按下像物理键（微下陷或加深一档），前景中景背景拉开；立体靠光影和材质做，不是发光和渐变堆叠。气质年轻鲜活：饱和的颜色、干脆的块面；克制靠比例、字阶、留白和光影一起立住，不靠把一切压平。\n" +
			"复杂需求直接做全：多类目记账、一周矩阵、计时状态机都放得下：存储有 64 个键、每键值可到 4000 字，列表可以 store.keys() 枚举、store.remove(键) 删。数据结构先想好，别把所有东西塞一个键。\n" +
			"可以联网：GET 公开接口取汇率天气都行，也可以引 https 的图表库和图标；引库必须锁死版本（URL 带版本号），不引会漂移的地址。但两条底线：核心功能断网也要能用（联网只做锦上添花）；不许把用户在本应用里输入的内容发给除了它自己来源以外的任何第三方。\n" +
			"两个宿主接口随取随用：window.oq.loc(回调) 定位一次，回调收到 {lat,lon,acc}，用户不给权限就收到 null；window.oq.shot(回调) 拍一张照片，回调收到 {img 是 data:image 地址, w, h}，取消收到 null。接口拿不到时功能要能降级，不许卡死界面等它；照片和坐标只在本应用里用，绝不出门。照片存不进 store（太大），当次用掉就好。\n" +
			"宿主是一张暖纸画布、钴蓝主色、衬线大数字的编辑气质；你的应用可以另立世界，但要像长在同一台手机上。运行时已注入：字体与复位样式；设计变量 var(--accent) 主色、var(--accent-rgb) 主色 RGB、var(--ink) 墨色、var(--ink-rgb) 墨色 RGB、var(--shadow-1)/var(--shadow-2) 两级浮起阴影（亮暗主题自动适配）。自己画的部分颜色用这些变量和 rgba(var(--ink-rgb)/var(--accent-rgb), 透明度)；这件事要更鲜艳的主色时，可以改写 :root 里自己的 --accent 和 --accent-rgb（饱和明快的一种颜色，但朱砂红和纸面红这种组合永久不许用，换青、绿、琥珀、蓝紫都行），亮暗两个主题下都保持对比度达标；引外部库样式不受此限。你写 <style> 和 <body> 内容。\n" +
			"存取只走 store：store.get(键, 默认值) 立即返回保存过的值；store.set(键, 值) 落到本地；store.keys() 返回全部键；store.remove(键) 删一个。键 ≤ 64 字符，值是数字或 ≤ 4000 字符的字符串。先读后存，别在内存里另放一份数据。\n" +
			"首屏放主操作；内容多就分成几个视图（页签或分段切换）来回切，用户还能把应用展开成全屏细看，全屏里放得下完整的多视图。行为用内联 <script> 或 onclick 属性写，改动后立即重画；图形用 CSS 画或用文字。\n" +
			"对真人好用是硬要求，但无障碍不等于迁就，它与美是同一门手艺：对比度靠笃实的墨色配干净的底色做出来，不是灰上加灰；大触控目标做出节奏和块面感，不是一排笨方块。用户绝大多数是年轻人，但无障碍照样做足：单手、烈日下、小屏幕、偶尔给爸妈看一眼，全都用得上，宁可字大行宽也不许费眼：正文 ≥ 15px 且主要信息更大；文字与背景对比度 ≥ 4.5:1（≥18px 加粗可 3:1），墨色文字用 var(--ink) 或 rgba(var(--ink-rgb),.85) 以上，不许自造更淡的灰，从外部引入的颜色同样要过这一关；亮暗两个主题都要清楚。触控目标 ≥ 44px，可点的东西互相留空防误触，用 button 元素，配 :active 按下反馈和看得见的 :focus 样式。状态不许只靠颜色区分，漏做、完成、选中要配文字或形状。图片带 alt 文字，标题一层一层来不跳级，一类控件只用一套长相。装饰性图形 aria-hidden，按钮文字就是动作本身，不写「点这里」。不用闪烁、摇晃、视差、滚动淡入或循环晃眼的动画；字号放大或屏幕变窄时内容重排不溢出。\n" +
			"设计不许偷懒：不用装饰 emoji、发光、渐变堆叠，不把所有元素都做成圆角胶囊；每个控件都有真行为。文案说人话：短句、具体词，按钮标签用动词或名词本身，不写口号，不写『让生活更美好』式的收尾，不编造没有的数字。按钮文字至少两个字，不许只有一个字；没有必要时按钮干脆不放文字，用图标配 aria-label。日历的星期表头写周一到周日，不写单个字。\n" +
			"硬规矩，违反会被整份拒绝：内容里不出现 location <a <form <iframe <base <meta import( eval( localstorage document.cookie postmessage 等任何跳转、嵌套帧、动态代码、直存、伪造宿主通道的字样（<style> 与 <script> 里同样不许；定位和拍照只走上面两个宿主接口）；html 总长 ≤ 48000 字节（含样式与引用）。\n" +
			"用户这句话是需求：" + request + "\n" +
			"照它现做一个具体能用的小应用。title ≤ 12 字是应用名，purpose 一句话说它帮什么忙。做不了或不像话就返回空 app。"
	}
	return "You build a palm-sized local mini-app for someone you know. It runs in a sandboxed frame on their phone. Today is " +
		now.Format("Mon, 2006-01-02") + ". Generation is asynchronous: think it through, take minutes if needed.\n" +
		"The app belongs to this one task: its layout, hierarchy, type scale, controls and density are drawn for it, as if a craftsman designed it alone. No generic dashboard formula (big number + progress bar + bar chart) unless the task itself demands it.\n" +
		"Be bold: it may look like anything at all: a ticket stub, a dial, a film strip, a utility bill, an envelope, a ruler. Start from one visual idea only this task could own, then push it all the way; audacious beats safe.\n" +
		"Finish one step above the best consumer products (the bar is Anthropic or Apple, then one step higher): a type scale with true hierarchy, footnote, body, figure and display each in its place and the key number or word set largest; whitespace with rhythm, dense blocks against generous emptiness; one accent used decisively on the one or two moments that matter most, never splashed everywhere; radii, strokes, press states and spacing consistent throughout; tabular figures so numbers align; every control feels good under a thumb, with a visible press state. Premium is not flat: give the surface real depth, cards lift off the ground with directional shadows on two levels (use the injected --shadow-1/--shadow-2), controls press in like physical keys, foreground, midground and ground pull apart; depth comes from light and material, never from glows or stacked gradients. Keep it young and alive, saturated colour, decisive blocks; restraint is carried by proportion, type, space and shadow together, not by flattening everything.\n" +
		"Build complex needs in full: category ledgers, week matrices, timer state machines all fit: storage gives you 64 keys, values up to 4000 chars, store.keys() to enumerate, store.remove(key) to delete. Design the data shape first; do not cram everything into one key.\n" +
		"Networking is allowed: GET public APIs, load https chart or icon libraries, pinned versions only (the version in the URL), never a floating address. Two lines you must not cross: the core functions keep working offline (network is garnish); never send what the user types into this app to any third party.\n" +
		"Two host interfaces are there when needed: window.oq.loc(cb) returns one position fix, the callback receives {lat,lon,acc} or null when permission is denied; window.oq.shot(cb) takes one photo, the callback receives {img as a data:image address, w, h} or null when cancelled. When a call comes back null the feature degrades and the interface never blocks waiting; photos and coordinates stay inside this app and never leave it (a photo is too big for store, use it in the moment).\n" +
		"The host is a warm paper canvas with a cobalt accent and serif display numerals; your app may build its own world, but it should feel grown on the same phone. The runtime already injects a font and reset, plus design tokens var(--accent), var(--accent-rgb), var(--ink), var(--ink-rgb) and two elevation shadows var(--shadow-1)/var(--shadow-2) (they follow light/dark automatically). For your own drawing use these tokens and rgba(var(--ink-rgb)/var(--accent-rgb), alpha); when the task wants a more vivid accent you may rewrite --accent and --accent-rgb in :root with one saturated colour of your own (never a vermilion or cinnabar red on paper tones; teal, green, amber or indigo all work), as long as both themes keep the contrast minimums; pulled libraries are exempt. You write the <style> and the <body>.\n" +
		"Data only through store: store.get(key, fallback) returns the saved value at once; store.set(key, value) persists locally; store.keys() lists keys; store.remove(key) deletes one. Keys ≤ 64 chars, values numbers or strings ≤ 4000 chars. Read first, then write; keep no second copy in memory.\n" +
		"The main action sits on the first screen; split larger content into views the user switches between, and remember the app can be expanded fullscreen, where full multi-view layouts fit. Behaviour goes in inline <script> or onclick attributes; redraw right after each change; draw graphics in CSS or text.\n" +
		"Good for real humans is a hard requirement, and accessibility is part of doing it well: contrast comes from confident ink on a clean ground, never grey on grey; large touch targets create rhythm and mass, not a row of dull blocks. The users are mostly young, and accessibility still gets done in full: one hand, bright sun, small screens, the occasional glance from a parent all count, and generous type beats strained eyes: body text ≥ 15px with key information larger; text-to-background contrast ≥ 4.5:1 (3:1 for ≥18px bold); ink text uses var(--ink) or rgba(var(--ink-rgb),.85) or darker, never a paler grey you invented, and colours pulled from outside must pass the same test; both light and dark themes must stay legible. Touch targets ≥ 44px with breathing room between them, built as button elements, with a visible :active press state and a visible :focus style. State must never be colour alone: missed, done, selected also carry text or shape. Pictures carry alt text, headings step one level at a time, and each control kind keeps one look. Decorative graphics get aria-hidden; button labels are the action itself, never \"click here\". No flashing, shaking, parallax, scroll-fade or endlessly animating effects; content reflows without overflow when type scales up or the screen narrows.\n" +
		"No lazy design: no decorative emoji, glows or stacked gradients, not everything becomes a rounded pill; every control does something real. Copy talks like a person: short sentences, concrete words, button labels are verbs or nouns, no slogans, no \"make life better\" endings, no invented numbers. Button labels run at least two characters, never a single character; when words add nothing, use an icon with an aria-label instead. Calendar weekday headers read 周一 through 周日, never a lone character.\n" +
		"Hard rules, the whole output is rejected on any hit: no location <a <form <iframe <base <meta import( eval( localstorage document.cookie postmessage anywhere including <style> and <script> (position and photos go only through the two host interfaces above); no navigation, nested frames, dynamic code, direct storage or forged host channel; total html ≤ 48000 bytes including styles and references.\n" +
		"The request: " + request + "\n" +
		"Build one concrete usable app for it. title ≤ 12 chars names it; purpose says in one sentence what it helps with. If it cannot be done well, return an empty app."
}

func appInstructionChinese(request string) bool {
	han, letters := 0, 0
	for _, r := range request {
		if unicode.IsLetter(r) {
			letters++
		}
		if unicode.Is(unicode.Han, r) {
			han++
		}
	}
	return han*2 > letters
}

func appFormat() map[string]any {
	app := map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"title", "purpose", "html"},
		"properties": map[string]any{
			"title":   map[string]string{"type": "string"},
			"purpose": map[string]string{"type": "string"},
			"html":    map[string]string{"type": "string"},
		},
	}
	schema := map[string]any{
		"type": "object", "additionalProperties": false, "required": []string{"app"},
		"properties": map[string]any{"app": app},
	}
	return map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "mini_app", "strict": true, "schema": schema}}
}

// callAppModel 打一次模型，解析出 app。传输细节与 ReadWithModel 同源同规矩。
func callAppModel(ctx context.Context, client *http.Client, endpoint, model, key, system string) (miniApp, error) {
	body, err := json.Marshal(map[string]any{
		"model": model, "messages": []readingMessage{{"system", system}, {"user", "做这个应用"}},
		"stream": false, "temperature": 0, "response_format": appFormat(),
	})
	if err != nil {
		return miniApp{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(body)))
	if err != nil {
		return miniApp{}, errors.New("模型接口地址无效")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	caller := http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	if client != nil {
		// 只借 Transport：小应用生成常超 90 秒，共享 client 的硬超时会先于
		// ctx 截断请求，让调用方传入的 ctx 当唯一的钟。
		caller.Transport = client.Transport
	}
	resp, err := caller.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return miniApp{}, ctx.Err()
		}
		return miniApp{}, errors.New("无法连接配置的模型服务")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return miniApp{}, fmt.Errorf("模型接口返回 HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxModelResponse+1))
	if err != nil || len(data) > maxModelResponse {
		return miniApp{}, errors.New("模型回复过大或读取失败")
	}
	var completion struct {
		Choices []struct {
			Message readingMessage `json:"message"`
		} `json:"choices"`
	}
	if json.Unmarshal(data, &completion) != nil || len(completion.Choices) == 0 {
		return miniApp{}, errors.New("无法读取模型接口的回复")
	}
	content := strings.TrimSpace(completion.Choices[0].Message.Content)
	if strings.HasPrefix(content, "```json\n") && strings.HasSuffix(content, "\n```") {
		content = strings.TrimSuffix(strings.TrimPrefix(content, "```json\n"), "\n```")
	}
	var result struct {
		App miniApp `json:"app"`
	}
	if json.Unmarshal([]byte(content), &result) != nil {
		return miniApp{}, errors.New("模型没有返回合规的应用")
	}
	return result.App, nil
}

// MakeMiniApp：生成 → 校验 → 失败带上原因重试一次 → 再失败降级文字卡。
// 返回的应用要么过了围栏，要么 Degraded。
func MakeMiniApp(ctx context.Context, client *http.Client, endpoint, model, key, request string, now time.Time) (miniApp, int, error) {
	return MakeMiniAppVariant(ctx, client, endpoint, model, key, request, now, "")
}

// MakeMiniAppVariant 在指令尾部追加额外要求（重做任务用它声明键兼容）。
func MakeMiniAppVariant(ctx context.Context, client *http.Client, endpoint, model, key, request string, now time.Time, extra string) (miniApp, int, error) {
	system := appInstruction(request, now) + extra
	app, err := callAppModel(ctx, client, endpoint, model, key, system)
	if err != nil {
		return miniApp{}, 0, err
	}
	firstErr := validateMiniApp(app)
	if firstErr == nil {
		return app, 1, nil
	}
	retry, err := callAppModel(ctx, client, endpoint, model, key,
		system+"\n上一次的输出违反了规则（"+firstErr.Error()+"），重新给一个合规的 app。")
	if err != nil {
		return miniApp{}, 0, err
	}
	if e := validateMiniApp(retry); e == nil {
		return retry, 2, nil
	}
	return miniApp{
		Title:    "小应用没做成",
		Purpose:  request,
		HTML:     "",
		Degraded: true,
	}, 2, nil
}

// saveMiniApp 落成当日 artifact，通用渲染器按 type="app" 取。
func (s *Store) saveMiniApp(user string, app miniApp, request string, now time.Time) (Artifact, error) {
	today := now.Format("2006-01-02")
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM artifacts WHERE user_id=? AND date=? AND type='app'`, user, today).Scan(&n); err != nil {
		return Artifact{}, err
	}
	return s.saveMiniAppSeq(user, app, request, today, now, n+1)
}

// appForRequest 找当天同请求的现成应用（省费去重：同一句话不生成第二遍）。
// 降级卡不算数（那次没做成，用户再问应该真做一次）。
func (s *Store) appForRequest(user, date, request string) (Artifact, bool) {
	rows, err := s.db.Query(`SELECT id,date,type,xml FROM artifacts WHERE user_id=? AND date=? AND type='app'`, user, date)
	if err != nil {
		return Artifact{}, false
	}
	defer rows.Close()
	want := "<request>" + xmlEscape(request) + "</request>"
	for rows.Next() {
		var a Artifact
		if err := rows.Scan(&a.ID, &a.Date, &a.Type, &a.XML); err != nil {
			continue
		}
		if strings.Contains(a.XML, want) && !strings.Contains(a.XML, "<degraded>1</degraded>") {
			return a, true
		}
	}
	return Artifact{}, false
}

// miniAppXML 是 app artifact 的唯一拼装点：HTTP 与设备 worker 共用，
// 两边落库的卡形状不会走样。
func miniAppXML(app miniApp, request string, now time.Time) string {
	degraded := "0"
	if app.Degraded {
		degraded = "1"
	}
	return "<app><title>" + xmlEscape(app.Title) + "</title><purpose>" + xmlEscape(app.Purpose) +
		"</purpose><request>" + xmlEscape(request) + "</request><html>" + xmlEscape(app.HTML) +
		"</html><made-at>" + now.UTC().Format(time.RFC3339) + "</made-at><degraded>" + degraded + "</degraded></app>"
}

// saveMiniAppSeq 按异步任务预留的序号落库：并发任务完成顺序不定，
// 序号在受理时定死，id 才不撞车。
func (s *Store) saveMiniAppSeq(user string, app miniApp, request, date string, now time.Time, seq int) (Artifact, error) {
	today := strings.TrimSpace(date)
	if today == "" {
		today = now.Format("2006-01-02")
	}
	row := Artifact{ID: fmt.Sprintf("app:%s:%s:%02d", user, today, seq), Date: today, Type: "app", XML: miniAppXML(app, request, now)}
	if err := s.upsertArtifact(user, row); err != nil {
		return Artifact{}, err
	}
	return row, nil
}
