/* LP 専用の写し（正本は ~/カンパニー/ashilog-web/nobr.js）。
   アプリの画面では動かさない: <html data-lp="1"> のときだけ数え直す */
/* 1文字だけ次の行に送られる「泣き別れ」をなくす（2026-10-29 本人「1文字だけ改行されるのは全部直して」）
   表示したあとに行を数え、最後の1文字（句読点は数えない）だけの行があれば、その文字を前の2文字とつなげる（U+2060 を挟む）。
   画面幅が変わったら数え直す。見出しの文字分け（.is-split）は main.js 側で末尾をまとめている。
   同じ中身を各見本サイトにも直書きしている（各 sample-site の index.html の末尾） */
(function () {
  var WJ = '⁠';
  var PUNCT = /[\s、。，．,.・：:；;！!？?」』）)\]】〉》…〜ー\-–—"'”’⁠]/;
  var SKIP = 'script,style,noscript,svg,textarea,input,select,option,code,pre,.is-split,[data-nobr-skip]';
  function blockOf(n) {
    var e = n.parentElement;
    while (e && e !== document.body) {
      var d = getComputedStyle(e).display;
      if (d !== 'inline' && d !== 'contents' && !(e.classList && (e.classList.contains('ch') || e.classList.contains('ch-tail')))) return e;
      e = e.parentElement;
    }
    return document.body;
  }
  function scan(fix, all) {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.data.trim()) return NodeFilter.FILTER_REJECT;
        var p = n.parentElement;
        if (!p || p.closest(all ? 'script,style,noscript,svg,textarea,input,select,option,code,pre' : SKIP)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var groups = new Map(), n;
    while ((n = walker.nextNode())) {
      var b = blockOf(n);
      if (!b.offsetParent && getComputedStyle(b).position !== 'fixed') continue; // 隠れている
      if (/^vertical/.test(getComputedStyle(b).writingMode)) continue; // 縦書きは1文字ずつが正しい
      var dt = b.closest('details'); if (dt && !dt.open && !b.closest('summary')) continue; // 閉じた質問の答えは、開いたときに数える
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b).push(n);
    }
    var found = [], ins = [], r = document.createRange();
    groups.forEach(function (nodes, b) {
      var chars = [];
      nodes.forEach(function (node) {
        for (var i = 0; i < node.data.length; i++) {
          var c = node.data[i];
          if (c === WJ) continue;
          r.setStart(node, i); r.setEnd(node, i + 1);
          var rc = r.getClientRects()[0];
          if (!rc || !rc.width && !/\s/.test(c)) continue;
          chars.push({ node: node, i: i, c: c, top: rc.top, h: rc.height || 10 });
        }
      });
      if (chars.length < 3) return;
      // 行に分ける
      var lines = [], cur = null;
      chars.forEach(function (ch) {
        if (!cur || Math.abs(ch.top - cur.top) > cur.h * 0.6) { cur = { top: ch.top, h: ch.h, list: [] }; lines.push(cur); }
        cur.list.push(ch);
      });
      var tiny = lines.filter(function (l) { return l.list.length <= 2; }).length;
      if (lines.length >= 4 && tiny / lines.length > 0.5) return;
      for (var k = 1; k < lines.length; k++) {
        var vis = lines[k].list.filter(function (ch) { return !PUNCT.test(ch.c); });
        var all = lines[k].list.filter(function (ch) { return !/\s/.test(ch.c); });
        if (vis.length > 1 || all.length === 0 || all.length > 3) continue;
        // 前の行の最後が空白（英単語の切れ目）なら触らない
        var prev = lines[k - 1].list, last = prev[prev.length - 1];
        if (!last || /\s/.test(last.c)) continue;
        found.push({ el: b, text: all.map(function (c) { return c.c; }).join('') });
        if (fix) {
          // 前の行の最後の2文字と、この行の最初の文字の間に WJ を入れる（後ろから入れて位置をずらさない）
          var seq = [prev[prev.length - 2], last, lines[k].list[0]].filter(Boolean);
          for (var j = seq.length - 1; j > 0; j--) ins.push(seq[j]);
        }
      }
    });
    // 同じ文字の並びの中で位置がずれないよう、後ろから入れる
    var byNode = new Map();
    ins.forEach(function (t) { if (!byNode.has(t.node)) byNode.set(t.node, new Set()); byNode.get(t.node).add(t.i); });
    byNode.forEach(function (set, node) { Array.from(set).sort(function (a, b) { return b - a; }).forEach(function (i) { if (node.data[i - 1] !== WJ) node.insertData(i, WJ); }); });
    return found;
  }
  function run() { if (document.documentElement.dataset.lp !== '1') return; window.__nobrRuns = (window.__nobrRuns || 0) + 1; for (var t = 0; t < 3; t++) { if (!scan(true).length) break; } }
  window.__orphans = function () { return scan(false, true).map(function (o) { return o.text + ' ← ' + (o.el.textContent || '').trim().slice(0, 30); }); };
  window.__nobrFix = function () { return scan(true).length; };
  if (window.__NOBR_AUDIT) return; // 監査だけのとき（直さずに数える）
  var timer;
  var timer2;
  function later() { clearTimeout(timer); clearTimeout(timer2); timer = setTimeout(run, 250); timer2 = setTimeout(run, 1200); } // 画像や文字の読み込みで折り返しが後から変わるので2回
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { setTimeout(run, 50); }); else addEventListener('load', run);
  addEventListener('load', function () { later(); setTimeout(run, 2500); });
  addEventListener('resize', later);
  // 画面の回転などで resize が来ない場合もあるので、ページの幅そのものも見張る
  if (window.ResizeObserver) { var lastW = 0; new ResizeObserver(function (es) { var w = Math.round(es[0].contentRect.width); if (w !== lastW) { lastW = w; later(); } }).observe(document.documentElement); }
  document.addEventListener('toggle', later, true); // 質問を開いたとき
})();
