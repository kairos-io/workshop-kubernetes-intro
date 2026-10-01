// KAI engine: loads kai-sprites.json + theme.json + content.json.
// Pixel drawing, fact filtering, block flattening, progress. Shared by every web page.
(function () {
  if (window.KAIE) return;
  let P = null;
  const PROGRESS_KEY = 'kai.workshop.v2';
  const E = {
    S: null, W: null, C: null,
    load() {
      if (!P) P = Promise.all(['kai-sprites.json', 'theme.json', 'content.json'].map(f => fetch(f).then(r => {
        if (!r.ok) throw new Error(f + ' ' + r.status); return r.json();
      }))).then(([S, W, C]) => { E.S = S; E.W = W; E.C = C; return E; });
      return P;
    },
    ready() { return !!(E.S && E.W && E.C); },

    // ---------- pixels ----------
    palette(mode) { return E.S.palettes[mode] || E.S.palettes.dmg; },
    pal(mode, region) { const p = E.palette(mode); return p[region] || p.world; },
    page(mode) { return E.palette(mode).page; },
    draw(ctx, map, colors, x, y, opt) {
      opt = opt || {};
      const codes = E.S.codes, sc = opt.scale || 1;
      for (let r = 0; r < map.length; r++) {
        const row = map[r];
        for (let c = 0; c < row.length; c++) {
          const ch = row[opt.flip ? row.length - 1 - c : c];
          if (ch === '.' || ch === ' ') continue;
          let i = (ch >= '0' && ch <= '3') ? +ch : codes[ch];
          if (opt.mono != null) i = opt.mono;
          ctx.fillStyle = colors[i];
          ctx.fillRect(x + c * sc, y + r * sc, sc, sc);
        }
      }
    },
    rect(ctx, color, x, y, w, h) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); },
    box(ctx, C, x, y, w, h, inv) {
      E.rect(ctx, C[3], x, y, w, h);
      E.rect(ctx, inv ? C[3] : C[0], x + 2, y + 2, w - 4, h - 4);
      E.rect(ctx, inv ? C[0] : C[2], x + 3, y + 3, w - 6, 1);
      E.rect(ctx, inv ? C[3] : C[0], x + 3, y + 4, w - 6, h - 7);
    },
    tile(ctx, map, colors, x0, y0, w, h, ox, oy) {
      ox = ox || 0; oy = oy || 0;
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
        const ch = map[((y - oy) % 8 + 8) % 8][((x - ox) % 8 + 8) % 8];
        ctx.fillStyle = colors[+ch]; ctx.fillRect(x, y, 1, 1);
      }
    },
    frame(anim, tick, reduced) {
      const A = E.S.animations, a = A[anim] || A.idle;
      const i = reduced ? 0 : Math.floor(tick * a.fps / 8) % a.frames.length;
      const [name, flag] = a.frames[i].split(':');
      return { map: E.S.frames[name], flip: flag === 'flip', dy: reduced ? 0 : ((a.dy && a.dy[i]) || 0), anim: a, i };
    },
    drawIcon(canvas, id, mode, size) {
      if (!canvas || !E.ready()) return;
      const m = E.S.icons[id] || E.S.frames[id]; if (!m) return;
      const x = canvas.getContext('2d'), n = m.length;
      x.clearRect(0, 0, canvas.width, canvas.height);
      E.draw(x, m, E.pal(mode, E.S.frames[id] ? 'kai' : 'icons'), Math.floor((canvas.width - m[0].length) / 2), Math.floor((canvas.height - n) / 2));
    },

    // ---------- text ----------
    fill(str, vars) { return String(str).replace(/\{(\w+)\}/g, (m, k) => vars && vars[k] != null ? vars[k] : m); },
    wrap(text, n) {
      n = n || 18;
      const out = [];
      String(text == null ? '' : text).split('\n').forEach(par => {
        let line = '';
        par.split(/\s+/).filter(Boolean).forEach(w => {
          while (w.length > n) { if (line) { out.push(line); line = ''; } out.push(w.slice(0, n)); w = w.slice(n); }
          if (!line) line = w;
          else if ((line + ' ' + w).length <= n) line += ' ' + w;
          else { out.push(line); line = w; }
        });
        out.push(line);
      });
      return out;
    },
    // Inline markdown: **bold**, \`code\`, [label](url). Link labels may contain \`code\`.
    inline(par) {
      const segs = [], re = /(\*\*[^*]+\*\*|\`[^\`]+\`|\[[^\]]+\]\([^)]+\))/g;
      let last = 0, m;
      while ((m = re.exec(par))) {
        if (m.index > last) segs.push({ t: 'text', v: par.slice(last, m.index) });
        const tok = m[0];
        if (tok[0] === '*') segs.push({ t: 'b', v: tok.slice(2, -2) });
        else if (tok[0] === '\`') segs.push({ t: 'code', v: tok.slice(1, -1) });
        else {
          const mm = tok.match(/\[([^\]]+)\]\(([^)]+)\)/), parts = mm[1].split(/(\`[^\`]+\`)/).filter(Boolean).map(x => x[0] === '\`' ? { v: x.slice(1, -1), code: true } : { v: x, code: false });
          segs.push({ t: 'a', v: parts.map(x => x.v).join(''), href: mm[2], parts });
        }
        last = m.index + tok.length;
      }
      if (last < par.length) segs.push({ t: 'text', v: par.slice(last) });
      return segs;
    },
    // Block markdown: paragraphs (blank line), "- " unordered and "1. " ordered lists.
    // Returns [{k:'p', segs}] | [{k:'ul'|'ol', items:[segs], start}]
    md(s) {
      const out = [];
      String(s || '').split(/\n\s*\n/).forEach(par => {
        const lines = par.split('\n'), li = /^\s*(?:([-*])|(\d+)[.)])\s+(.*)$/;
        let buf = [];
        const flushP = () => { if (buf.length) { out.push({ k: 'p', segs: E.inline(buf.join(' ')) }); buf = []; } };
        lines.forEach(l => {
          const m = l.match(li);
          if (!m) { const prev = out[out.length - 1]; if (!buf.length && prev && prev.k !== 'p' && /^\s+\S/.test(l)) { const it = prev.items[prev.items.length - 1]; it.push({ t: 'text', v: ' ' }, ...E.inline(l.trim())); } else buf.push(l.trim()); return; }
          flushP();
          const k = m[1] ? 'ul' : 'ol', prev = out[out.length - 1];
          if (prev && prev.k === k && prev.open) prev.items.push(E.inline(m[3]));
          else out.push({ k, items: [E.inline(m[3])], start: m[2] ? +m[2] : 1, open: true });
        });
        flushP();
        out.forEach(b => { b.open = false; });
      });
      return out.filter(b => b.k !== 'p' || b.segs.length);
    },
    mdPlain(s) { return E.md(s).map(b => b.k === 'p' ? b.segs.map(g => g.v).join('') : b.items.map((it, i) => (b.k === 'ol' ? (b.start + i) + '. ' : '- ') + it.map(g => g.v).join('')).join('\n')).join('\n\n'); },
    cmdLines(code, isFile) {
      const ls = String(code).split('\n');
      return ls.map((text, i) => ({ text, cont: !isFile && i > 0 && /\\\s*$/.test(ls[i - 1]), prompt: !isFile && !(i > 0 && /\\\s*$/.test(ls[i - 1])) }));
    },

    // ---------- facts ----------
    fact(id) { return E.C.facts.find(f => f.id === id); },
    optLabel(fid, oid) {
      if (oid === 'unsure' || oid == null) return 'Not sure yet';
      const f = E.fact(fid), o = f && f.options.find(o => o.id === oid);
      return o ? o.label : oid;
    },
    defaultFacts() { const o = {}; E.C.facts.forEach(f => o[f.id] = 'unsure'); return o; },
    matches(only, facts) {
      if (!only) return true;
      return Object.keys(only).every(k => { const v = facts && facts[k]; return !v || v === 'unsure' || only[k].includes(v); });
    },
    unset(facts, k) { const v = facts && facts[k]; return !v || v === 'unsure'; },
    onlyLabel(only, facts) {
      if (!only) return '';
      const keys = Object.keys(only).filter(k => E.unset(facts, k));
      if (!keys.length) return '';
      const o = {}; keys.forEach(k => o[k] = only[k]); return E.onlyText(o);
    },
    onlyText(only) {
      if (!only) return '';
      return E.W.labels.only_if + ': ' + Object.keys(only).map(k => only[k].map(o => E.optLabel(k, o)).join(' or ')).join(', ');
    },
    loadoutText(facts) {
      return E.C.facts.map(f => facts[f.id] && facts[f.id] !== 'unsure' ? E.optLabel(f.id, facts[f.id]) : null).filter(Boolean).join(' · ') || 'Not sure yet (showing everything)';
    },

    // Flatten blocks into rows both renderers (web + terminal) walk top to bottom.
    // opts: { key, facts, sel: {altKey: index}, showAll: {altKey: true}, layout: 'tabs'|'stacked', inset }
    flatten(blocks, opts, out) {
      out = out || [];
      const facts = opts.facts || {}, inset = opts.inset || 0;
      (blocks || []).forEach((b, bi) => {
        const key = opts.key + '/' + bi;
        if (b.type !== 'alternatives' && !E.matches(b.only, facts)) return;
        const only = E.onlyLabel(b.only, facts);
        if (b.type === 'text') out.push({ type: 'text', key, inset, md: b.md, blocks: E.md(b.md), only });
        else if (b.type === 'command' || b.type === 'file') out.push({ type: 'command', key, inset, isFile: b.type === 'file', name: b.name || '', code: b.code, lines: E.cmdLines(b.code, b.type === 'file'), only });
        else if (b.type === 'output') out.push({ type: 'output', key, inset, lines: String(b.text).split('\n'), only });
        else if (b.type === 'callout') out.push({ type: 'callout', key, inset, kind: b.kind, md: b.md, blocks: E.md(b.md), only });
        else if (b.type === 'alternatives') {
          const all = !!(opts.showAll && opts.showAll[key]);
          const items = b.items.map((it, i) => ({ ...it, i, vis: all || E.matches(it.only, facts) })).filter(it => it.vis);
          out.push({ type: 'heading', key: key + '/h', inset, text: b.title || '' });
          if (!items.length) { out.push({ type: 'empty', key, inset, total: b.items.length }); return; }
          if (all) out.push({ type: 'notice', key: key + '/n', inset });
          const sub = { ...opts, facts: all ? {} : facts, inset: inset + 1 };
          if ((opts.layout || 'tabs') === 'tabs' && items.length > 1) {
            let sel = opts.sel && opts.sel[key];
            if (!items.some(it => it.i === sel)) sel = items[0].i;
            out.push({ type: 'tabs', key, inset, tabs: items.map(it => ({ i: it.i, label: it.label, only: E.onlyLabel(it.only, sub.facts), selected: it.i === sel })) });
            const it = b.items[sel];
            E.flatten(it.blocks, { ...sub, key: key + '/' + sel }, out);
          } else {
            items.forEach(it => {
              out.push({ type: 'altHeader', key: key + '/' + it.i + '/h', inset: inset + 1, label: it.label, only: E.onlyLabel(it.only, sub.facts) });
              E.flatten(it.blocks, { ...sub, key: key + '/' + it.i }, out);
            });
          }
        }
      });
      return out;
    },

    // ---------- stages & progress (stage ids are slugs; order comes from content.json) ----------
    themeStage(id) { return E.W.stages.find(s => s.id === id) || { id, location: String(id).toUpperCase(), nodes: 0, items: [] }; },
    stage(id) { return E.C.stages.find(s => s.id === id) || E.C.stages[0]; },
    stageIds() { return E.C.stages.map(s => s.id); },
    stageNo(id) { return E.stageIds().indexOf(id) + 1; },
    steps(id, facts) { return E.stage(id).steps.filter(s => E.matches(s.only, facts)); },
    stepKey(sid, stepId) { return sid + '/' + stepId; },
    newProgress() {
      return { v: 2, started: false, name: '', character: '', virtName: '', facts: E.defaultFacts(), done: {}, skipped: {}, xp: 0, completedAt: null,
        last: { stage: E.stageIds()[0], step: 0 }, settings: { palette: 'dmg', motion: 'system', text: 'm', layout: 'tabs' } };
    },
    loadProgress() {
      try { const p = JSON.parse(localStorage.getItem(PROGRESS_KEY)); if (p && p.v === 2) { const n = E.newProgress(); return { ...n, ...p, facts: { ...n.facts, ...p.facts }, settings: { ...n.settings, ...p.settings }, skipped: p.skipped || {} }; } } catch (e) {}
      return E.newProgress();
    },
    saveProgress(p) { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch (e) {} },
    // seed: { name, character, facts, cleared: N (first N stages), skipped: [ids], done: [keys], xp, started, settings, completedAt }
    seedProgress(seed) {
      const p = E.newProgress();
      if (!seed) return p;
      p.started = seed.started ?? true;
      p.name = seed.name ?? (p.started ? E.W.player.defaultName : '');
      p.character = seed.character ?? (p.started ? E.W.player.characters[0].id : '');
      p.virtName = seed.virtName ?? '';
      Object.assign(p.facts, seed.facts || {});
      Object.assign(p.settings, seed.settings || {});
      E.C.stages.forEach((s, i) => { if (i < (seed.cleared || 0)) s.steps.forEach(st => { if (!st.optional) p.done[E.stepKey(s.id, st.id)] = true; }); });
      (seed.skipped || []).forEach(id => p.skipped[id] = true);
      (seed.done || []).forEach(k => p.done[k] = true);
      p.xp = seed.xp ?? Object.keys(p.done).length * E.W.xp.step;
      p.completedAt = seed.completedAt ?? (E.allDone(p) ? new Date().toISOString().slice(0, 10) : null);
      return p;
    },
    stageProgress(p, id) {
      const st = E.steps(id, p.facts), req = st.filter(s => !s.optional), side = st.filter(s => s.optional);
      const isDone = s => !!p.done[E.stepKey(id, s.id)];
      return { done: req.filter(isDone).length, total: req.length, side: side.length, sideDone: side.filter(isDone).length };
    },
    stageCleared(p, id) { const g = E.stageProgress(p, id); return g.total > 0 && g.done === g.total; },
    stagePassed(p, id) { return E.stageCleared(p, id) || !!(p.skipped && p.skipped[id]); },
    stageState(p, id) {
      if (E.stageCleared(p, id)) return 'cleared';
      if (p.skipped && p.skipped[id]) return 'skipped';
      const ids = E.stageIds(), i = ids.indexOf(id);
      return (i <= 0 || E.stagePassed(p, ids[i - 1])) ? 'current' : 'locked';
    },
    currentStage(p) { return E.stageIds().find(id => E.stageState(p, id) === 'current') || null; },
    allDone(p) { return E.stageIds().every(id => E.stagePassed(p, id)); },
    totals(p) {
      let done = 0, total = 0, cleared = 0, skipped = 0, side = 0;
      E.stageIds().forEach(id => { const g = E.stageProgress(p, id); done += g.done; total += g.total; side += g.sideDone; if (E.stageCleared(p, id)) cleared++; else if (p.skipped && p.skipped[id]) skipped++; });
      return { done, total, cleared, skipped, side, stages: E.stageIds().length };
    },
    firstOpenStep(p, id) {
      const st = E.steps(id, p.facts), i = st.findIndex(s => !s.optional && !p.done[E.stepKey(id, s.id)]);
      return i < 0 ? 0 : i;
    },

    // ---------- mentors: random but stable, from the player's name + stage ids ----------
    fnv1a(s) { let h = 0x811c9dc5; for (const c of new TextEncoder().encode(s)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; },
    mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; }; },
    mentorPlan(name) {
      const n = String(name || '').trim().toLowerCase(), ids = E.stageIds(), M = E.W.mentors.map(m => m.id), out = {};
      let prev = null;
      for (let b = 0; b * M.length < ids.length; b++) {
        const block = ids.slice(b * M.length, (b + 1) * M.length), r = E.mulberry(E.fnv1a(n + '|' + block.join(','))), perm = M.slice();
        for (let i = perm.length - 1; i > 0; i--) { const j = r() % (i + 1); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
        if (prev && perm[0] === prev && perm.length > 1) { const t = perm[0]; perm[0] = perm[1]; perm[1] = t; }
        block.forEach((id, i) => out[id] = perm[i]);
        prev = perm[block.length - 1];
      }
      return out;
    },
    mentor(name, stageId) { const id = E.mentorPlan(name)[stageId]; return E.W.mentors.find(m => m.id === id) || E.W.mentors[0]; },
    first(m) { return String(m.name).split(' ')[0]; },
    drawPortrait(canvas, mentorId, mode) {
      if (!canvas || !E.ready()) return;
      const m = E.W.mentors.find(x => x.id === mentorId), map = m && E.S.portraits[m.portrait];
      if (!map) return;
      const x = canvas.getContext('2d'); x.clearRect(0, 0, canvas.width, canvas.height);
      E.draw(x, map, E.pal(mode, 'portrait'), Math.floor((canvas.width - 24) / 2), Math.floor((canvas.height - 24) / 2));
    },

    // ---------- items ----------
    parseItem(s) { const [id, part] = String(s).split('#'); return { id, part: part ? +part : 0 }; },
    stageItems(id) { return (E.themeStage(id).items || []).map(E.parseItem); },
    inventory(p) {
      const owned = {}, grants = {};
      E.stageIds().forEach(sid => E.stageItems(sid).forEach(it => {
        const k = it.part ? it.id + '#' + it.part : it.id;
        grants[k] = sid;
        if (E.stageCleared(p, sid)) owned[k] = true;
      }));
      const list = [];
      E.stageIds().forEach(sid => E.stageItems(sid).forEach(it => {
        if (it.part) { if (!list.some(x => x.id === it.id)) list.push(E.megaState(it.id, owned, grants)); return; }
        const d = E.W.items[it.id] || { name: it.id, icon: 'unknown', desc: '' };
        list.push({ id: it.id, name: d.name, icon: d.icon, desc: d.desc, owned: !!owned[it.id], stage: sid, mega: false });
      }));
      return list;
    },
    megaState(id, owned, grants) {
      const d = E.W.mega[id];
      const parts = d.parts.map((pt, i) => { const k = id + '#' + (i + 1); return { n: i + 1, label: pt.label, icon: pt.icon || d.icon, stage: grants[k] || null, owned: !!owned[k], soon: !grants[k] }; });
      return { id, name: d.name, icon: d.icon, desc: d.desc, mega: true, parts, have: parts.filter(x => x.owned).length, total: parts.length, owned: parts.some(x => x.owned) };
    },

    // ---------- player ----------
    pframe(style, pose, tick, reduced) {
      const A = E.S.playerAnimations, a = A[pose] || A.idle;
      const i = reduced ? 0 : Math.floor(tick * a.fps / 8) % a.frames.length;
      const [name, flag] = a.frames[i].split(':');
      return { map: E.S.frames['p-' + (style || 'hoodie') + '-' + name] || E.S.frames['p-hoodie-down'], flip: flag === 'flip', dy: reduced ? 0 : ((a.dy && a.dy[i]) || 0) };
    },
    playerName(p) { return (p && p.name) || E.W.player.defaultName; },

    // ---------- route across Europe ----------
    // N stops spread evenly along the route polyline, so any number of stages fits.
    routeStops(n) {
      const R = E.S.europe.route, seg = [];
      let total = 0;
      for (let i = 0; i < R.length - 1; i++) { const l = Math.hypot(R[i + 1][0] - R[i][0], R[i + 1][1] - R[i][1]); seg.push(l); total += l; }
      const out = [];
      for (let k = 0; k < n; k++) {
        let d = n === 1 ? 0 : total * k / (n - 1), i = 0;
        while (i < seg.length - 1 && d > seg[i]) { d -= seg[i]; i++; }
        const t = seg[i] ? Math.min(1, d / seg[i]) : 0;
        out.push([Math.round(R[i][0] + (R[i + 1][0] - R[i][0]) * t), Math.round(R[i][1] + (R[i + 1][1] - R[i][1]) * t)]);
      }
      return out;
    },
    // Badge: KAI's face, the player's name and the date. Used by the viewport and the PNG download.
    drawBadge(ctx, mode, name, date, x0, y0) {
      const U = E.pal(mode, 'ui'), K = E.pal(mode, 'kai'), sc = 1;
      x0 = x0 || 0; y0 = y0 || 0;
      const R = (c, x, y, w, h) => E.rect(ctx, U[c], x0 + x, y0 + y, w, h);
      R(3, 34, 78, 14, 16); R(3, 112, 78, 14, 16); R(2, 36, 78, 10, 14); R(2, 114, 78, 10, 14);
      R(0, 38, 90, 6, 4); R(0, 116, 90, 6, 4);
      R(3, 36, 4, 88, 84); R(3, 32, 8, 96, 76); R(0, 38, 6, 84, 80); R(0, 34, 10, 92, 72);
      R(2, 40, 8, 80, 2); R(2, 40, 82, 80, 2);
      E.draw(ctx, E.S.frames.front.slice(0, 10), K, x0 + 64, y0 + 14, { scale: 2 });
      ctx.fillStyle = U[3]; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = '8px "Press Start 2P", monospace';
      ctx.fillText(E.W.messages.badge_title.split(' ')[0], x0 + 80, y0 + 38);
      ctx.fillText(String(name || '').toUpperCase().slice(0, 12), x0 + 80, y0 + 54);
      ctx.fillText(date || '', x0 + 80, y0 + 68);
    },
    // ---------- loadout: one question per screen, driven by content.facts (askIf, forces, notice) ----------
    strict(when, facts) { return Object.keys(when || {}).every(k => !E.unset(facts, k) && when[k].includes(facts[k])); },
    loadoutQuestions(facts) {
      const out = [];
      E.C.facts.forEach(f => {
        if (f.askIf && !E.strict(f.askIf, facts)) return;
        out.push({ type: 'fact', id: f.id });
        const o = f.options.find(x => x.id === facts[f.id]);
        if (o && o.notice) out.push({ type: 'notice', id: o.notice, fact: f.id });
      });
      return out;
    },
    // Apply option side effects (Windows forces Master) and clear answers a changed fact no longer allows.
    withFact(facts, fid, oid) {
      const f = { ...facts, [fid]: oid };
      E.C.facts.forEach(ff => { const o = ff.options.find(x => x.id === f[ff.id]); if (o && o.forces) Object.assign(f, o.forces); });
      const prev = E.fact(fid).options.find(x => x.id === facts[fid]);
      if (prev && prev.forces) Object.keys(prev.forces).forEach(k => { if (!(E.fact(fid).options.find(x => x.id === oid) || {}).forces) f[k] = 'unsure'; });
      E.C.facts.forEach(ff => { if (ff.askIf && !E.strict(ff.askIf, f) && !Object.values(E.C.facts).some(x => (x.options.find(o => o.id === f[x.id]) || {}).forces && (x.options.find(o => o.id === f[x.id]).forces[ff.id]))) f[ff.id] = 'unsure'; });
      return f;
    },
    isMaster(facts) { return facts && facts.virtualization === 'own'; },
    skipBlock(p, id) { const s = E.stage(id); return s.noSkip && E.strict(s.noSkip.when, p.facts) ? s.noSkip.reason : ''; },

    // ---------- AI prompts (templates in theme.prompts; screens only fill placeholders) ----------
    promptVars(p, sid, st, sel) {
      const P = E.W.prompts, f = p.facts, sc = E.stage(sid);
      const lab = id => E.unset(f, id) ? E.fill(P.unsetPlaceholder, { fact: E.fact(id).label.toUpperCase() }) : E.optLabel(id, f[id]);
      const virt = E.unset(f, 'virtualization') ? lab('virtualization') : f.virtualization === 'kairos-lab' ? 'kairos-lab' : (String(p.virtName || '').trim() || P.virtPlaceholder);
      const v = { stage: sc.title, os: lab('os'), arch: lab('arch'), runtime: lab('runtime'), virtualization: virt,
        tool: (sc.tool && sc.tool.name) || '', source: (sc.tool && sc.tool.url) || '', docs: sc.docs || '', logs: P.logsPlaceholder, goal: sc.goal || sc.title };
      if (st) {
        const rows = E.flatten(st.blocks, { key: sid + '/' + st.id, facts: f, sel: sel || {}, showAll: {}, layout: sel ? 'tabs' : 'stacked' });
        const cmds = rows.filter(r => r.type === 'command' && !r.isFile).map(r => r.code);
        const outs = rows.filter(r => r.type === 'output').map(r => r.lines.join('\n'));
        const h = st.help || {};
        Object.assign(v, { step: st.title, goal: st.goal || st.title, tool: h.tool || '', source: h.source || '', docs: h.docs || '', commands: cmds.join('\n\n') || P.noCommands, expected: h.expect || st.check.prompt });
      }
      v.ask = E.fill(sc.tip || '', v);
      return v;
    },
    // A template line whose placeholders resolve to nothing (e.g. a step without help) is dropped, not filled with made-up text.
    prompt(kind, p, sid, st, sel) {
      const v = E.promptVars(p, sid, st, sel);
      return E.W.prompts[kind].filter(l => (l.match(/\{(\w+)\}/g) || []).every(m => { const k = m.slice(1, -1); return !(k in v) || String(v[k]).trim() !== ''; })).map(l => E.fill(l, v)).join('\n');
    },
    stepHelp(st) { const h = (st && st.help) || {}; return { tool: h.tool || '', source: h.source || '', docs: h.docs || '', expect: h.expect || '', has: !!(h.tool || h.docs) }; },
    stepOnly(st, facts) { return E.onlyLabel(st && st.only, facts); },
    checkKind(st) { const k = st && st.check && st.check.kind; return { id: k || 'manual', label: (E.W.checkKinds && E.W.checkKinds[k]) || k || '' }; },
    // [label](stage:id) links inside markdown point at another stage
    stageLink(href) { const m = /^stage:([^#]+)/.exec(String(href || '')); return m && E.C.stages.some(s => s.id === m[1]) ? m[1] : null; },
    // ---------- reader mode (game | workshop) and projector prefs, stored in the browser ----------
    getMode() { try { const m = localStorage.getItem('kai.mode'); return m === 'game' || m === 'workshop' ? m : null; } catch (err) { return null; } },
    setMode(m) { try { localStorage.setItem('kai.mode', m); } catch (err) {} },
    getView() { try { return { size: 3, dark: false, ...JSON.parse(localStorage.getItem('kai.workshop.view') || '{}') }; } catch (err) { return { size: 3, dark: false }; } },
    setView(v) { try { localStorage.setItem('kai.workshop.view', JSON.stringify(v)); } catch (err) {} },
    promptSegs(text) { return String(text).split(/(\[[^\]\n]+\])/).filter(Boolean).map(v => ({ v, ph: /^\[[^\]]+\]$/.test(v) })); },
    today() { return new Date().toISOString().slice(0, 10); }
  };
  window.KAIE = E;
})();
