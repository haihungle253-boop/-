/* 中学科二速记 · app.js
   路由：hash-based（#/home, #/chapter/:cid, #/chapter/:cid/section/:sid,
        #/flash, #/flash/run, #/quiz, #/quiz/run, #/quiz/result,
        #/search, #/profile）
   数据来自 window.DATA（讲义结构化内容）与 window.QUIZ（自测题库）。
   所有进度/收藏/主题设置保存在 localStorage。 */

(function(){
  "use strict";

  var DATA = window.DATA;
  var QUIZ = window.QUIZ;
  var STORE_KEY = "zktk_state_v1";

  // ---------------------------------------------------------------- state
  function loadState(){
    try{
      var raw = localStorage.getItem(STORE_KEY);
      if(raw) return Object.assign(defaultState(), JSON.parse(raw));
    }catch(e){}
    return defaultState();
  }
  function defaultState(){
    return {
      theme: "system",
      reviewed: {},      // pointId -> true
      bookmarks: {},      // pointId -> true
      mnemo: {},          // mnemoId -> {known:bool, seen:int}
      mistakes: {},        // quizId -> true
      quizHistory: []      // {date, total, correct}
    };
  }
  var state = loadState();
  function save(){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }catch(e){} }

  // ---------------------------------------------------------------- utils
  function el(html){
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function esc(s){
    return String(s==null?"":s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }
  // 轻量内联标记：**加粗**  ~~【考频标签】~~
  function inlineMD(text){
    var s = esc(text);
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/~~(.+?)~~/g, '<del class="examtag">$1</del>');
    return s;
  }
  function debounce(fn, ms){
    var t; return function(){ var a=arguments, c=this; clearTimeout(t); t=setTimeout(function(){fn.apply(c,a);}, ms); };
  }
  function shuffle(arr){
    var a = arr.slice();
    for(var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var tmp=a[i]; a[i]=a[j]; a[j]=tmp; }
    return a;
  }
  function dotStr(n){ return n>0 ? "●".repeat(n) + "○".repeat(3-n) : ""; }

  // ---------------------------------------------------------------- flat indices
  var FLAT_CHAPTERS = DATA.chapters;
  function findChapter(cid){ return FLAT_CHAPTERS.find(function(c){return c.id===cid;}); }
  function findSection(cid, sid){
    var c = findChapter(cid); if(!c) return null;
    return c.sections.find(function(s){return s.id===sid;});
  }
  function allPoints(){
    var out = [];
    FLAT_CHAPTERS.forEach(function(c){
      (c.sections||[]).forEach(function(s){
        (s.points||[]).forEach(function(p){ out.push({point:p, chapter:c, section:s}); });
      });
    });
    return out;
  }
  var POINT_INDEX = null;
  function pointIndex(){
    if(POINT_INDEX) return POINT_INDEX;
    POINT_INDEX = {};
    allPoints().forEach(function(rec){ POINT_INDEX[rec.point.id] = rec; });
    return POINT_INDEX;
  }
  function chapterTotalPoints(c){
    var n = 0; (c.sections||[]).forEach(function(s){ n += (s.points||[]).length; });
    return n;
  }
  function chapterReviewedCount(c){
    var n = 0; (c.sections||[]).forEach(function(s){ (s.points||[]).forEach(function(p){ if(state.reviewed[p.id]) n++; }); });
    return n;
  }

  // mnemonic deck source: {id, phrase, note, items, pointId, pointTitle, chapterTitle, sectionTitle}
  function buildMnemonicDeck(chapterIds){
    var deck = [];
    allPoints().forEach(function(rec){
      if(chapterIds && chapterIds.indexOf(rec.chapter.id) === -1) return;
      (rec.point.blocks||[]).forEach(function(b, i){
        if(b.type === "mnemonic" && b.items && b.items.length){
          deck.push({
            id: rec.point.id + "-m" + i,
            phrase: b.phrase, note: b.note, items: b.items,
            pointId: rec.point.id, pointTitle: rec.point.title,
            chapterTitle: rec.chapter.title, sectionTitle: rec.section.title
          });
        }
      });
    });
    return deck;
  }

  // ---------------------------------------------------------------- block renderers
  function renderBlocks(blocks){
    return (blocks||[]).map(renderBlock).join("");
  }
  function renderBlock(b){
    switch(b.type){
      case "p": return '<p class="b-p">' + inlineMD(b.text) + "</p>";
      case "quote": return '<p class="b-quote">' + inlineMD(b.text) + "</p>";
      case "list": return '<ul class="b-list">' + b.items.map(function(i){return "<li>"+inlineMD(i)+"</li>";}).join("") + "</ul>";
      case "tip": return '<div class="b-tip">' + inlineMD(b.text) + "</div>";
      case "compare":
        return '<div class="b-compare"><div class="b-compare__title">'+esc(b.title||"易混对比")+'</div>' +
          b.rows.map(function(r){ return '<div class="b-compare__row"><b>'+esc(r.term)+'：</b><span>'+inlineMD(r.def)+"</span></div>"; }).join("") +
          "</div>";
      case "def":
        return '<div class="b-def">' + b.rows.map(function(r){
          return '<div class="b-def__row"><div class="b-def__term">'+esc(r.term)+'</div><div class="b-def__def">'+inlineMD(r.def)+"</div></div>";
        }).join("") + "</div>";
      case "table":
        var thead = b.headers ? "<thead><tr>" + b.headers.map(function(h){return "<th>"+inlineMD(h)+"</th>";}).join("") + "</tr></thead>" : "";
        var tbody = "<tbody>" + b.rows.map(function(row){
          return "<tr>" + row.map(function(cell){return "<td>"+inlineMD(cell)+"</td>";}).join("") + "</tr>";
        }).join("") + "</tbody>";
        return '<div class="table-wrap"><table class="b-table">'+thead+tbody+"</table></div>";
      case "mnemonic":
        var itemsHtml = (b.items||[]).map(function(it){
          return '<div class="b-mnemonic__item"><span class="b-mnemonic__k">'+esc(it.k)+"</span><span>"+inlineMD(it.v)+"</span></div>";
        }).join("");
        return '<div class="b-mnemonic"><div class="b-mnemonic__label">小烦口诀</div><div class="b-mnemonic__phrase">'+esc(b.phrase)+"</div>" +
          (b.note ? '<div class="b-mnemonic__note">'+inlineMD(b.note)+"</div>" : "") +
          (itemsHtml ? '<div class="b-mnemonic__items">'+itemsHtml+"</div>" : "") + "</div>";
      case "diagram":
        return '<div class="b-def">' + b.tracks.map(function(t){
          return '<div class="b-def__row"><div class="b-def__term" style="width:auto;">'+esc(t.label)+'</div><div class="b-def__def">'+t.lines.map(esc).join(" &nbsp;|&nbsp; ")+"</div></div>";
        }).join("") + "</div>";
      default: return "";
    }
  }

  function renderPoint(p){
    var reviewed = !!state.reviewed[p.id];
    var marked = !!state.bookmarks[p.id];
    return '<article class="point" data-importance="'+(p.importance||0)+'" id="pt-'+p.id+'">' +
      '<div class="point__spine"></div>' +
      '<div class="point__head">' +
        '<h3 class="point__title">'+esc(p.title)+"</h3>" +
        '<button class="point__bookmark" data-bm="'+p.id+'" data-on="'+(marked?1:0)+'" aria-label="收藏">'+starIcon(marked)+"</button>" +
      "</div>" +
      (p.importance ? '<div class="point__dots">'+dotStr(p.importance)+" 重要程度</div>" : "") +
      '<div class="point__meta">' +
        (p.examTypes||[]).map(function(t){return '<span class="chip">'+esc(t)+"</span>";}).join("") +
        (p.examTags||[]).map(function(t){return '<span class="chip chip--exam">'+esc(t)+"考过</span>";}).join("") +
      "</div>" +
      '<div class="point__body">' + renderBlocks(p.blocks) + "</div>" +
      '<label style="display:flex;align-items:center;gap:7px;margin-top:12px;font-size:.78rem;color:var(--ink-soft);cursor:pointer;">' +
        '<input type="checkbox" data-reviewed="'+p.id+'" '+(reviewed?"checked":"")+' style="accent-color:var(--accent);width:15px;height:15px;">已复习，标记为掌握' +
      "</label>" +
    "</article>";
  }

  function starIcon(on){
    return on
      ? '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>'
      : '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z"/></svg>';
  }

  // ---------------------------------------------------------------- topbar / tabbar
  var ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/></svg>',
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 6V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-2"/></svg>',
    quiz: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.3 2.3L16 10"/></svg>',
    profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8.2" r="3.4"/><path d="M4.8 20c1.2-3.6 4-5.4 7.2-5.4s6 1.8 7.2 5.4"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="m14 18-6-6 6-6"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    searchSm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    lockedBook: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5v-13Z"/></svg>'
  };
  var TABS = [
    {key:"home", label:"首页", icon:ICONS.home, route:"#/home"},
    {key:"flash", label:"背诵", icon:ICONS.cards, route:"#/flash"},
    {key:"quiz", label:"自测", icon:ICONS.quiz, route:"#/quiz"},
    {key:"profile", label:"我的", icon:ICONS.profile, route:"#/profile"}
  ];

  function renderTabbar(activeKey){
    return '<nav class="tabbar">' + TABS.map(function(t){
      return '<button class="'+(t.key===activeKey?"active":"")+'" data-nav="'+t.route+'">' + t.icon + "<span>"+t.label+"</span></button>";
    }).join("") + "</nav>";
  }
  function setTabbar(activeKey){
    var host = document.getElementById("tabbar-host");
    host.innerHTML = renderTabbar(activeKey);
  }
  function setTopbar(opts){
    var host = document.getElementById("topbar-host");
    host.innerHTML =
      '<div class="topbar">' +
        (opts.back ? '<button class="topbar__back" data-back>'+ICONS.back+"</button>" : "") +
        '<div class="topbar__title">' +
          (opts.crumb ? '<div class="crumb">'+esc(opts.crumb)+"</div>" : "") +
          "<h1>"+esc(opts.title)+"</h1>" +
        "</div>" +
        (opts.action ? '<button class="topbar__action" data-action="'+opts.action+'">'+(opts.actionIcon||"")+"</button>" : "") +
      "</div>";
    var backBtn = host.querySelector("[data-back]");
    if(backBtn) backBtn.addEventListener("click", function(){ history.back(); });
    var actionBtn = host.querySelector("[data-action]");
    if(actionBtn) actionBtn.addEventListener("click", function(){
      if(opts.action === "search") navigate("#/search");
    });
  }

  // ---------------------------------------------------------------- views
  var main = document.getElementById("main");

  function viewHome(){
    setTopbar({title: DATA.meta.title, action:"search", actionIcon: ICONS.searchSm});
    setTabbar("home");
    var totalPoints = allPoints().length;
    var reviewedTotal = Object.keys(state.reviewed).length;
    var bmTotal = Object.keys(state.bookmarks).length;
    var html = '<div class="hero">' +
      '<div class="hero__eyebrow">教师资格证 · 中学科目二</div>' +
      "<h1>"+esc(DATA.meta.subtitle)+"</h1>" +
      "<p>"+esc(DATA.meta.sourceNote)+"</p>" +
    "</div>" +
    '<div class="stat-row">' +
      '<div class="stat-card"><b>'+reviewedTotal+"/"+totalPoints+"</b><span>已复习知识点</span></div>" +
      '<div class="stat-card"><b>'+bmTotal+"</b><span>收藏</span></div>" +
      '<div class="stat-card"><b>'+Object.keys(state.mistakes).length+"</b><span>错题</span></div>" +
    "</div>" +
    '<div class="chapter-list">' + FLAT_CHAPTERS.map(chapterCardHtml).join("") + "</div>" +
    '<p class="source-note">'+esc(DATA.meta.sourceNote)+"</p>";
    main.innerHTML = html;
    main.querySelectorAll("[data-chapter]").forEach(function(node){
      node.addEventListener("click", function(){
        var cid = node.getAttribute("data-chapter");
        navigate("#/chapter/"+cid);
      });
    });
  }

  function chapterCardHtml(c){
    var total = chapterTotalPoints(c);
    var reviewed = chapterReviewedCount(c);
    var pct = total ? Math.round(reviewed/total*100) : 0;
    var statusBadge = c.status === "locked" ? '<span class="badge badge--locked">待补充</span>'
      : c.status === "partial" ? '<span class="badge badge--partial">部分内容</span>'
      : '<span class="badge badge--complete">完整</span>';
    return '<button class="chapter-card" data-status="'+c.status+'" data-chapter="'+c.id+'">' +
      '<div style="flex:1;min-width:0;">' +
        '<div class="chapter-card__no">'+esc(c.no)+"</div>" +
        '<div class="chapter-card__title">'+esc(c.title)+"</div>" +
        '<div class="chapter-card__meta">'+c.sections.length+" 节 · "+total+" 个知识点</div>" +
        (total ? '<div class="chapter-card__progress"><i style="width:'+pct+'%"></i></div>' : "") +
      "</div>" +
      '<div class="chapter-card__right">' + statusBadge +
        '<span class="chevron"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span>' +
      "</div>" +
    "</button>";
  }

  function viewChapter(cid){
    var c = findChapter(cid);
    if(!c){ navigate("#/home"); return; }
    setTopbar({title:c.title, crumb:c.no, back:true});
    setTabbar("home");
    if(c.status === "locked"){
      main.innerHTML = '<div class="empty-state">' + ICONS.lockedBook +
        '<br>讲义原文这一章还没上传到 App 里。<br>把对应页面发给我，我就照着讲义把内容一字不差地补进来。</div>';
      return;
    }
    var html = '<div class="section-list">' + c.sections.map(function(s, i){
      var total = (s.points||[]).length;
      var reviewed = (s.points||[]).filter(function(p){return state.reviewed[p.id];}).length;
      var locked = s.status === "locked" || total === 0;
      return '<button class="section-card" '+(locked?"disabled":"")+' data-sec="'+s.id+'" style="'+(locked?"opacity:.5;":"")+'">' +
        '<div class="section-card__idx">'+(i+1)+"</div>" +
        '<div class="section-card__body">' +
          '<div class="section-card__title">'+esc(s.no)+" "+esc(s.title)+"</div>" +
          '<div class="section-card__meta">'+(locked ? "待补充内容" : total+" 个知识点 · 已复习 "+reviewed+"/"+total)+"</div>" +
        "</div>" +
        (locked ? "" : '<span class="chevron"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span>') +
      "</button>";
    }).join("") + "</div>";
    main.innerHTML = html;
    main.querySelectorAll("[data-sec]").forEach(function(node){
      if(node.disabled) return;
      node.addEventListener("click", function(){ navigate("#/chapter/"+cid+"/section/"+node.getAttribute("data-sec")); });
    });
  }

  function viewSection(cid, sid){
    var c = findChapter(cid);
    var s = c && findSection(cid, sid);
    if(!s){ navigate("#/chapter/"+cid); return; }
    setTopbar({title:s.title, crumb:c.title+" · "+s.no, back:true});
    setTabbar("home");
    main.innerHTML = (s.points||[]).map(renderPoint).join("") || '<div class="locked-note">这一节的内容还没有补充。</div>';
    bindPointCardEvents(main);
  }

  function bindPointCardEvents(root){
    root.querySelectorAll("[data-bm]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var id = btn.getAttribute("data-bm");
        if(state.bookmarks[id]) delete state.bookmarks[id]; else state.bookmarks[id] = true;
        save();
        btn.setAttribute("data-on", state.bookmarks[id] ? 1 : 0);
        btn.innerHTML = starIcon(!!state.bookmarks[id]);
      });
    });
    root.querySelectorAll("[data-reviewed]").forEach(function(chk){
      chk.addEventListener("change", function(){
        var id = chk.getAttribute("data-reviewed");
        if(chk.checked) state.reviewed[id] = true; else delete state.reviewed[id];
        save();
      });
    });
  }

  // ---------------------------------------------------- search
  function searchIndexText(p){
    if(p._searchCache) return p._searchCache;
    var parts = [p.title];
    (p.blocks||[]).forEach(function(b){
      if(b.text) parts.push(b.text);
      if(b.phrase) parts.push(b.phrase);
      if(b.note) parts.push(b.note);
      if(b.items) b.items.forEach(function(it){ parts.push(it.k, it.v); });
      if(b.items && b.rows) {} // no-op
      if(b.rows) b.rows.forEach(function(r){
        if(Array.isArray(r)) parts.push(r.join(" ")); else parts.push((r.term||"")+" "+(r.def||""));
      });
      if(b.headers) parts.push(b.headers.join(" "));
      if(b.items && b.items[0] && b.items[0].k===undefined){}
    });
    p._searchCache = parts.join(" ").replace(/\*\*|~~/g, "");
    return p._searchCache;
  }
  function viewSearch(){
    setTopbar({title:"搜索知识点", back:true});
    setTabbar("home");
    main.innerHTML =
      '<div class="searchbar">' + ICONS.search + '<input id="search-input" placeholder="搜索标题、口诀、知识点内容…" autofocus></div>' +
      '<div id="search-results"></div>';
    var input = document.getElementById("search-input");
    var results = document.getElementById("search-results");
    function run(){
      var q = input.value.trim();
      if(!q){ results.innerHTML = '<div class="search-empty">输入关键词，比如"启发性原则"、"口诀"、"赫尔巴特"…</div>'; return; }
      var hits = allPoints().filter(function(rec){
        return searchIndexText(rec.point).indexOf(q) !== -1;
      }).slice(0, 40);
      if(!hits.length){ results.innerHTML = '<div class="search-empty">没有找到"'+esc(q)+'"相关的内容。</div>'; return; }
      results.innerHTML = hits.map(function(rec){
        var txt = searchIndexText(rec.point);
        var idx = txt.indexOf(q);
        var snippet = txt.substring(Math.max(0, idx-16), idx+q.length+30);
        var snippetHtml = esc(snippet).replace(esc(q), "<mark>"+esc(q)+"</mark>");
        return '<div class="search-hit" data-cid="'+rec.chapter.id+'" data-sid="'+rec.section.id+'" data-pid="'+rec.point.id+'">' +
          '<div class="search-hit__path">'+esc(rec.chapter.title)+" › "+esc(rec.section.title)+"</div>" +
          '<div class="search-hit__title">'+esc(rec.point.title)+"</div>" +
          '<div class="search-hit__snippet">…'+snippetHtml+"…</div>" +
        "</div>";
      }).join("");
      results.querySelectorAll(".search-hit").forEach(function(node){
        node.addEventListener("click", function(){
          navigate("#/chapter/"+node.getAttribute("data-cid")+"/section/"+node.getAttribute("data-sid")+"?pt="+node.getAttribute("data-pid"));
        });
      });
    }
    input.addEventListener("input", debounce(run, 120));
    run();
  }

  // ---------------------------------------------------- flashcards
  var flashDeck = [];
  var flashPos = 0;
  var flashAgainQueue = [];
  var flashKnownCount = 0;

  function viewFlashSetup(){
    setTopbar({title:"背诵闪卡"});
    setTabbar("flash");
    var chapters = FLAT_CHAPTERS.filter(function(c){ return c.status !== "locked"; });
    var full = buildMnemonicDeck(null);
    var onlyUnmastered = (localStorage.getItem("zktk_flash_unmastered") === "1");
    main.innerHTML =
      '<div class="hero" style="padding-bottom:6px;"><div class="hero__eyebrow">口诀记忆卡</div><h1>把讲义里的"小烦口诀"变成翻卡片</h1><p>共收录 '+full.length+' 组口诀。正面看口诀，点击翻面看完整对照，标记"还没记住"会在本轮结束后重新出现。</p></div>' +
      '<div class="deck-setup">' +
        chapters.map(function(c){
          var n = buildMnemonicDeck([c.id]).length;
          if(!n) return "";
          var on = localStorage.getItem("zktk_flash_ch_"+c.id) !== "0";
          return '<div class="check-row"><div><div class="check-row__label">'+esc(c.title)+'</div><div class="check-row__sub">'+n+' 组口诀</div></div><button class="switch" data-ch="'+c.id+'" data-on="'+(on?1:0)+'"></button></div>';
        }).join("") +
        '<div class="check-row"><div><div class="check-row__label">只看未掌握</div><div class="check-row__sub">跳过已经标记"记住了"的卡片</div></div><button class="switch" id="flash-unmastered" data-on="'+(onlyUnmastered?1:0)+'"></button></div>' +
      "</div>" +
      '<button class="primary-btn" id="flash-start" style="margin-top:18px;">开始背诵</button>';

    main.querySelectorAll(".switch[data-ch]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var on = btn.getAttribute("data-on") === "1";
        btn.setAttribute("data-on", on?0:1);
        localStorage.setItem("zktk_flash_ch_"+btn.getAttribute("data-ch"), on?"0":"1");
      });
    });
    var um = document.getElementById("flash-unmastered");
    um.addEventListener("click", function(){
      var on = um.getAttribute("data-on") === "1";
      um.setAttribute("data-on", on?0:1);
      localStorage.setItem("zktk_flash_unmastered", on?"0":"1");
    });
    document.getElementById("flash-start").addEventListener("click", function(){
      var chosen = chapters.filter(function(c){ return localStorage.getItem("zktk_flash_ch_"+c.id) !== "0"; }).map(function(c){return c.id;});
      var deck = buildMnemonicDeck(chosen.length?chosen:null);
      if(document.getElementById("flash-unmastered").getAttribute("data-on") === "1"){
        deck = deck.filter(function(card){ return !(state.mnemo[card.id] && state.mnemo[card.id].known); });
      }
      if(!deck.length){ alert("没有可背诵的卡片，试试关闭\"只看未掌握\"。"); return; }
      flashDeck = shuffle(deck);
      flashPos = 0; flashAgainQueue = []; flashKnownCount = 0;
      navigate("#/flash/run");
    });
  }

  function viewFlashRun(){
    setTopbar({title:"背诵中", back:true});
    setTabbar("flash");
    if(flashPos >= flashDeck.length){
      if(flashAgainQueue.length){
        flashDeck = shuffle(flashAgainQueue);
        flashAgainQueue = [];
        flashPos = 0;
      } else {
        main.innerHTML = '<div class="deck-done"><h2>本轮背完啦</h2><p>本次共复习 '+flashKnownCount+' 组口诀，已标记"记住了"。</p><button class="primary-btn" style="margin-top:16px;" data-nav="#/flash">再来一轮</button></div>';
        main.querySelector("[data-nav]").addEventListener("click", function(){ navigate("#/flash"); });
        return;
      }
    }
    var card = flashDeck[flashPos];
    var total = flashDeck.length;
    var itemsHtml = card.items.map(function(it){
      return '<div class="b-mnemonic__item"><span class="b-mnemonic__k">'+esc(it.k)+"</span><span>"+inlineMD(it.v)+"</span></div>";
    }).join("");
    main.innerHTML =
      '<div class="deck-progress"><div class="deck-progress__bar"><i style="width:'+Math.round(flashPos/total*100)+'%"></i></div><div class="deck-progress__num">'+(flashPos+1)+" / "+total+"</div></div>" +
      '<div class="flash-stage"><div class="flashcard" id="flashcard" data-flip="0">' +
        '<div class="flash-face flash-face--front">' +
          '<div class="flash-face__label">'+esc(card.chapterTitle)+" · "+esc(card.sectionTitle)+"</div>" +
          '<div class="flash-face__phrase">'+esc(card.phrase)+"</div>" +
          '<div class="flash-face__hint">点击卡片查看完整口诀对照 ↺</div>' +
        "</div>" +
        '<div class="flash-face flash-face--back">' +
          '<div class="flash-face__label">对照 · '+esc(card.pointTitle)+"</div>" +
          (card.note ? '<div class="b-mnemonic__note" style="text-align:center;margin:6px 0 10px;">'+inlineMD(card.note)+"</div>" : "") +
          '<div class="b-mnemonic__items">'+itemsHtml+"</div>" +
          '<div class="point-link" data-goto="'+card.pointId+'">查看完整知识点 →</div>' +
        "</div>" +
      "</div></div>" +
      '<div class="deck-actions"><button class="btn-again" id="btn-again">还没记住</button><button class="btn-known" id="btn-known">记住了</button></div>';

    var flip = false;
    document.getElementById("flashcard").addEventListener("click", function(e){
      if(e.target.closest("[data-goto]")) return;
      flip = !flip;
      this.setAttribute("data-flip", flip?1:0);
    });
    var link = main.querySelector("[data-goto]");
    if(link) link.addEventListener("click", function(e){
      e.stopPropagation();
      var rec = pointIndex()[link.getAttribute("data-goto")];
      if(rec) navigate("#/chapter/"+rec.chapter.id+"/section/"+rec.section.id+"?pt="+rec.point.id);
    });
    document.getElementById("btn-again").addEventListener("click", function(){
      state.mnemo[card.id] = {known:false, seen:((state.mnemo[card.id]&&state.mnemo[card.id].seen)||0)+1};
      save();
      flashAgainQueue.push(card);
      flashPos++; navigate("#/flash/run", true);
    });
    document.getElementById("btn-known").addEventListener("click", function(){
      state.mnemo[card.id] = {known:true, seen:((state.mnemo[card.id]&&state.mnemo[card.id].seen)||0)+1};
      save();
      flashKnownCount++;
      flashPos++; navigate("#/flash/run", true);
    });
  }

  // ---------------------------------------------------- quiz
  var quizPool = [];
  var quizPos = 0;
  var quizCorrect = 0;
  var quizAnswered = false;
  var quizSessionMistakes = [];

  function chaptersWithQuiz(){
    var set = {};
    QUIZ.forEach(function(q){ var rec = pointIndex()[q.pointId]; if(rec) set[rec.chapter.id] = (set[rec.chapter.id]||0)+1; });
    return set;
  }

  function viewQuizSetup(){
    setTopbar({title:"自测练习"});
    setTabbar("quiz");
    var byChapter = chaptersWithQuiz();
    var chapters = FLAT_CHAPTERS.filter(function(c){ return byChapter[c.id]; });
    main.innerHTML =
      '<div class="hero" style="padding-bottom:6px;"><div class="hero__eyebrow">选择题 + 判断题</div><h1>检验一下记牢了没</h1><p>题库共 '+QUIZ.length+' 题，全部改编自已收录的讲义知识点，答错会自动进入"我的·错题本"。</p></div>' +
      '<div class="deck-setup">' +
        chapters.map(function(c){
          var on = localStorage.getItem("zktk_quiz_ch_"+c.id) !== "0";
          return '<div class="check-row"><div><div class="check-row__label">'+esc(c.title)+'</div><div class="check-row__sub">'+byChapter[c.id]+' 题</div></div><button class="switch" data-qch="'+c.id+'" data-on="'+(on?1:0)+'"></button></div>';
        }).join("") +
      "</div>" +
      '<button class="primary-btn" id="quiz-start" style="margin-top:18px;">开始自测</button>';
    main.querySelectorAll("[data-qch]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var on = btn.getAttribute("data-on") === "1";
        btn.setAttribute("data-on", on?0:1);
        localStorage.setItem("zktk_quiz_ch_"+btn.getAttribute("data-qch"), on?"0":"1");
      });
    });
    document.getElementById("quiz-start").addEventListener("click", function(){
      var chosen = chapters.filter(function(c){ return localStorage.getItem("zktk_quiz_ch_"+c.id) !== "0"; }).map(function(c){return c.id;});
      var pool = QUIZ.filter(function(q){ var rec = pointIndex()[q.pointId]; return rec && chosen.indexOf(rec.chapter.id) !== -1; });
      if(!pool.length){ alert("请至少选择一个有题目的章节。"); return; }
      quizPool = shuffle(pool);
      quizPos = 0; quizCorrect = 0; quizSessionMistakes = [];
      navigate("#/quiz/run");
    });
  }

  function viewQuizRun(){
    setTopbar({title:"自测中 "+(quizPos+1)+"/"+quizPool.length, back:true});
    setTabbar("quiz");
    if(quizPos >= quizPool.length){ navigate("#/quiz/result", true); return; }
    var q = quizPool[quizPos];
    quizAnswered = false;
    var rec = pointIndex()[q.pointId];
    var html = '<div class="quiz-card">' +
      '<div class="quiz-card__stem">'+(quizPos+1)+". "+inlineMD(q.stem)+"</div>";
    if(q.type === "single"){
      html += '<div class="quiz-opts">' + q.options.map(function(opt, i){
        return '<div class="quiz-opt" data-i="'+i+'"><span class="quiz-opt__mark">'+String.fromCharCode(65+i)+"</span><span>"+inlineMD(opt)+"</span></div>";
      }).join("") + "</div>";
    } else {
      html += '<div class="judge-row"><button data-j="1">✓ 正确</button><button data-j="0">✗ 错误</button></div>';
    }
    html += '<div id="quiz-explain-slot"></div>' +
      '<div class="quiz-footer"><span class="quiz-score">本轮正确 '+quizCorrect+" / "+quizPos+"</span>" +
      '<button class="ghost-btn" id="quiz-next" style="display:none;">下一题 →</button></div>' +
    "</div>";
    main.innerHTML = html;

    function reveal(userCorrect, chosenEl, correctEl){
      quizAnswered = true;
      if(chosenEl && chosenEl !== correctEl) chosenEl.setAttribute("data-state", "wrong");
      if(correctEl) correctEl.setAttribute("data-state", "correct");
      var slot = document.getElementById("quiz-explain-slot");
      slot.innerHTML = '<div class="quiz-explain"><b>'+(userCorrect?"答对了 ✓":"答错了 · 正确答案见下")+"</b>"+inlineMD(q.explain)+
        (rec ? '<div class="point-link" data-goto="'+q.pointId+'" style="margin-top:8px;color:var(--accent);cursor:pointer;">回到知识点：'+esc(rec.section.title)+" → "+esc(rec.point.title)+" →</div>" : "") +
        "</div>";
      var link = slot.querySelector("[data-goto]");
      if(link) link.addEventListener("click", function(){ navigate("#/chapter/"+rec.chapter.id+"/section/"+rec.section.id+"?pt="+q.pointId); });
      if(userCorrect) quizCorrect++;
      else { quizSessionMistakes.push(q.id); state.mistakes[q.id] = true; save(); }
      document.getElementById("quiz-next").style.display = "inline-block";
      main.querySelector(".quiz-score").textContent = "本轮正确 "+quizCorrect+" / "+(quizPos+1);
    }

    if(q.type === "single"){
      main.querySelectorAll(".quiz-opt").forEach(function(node){
        node.addEventListener("click", function(){
          if(quizAnswered) return;
          var i = parseInt(node.getAttribute("data-i"), 10);
          var correctEl = main.querySelector('.quiz-opt[data-i="'+q.answer+'"]');
          reveal(i === q.answer, node, correctEl);
        });
      });
    } else {
      main.querySelectorAll("[data-j]").forEach(function(btn){
        btn.addEventListener("click", function(){
          if(quizAnswered) return;
          var val = btn.getAttribute("data-j") === "1";
          reveal(val === q.answer, null, null);
          btn.style.borderColor = "var(--accent)";
        });
      });
    }
    document.getElementById("quiz-next").addEventListener("click", function(){
      quizPos++;
      navigate("#/quiz/run", true);
    });
  }

  function viewQuizResult(){
    setTopbar({title:"自测结果"});
    setTabbar("quiz");
    var total = quizPool.length;
    state.quizHistory.push({date:Date.now(), total:total, correct:quizCorrect});
    if(state.quizHistory.length>30) state.quizHistory.shift();
    save();
    main.innerHTML =
      '<div class="result-hero"><div class="result-hero__num">'+quizCorrect+" / "+total+"</div><div class=\"result-hero__label\">本轮正确率 "+Math.round(quizCorrect/total*100)+"%</div></div>" +
      (quizSessionMistakes.length ? '<div class="profile-card"><h3>本轮错题（'+quizSessionMistakes.length+'）</h3>' +
        quizSessionMistakes.map(function(qid){
          var q = QUIZ.find(function(x){return x.id===qid;});
          return '<div class="mistake-row"><div class="mistake-row__stem">'+inlineMD(q.stem)+'</div><span class="mistake-row__tag">已存入错题本</span></div>';
        }).join("") + "</div>" : '<p style="text-align:center;color:var(--ink-soft);font-size:.86rem;">全对，太厉害了。</p>') +
      '<button class="primary-btn" id="quiz-again" style="margin-top:6px;">再测一轮</button>';
    document.getElementById("quiz-again").addEventListener("click", function(){ navigate("#/quiz"); });
  }

  // ---------------------------------------------------- profile
  function viewProfile(){
    setTopbar({title:"我的"});
    setTabbar("profile");
    var totalPoints = allPoints().length;
    var reviewedTotal = Object.keys(state.reviewed).length;
    var bmList = Object.keys(state.bookmarks).map(function(id){ return pointIndex()[id]; }).filter(Boolean);
    var mistakeIds = Object.keys(state.mistakes);
    var deck = buildMnemonicDeck(null);
    var masteredMnemo = deck.filter(function(c){ return state.mnemo[c.id] && state.mnemo[c.id].known; }).length;

    var html = '<div class="profile-card"><h3>整体进度</h3>' +
      progressLine("知识点复习", reviewedTotal, totalPoints) +
      progressLine("口诀掌握", masteredMnemo, deck.length) +
      "</div>";

    html += '<div class="profile-card"><h3>分章节进度</h3>' +
      FLAT_CHAPTERS.filter(function(c){return chapterTotalPoints(c)>0;}).map(function(c){
        return progressLine(c.title, chapterReviewedCount(c), chapterTotalPoints(c));
      }).join("") + "</div>";

    html += '<div class="profile-card"><h3>收藏（'+bmList.length+'）</h3>' +
      (bmList.length ? bmList.map(function(rec){
        return '<div class="mistake-row" data-goto="'+rec.point.id+'" data-cid="'+rec.chapter.id+'" data-sid="'+rec.section.id+'" style="cursor:pointer;"><div class="mistake-row__stem">'+esc(rec.point.title)+'</div><span class="mistake-row__tag" style="color:var(--gold);">'+esc(rec.section.title)+"</span></div>";
      }).join("") : '<div class="empty-state">还没有收藏任何知识点，去知识点页面点一下星标吧。</div>') + "</div>";

    html += '<div class="profile-card"><h3>错题本（'+mistakeIds.length+'）</h3>' +
      (mistakeIds.length ? mistakeIds.map(function(qid){
        var q = QUIZ.find(function(x){return x.id===qid;});
        if(!q) return "";
        return '<div class="mistake-row"><div class="mistake-row__stem">'+inlineMD(q.stem)+'</div><button class="ghost-btn" data-clearmis="'+qid+'" style="padding:4px 10px;font-size:.7rem;">移出</button></div>';
      }).join("") : '<div class="empty-state">暂无错题，继续保持～</div>') + "</div>";

    html += '<div class="profile-card"><h3>外观</h3><div class="theme-toggle">' +
      ["system","light","dark"].map(function(t){
        var label = t==="system"?"跟随系统":t==="light"?"浅色":"深色";
        return '<button data-theme="'+t+'" class="'+(state.theme===t?"active":"")+'">'+label+"</button>";
      }).join("") + "</div></div>";

    html += '<div class="profile-card"><h3>关于</h3><p style="font-size:.78rem;color:var(--ink-soft);line-height:1.8;">'+esc(DATA.meta.sourceNote)+'</p></div>';

    main.innerHTML = html;

    main.querySelectorAll("[data-goto]").forEach(function(node){
      node.addEventListener("click", function(){
        navigate("#/chapter/"+node.getAttribute("data-cid")+"/section/"+node.getAttribute("data-sid")+"?pt="+node.getAttribute("data-goto"));
      });
    });
    main.querySelectorAll("[data-clearmis]").forEach(function(btn){
      btn.addEventListener("click", function(e){
        e.stopPropagation();
        delete state.mistakes[btn.getAttribute("data-clearmis")];
        save(); viewProfile();
      });
    });
    main.querySelectorAll("[data-theme]").forEach(function(btn){
      btn.addEventListener("click", function(){
        state.theme = btn.getAttribute("data-theme");
        save(); applyTheme(); viewProfile();
      });
    });
  }
  function progressLine(label, done, total){
    var pct = total ? Math.round(done/total*100) : 0;
    return '<div class="progress-line"><div class="progress-line__label">'+esc(label)+'</div><div class="progress-line__bar"><i style="width:'+pct+'%"></i></div><div class="progress-line__num">'+done+"/"+total+"</div></div>";
  }

  function applyTheme(){
    var root = document.documentElement;
    if(state.theme === "light") root.setAttribute("data-theme", "light");
    else if(state.theme === "dark") root.setAttribute("data-theme", "dark");
    else root.removeAttribute("data-theme");
  }

  // ---------------------------------------------------------------- router
  function navigate(hash, replace){
    var nextHash = "#" + hash.split("#")[1];
    // Replacing the current hash does not emit `hashchange`. Quiz and
    // flash-card sessions intentionally reuse the same route while advancing
    // their in-memory position, so force a render when the route is unchanged.
    if(location.hash === nextHash){
      if(replace) history.replaceState(null, "", nextHash);
      route();
      return;
    }
    if(replace) location.replace(nextHash);
    else location.hash = nextHash.replace(/^#/, "");
  }
  window.navigate = navigate;

  function parseHash(){
    var h = location.hash.replace(/^#\/?/, "");
    var qIdx = h.indexOf("?");
    var query = {};
    if(qIdx !== -1){
      var qs = h.substring(qIdx+1); h = h.substring(0, qIdx);
      qs.split("&").forEach(function(pair){ var kv = pair.split("="); query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]||""); });
    }
    return {path: h.split("/").filter(Boolean), query: query};
  }

  function route(){
    var r = parseHash();
    var p = r.path;
    window.scrollTo(0,0);
    if(p.length === 0 || p[0] === "home") return viewHome();
    if(p[0] === "chapter" && p[1] && p[2] === "section" && p[3]) {
      viewSection(p[1], p[3]);
      if(r.query.pt){
        setTimeout(function(){
          var node = document.getElementById("pt-"+r.query.pt);
          if(node) node.scrollIntoView({behavior:"smooth", block:"start"});
        }, 60);
      }
      return;
    }
    if(p[0] === "chapter" && p[1]) return viewChapter(p[1]);
    if(p[0] === "search") return viewSearch();
    if(p[0] === "flash" && p[1] === "run") return viewFlashRun();
    if(p[0] === "flash") return viewFlashSetup();
    if(p[0] === "quiz" && p[1] === "run") return viewQuizRun();
    if(p[0] === "quiz" && p[1] === "result") return viewQuizResult();
    if(p[0] === "quiz") return viewQuizSetup();
    if(p[0] === "profile") return viewProfile();
    return viewHome();
  }

  document.addEventListener("click", function(e){
    var nav = e.target.closest("[data-nav]");
    if(nav){ navigate(nav.getAttribute("data-nav")); }
  });

  window.addEventListener("hashchange", route);
  applyTheme();
  route();
})();
