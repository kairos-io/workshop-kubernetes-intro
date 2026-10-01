// KAI terminal layout, JS twin of tui/main.go. Builds a character grid for a screen at a given
// size so the web gallery can preview exactly what the terminal draws.
(function () {
  const T = {};
  function Grid(w, h, ascii) {
    this.w = w; this.h = h; this.ascii = !!ascii;
    this.c = []; for (let y = 0; y < h; y++) { const r = []; for (let x = 0; x < w; x++) r.push({ ch: ' ', fg: null, bg: null, b: false }); this.c.push(r); }
  }
  Grid.prototype.put = function (x, y, s, st) {
    st = st || {}; s = String(s);
    if (y < 0 || y >= this.h) return;
    for (const ch of s) { if (x >= this.w) break; if (x >= 0) this.c[y][x] = { ch, fg: st.fg || null, bg: st.bg || null, b: !!st.b }; x++; }
  };
  Grid.prototype.fill = function (x, y, w, h, st) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (j >= 0 && j < this.h && i >= 0 && i < this.w) this.c[j][i] = { ch: ' ', fg: st.fg || null, bg: st.bg || null, b: false }; };
  Grid.prototype.bar = function (y, left, right, st) {
    this.fill(0, y, this.w, 1, st);
    this.put(0, y, T.clip(left, this.w), st);
    if (right) { const r = T.clip(right, Math.max(0, this.w - T.len(left) - 1)); this.put(this.w - T.len(r), y, r, st); }
  };
  // Pixel map at 1 column x 2 pixel rows per cell (square pixels in a 1:2 cell).
  Grid.prototype.sprite = function (x0, y0, map, colors, codes, opt) {
    opt = opt || {};
    const hh = map.length, ww = map[0].length;
    const px = (r, c) => {
      if (r < 0 || r >= hh) return null;
      const row = map[r], ch = row[opt.flip ? ww - 1 - c : c];
      if (ch === '.' || ch === ' ' || ch == null) return null;
      let i = (ch >= '0' && ch <= '3') ? +ch : codes[ch];
      if (opt.mono != null) i = opt.mono;
      return i;
    };
    for (let r = 0; r < hh; r += 2) for (let c = 0; c < ww; c++) {
      const a = px(r, c), b = px(r + 1, c), x = x0 + c, y = y0 + (r >> 1);
      if (x < 0 || x >= this.w || y < 0 || y >= this.h) continue;
      if (a == null && b == null) continue;
      if (this.ascii) { const s = Math.max(a ?? -1, b ?? -1); this.c[y][x] = { ch: ' .+#'[s], fg: null, bg: null, b: false }; continue; }
      const under = this.c[y][x].bg;
      this.c[y][x] = { ch: '▀', fg: a == null ? under : colors[a], bg: b == null ? under : colors[b], b: false, px: true };
    }
  };
  T.len = s => [...String(s)].length;
  T.clip = (s, n) => { const a = [...String(s)]; return a.length <= n ? a.join('') : a.slice(0, Math.max(0, n - 1)).join('') + '…'; };
  T.wrap = (s, n) => (window.KAIE.wrap(s, Math.max(8, n)));
  T.center = (g, y, s, st) => g.put(Math.max(0, Math.floor((g.w - T.len(s)) / 2)), y, s, st);

  T.glyphs = ascii => ascii
    ? { cur: '>', ok: '[x]', now: '[>]', lock: '[#]', side: '[*]', skip: '[>>]', todo: '[ ]', full: '#', empty: '-', tri: '>', fail: 'x', dot: '-', up: '^', down: 'v', box: ['+', '-', '+', '|', '+', '+'] }
    : { cur: '▶', ok: '✓', now: '●', lock: '×', side: '☆', skip: '»', todo: '·', full: '■', empty: '□', tri: '▸', fail: '✗', dot: '·', up: '↑', down: '↓', box: ['┌', '─', '┐', '│', '└', '┘'] };

  T.box = function (g, x, y, w, h, st, G) {
    const b = G.box;
    g.put(x, y, b[0] + b[1].repeat(w - 2) + b[2], st);
    for (let j = 1; j < h - 1; j++) { g.put(x, y + j, b[3], st); g.put(x + w - 1, y + j, b[3], st); }
    g.put(x, y + h - 1, b[4] + b[1].repeat(w - 2) + b[5], st);
  };
  T.pbar = (done, total, n, G) => { const f = total ? Math.round(n * done / total) : 0; return G.full.repeat(f) + G.empty.repeat(n - f); };

  T.scene = function (g, E, x0, y0, wpx, anim, mode, opt) {
    const Wc = E.pal(mode, 'world'), K = E.pal(mode, 'kai'), codes = E.S.codes;
    const grass = E.S.tiles.grass, path = E.S.tiles.path;
    const tmp = []; for (let y = 0; y < 16; y++) { let row = ''; for (let x = 0; x < wpx; x++) row += (y >= 9 && y < 15 ? path : grass)[y % 8][x % 8]; tmp.push(row); }
    g.sprite(x0, y0, tmp, Wc, codes);
    const f = E.frame(anim, 0, true);
    g.sprite(x0 + (opt && opt.kx != null ? opt.kx : 4), y0, f.map, K, codes, { flip: f.flip });
  };

  // ---------- instruction lines ----------
  // Line = { segs: [{s, st}], cmd?: index }
  T.instructions = function (E, p, st, sid, width, ui) {
    const G = T.glyphs(ui.ascii), L = E.W.labels, lines = [], bold = { b: true };
    const push = (segs, extra) => lines.push({ segs, ...(extra || {}) });
    const blank = () => { if (lines.length && lines[lines.length - 1].segs.length) push([]); };
    // blocks from E.md: paragraphs and lists, with a hanging indent under list markers
    const words = segs => { const out = []; segs.forEach(g => String(g.v).split(/\s+/).forEach(w => { if (w) out.push({ s: w, st: g.t === 'b' || g.t === 'code' ? bold : null }); })); segs.filter(g => g.t === 'a').forEach(g => { const sl = E.stageLink(g.href); out.push({ s: sl ? '(stage ' + E.stageNo(sl) + ')' : '<' + g.href + '>', st: null }); }); return out; };
    const flow = (ws, ind, lead, hang) => {
      let cur = [], n = 0, first = true;
      const max = width - ind;
      if (lead) { cur.push({ s: lead, st: bold }); n = T.len(lead); }
      ws.forEach(w => {
        const wl = T.len(w.s), lim = first ? max : max - hang;
        if (n && n + 1 + wl > lim) { push([{ s: ' '.repeat(first ? ind : ind + hang), st: null }, ...cur]); cur = []; n = 0; first = false; }
        if (n) { cur.push({ s: ' ', st: null }); n++; }
        cur.push(w); n += wl;
      });
      if (cur.length) push([{ s: ' '.repeat(first ? ind : ind + hang), st: null }, ...cur]);
    };
    const para = (blocks, ind, first) => {
      blocks.forEach((b, bi) => {
        const lead = bi === 0 ? first : '';
        if (b.k === 'p') { flow(words(b.segs), ind, lead, 0); return; }
        if (lead) push([{ s: ' '.repeat(ind), st: null }, { s: lead, st: bold }]);
        b.items.forEach((it, i) => { const mk = b.k === 'ol' ? (b.start + i) + '.' : (ui.ascii ? '-' : '•'); flow(words(it), ind, mk, T.len(mk) + 1); });
      });
    };
    const P = s => [{ k: 'p', segs: [{ t: 'text', v: s }] }];
    const so = E.stepOnly(st, p.facts), hp = E.stepHelp(st);
    if (so) push([{ s: '  ', st: null }, { s: '[' + so + ']', st: null }]);
    if (hp.has && ui.status !== 'tip') { flow(words([{ t: 'b', v: (L.tool || 'Tool') + ':' }, { t: 'text', v: ' ' + hp.tool + (hp.source ? ' <' + hp.source + '>' : '') + (hp.docs ? '  ' + (L.docs || 'Docs') + ': <' + hp.docs + '>' : '') }]), 2, '', 2); }
    const opts = { key: sid + '/' + st.id, facts: p.facts, sel: {}, showAll: ui.showAll || {}, layout: 'stacked' };
    const rows = E.flatten(st.blocks, opts);
    if (ui.status === 'failed') { rows.push({ type: 'trouble', inset: 0 }); E.flatten(st.check.fail, { ...opts, key: opts.key + '/fail', inset: 1 }, rows); }
    const aiRows = (kind, title) => { const code = E.prompt(kind, p, sid, kind === 'fail' ? st : null); rows.push({ type: 'heading', text: title, inset: 0 }); rows.push({ type: 'callout', kind: 'warning', blocks: E.md(E.W.prompts.warning), inset: 0 }); if (E.isMaster(p.facts) && !p.virtName) rows.push({ type: 'text', blocks: P('Press v to type the name of your virtualization software into the prompt.'), inset: 0 }); rows.push({ type: 'command', isFile: true, name: 'AI prompt', code, lines: E.cmdLines(code, true), inset: 0 }); };
    if (ui.status === 'failed') aiRows('fail', L.ai_title);
    if (ui.status === 'tip') { rows.length = 0; aiRows('tip', L.tip_title); }
    let ci = 0;
    rows.forEach(r => {
      const ind = 2 + (r.inset || 0) * 2;
      if (r.only && r.type !== 'altHeader') { blank(); push([{ s: ' '.repeat(ind), st: null }, { s: '[' + r.only + ']', st: null }]); }
      else if (!['altHeader'].includes(r.type)) blank();
      if (r.type === 'text') para(r.blocks, ind);
      else if (r.type === 'heading' && r.text) push([{ s: ' '.repeat(ind), st: null }, { s: r.text, st: bold }]);
      else if (r.type === 'altHeader') { blank(); push([{ s: ' '.repeat(ind), st: null }, { s: G.tri + ' ' + r.label, st: bold }, { s: r.only ? '  [' + r.only + ']' : '', st: null }]); }
      else if (r.type === 'command') {
        const focus = ci === (ui.focus || 0);
        const label = (r.isFile ? 'File: ' + r.name : 'Command ' + (ci + 1)) + (focus ? '  ·  c copy  ·  o print plain' : '');
        push([{ s: ' '.repeat(ind), st: null }, { s: (focus ? G.cur + ' ' : '  ') + label, st: focus ? ui.sel : null }], { cmd: ci });
        const ci2 = ind + 2;
        const cl = r.code.split('\n');
        cl.forEach((l0, li) => {
          const l = (r.isFile ? '' : (li > 0 && /\\\s*$/.test(cl[li - 1]) ? '  ' : '$ ')) + l0;
          let rest = l, firstW = width - ci2;
          if (T.len(rest) <= firstW) { push([{ s: ' '.repeat(ci2), st: null }, { s: rest, st: bold }], { cmd: ci, code: true }); return; }
          push([{ s: ' '.repeat(ci2), st: null }, { s: [...rest].slice(0, firstW).join(''), st: bold }], { cmd: ci, code: true });
          rest = [...rest].slice(firstW).join('');
          while (rest.length) { const n = width - ci2 - 2; push([{ s: ' '.repeat(ci2 + 2), st: null }, { s: [...rest].slice(0, n).join(''), st: bold }], { cmd: ci, code: true }); rest = [...rest].slice(n).join(''); }
        });
        ci++;
      } else if (r.type === 'output') {
        push([{ s: ' '.repeat(ind), st: null }, { s: '  ' + L.expected_output + ':', st: null }]);
        r.lines.forEach(l => push([{ s: ' '.repeat(ind + 4), st: null }, { s: T.clip(l, width - ind - 4), st: null }]));
      } else if (r.type === 'callout') {
        const ic = { note: '[i]', caution: '[!]', warning: '/!\\' }[r.kind] || '[i]';
        para(r.blocks, ind, ic + ' ' + (L[r.kind] || r.kind) + ':');
      } else if (r.type === 'empty') {
        push([{ s: ' '.repeat(ind), st: null }, { s: '? ' + L.empty, st: bold }]);
        para(P('Your loadout: ' + E.loadoutText(p.facts) + '. Press a to show all ' + r.total + ' options, l to change your loadout.'), ind + 2);
      } else if (r.type === 'notice') push([{ s: ' '.repeat(ind), st: null }, { s: L.showing_all + ' (a: match my loadout)', st: null }]);
      else if (r.type === 'trouble') { push([{ s: ' '.repeat(ind), st: null }, { s: ' ' + G.fail + ' ' + L.troubleshooting + ' ', st: ui.sel }]); flow(words([{ t: 'text', v: L.common_fixes + ', or copy the AI prompt below (Tab to it, then c).' }]), ind, '', 0); }
    });
    return { lines, commands: ci };
  };

  // ---------- screens ----------
  T.render = function (E, o) {
    const w = o.w || 80, h = o.h || 24, ascii = !!o.ascii, mode = o.palette || 'dmg';
    const g = new Grid(w, h, ascii), G = T.glyphs(ascii), U = E.pal(mode, 'ui'), W = E.W, M = W.messages, L = W.labels;
    const barSt = ascii ? {} : { fg: U[0], bg: U[3], b: true };
    const sel = ascii ? { b: true } : { fg: U[3], bg: U[1], b: true };
    const p = o.p, view = o.view || 'title', ids = E.stageIds(), sid = o.stage || ids[0], th = E.themeStage(sid), sc = E.stage(sid), no = E.stageNo(sid);
    const tot = E.totals(p), gg = E.stageProgress(p, sid), wide = w >= 100, name = E.playerName(p), NAME = name.toUpperCase();
    const codes = E.S.codes, K = E.pal(mode, 'kai'), I = E.pal(mode, 'icons'), PL = E.pal(mode, 'player'), PO = E.pal(mode, 'portrait');
    const style = p.character || W.player.characters[o.charCursor || 0].id, plan = E.mentorPlan(name), mm = E.W.mentors.find(x => x.id === plan[sid]);
    const keys = s => g.bar(h - 1, ' ' + (o.toast || s), '', barSt);
    const xp = 'XP ' + String(p.xp).padStart(4, '0') + ' ';
    const stGlyph = s => ({ cleared: G.ok, current: G.now, skipped: G.skip, locked: G.lock })[s];
    const duo = (x, y, pose, kpose) => { g.sprite(x, y, E.pframe(style, pose, 0, true).map, PL, codes); g.sprite(x + 18, y, E.frame(kpose || 'idle', 0, true).map, K, codes); };
    const para = (x, y, s, n, st) => { const ls = T.wrap(s, n); ls.forEach((l, i) => g.put(x, y + i, l, st || {})); return ls.length; };

    if (view === 'title') {
      g.bar(0, ' ' + W.game.title + ' ' + W.game.edition, 'kai ', barSt);
      const lx = Math.floor((w - 36) / 2);
      g.sprite(lx, 2, E.S.logos.kairos, E.pal(mode, 'kairos'), codes);
      g.sprite(lx + 20, 2, E.S.logos.hadron, E.pal(mode, 'hadron'), codes);
      T.center(g, 11, W.game.title.split('').join(' ') + '   ' + W.game.edition.split('').join(' '), { b: true });
      T.center(g, 12, 'with ' + W.game.subtitle + ' Linux');
      let y = 14;
      if (h >= 40) { T.scene(g, E, Math.floor((w - 40) / 2), 14, 40, 'walk', mode, { kx: 12 }); y = 24; }
      const items = [['New game', ''], ['Continue', p.started ? name + ' ' + G.dot + ' ' + tot.done + '/' + tot.total + ' steps' : 'no save yet'], ['Plain view', W.links.plainView]];
      items.forEach(([l, d], i) => { const on = i === (o.cursor || 0), s = (on ? G.cur + ' ' : '  ') + l.padEnd(12) + d; g.put(Math.floor((w - 48) / 2), y + i * 2, s.padEnd(48), on ? sel : {}); });
      g.put(2, h - 3, T.clip(W.footer, w - 4));
      keys('up/down move ' + G.dot + ' Enter select ' + G.dot + ' q quit');
    } else if (view === 'name') {
      g.bar(0, ' NEW GAME', 'kai ', barSt);
      g.put(2, 2, "What's your name?", { b: true });
      para(2, 3, 'KAI calls you by this name, and it goes on your badge.', wide ? w - 26 : w - 4);
      T.box(g, 2, 6, 20, 3, {}, G); g.put(4, 7, (o.nameText || '') + '_', { b: true });
      g.put(2, 10, 'Type up to ' + W.player.nameMax + ' characters. Backspace deletes.');
      g.put(2, 11, 'Empty is fine: KAI will call you ' + W.player.defaultName + '.');
      if (wide) g.sprite(w - 20, 2, E.frame('wave', 0, true).map, K, codes); else g.sprite(w - 18, 6, E.frame('wave', 0, true).map, K, codes);
      keys('type your name ' + G.dot + ' Enter confirm ' + G.dot + ' Esc back');
    } else if (view === 'welcome') {
      const WL = W.welcome, wm = W.mentors.find(m => m.id === WL.mentor), pi = Math.min(o.welcomePage || 0, WL.pages.length - 1), pg = WL.pages[pi], last = pi === WL.pages.length - 1;
      g.bar(0, ' WELCOME ' + G.dot + ' ' + NAME, 'Page ' + (pi + 1) + ' of ' + WL.pages.length + ' ', barSt);
      T.box(g, 1, 1, 28, 14, {}, G);
      g.sprite(3, 2, E.S.portraits[wm.portrait], PO, codes);
      g.put(31, 2, wm.name, { b: true }); g.put(31, 3, wm.country);
      const txt = E.mdPlain(E.fill(pg.md, { name })).replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 <$2>');
      const ls = T.wrap(txt, w - 33); ls.slice(0, h - 8).forEach((l, i) => g.put(31, 5 + i, l));
      g.put(31, Math.min(h - 3, 6 + ls.length), WL.pages.map((x, i) => i <= pi ? (ascii ? '#' : '■') : (ascii ? '-' : '□')).join(' '));
      keys('Enter ' + (last ? WL.start.toLowerCase() : 'next') + ' ' + G.dot + ' left back ' + G.dot + ' q quit');
    } else if (view === 'character') {
      g.bar(0, ' NEW GAME ' + G.dot + ' ' + NAME, 'kai ', barSt);
      g.put(2, 2, 'Pick your look', { b: true });
      const cs = W.player.characters, cw = Math.floor((w - 4) / cs.length);
      cs.forEach((c, i) => {
        const x = 2 + i * cw, on = i === (o.charCursor || 0);
        g.sprite(x + Math.floor((cw - 16) / 2), 4, E.S.frames['p-' + c.id + '-down'], PL, codes);
        const lab = on ? '[' + c.label + ']' : ' ' + c.label + ' ';
        g.put(x + Math.floor((cw - T.len(lab)) / 2), 13, lab, on ? sel : { b: true });
        T.wrap(c.desc, cw - 2).forEach((l, j) => g.put(x + 1, 15 + j, l));
      });
      keys('left/right choose ' + G.dot + ' Enter confirm ' + G.dot + ' Esc back');
    } else if (view === 'loadout') {
      const LO = W.loadout, qs = E.loadoutQuestions(p.facts), qi = Math.min(o.lq || 0, qs.length - 1), q = qs[qi];
      g.bar(0, ' LOADOUT ' + G.dot + ' ' + NAME, E.fill(LO.progress, { n: qi + 1, total: qs.length }) + ' ', barSt);
      const cw = w - (wide ? 26 : 4);
      if (wide) g.sprite(w - 20, 2, E.S.frames.front, K, codes);
      let y = 2;
      const md = (s, x, st) => { const txt = E.mdPlain(s); T.wrap(txt, cw - (x - 2)).forEach(l => g.put(x, y++, l, st || {})); };
      if (q.type === 'notice') { const nt = LO.notices[q.id]; g.put(2, y++, nt.title, { b: true }); y++; md(nt.md, 2); }
      else {
        const fd = E.fact(q.id), qd = LO.questions[q.id] || {};
        g.put(2, y++, qd.title || fd.question, { b: true }); y++;
        fd.options.forEach((op, i) => {
          const od = (qd.options || {})[op.id] || {}, s = p.facts[q.id] === op.id, on = i === (o.optCursor ?? Math.max(0, fd.options.findIndex(x => x.id === p.facts[q.id])));
          g.put(2, y++, ((on ? G.cur : ' ') + ' ' + (s ? (ascii ? '(*) ' : '● ') : (ascii ? '( ) ' : '○ ')) + op.label + (od.badge ? '  [' + od.badge + ']' : '')).padEnd(Math.min(cw, 40)), on ? sel : { b: true });
          if (od.md && h >= 30) md(od.md, 8); else if (od.md) { g.put(8, y++, T.clip(E.mdPlain(od.md), cw - 6)); }
        });
        y++;
        if (qd.md) md(qd.md, 2);
        (qd.when || []).forEach(x => { if (E.strict(x.only, p.facts)) md(x.md, 2); });
        if (qd.help) { y++; g.put(2, y++, qd.help.label + ' ' + E.mdPlain(qd.help.md), { b: true }); g.put(6, y++, qd.help.code, { b: true }); md(qd.help.after, 2); }
      }
      keys('up/down choose ' + G.dot + ' Enter ' + (qi === qs.length - 1 ? 'start' : 'next') + ' ' + G.dot + ' Esc back ' + G.dot + ' q quit');
    } else if (view === 'map') {
      g.bar(0, ' ' + M.map_title + ' ' + G.dot + ' ' + NAME, xp, barSt);
      const cur = o.mapCursor || 0;
      let y0 = 2;
      if (wide) {
        const eu = E.S.europe, stops = E.routeStops(ids.length), ww = w - 4, hh = 32, sx = 2;
        const cx = stops[cur][0] / 2, cy = stops[cur][1] / 2, ox = Math.max(0, Math.min(eu.w / 2 - ww, Math.round(cx - ww / 2))), oy = Math.max(0, Math.min(eu.h / 2 - hh, Math.round(cy - hh / 2)));
        const Lnd = (a, b2) => eu.rows[b2] && eu.rows[b2][a] === '1', rows = [];
        for (let yy = 0; yy < hh; yy++) { let r = ''; for (let xx = 0; xx < ww; xx++) { const a = (ox + xx) * 2, b2 = (oy + yy) * 2, land = Lnd(a, b2), coast = land && (!Lnd(a - 2, b2) || !Lnd(a + 2, b2) || !Lnd(a, b2 - 2) || !Lnd(a, b2 + 2)); r += coast ? '3' : land ? '2' : ((xx + yy * 3) % 11 === 0 ? '1' : '0'); } rows.push(r); }
        stops.forEach(([a, b2]) => { const x2 = Math.round(a / 2) - ox, y2 = Math.round(b2 / 2) - oy; [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([dx, dy]) => { const yy = y2 + dy, xx = x2 + dx; if (yy >= 0 && yy < hh && xx >= 0 && xx < ww) rows[yy] = rows[yy].slice(0, xx) + '0' + rows[yy].slice(xx + 1); }); });
        g.sprite(sx, 2, rows, E.pal(mode, 'world'), codes);
        stops.forEach(([a, b2], i) => { const x2 = sx + Math.round(a / 2) - ox, y2 = 2 + Math.floor((Math.round(b2 / 2) - oy) / 2); if (x2 >= sx && x2 < w - 4 && y2 >= 2 && y2 < 2 + hh / 2) g.put(x2 + 2, y2, stGlyph(E.stageState(p, ids[i])) + (i + 1), i === cur ? sel : barSt); });
        y0 = 3 + hh / 2;
      }
      g.put(2, y0, T.clip((tot.cleared + tot.skipped) + ' of ' + tot.stages + ' stops done ' + G.dot + ' ' + tot.done + '/' + tot.total + ' steps ' + G.dot + ' ' + p.xp + ' XP', w - 4), { b: true });
      const rowsN = Math.max(1, Math.floor((h - 2 - (y0 + 2)) / 2)), start = Math.max(0, Math.min(cur - Math.floor(rowsN / 2), ids.length - rowsN));
      ids.slice(start, start + rowsN).forEach((id, j) => {
        const i = start + j, state = E.stageState(p, id), q = E.stageProgress(p, id), on = i === cur, y = y0 + 2 + j * 2, m2 = E.W.mentors.find(x => x.id === plan[id]);
        const head = (on ? G.cur : ' ') + ' ' + stGlyph(state) + ' ' + ((i + 1) + ' ' + E.themeStage(id).location).padEnd(17);
        const pgc = E.page(mode), clr = ascii ? { b: true } : { fg: pgc.onCleared, bg: pgc.cleared, b: true };
        g.put(1, y, T.clip(head + E.stage(id).title, w - 2).padEnd(w - 2), on ? sel : state === 'cleared' ? clr : { b: state !== 'locked' });
        const nsk = state === 'current' ? E.skipBlock(p, id) : '';
        const tail = state === 'locked' ? 'locked ' + G.dot + ' finish or skip stop ' + i + ' first' : state + (nsk ? ' ' + G.dot + ' ' + L.no_skip.toLowerCase() + ': ' + nsk : '') + (q.side ? ' ' + G.dot + ' ' + G.side + ' ' + q.sideDone + '/' + q.side : '');
        g.put(7, y + 1, T.clip(T.pbar(q.done, q.total, 8, G) + ' ' + q.done + '/' + q.total + ' ' + G.dot + ' with ' + E.first(m2) + ' ' + G.dot + ' ' + tail, w - 8));
      });
      if (start > 0) g.put(w - 2, y0 + 2, G.up, { b: true });
      if (start + rowsN < ids.length) g.put(w - 2, h - 3, G.down, { b: true });
      if (o.skipAsk) keys(T.clip('Skip ' + E.themeStage(ids[cur]).location + '? You can come back any time. y yes ' + G.dot + ' n no', w - 2));
      else keys('up/down move ' + G.dot + ' Enter open ' + G.dot + ' s skip ' + G.dot + ' l loadout ' + G.dot + ' q quit');
    } else if (view === 'mentor') {
      g.bar(0, ' STOP ' + no + ' ' + th.location + ' ' + G.dot + ' ' + NAME, xp, barSt);
      T.box(g, 1, 1, 28, 14, {}, G);
      g.sprite(3, 2, E.S.portraits[mm.portrait], PO, codes);
      g.put(31, 2, 'Mentor', {}); g.put(31, 3, mm.name, { b: true }); g.put(31, 4, mm.country);
      para(31, 6, E.fill(M.mentor_intro, { mentor: E.first(mm), goal: sc.goal }), w - 33, { b: true });
      duo(31, 9, 'happy', 'wave');
      keys('Enter start ' + G.dot + ' m route ' + G.dot + ' q quit');
    } else if (view === 'stage') {
      const steps = E.steps(sid, p.facts), si = Math.min(o.step || 0, steps.length - 1), st = steps[si], failed = o.status === 'failed';
      g.bar(0, ' ST' + no + ' ' + th.location + ' ' + G.dot + ' ' + NAME, 'STEPS ' + T.pbar(gg.done, gg.total, gg.total, G) + ' ' + gg.done + '/' + gg.total + '  ' + xp, barSt);
      const ins = T.instructions(E, p, st, sid, wide ? w - 44 : w - 2, { ascii, sel, focus: o.focus || 0, status: o.status, showAll: o.showAll });
      const anim = failed ? 'sad' : ins.commands ? 'point' : 'read';
      const dlg = failed ? [M.fail_head + ' ' + G.dot + ' ' + M.fail_sub, M.fail_line] : o.status === 'tip' ? [st.title, M.tip_line] : [st.title, st.line];
      const sub = ' Step ' + (si + 1) + ' of ' + steps.length + ' ' + G.dot + ' ' + st.title + (st.optional ? ' ' + G.dot + ' ' + G.side + ' side quest (optional)' : '');
      const scene2 = (x0, y0) => { T.scene(g, E, x0, y0, 40, anim, mode, { kx: 22 }); g.sprite(x0 + 4, y0, E.pframe(style, anim === 'sad' ? 'sad' : anim, 0, true).map, PL, codes); };
      let ix, iy, ih;
      if (!wide) {
        scene2(0, 1);
        const bw = w - 41; T.box(g, 41, 1, bw, 8, {}, G);
        const dl = []; dlg.forEach((d, i) => T.wrap(d, bw - 4).forEach(l => dl.push({ l, b: i === 0 })));
        dl.slice(0, 6).forEach((d, i) => g.put(43, 2 + i, d.l, d.b ? { b: true } : {}));
        g.bar(9, sub, '', sel);
        ix = 0; iy = 10; ih = h - 12;
      } else {
        scene2(0, 1);
        T.box(g, 0, 9, 40, 8, {}, G);
        const dl = []; dlg.forEach((d, i) => T.wrap(d, 36).forEach(l => dl.push({ l, b: i === 0 })));
        dl.slice(0, 6).forEach((d, i) => g.put(2, 10 + i, d.l, d.b ? { b: true } : {}));
        g.put(1, 18, 'Steps ' + G.dot + ' with ' + E.first(mm), { b: true });
        steps.forEach((x, i) => { const d = p.done[E.stepKey(sid, x.id)], m = d ? G.ok : x.optional ? G.side : G.todo; g.put(1, 19 + i, T.clip((i === si ? G.cur : ' ') + ' ' + m + ' ' + (i + 1) + ' ' + x.title, 38), i === si ? sel : {}); });
        g.put(1, 20 + steps.length, 'Loadout', { b: true });
        T.wrap(E.loadoutText(p.facts), 37).forEach((l, i) => g.put(2, 21 + steps.length + i, l));
        g.fill(42, 1, w - 42, 1, sel); g.put(42, 1, T.clip(sub, w - 42), sel);
        ix = 42; iy = 2; ih = h - 5;
      }
      const scroll = Math.max(0, Math.min(o.scroll || 0, Math.max(0, ins.lines.length - ih)));
      ins.lines.slice(scroll, scroll + ih).forEach((ln, j) => { let x = ix; ln.segs.forEach(sg => { g.put(x, iy + j, sg.s, sg.st || {}); x += T.len(sg.s); }); });
      if (scroll > 0) g.put(w - 1, iy, G.up, { b: true });
      if (scroll + ih < ins.lines.length) g.put(w - 1, iy + ih - 1, G.down, { b: true });
      const done = p.done[E.stepKey(sid, st.id)];
      g.put(wide ? 42 : 0, h - 2, T.clip(' Check (' + E.checkKind(st).label + '): ' + st.check.prompt + (done ? '  ' + G.ok + ' cleared' : ''), wide ? w - 42 : w), { b: true });
      const tipK = E.isMaster(p.facts) ? ' ' + G.dot + ' t TIP' : '';
      keys(done ? 'Enter next step ' + G.dot + ' left/right steps ' + G.dot + ' up/down scroll ' + G.dot + ' Tab cmd ' + G.dot + ' c copy' + tipK + ' ' + G.dot + ' m route'
        : 'Enter ' + L.next_step.toLowerCase() + ' ' + G.dot + ' n ' + L.did_not_work.toLowerCase() + ' ' + G.dot + ' up/down ' + G.dot + ' Tab ' + G.dot + ' c copy' + tipK + ' ' + G.dot + ' m route');
    } else {
      const k = view;
      g.bar(0, ' ST' + no + ' ' + th.location + ' ' + G.dot + ' ' + NAME, xp, barSt);
      const kx = Math.floor((w - 34) / 2);
      if (k === 'clear-step') {
        duo(kx, 2, 'celebrate', 'celebrate');
        T.center(g, 11, (o.clear && o.clear.optional) ? M.side_clear : M.step_clear, { b: true });
        T.center(g, 12, T.clip('+' + ((o.clear && o.clear.xp) || W.xp.step) + ' XP ' + G.dot + ' ' + gg.done + ' of ' + gg.total + ' steps at ' + th.location, w - 4));
        T.center(g, 14, T.clip(E.fill(M.step_clear_line, { name }), w - 4));
        keys('Enter continue ' + G.dot + ' m route ' + G.dot + ' q quit');
      } else if (k === 'clear-stage') {
        g.sprite(kx - 10, 2, E.S.portraits[mm.portrait], PO, codes);
        g.sprite(kx + 18, 2, E.frame('jump', 0, true).map, K, codes);
        g.sprite(kx + 36, 2, E.pframe(style, 'celebrate', 0, true).map, PL, codes);
        T.center(g, 15, M.stage_clear + ' ' + G.dot + ' STOP ' + no + ' ' + th.location, { b: true });
        T.center(g, 16, T.clip(E.fill(M.mentor_outro, { name, mentor: E.first(mm) }), w - 4), { b: true });
        T.center(g, 17, T.clip(sc.title + ' ' + G.dot + ' ' + gg.done + '/' + gg.total + ' steps', w - 4));
        keys('Enter collect items ' + G.dot + ' m route ' + G.dot + ' q quit');
      } else if (k === 'items') {
        g.put(2, 2, M.item_head, { b: true });
        const inv = E.inventory(p);
        E.stageItems(sid).forEach((it, i) => {
          const y = 4 + i * 5, mg = it.part ? inv.find(x => x.id === it.id) : null, d = mg || E.W.items[it.id];
          g.sprite(3, y, E.S.icons[d.icon] || E.S.icons.unknown, I, codes);
          g.put(14, y, mg ? mg.name + ' ' + mg.have + '/' + mg.total + ' ' + G.dot + ' part ' + it.part + ': ' + mg.parts[it.part - 1].label : d.name, { b: true });
          g.put(14, y + 1, T.clip(d.desc, w - 16));
          if (mg) { const nx = mg.parts.find(x => !x.owned); g.put(14, y + 2, T.clip(!nx ? 'Complete!' : nx.soon ? 'Part ' + nx.n + ', ' + nx.label + ': coming soon' : 'Next part: ' + nx.label + ' (stop ' + E.stageNo(nx.stage) + ')', w - 16)); }
        });
        keys('Enter continue ' + G.dot + ' m route ' + G.dot + ' q quit');
      } else if (k === 'complete') {
        g.bar(0, ' ' + M.complete_head + ' ' + G.dot + ' ' + NAME, xp, barSt);
        g.put(2, 2, T.clip(E.fill(M.complete_line, { name }), w - 4), { b: true });
        g.put(2, 3, T.clip(tot.done + '/' + tot.total + ' steps ' + G.dot + ' ' + tot.cleared + ' cleared ' + G.dot + ' ' + tot.skipped + ' skipped ' + G.dot + ' ' + p.xp + ' XP', w - 4));
        ids.forEach((id, i) => { const q = E.stageProgress(p, id), s2 = E.stageState(p, id), m2 = E.W.mentors.find(x => x.id === plan[id]); g.put(2, 5 + i, T.clip(stGlyph(s2) + ' ' + ((i + 1) + ' ' + E.themeStage(id).location).padEnd(17) + (s2 === 'skipped' ? 'skipped' : q.done + '/' + q.total).padEnd(9) + E.first(m2).padEnd(10) + E.stage(id).title, w - 4)); });
        const inv = E.inventory(p), y1 = 6 + ids.length;
        const invS = inv.map(it => it.mega ? it.name + ' ' + it.have + '/' + it.total + (it.parts.some(x => x.soon) ? ' (+netboot soon)' : '') : it.owned ? it.name : M.unknown_item).join('  ');
        T.wrap('Items: ' + invS, w - 4).slice(0, h >= 40 ? 6 : 2).forEach((l, i) => g.put(2, y1 + i, l));
        const cy = h >= 40 ? y1 + 7 : h - 3;
        g.put(2, cy, T.clip(L.cta, w - 4), { b: true });
        if (h >= 40) {
          const inst = E.stage(ids[0]).steps[0].blocks.find(b2 => b2.type === 'alternatives');
          let yy = cy + 1;
          inst.items.slice(0, 2).filter(x => E.matches(x.only, p.facts)).forEach(x => { g.put(4, yy++, x.label + ' [' + E.onlyText(x.only) + ']'); x.blocks[0].code.split('\n').forEach(l => g.put(6, yy++, T.clip(l, w - 8), { b: true })); yy++; });
        }
        keys('Enter badge ' + G.dot + ' m route ' + G.dot + ' q quit');
      } else if (k === 'badge') {
        g.bar(0, ' ' + M.badge_title + ' ' + G.dot + ' ' + NAME, '', barSt);
        const bw = 36, bx = Math.floor((w - bw) / 2);
        T.box(g, bx, 2, bw, 16, {}, G);
        g.sprite(bx + 10, 3, E.S.frames.front.slice(0, 10), K, codes);
        g.put(bx + 11, 3, '', {});
        T.center(g, 10, M.badge_title, { b: true });
        T.center(g, 12, NAME.slice(0, 12), { b: true });
        T.center(g, 14, p.completedAt || E.today());
        T.center(g, 16, G.side + ' ' + tot.cleared + ' stops ' + G.dot + ' ' + p.xp + ' XP ' + G.side);
        keys('m route ' + G.dot + ' q quit');
      }
    }
    return g;
  };

  T.ASCII = {"»":">","·":"-","↑":"^","↓":"v","←":"<","→":">","…":"~","✓":"x","✗":"x","▶":">","●":"*","☆":"*","■":"#","□":"-","▸":">","×":"x","“":"\"","”":"\"","‘":"'","’":"'","⤷":">","—":"-","–":"-","░":".","▒":"+","█":"#"};
  T.toAscii = ch => ch.charCodeAt(0) < 128 ? ch : (T.ASCII[ch] || '?');
  T.esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  T.toHTML = function (g, dflt) {
    dflt = dflt || { fg: '#D8DEE0', bg: '#101414' };
    let out = '';
    for (let y = 0; y < g.h; y++) {
      let run = null, buf = '';
      const flush = () => { if (!run) return; out += '<span style="color:' + (run.fg || dflt.fg) + ';background:' + (run.bg || 'transparent') + (run.b ? ';font-weight:600' : '') + '">' + T.esc(buf) + '</span>'; buf = ''; };
      for (let x = 0; x < g.w; x++) {
        const c = g.c[y][x], k = (c.fg || '') + '|' + (c.bg || '') + '|' + c.b;
        if (!run || run.k !== k) { flush(); run = { k, fg: c.fg, bg: c.bg, b: c.b }; }
        buf += g.ascii ? T.toAscii(c.ch) : c.ch;
      }
      flush(); out += '\n';
    }
    return out;
  };
  window.KAIT = T;
})();
