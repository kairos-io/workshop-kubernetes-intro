// kai: the KAI workshop guide in your terminal.
// Reads kai-sprites.json, theme.json and content.json, the same files as the web version.
// Go standard library only. The game never runs a workshop command: you do.
package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// ---------------------------------------------------------------- data

type Anim struct {
	Fps    float64  `json:"fps"`
	Frames []string `json:"frames"`
}

type Pal struct {
	World    []string `json:"world"`
	Kai      []string `json:"kai"`
	UI       []string `json:"ui"`
	Icons    []string `json:"icons"`
	Kairos   []string `json:"kairos"`
	Hadron   []string `json:"hadron"`
	Player   []string `json:"player"`
	Portrait []string `json:"portrait"`
	Page     map[string]string `json:"page"`
}

type Europe struct {
	W     int      `json:"w"`
	H     int      `json:"h"`
	Rows  []string `json:"rows"`
	Route [][2]int `json:"route"`
}

type Sprites struct {
	Codes            map[string]int      `json:"codes"`
	Frames           map[string][]string `json:"frames"`
	Tiles            map[string][]string `json:"tiles"`
	Icons            map[string][]string `json:"icons"`
	Logos            map[string][]string `json:"logos"`
	Portraits        map[string][]string `json:"portraits"`
	Palettes         map[string]Pal      `json:"palettes"`
	Animations       map[string]Anim     `json:"animations"`
	PlayerAnimations map[string]Anim     `json:"playerAnimations"`
	Europe           Europe              `json:"europe"`
}

type ThemeStage struct {
	ID       string   `json:"id"`
	Location string   `json:"location"`
	Nodes    int      `json:"nodes"`
	Items    []string `json:"items"`
}

type ItemDef struct {
	Name string `json:"name"`
	Icon string `json:"icon"`
	Desc string `json:"desc"`
}

type MegaPart struct {
	Label string `json:"label"`
	Icon  string `json:"icon"`
}

type Mega struct {
	Name  string     `json:"name"`
	Icon  string     `json:"icon"`
	Desc  string     `json:"desc"`
	Parts []MegaPart `json:"parts"`
}

type Mentor struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Country  string `json:"country"`
	Portrait string `json:"portrait"`
}

type Character struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Desc  string `json:"desc"`
}

type Theme struct {
	Game struct {
		Title    string `json:"title"`
		Subtitle string `json:"subtitle"`
		Edition  string `json:"edition"`
	} `json:"game"`
	Links struct {
		PlainView string `json:"plainView"`
	} `json:"links"`
	Footer  string `json:"footer"`
	Welcome struct {
		Mentor string `json:"mentor"`
		Pages  []struct {
			Line string `json:"line"`
			Md   string `json:"md"`
		} `json:"pages"`
		Next  string `json:"next"`
		Back  string `json:"back"`
		Start string `json:"start"`
	} `json:"welcome"`
	Loadout struct {
		Progress  string                   `json:"progress"`
		Next      string                   `json:"next"`
		Back      string                   `json:"back"`
		Done      string                   `json:"done"`
		Questions map[string]LoadoutQ      `json:"questions"`
		Notices   map[string]LoadoutNotice `json:"notices"`
	} `json:"loadout"`
	Prompts struct {
		VirtPlaceholder  string   `json:"virtPlaceholder"`
		LogsPlaceholder  string   `json:"logsPlaceholder"`
		UnsetPlaceholder string   `json:"unsetPlaceholder"`
		NoCommands       string   `json:"noCommands"`
		Warning          string   `json:"warning"`
		Fail             []string `json:"fail"`
		Tip              []string `json:"tip"`
	} `json:"prompts"`
	XP          struct {
		Step      int `json:"step"`
		SideQuest int `json:"sideQuest"`
	} `json:"xp"`
	Player struct {
		NameMax     int         `json:"nameMax"`
		DefaultName string      `json:"defaultName"`
		Characters  []Character `json:"characters"`
	} `json:"player"`
	Mentors  []Mentor                   `json:"mentors"`
	CheckKinds map[string]string        `json:"checkKinds"`
	Stages   []ThemeStage               `json:"stages"`
	Items    map[string]ItemDef         `json:"items"`
	Mega     map[string]Mega            `json:"mega"`
	Messages map[string]json.RawMessage `json:"messages"`
	Labels   map[string]string          `json:"labels"`
}

type Opt struct {
	ID     string            `json:"id"`
	Label  string            `json:"label"`
	Forces map[string]string `json:"forces"`
	Notice string            `json:"notice"`
}

type LoadoutQ struct {
	Title   string `json:"title"`
	Md      string `json:"md"`
	Options map[string]struct {
		Badge string `json:"badge"`
		Md    string `json:"md"`
	} `json:"options"`
	When []struct {
		Only Only   `json:"only"`
		Md   string `json:"md"`
	} `json:"when"`
	Help *struct {
		Label string `json:"label"`
		Md    string `json:"md"`
		Code  string `json:"code"`
		After string `json:"after"`
	} `json:"help"`
}

type LoadoutNotice struct {
	Title string `json:"title"`
	Line  string `json:"line"`
	Md    string `json:"md"`
}

type Fact struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	Question string `json:"question"`
	Options  []Opt  `json:"options"`
	AskIf    Only   `json:"askIf"`
}

type Only map[string][]string

type Item struct {
	Label  string  `json:"label"`
	Only   Only    `json:"only"`
	Blocks []Block `json:"blocks"`
}

type Block struct {
	Type  string `json:"type"`
	Md    string `json:"md"`
	Code  string `json:"code"`
	Name  string `json:"name"`
	Text  string `json:"text"`
	Kind  string `json:"kind"`
	Only  Only   `json:"only"`
	Title string `json:"title"`
	Items []Item `json:"items"`
}

type Step struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	Goal     string  `json:"goal"`
	Line     string  `json:"line"`
	Optional bool    `json:"optional"`
	Only     Only    `json:"only"`
	Blocks   []Block `json:"blocks"`
	Help     struct {
		Tool   string `json:"tool"`
		Source string `json:"source"`
		Docs   string `json:"docs"`
		Expect string `json:"expect"`
	} `json:"help"`
	Check struct {
		Kind   string  `json:"kind"`
		Prompt string  `json:"prompt"`
		Fail   []Block `json:"fail"`
	} `json:"check"`
}

type Stage struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Goal  string `json:"goal"`
	Steps []Step `json:"steps"`
	Tool  struct {
		Name string `json:"name"`
		URL  string `json:"url"`
	} `json:"tool"`
	Docs   string `json:"docs"`
	Tip    string `json:"tip"`
	NoSkip *struct {
		When   Only   `json:"when"`
		Reason string `json:"reason"`
	} `json:"noSkip"`
}

type Content struct {
	Facts  []Fact  `json:"facts"`
	Stages []Stage `json:"stages"`
}

type Settings struct {
	Palette string `json:"palette"`
	Motion  string `json:"motion"`
	Text    string `json:"text"`
	Layout  string `json:"layout"`
}

type Progress struct {
	V           int               `json:"v"`
	Started     bool              `json:"started"`
	Name        string            `json:"name"`
	Character   string            `json:"character"`
	Facts       map[string]string `json:"facts"`
	Done        map[string]bool   `json:"done"`
	Skipped     map[string]bool   `json:"skipped"`
	XP          int               `json:"xp"`
	CompletedAt string            `json:"completedAt"`
	Settings    Settings          `json:"settings"`
	VirtName    string            `json:"virtName"`
}

var S Sprites
var W Theme
var C Content

func findAssets(dir string) string {
	cands := []string{dir, ".", "..", "../web"}
	if exe, err := os.Executable(); err == nil {
		d := filepath.Dir(exe)
		cands = append(cands, d, filepath.Join(d, ".."), filepath.Join(d, "..", "web"))
	}
	for _, d := range cands {
		if d == "" {
			continue
		}
		if _, err := os.Stat(filepath.Join(d, "content.json")); err == nil {
			return d
		}
	}
	return "."
}

func load(dir string) {
	d := findAssets(dir)
	files := []struct {
		name string
		v    interface{}
	}{{"kai-sprites.json", &S}, {"theme.json", &W}, {"content.json", &C}}
	for _, f := range files {
		b, err := os.ReadFile(filepath.Join(d, f.name))
		if err != nil {
			fmt.Fprintf(os.Stderr, "kai: cannot read %s (use --assets DIR): %v\n", f.name, err)
			os.Exit(2)
		}
		if err := json.Unmarshal(b, f.v); err != nil {
			fmt.Fprintf(os.Stderr, "kai: bad %s: %v\n", f.name, err)
			os.Exit(2)
		}
	}
}

func msg(key string) string {
	var s string
	json.Unmarshal(W.Messages[key], &s)
	return s
}

func fill(s string, vars map[string]string) string {
	for k, v := range vars {
		s = strings.ReplaceAll(s, "{"+k+"}", v)
	}
	return s
}

// ---------------------------------------------------------------- text helpers

func rlen(s string) int { return utf8.RuneCountInString(s) }

func maxi(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func mini(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	if n <= 1 {
		return string(r[:maxi(0, n)])
	}
	return string(r[:n-1]) + "…"
}

func pad(s string, n int) string { return s + strings.Repeat(" ", maxi(0, n-rlen(s))) }

func wrap(text string, n int) []string {
	if n < 8 {
		n = 8
	}
	var out []string
	for _, par := range strings.Split(text, "\n") {
		line := ""
		for _, w := range strings.Fields(par) {
			for rlen(w) > n {
				if line != "" {
					out = append(out, line)
					line = ""
				}
				r := []rune(w)
				out = append(out, string(r[:n]))
				w = string(r[n:])
			}
			if line == "" {
				line = w
			} else if rlen(line)+1+rlen(w) <= n {
				line += " " + w
			} else {
				out = append(out, line)
				line = w
			}
		}
		out = append(out, line)
	}
	return out
}

type Seg struct{ T, V, Href string }

var mdRe = regexp.MustCompile("(\\*\\*[^*]+\\*\\*|`[^`]+`|\\[[^\\]]+\\]\\([^)]+\\))")
var parRe = regexp.MustCompile(`\n\s*\n`)
var linkRe = regexp.MustCompile(`\[([^\]]+)\]\(([^)]+)\)`)

type MdBlock struct {
	K     string // "p", "ul", "ol"
	Segs  []Seg
	Items [][]Seg
	Start int
}

var liRe = regexp.MustCompile(`^\s*(?:([-*])|(\d+)[.)])\s+(.*)$`)

func inline(par string) []Seg {
	var segs []Seg
	last := 0
	for _, m := range mdRe.FindAllStringIndex(par, -1) {
		if m[0] > last {
			segs = append(segs, Seg{T: "text", V: par[last:m[0]]})
		}
		tok := par[m[0]:m[1]]
		switch tok[0] {
		case '*':
			segs = append(segs, Seg{T: "b", V: tok[2 : len(tok)-2]})
		case '`':
			segs = append(segs, Seg{T: "code", V: tok[1 : len(tok)-1]})
		default:
			mm := linkRe.FindStringSubmatch(tok)
			segs = append(segs, Seg{T: "a", V: strings.ReplaceAll(mm[1], "`", ""), Href: mm[2]})
		}
		last = m[1]
	}
	if last < len(par) {
		segs = append(segs, Seg{T: "text", V: par[last:]})
	}
	return segs
}

// md: paragraphs (blank line), "- " unordered and "1. " ordered lists. Same as kai-engine.js md().
func md(s string) []MdBlock {
	var out []MdBlock
	for _, par := range parRe.Split(s, -1) {
		var buf []string
		open := -1
		flush := func() {
			if len(buf) > 0 {
				out = append(out, MdBlock{K: "p", Segs: inline(strings.Join(buf, " "))})
				buf = nil
			}
		}
		for _, l := range strings.Split(par, "\n") {
			m := liRe.FindStringSubmatch(l)
			if m == nil {
				if len(buf) == 0 && open >= 0 && strings.HasPrefix(l, " ") && strings.TrimSpace(l) != "" {
					it := &out[open].Items[len(out[open].Items)-1]
					*it = append(append(*it, Seg{T: "text", V: " "}), inline(strings.TrimSpace(l))...)
					continue
				}
				if strings.TrimSpace(l) != "" {
					buf = append(buf, strings.TrimSpace(l))
				}
				open = -1
				continue
			}
			flush()
			k := "ol"
			if m[1] != "" {
				k = "ul"
			}
			if open >= 0 && out[open].K == k {
				out[open].Items = append(out[open].Items, inline(m[3]))
			} else {
				st, _ := strconv.Atoi(m[2])
				if st == 0 {
					st = 1
				}
				out = append(out, MdBlock{K: k, Items: [][]Seg{inline(m[3])}, Start: st})
				open = len(out) - 1
			}
		}
		flush()
	}
	return out
}

func segText(segs []Seg) string {
	var sb strings.Builder
	for _, s := range segs {
		sb.WriteString(s.V)
		if s.T == "a" {
			sb.WriteString(" <" + s.Href + ">")
		}
	}
	return sb.String()
}

func mdPlain(s string) string {
	var parts []string
	for _, b := range md(s) {
		if b.K == "p" {
			parts = append(parts, segText(b.Segs))
			continue
		}
		var ls []string
		for i, it := range b.Items {
			mk := "-"
			if b.K == "ol" {
				mk = strconv.Itoa(b.Start+i) + "."
			}
			ls = append(ls, mk+" "+segText(it))
		}
		parts = append(parts, strings.Join(ls, "\n"))
	}
	return strings.Join(parts, "\n\n")
}

// ---------------------------------------------------------------- facts + flatten (mirror kai-engine.js)

func fact(id string) *Fact {
	for i := range C.Facts {
		if C.Facts[i].ID == id {
			return &C.Facts[i]
		}
	}
	return nil
}

func optLabel(fid, oid string) string {
	if oid == "" || oid == "unsure" {
		return "Not sure yet"
	}
	if f := fact(fid); f != nil {
		for _, o := range f.Options {
			if o.ID == oid {
				return o.Label
			}
		}
	}
	return oid
}

func matches(only Only, facts map[string]string) bool {
	for k, vals := range only {
		v := facts[k]
		if v == "" || v == "unsure" {
			continue
		}
		ok := false
		for _, x := range vals {
			if x == v {
				ok = true
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

func onlyText(only Only) string {
	if len(only) == 0 {
		return ""
	}
	var parts []string
	for _, f := range C.Facts {
		vals, ok := only[f.ID]
		if !ok {
			continue
		}
		var ls []string
		for _, v := range vals {
			ls = append(ls, optLabel(f.ID, v))
		}
		parts = append(parts, strings.Join(ls, " or "))
	}
	return W.Labels["only_if"] + ": " + strings.Join(parts, ", ")
}

func loadoutText(facts map[string]string) string {
	var ls []string
	for _, f := range C.Facts {
		if v := facts[f.ID]; v != "" && v != "unsure" {
			ls = append(ls, optLabel(f.ID, v))
		}
	}
	if len(ls) == 0 {
		return "Not sure yet (showing everything)"
	}
	return strings.Join(ls, " · ")
}

type Row struct {
	Type, Key, Only, Code, Name, Kind, Text, Label string
	Inset, Total                                   int
	Blocks                                         []MdBlock
	IsFile                                         bool
	Lines                                          []string
}

// The terminal always stacks alternatives.
func flatten(blocks []Block, key string, facts map[string]string, showAll map[string]bool, inset int, out []Row) []Row {
	for bi, b := range blocks {
		k := key + "/" + strconv.Itoa(bi)
		if b.Type != "alternatives" && !matches(b.Only, facts) {
			continue
		}
		only := onlyLabel(b.Only, facts)
		switch b.Type {
		case "text":
			out = append(out, Row{Type: "text", Key: k, Inset: inset, Blocks: md(b.Md), Only: only})
		case "command", "file":
			out = append(out, Row{Type: "command", Key: k, Inset: inset, IsFile: b.Type == "file", Name: b.Name, Code: b.Code, Only: only})
		case "output":
			out = append(out, Row{Type: "output", Key: k, Inset: inset, Lines: strings.Split(b.Text, "\n"), Only: only})
		case "callout":
			out = append(out, Row{Type: "callout", Key: k, Inset: inset, Kind: b.Kind, Blocks: md(b.Md), Only: only})
		case "alternatives":
			all := showAll[k]
			sub := facts
			if all {
				sub = map[string]string{}
			}
			out = append(out, Row{Type: "heading", Key: k + "/h", Inset: inset, Text: b.Title})
			var vis []int
			for i, it := range b.Items {
				if all || matches(it.Only, facts) {
					vis = append(vis, i)
				}
			}
			if len(vis) == 0 {
				out = append(out, Row{Type: "empty", Key: k, Inset: inset, Total: len(b.Items)})
				continue
			}
			if all {
				out = append(out, Row{Type: "notice", Key: k + "/n", Inset: inset})
			}
			for _, i := range vis {
				it := b.Items[i]
				out = append(out, Row{Type: "altHeader", Key: k + "/" + strconv.Itoa(i) + "/h", Inset: inset + 1, Label: it.Label, Only: onlyLabel(it.Only, sub)})
				out = flatten(it.Blocks, k+"/"+strconv.Itoa(i), sub, showAll, inset+1, out)
			}
		}
	}
	return out
}

func unset(facts map[string]string, k string) bool { v := facts[k]; return v == "" || v == "unsure" }

// onlyLabel shows "Only if" only for facts the loadout has not answered (same as kai-engine.js).
func onlyLabel(only Only, facts map[string]string) string {
	o := Only{}
	for k, v := range only {
		if unset(facts, k) {
			o[k] = v
		}
	}
	return onlyText(o)
}

func strict(when Only, facts map[string]string) bool {
	for k, vals := range when {
		if unset(facts, k) {
			return false
		}
		ok := false
		for _, v := range vals {
			if v == facts[k] {
				ok = true
			}
		}
		if !ok {
			return false
		}
	}
	return true
}

type Question struct{ Type, ID string }

func loadoutQuestions(facts map[string]string) []Question {
	var out []Question
	for _, f := range C.Facts {
		if len(f.AskIf) > 0 && !strict(f.AskIf, facts) {
			continue
		}
		out = append(out, Question{"fact", f.ID})
		for _, o := range f.Options {
			if o.ID == facts[f.ID] && o.Notice != "" {
				out = append(out, Question{"notice", o.Notice})
			}
		}
	}
	return out
}

func optOf(fid, oid string) *Opt {
	if f := fact(fid); f != nil {
		for i := range f.Options {
			if f.Options[i].ID == oid {
				return &f.Options[i]
			}
		}
	}
	return nil
}

func withFact(facts map[string]string, fid, oid string) map[string]string {
	out := map[string]string{}
	for k, v := range facts {
		out[k] = v
	}
	prev := optOf(fid, facts[fid])
	out[fid] = oid
	forced := map[string]bool{}
	for _, ff := range C.Facts {
		if o := optOf(ff.ID, out[ff.ID]); o != nil {
			for k, v := range o.Forces {
				out[k] = v
				forced[k] = true
			}
		}
	}
	if prev != nil {
		for k := range prev.Forces {
			if !forced[k] {
				out[k] = "unsure"
			}
		}
	}
	for _, ff := range C.Facts {
		if len(ff.AskIf) > 0 && !strict(ff.AskIf, out) && !forced[ff.ID] {
			out[ff.ID] = "unsure"
		}
	}
	return out
}

func isMaster(facts map[string]string) bool { return facts["virtualization"] == "own" }

func skipBlock(p *Progress, id string) string {
	s := stageC(id)
	if s.NoSkip != nil && strict(s.NoSkip.When, p.Facts) {
		return s.NoSkip.Reason
	}
	return ""
}

var phRe = regexp.MustCompile(`\{(\w+)\}`)

func stageLink(href string) string {
	if strings.HasPrefix(href, "stage:") {
		id := strings.SplitN(strings.TrimPrefix(href, "stage:"), "#", 2)[0]
		if stageNo(id) > 0 {
			return id
		}
	}
	return ""
}

func checkKind(st Step) string {
	if l, ok := W.CheckKinds[st.Check.Kind]; ok {
		return l
	}
	if st.Check.Kind != "" {
		return st.Check.Kind
	}
	return "manual"
}

// prompt builds an AI prompt from theme.prompts (same as kai-engine.js prompt()).
func prompt(kind string, p *Progress, sid string, st *Step) string {
	P, f, sc := W.Prompts, p.Facts, stageC(sid)
	lab := func(id string) string {
		if unset(f, id) {
			return fill(P.UnsetPlaceholder, map[string]string{"fact": strings.ToUpper(fact(id).Label)})
		}
		return optLabel(id, f[id])
	}
	virt := strings.TrimSpace(p.VirtName)
	if unset(f, "virtualization") {
		virt = lab("virtualization")
	} else if f["virtualization"] == "kairos-lab" {
		virt = "kairos-lab"
	} else if virt == "" {
		virt = P.VirtPlaceholder
	}
	v := map[string]string{"stage": sc.Title, "os": lab("os"), "arch": lab("arch"), "runtime": lab("runtime"), "virtualization": virt,
		"tool": sc.Tool.Name, "source": sc.Tool.URL, "docs": sc.Docs, "logs": P.LogsPlaceholder, "goal": sc.Goal}
	if v["goal"] == "" {
		v["goal"] = sc.Title
	}
	if st != nil {
		rows := flatten(st.Blocks, stepKey(sid, st.ID), f, map[string]bool{}, 0, nil)
		var cmds, outs []string
		for _, r := range rows {
			if r.Type == "command" && !r.IsFile {
				cmds = append(cmds, r.Code)
			}
			if r.Type == "output" {
				outs = append(outs, strings.Join(r.Lines, "\n"))
			}
		}
		v["step"] = st.Title
		v["tool"], v["source"], v["docs"] = st.Help.Tool, st.Help.Source, st.Help.Docs
		v["goal"] = st.Goal
		if v["goal"] == "" {
			v["goal"] = st.Title
		}
		v["commands"] = strings.Join(cmds, "\n\n")
		if v["commands"] == "" {
			v["commands"] = P.NoCommands
		}
		v["expected"] = st.Check.Prompt
		if st.Help.Expect != "" {
			v["expected"] = st.Help.Expect
		}
		_ = outs
	}
	v["ask"] = fill(sc.Tip, v)
	tpl := P.Fail
	if kind == "tip" {
		tpl = P.Tip
	}
	var ls []string
	// a line whose placeholders resolve to nothing is dropped, never filled with made-up text
	for _, l := range tpl {
		keep := true
		for _, m := range phRe.FindAllStringSubmatch(l, -1) {
			if val, ok := v[m[1]]; ok && strings.TrimSpace(val) == "" {
				keep = false
			}
		}
		if keep {
			ls = append(ls, fill(l, v))
		}
	}
	return strings.Join(ls, "\n")
}

// ---------------------------------------------------------------- stages + progress (slug ids, order from content.json)

func stageIDs() []string {
	var ids []string
	for _, s := range C.Stages {
		ids = append(ids, s.ID)
	}
	return ids
}

func stageNo(id string) int {
	for i, x := range stageIDs() {
		if x == id {
			return i + 1
		}
	}
	return 0
}

func themeStage(id string) ThemeStage {
	for _, s := range W.Stages {
		if s.ID == id {
			return s
		}
	}
	return ThemeStage{ID: id, Location: strings.ToUpper(id)}
}

func stageC(id string) Stage {
	for _, s := range C.Stages {
		if s.ID == id {
			return s
		}
	}
	return C.Stages[0]
}

func steps(id string, facts map[string]string) []Step {
	var out []Step
	for _, s := range stageC(id).Steps {
		if matches(s.Only, facts) {
			out = append(out, s)
		}
	}
	return out
}

func stepKey(sid, id string) string { return sid + "/" + id }

type SP struct{ Done, Total, Side, SideDone int }

func stageProgress(p *Progress, id string) SP {
	var g SP
	for _, s := range steps(id, p.Facts) {
		d := p.Done[stepKey(id, s.ID)]
		if s.Optional {
			g.Side++
			if d {
				g.SideDone++
			}
		} else {
			g.Total++
			if d {
				g.Done++
			}
		}
	}
	return g
}

func stageCleared(p *Progress, id string) bool { g := stageProgress(p, id); return g.Total > 0 && g.Done == g.Total }
func stagePassed(p *Progress, id string) bool  { return stageCleared(p, id) || p.Skipped[id] }

func stageState(p *Progress, id string) string {
	if stageCleared(p, id) {
		return "cleared"
	}
	if p.Skipped[id] {
		return "skipped"
	}
	ids := stageIDs()
	for i, x := range ids {
		if x == id && (i == 0 || stagePassed(p, ids[i-1])) {
			return "current"
		}
	}
	return "locked"
}

func currentStage(p *Progress) string {
	for _, id := range stageIDs() {
		if stageState(p, id) == "current" {
			return id
		}
	}
	return ""
}

func allDone(p *Progress) bool {
	for _, id := range stageIDs() {
		if !stagePassed(p, id) {
			return false
		}
	}
	return true
}

type Tot struct{ Done, Total, Cleared, Skipped, Side, Stages int }

func totals(p *Progress) Tot {
	var t Tot
	for _, id := range stageIDs() {
		g := stageProgress(p, id)
		t.Done += g.Done
		t.Total += g.Total
		t.Side += g.SideDone
		if stageCleared(p, id) {
			t.Cleared++
		} else if p.Skipped[id] {
			t.Skipped++
		}
		t.Stages++
	}
	return t
}

func firstOpenStep(p *Progress, id string) int {
	for i, s := range steps(id, p.Facts) {
		if !s.Optional && !p.Done[stepKey(id, s.ID)] {
			return i
		}
	}
	return 0
}

func newProgress() *Progress {
	p := &Progress{V: 2, Facts: map[string]string{}, Done: map[string]bool{}, Skipped: map[string]bool{},
		Settings: Settings{Palette: "dmg", Motion: "system", Text: "m", Layout: "tabs"}}
	for _, f := range C.Facts {
		p.Facts[f.ID] = "unsure"
	}
	return p
}

func progressPath() string {
	d, err := os.UserConfigDir()
	if err != nil {
		d = "."
	}
	return filepath.Join(d, "kai", "progress.json")
}

func loadProgress() *Progress {
	p := newProgress()
	b, err := os.ReadFile(progressPath())
	if err != nil {
		return p
	}
	var q Progress
	if json.Unmarshal(b, &q) != nil || q.V != 2 {
		return p
	}
	for k, v := range q.Facts {
		p.Facts[k] = v
	}
	if q.Done != nil {
		p.Done = q.Done
	}
	if q.Skipped != nil {
		p.Skipped = q.Skipped
	}
	p.XP, p.Started, p.Name, p.Character, p.CompletedAt = q.XP, q.Started, q.Name, q.Character, q.CompletedAt
	p.VirtName = q.VirtName
	if q.Settings.Palette != "" {
		p.Settings = q.Settings
	}
	return p
}

func saveProgress(p *Progress) {
	path := progressPath()
	os.MkdirAll(filepath.Dir(path), 0o755)
	b, _ := json.MarshalIndent(p, "", " ")
	os.WriteFile(path, b, 0o644)
}

func playerName(p *Progress) string {
	if p.Name != "" {
		return p.Name
	}
	return W.Player.DefaultName
}

func today() string { return time.Now().UTC().Format("2006-01-02") }

// ---------------------------------------------------------------- mentors: random but stable (same as kai-engine.js mentorPlan)

func fnv1a(s string) uint32 {
	h := uint32(0x811c9dc5)
	for _, c := range []byte(s) {
		h ^= uint32(c)
		h *= 0x01000193
	}
	return h
}

func mulberry(seed uint32) func() uint32 {
	a := seed
	return func() uint32 {
		a += 0x6D2B79F5
		t := a
		t = (t ^ (t >> 15)) * (t | 1)
		t ^= t + (t^(t>>7))*(t|61)
		return t ^ (t >> 14)
	}
}

func mentorPlan(name string) map[string]string {
	n := strings.ToLower(strings.TrimSpace(name))
	ids := stageIDs()
	var M []string
	for _, m := range W.Mentors {
		M = append(M, m.ID)
	}
	out := map[string]string{}
	prev := ""
	for b := 0; b*len(M) < len(ids); b++ {
		block := ids[b*len(M) : mini(len(ids), (b+1)*len(M))]
		r := mulberry(fnv1a(n + "|" + strings.Join(block, ",")))
		perm := append([]string{}, M...)
		for i := len(perm) - 1; i > 0; i-- {
			j := int(r() % uint32(i+1))
			perm[i], perm[j] = perm[j], perm[i]
		}
		if prev != "" && perm[0] == prev && len(perm) > 1 {
			perm[0], perm[1] = perm[1], perm[0]
		}
		for i, id := range block {
			out[id] = perm[i]
		}
		prev = perm[len(block)-1]
	}
	return out
}

func mentorByID(id string) Mentor {
	for _, m := range W.Mentors {
		if m.ID == id {
			return m
		}
	}
	return W.Mentors[0]
}

func first(m Mentor) string { return strings.Fields(m.Name)[0] }

// ---------------------------------------------------------------- items

type ItemRef struct {
	ID   string
	Part int
}

func stageItems(id string) []ItemRef {
	var out []ItemRef
	for _, s := range themeStage(id).Items {
		parts := strings.SplitN(s, "#", 2)
		r := ItemRef{ID: parts[0]}
		if len(parts) == 2 {
			r.Part, _ = strconv.Atoi(parts[1])
		}
		out = append(out, r)
	}
	return out
}

type PartState struct {
	N           int
	Label, Icon string
	Stage       string
	Owned, Soon bool
}

type Inv struct {
	ID, Name, Icon, Desc, Stage string
	Owned, Mega                 bool
	Parts                       []PartState
	Have, Total                 int
}

func inventory(p *Progress) []Inv {
	owned, grants := map[string]bool{}, map[string]string{}
	for _, sid := range stageIDs() {
		for _, it := range stageItems(sid) {
			k := it.ID
			if it.Part > 0 {
				k += "#" + strconv.Itoa(it.Part)
			}
			grants[k] = sid
			if stageCleared(p, sid) {
				owned[k] = true
			}
		}
	}
	var list []Inv
	seen := map[string]bool{}
	for _, sid := range stageIDs() {
		for _, it := range stageItems(sid) {
			if it.Part > 0 {
				if seen[it.ID] {
					continue
				}
				seen[it.ID] = true
				d := W.Mega[it.ID]
				v := Inv{ID: it.ID, Name: d.Name, Icon: d.Icon, Desc: d.Desc, Mega: true}
				for i, pt := range d.Parts {
					k := it.ID + "#" + strconv.Itoa(i+1)
					ic := pt.Icon
					if ic == "" {
						ic = d.Icon
					}
					ps := PartState{N: i + 1, Label: pt.Label, Icon: ic, Stage: grants[k], Owned: owned[k], Soon: grants[k] == ""}
					if ps.Owned {
						v.Have++
						v.Owned = true
					}
					v.Parts = append(v.Parts, ps)
				}
				v.Total = len(v.Parts)
				list = append(list, v)
				continue
			}
			d := W.Items[it.ID]
			list = append(list, Inv{ID: it.ID, Name: d.Name, Icon: d.Icon, Desc: d.Desc, Owned: owned[it.ID], Stage: sid})
		}
	}
	return list
}

// ---------------------------------------------------------------- terminal capability

type Mode int

const (
	ModeNone Mode = iota
	Mode16
	Mode256
	ModeTrue
)

var colorMode Mode
var unicode bool
var isTTY bool

func detect(force string) {
	term := os.Getenv("TERM")
	fi, _ := os.Stdout.Stat()
	isTTY = fi != nil && fi.Mode()&os.ModeCharDevice != 0
	loc := strings.ToUpper(os.Getenv("LC_ALL") + os.Getenv("LC_CTYPE") + os.Getenv("LANG"))
	unicode = strings.Contains(loc, "UTF-8") || strings.Contains(loc, "UTF8") || os.Getenv("WT_SESSION") != ""
	switch force {
	case "truecolor":
		colorMode = ModeTrue
	case "256":
		colorMode = Mode256
	case "16":
		colorMode = Mode16
	case "none":
		colorMode = ModeNone
	case "ascii":
		colorMode, unicode = ModeNone, false
	default:
		ct := strings.ToLower(os.Getenv("COLORTERM"))
		switch {
		case os.Getenv("NO_COLOR") != "" || term == "dumb" || !isTTY:
			colorMode = ModeNone
		case ct == "truecolor" || ct == "24bit":
			colorMode = ModeTrue
		case strings.Contains(term, "256color"):
			colorMode = Mode256
		default:
			colorMode = Mode16
		}
	}
}

// ---------------------------------------------------------------- grid (mirror kai-term.js)

type St struct {
	Fg, Bg string
	B      bool
}

type Cell struct {
	Ch     rune
	Fg, Bg string
	B      bool
}

type Grid struct {
	W, H  int
	C     [][]Cell
	Plain bool
}

type Glyphs struct {
	Cur, Ok, Now, Lock, Side, Skip, Todo, Full, Empty, Tri, Fail, Dot, Up, Down string
	Box                                                                         [6]string
}

func glyphs() Glyphs {
	if !unicode {
		return Glyphs{">", "[x]", "[>]", "[#]", "[*]", "[>>]", "[ ]", "#", "-", ">", "x", "-", "^", "v", [6]string{"+", "-", "+", "|", "+", "+"}}
	}
	return Glyphs{"▶", "✓", "●", "×", "☆", "»", "·", "■", "□", "▸", "✗", "·", "↑", "↓", [6]string{"┌", "─", "┐", "│", "└", "┘"}}
}

func newGrid(w, h int) *Grid {
	g := &Grid{W: w, H: h, Plain: colorMode == ModeNone}
	g.C = make([][]Cell, h)
	for y := range g.C {
		g.C[y] = make([]Cell, w)
		for x := range g.C[y] {
			g.C[y][x] = Cell{Ch: ' '}
		}
	}
	return g
}

func (g *Grid) put(x, y int, s string, st St) {
	if y < 0 || y >= g.H {
		return
	}
	for _, ch := range s {
		if x >= g.W {
			break
		}
		if x >= 0 {
			g.C[y][x] = Cell{Ch: ch, Fg: st.Fg, Bg: st.Bg, B: st.B}
		}
		x++
	}
}

func (g *Grid) fill(x, y, w, h int, st St) {
	for j := y; j < y+h; j++ {
		for i := x; i < x+w; i++ {
			if j >= 0 && j < g.H && i >= 0 && i < g.W {
				g.C[j][i] = Cell{Ch: ' ', Fg: st.Fg, Bg: st.Bg}
			}
		}
	}
}

func (g *Grid) bar(y int, left, right string, st St) {
	g.fill(0, y, g.W, 1, st)
	g.put(0, y, clip(left, g.W), st)
	if right != "" {
		r := clip(right, maxi(0, g.W-rlen(left)-1))
		g.put(g.W-rlen(r), y, r, st)
	}
}

func (g *Grid) center(y int, s string, st St) { g.put(maxi(0, (g.W-rlen(s))/2), y, s, st) }

func (g *Grid) box(x, y, w, h int, st St, G Glyphs) {
	b := G.Box
	g.put(x, y, b[0]+strings.Repeat(b[1], w-2)+b[2], st)
	for j := 1; j < h-1; j++ {
		g.put(x, y+j, b[3], st)
		g.put(x+w-1, y+j, b[3], st)
	}
	g.put(x, y+h-1, b[4]+strings.Repeat(b[1], w-2)+b[5], st)
}

func (g *Grid) para(x, y int, s string, n int, st St) int {
	ls := wrap(s, n)
	for i, l := range ls {
		g.put(x, y+i, l, st)
	}
	return len(ls)
}

// sprite: 1 column x 2 pixel rows per cell.
func (g *Grid) sprite(x0, y0 int, m []string, colors []string, flip bool, mono int) {
	hh := len(m)
	if hh == 0 || len(colors) < 4 {
		return
	}
	ww := len(m[0])
	px := func(r, c int) int {
		if r < 0 || r >= hh || c >= len(m[r]) {
			return -1
		}
		row := m[r]
		ch := row[c]
		if flip {
			ch = row[ww-1-c]
		}
		if ch == '.' || ch == ' ' {
			return -1
		}
		i := 0
		if ch >= '0' && ch <= '3' {
			i = int(ch - '0')
		} else {
			i = S.Codes[string(ch)]
		}
		if mono >= 0 {
			i = mono
		}
		return i
	}
	ramp := []rune(" .+#")
	if unicode {
		ramp = []rune(" ░▒█")
	}
	for r := 0; r < hh; r += 2 {
		for c := 0; c < ww; c++ {
			a, b := px(r, c), px(r+1, c)
			x, y := x0+c, y0+r/2
			if x < 0 || x >= g.W || y < 0 || y >= g.H || (a < 0 && b < 0) {
				continue
			}
			if g.Plain {
				g.C[y][x] = Cell{Ch: ramp[maxi(a, b)]}
				continue
			}
			under := g.C[y][x].Bg
			fg, bg := under, under
			if a >= 0 {
				fg = colors[a]
			}
			if b >= 0 {
				bg = colors[b]
			}
			if unicode {
				g.C[y][x] = Cell{Ch: '▀', Fg: fg, Bg: bg}
			} else {
				c2 := fg
				if a < 0 {
					c2 = bg
				}
				g.C[y][x] = Cell{Ch: ' ', Bg: c2}
			}
		}
	}
}

func pal(mode, region string) []string {
	p, ok := S.Palettes[mode]
	if !ok {
		p = S.Palettes["dmg"]
	}
	m := map[string][]string{"world": p.World, "kai": p.Kai, "ui": p.UI, "icons": p.Icons, "kairos": p.Kairos, "hadron": p.Hadron, "player": p.Player, "portrait": p.Portrait}
	if c := m[region]; len(c) == 4 {
		return c
	}
	return p.World
}

func kaiFrame(anim string) ([]string, bool) {
	a, ok := S.Animations[anim]
	if !ok {
		a = S.Animations["idle"]
	}
	parts := strings.SplitN(a.Frames[0], ":", 2)
	return S.Frames[parts[0]], len(parts) > 1 && parts[1] == "flip"
}

func playerFrame(style, pose string) ([]string, bool) {
	a, ok := S.PlayerAnimations[pose]
	if !ok {
		a = S.PlayerAnimations["idle"]
	}
	parts := strings.SplitN(a.Frames[0], ":", 2)
	m, ok := S.Frames["p-"+style+"-"+parts[0]]
	if !ok {
		m = S.Frames["p-hoodie-down"]
	}
	return m, len(parts) > 1 && parts[1] == "flip"
}

func scene(g *Grid, x0, y0, wpx int, mode string) {
	var tmp []string
	for y := 0; y < 16; y++ {
		var sb strings.Builder
		for x := 0; x < wpx; x++ {
			t := S.Tiles["grass"]
			if y >= 9 && y < 15 {
				t = S.Tiles["path"]
			}
			sb.WriteByte(t[y%8][x%8])
		}
		tmp = append(tmp, sb.String())
	}
	g.sprite(x0, y0, tmp, pal(mode, "world"), false, -1)
}

func pbar(done, total, n int, G Glyphs) string {
	f := 0
	if total > 0 {
		f = (n*done + total/2) / total
	}
	return strings.Repeat(G.Full, f) + strings.Repeat(G.Empty, maxi(0, n-f))
}

// routeStops spreads n stops evenly along the route polyline (same as kai-engine.js).
func routeStops(n int) [][2]int {
	R := S.Europe.Route
	var seg []float64
	total := 0.0
	for i := 0; i < len(R)-1; i++ {
		dx, dy := float64(R[i+1][0]-R[i][0]), float64(R[i+1][1]-R[i][1])
		l := sqrt(dx*dx + dy*dy)
		seg = append(seg, l)
		total += l
	}
	var out [][2]int
	for k := 0; k < n; k++ {
		d := 0.0
		if n > 1 {
			d = total * float64(k) / float64(n-1)
		}
		i := 0
		for i < len(seg)-1 && d > seg[i] {
			d -= seg[i]
			i++
		}
		t := 0.0
		if seg[i] > 0 {
			t = d / seg[i]
			if t > 1 {
				t = 1
			}
		}
		x := float64(R[i][0]) + float64(R[i+1][0]-R[i][0])*t
		y := float64(R[i][1]) + float64(R[i+1][1]-R[i][1])*t
		out = append(out, [2]int{int(x + 0.5), int(y + 0.5)})
	}
	return out
}

func sqrt(x float64) float64 {
	if x <= 0 {
		return 0
	}
	z := x
	for i := 0; i < 30; i++ {
		z = (z + x/z) / 2
	}
	return z
}

// ---------------------------------------------------------------- output

func rgb(hex string) (int, int, int) {
	v, _ := strconv.ParseUint(strings.TrimPrefix(hex, "#"), 16, 32)
	return int(v >> 16 & 255), int(v >> 8 & 255), int(v & 255)
}

func sq(x int) int { return x * x }

func to256(hex string) int {
	r, g, b := rgb(hex)
	lv := []int{0, 95, 135, 175, 215, 255}
	q := func(c int) int {
		if c < 48 {
			return 0
		}
		if c < 115 {
			return 1
		}
		return (c - 35) / 40
	}
	ri, gi, bi := q(r), q(g), q(b)
	dc := sq(r-lv[ri]) + sq(g-lv[gi]) + sq(b-lv[bi])
	gray := maxi(0, mini(23, ((r+g+b)/3-8)/10))
	gv := 8 + gray*10
	if sq(r-gv)+sq(g-gv)+sq(b-gv) < dc {
		return 232 + gray
	}
	return 16 + 36*ri + 6*gi + bi
}

var ansi16 = [][3]int{{0, 0, 0}, {128, 0, 0}, {0, 128, 0}, {128, 128, 0}, {0, 0, 128}, {128, 0, 128}, {0, 128, 128}, {192, 192, 192},
	{128, 128, 128}, {255, 0, 0}, {0, 255, 0}, {255, 255, 0}, {0, 0, 255}, {255, 0, 255}, {0, 255, 255}, {255, 255, 255}}

func to16(hex string) int {
	r, g, b := rgb(hex)
	best, bd := 0, 1<<30
	for i, c := range ansi16 {
		if d := sq(r-c[0]) + sq(g-c[1]) + sq(b-c[2]); d < bd {
			best, bd = i, d
		}
	}
	return best
}

func colorCode(hex string, bg bool) string {
	if hex == "" {
		return ""
	}
	switch colorMode {
	case ModeTrue:
		r, g, b := rgb(hex)
		if bg {
			return fmt.Sprintf(";48;2;%d;%d;%d", r, g, b)
		}
		return fmt.Sprintf(";38;2;%d;%d;%d", r, g, b)
	case Mode256:
		if bg {
			return fmt.Sprintf(";48;5;%d", to256(hex))
		}
		return fmt.Sprintf(";38;5;%d", to256(hex))
	case Mode16:
		c := to16(hex)
		base := 30
		if bg {
			base = 40
		}
		if c >= 8 {
			return ";" + strconv.Itoa(base+60+c-8)
		}
		return ";" + strconv.Itoa(base+c)
	}
	return ""
}

var asciiMap = map[rune]rune{'·': '-', '↑': '^', '↓': 'v', '←': '<', '→': '>', '…': '~', '✓': 'x', '✗': 'x', '▶': '>', '●': '*', '☆': '*', '■': '#', '□': '-', '▸': '>', '×': 'x', '“': '"', '”': '"', '‘': '\'', '’': '\'', '⤷': '>', '—': '-', '–': '-', '░': '.', '▒': '+', '█': '#', '»': '>'}

// toASCII keeps every byte 7-bit when the locale is not UTF-8.
func toASCII(r rune) rune {
	if r < 128 {
		return r
	}
	if a, ok := asciiMap[r]; ok {
		return a
	}
	return '?'
}

func plain(s string) string {
	if unicode {
		return s
	}
	return strings.Map(toASCII, s)
}

func (g *Grid) lines() []string {
	out := make([]string, g.H)
	for y := 0; y < g.H; y++ {
		var sb strings.Builder
		last := ""
		for x := 0; x < g.W; x++ {
			c := g.C[y][x]
			if colorMode != ModeNone {
				k := "\x1b[0"
				if c.B {
					k += ";1"
				}
				k += colorCode(c.Fg, false) + colorCode(c.Bg, true) + "m"
				if k != last {
					sb.WriteString(k)
					last = k
				}
			}
			ch := c.Ch
			if !unicode {
				ch = toASCII(ch)
			}
			sb.WriteRune(ch)
		}
		if colorMode != ModeNone {
			sb.WriteString("\x1b[0m")
			out[y] = sb.String()
		} else {
			out[y] = strings.TrimRight(sb.String(), " ")
		}
	}
	return out
}

// ---------------------------------------------------------------- app

type App struct {
	welcomePage, lq, optCursor int
	editVirt                   bool
	p                                                    *Progress
	view, status, toast, stage, palette, nameDraft       string
	step, cursor, factCursor, mapCursor, charCursor      int
	scroll, focus, clearXP                               int
	clearOptional, clearStageCleared, persist, skipAsk bool
	showAll                                              map[string]bool
	cmds                                                 []string
}

type SegSt struct {
	S  string
	St St
}

type Line struct {
	Segs  []SegSt
	Cmd   int
	Label bool
}

func (a *App) instructions(st Step, sid string, width int, sel St) []Line {
	G, L := glyphs(), W.Labels
	var lines []Line
	bold := St{B: true}
	sp := func(n int) SegSt { return SegSt{S: strings.Repeat(" ", maxi(0, n))} }
	push := func(segs ...SegSt) { lines = append(lines, Line{Segs: segs, Cmd: -1}) }
	blank := func() {
		if len(lines) > 0 && len(lines[len(lines)-1].Segs) > 0 {
			push()
		}
	}
	words := func(segs []Seg) []SegSt {
		var out []SegSt
		for _, sg := range segs {
			st := St{}
			if sg.T == "b" || sg.T == "code" {
				st = bold
			}
			for _, w := range strings.Fields(sg.V) {
				out = append(out, SegSt{S: w, St: st})
			}
		}
		for _, sg := range segs {
			if sg.T == "a" {
				if sl := stageLink(sg.Href); sl != "" {
					out = append(out, SegSt{S: fmt.Sprintf("(stage %d)", stageNo(sl))})
				} else {
					out = append(out, SegSt{S: "<" + sg.Href + ">"})
				}
			}
		}
		return out
	}
	flow := func(ws []SegSt, ind int, lead string, hang int) {
		var cur []SegSt
		n, firstLine := 0, true
		max := width - ind
		if lead != "" {
			cur = append(cur, SegSt{S: lead, St: bold})
			n = rlen(lead)
		}
		emit := func() {
			in := ind
			if !firstLine {
				in += hang
			}
			lines = append(lines, Line{Segs: append([]SegSt{sp(in)}, cur...), Cmd: -1})
		}
		for _, w := range ws {
			lim := max
			if !firstLine {
				lim = max - hang
			}
			wl := rlen(w.S)
			if n > 0 && n+1+wl > lim {
				emit()
				cur, n, firstLine = nil, 0, false
			}
			if n > 0 {
				cur = append(cur, SegSt{S: " "})
				n++
			}
			cur = append(cur, w)
			n += wl
		}
		if len(cur) > 0 {
			emit()
		}
	}
	para := func(blocks []MdBlock, ind int, lead string) {
		for bi, b := range blocks {
			l := ""
			if bi == 0 {
				l = lead
			}
			if b.K == "p" {
				flow(words(b.Segs), ind, l, 0)
				continue
			}
			if l != "" {
				push(sp(ind), SegSt{S: l, St: bold})
			}
			for i, it := range b.Items {
				mk := "•"
				if !unicode {
					mk = "-"
				}
				if b.K == "ol" {
					mk = strconv.Itoa(b.Start+i) + "."
				}
				flow(words(it), ind, mk, rlen(mk)+1)
			}
		}
	}
	P := func(s string) []MdBlock { return []MdBlock{{K: "p", Segs: []Seg{{T: "text", V: s}}}} }
	if so := onlyLabel(st.Only, a.p.Facts); so != "" {
		push(sp(2), SegSt{S: "[" + so + "]"})
	}
	if (st.Help.Tool != "" || st.Help.Docs != "") && a.status != "tip" {
		s := " " + st.Help.Tool
		if st.Help.Source != "" {
			s += " <" + st.Help.Source + ">"
		}
		if st.Help.Docs != "" {
			s += "  " + L["docs"] + ": <" + st.Help.Docs + ">"
		}
		flow(append([]SegSt{{S: L["tool"] + ":", St: bold}}, words([]Seg{{T: "text", V: s}})...), 2, "", 2)
	}
	key := stepKey(sid, st.ID)
	rows := flatten(st.Blocks, key, a.p.Facts, a.showAll, 0, nil)
	if a.status == "failed" {
		rows = append(rows, Row{Type: "trouble"})
		rows = flatten(st.Check.Fail, key+"/fail", a.p.Facts, a.showAll, 1, rows)
	}
	aiRows := func(kind, title string) {
		var sp2 *Step
		if kind == "fail" {
			sp2 = &st
		}
		code := prompt(kind, a.p, sid, sp2)
		rows = append(rows, Row{Type: "heading", Text: title})
		rows = append(rows, Row{Type: "callout", Kind: "warning", Blocks: md(W.Prompts.Warning)})
		if isMaster(a.p.Facts) {
			rows = append(rows, Row{Type: "text", Blocks: P("Press v to type the name of your virtualization software into the prompt.")})
		}
		rows = append(rows, Row{Type: "command", IsFile: true, Name: "AI prompt", Code: code})
	}
	if a.status == "failed" {
		aiRows("fail", L["ai_title"])
	}
	if a.status == "tip" {
		rows = nil
		aiRows("tip", L["tip_title"])
	}
	a.cmds = nil
	ci := 0
	for _, r := range rows {
		ind := 2 + r.Inset*2
		if r.Only != "" && r.Type != "altHeader" {
			blank()
			push(sp(ind), SegSt{S: "[" + r.Only + "]"})
		} else if r.Type != "altHeader" {
			blank()
		}
		switch r.Type {
		case "text":
			para(r.Blocks, ind, "")
		case "heading":
			if r.Text != "" {
				push(sp(ind), SegSt{S: r.Text, St: bold})
			}
		case "altHeader":
			blank()
			extra := ""
			if r.Only != "" {
				extra = "  [" + r.Only + "]"
			}
			push(sp(ind), SegSt{S: G.Tri + " " + r.Label, St: bold}, SegSt{S: extra})
		case "command":
			focus := ci == a.focus
			label := "Command " + strconv.Itoa(ci+1)
			if r.IsFile {
				label = "File: " + r.Name
			}
			pre, s2 := "  ", St{}
			if focus {
				label += "  " + G.Dot + "  c copy  " + G.Dot + "  o print plain"
				pre, s2 = G.Cur+" ", sel
			}
			lines = append(lines, Line{Segs: []SegSt{sp(ind), {S: pre + label, St: s2}}, Cmd: ci, Label: true})
			ci2 := ind + 2
			cl := strings.Split(r.Code, "\n")
			for li, l0 := range cl {
				l := l0
				if !r.IsFile {
					if li > 0 && strings.HasSuffix(strings.TrimRight(cl[li-1], " "), "\\") {
						l = "  " + l0
					} else {
						l = "$ " + l0
					}
				}
				rs := []rune(l)
				firstW := width - ci2
				if len(rs) <= firstW {
					lines = append(lines, Line{Segs: []SegSt{sp(ci2), {S: l, St: bold}}, Cmd: ci})
					continue
				}
				lines = append(lines, Line{Segs: []SegSt{sp(ci2), {S: string(rs[:firstW]), St: bold}}, Cmd: ci})
				rs = rs[firstW:]
				for len(rs) > 0 {
					n := mini(len(rs), maxi(8, width-ci2-2))
					lines = append(lines, Line{Segs: []SegSt{sp(ci2 + 2), {S: string(rs[:n]), St: bold}}, Cmd: ci})
					rs = rs[n:]
				}
			}
			a.cmds = append(a.cmds, r.Code)
			ci++
		case "output":
			push(sp(ind), SegSt{S: "  " + L["expected_output"] + ":"})
			for _, l := range r.Lines {
				push(sp(ind+4), SegSt{S: clip(l, width-ind-4)})
			}
		case "callout":
			ic := map[string]string{"note": "[i]", "caution": "[!]", "warning": "/!\\"}[r.Kind]
			if ic == "" {
				ic = "[i]"
			}
			para(r.Blocks, ind, ic+" "+L[r.Kind]+":")
		case "empty":
			push(sp(ind), SegSt{S: "? " + L["empty"], St: bold})
			para(P("Your loadout: " + loadoutText(a.p.Facts) + ". Press a to show all " + strconv.Itoa(r.Total) + " options, l to change your loadout."), ind+2, "")
		case "notice":
			push(sp(ind), SegSt{S: L["showing_all"] + " (a: match my loadout)"})
		case "trouble":
			push(sp(ind), SegSt{S: " " + G.Fail + " " + L["troubleshooting"] + " ", St: sel})
			flow(words([]Seg{{T: "text", V: L["common_fixes"] + ", or copy the AI prompt below (Tab to it, then c)."}}), ind, "", 0)
		}
	}
	return lines
}

func (a *App) render(w, h int) *Grid {
	g, G, mode := newGrid(w, h), glyphs(), a.palette
	U := pal(mode, "ui")
	K, I, PL, PO := pal(mode, "kai"), pal(mode, "icons"), pal(mode, "player"), pal(mode, "portrait")
	barSt, sel := St{Fg: U[0], Bg: U[3], B: true}, St{Fg: U[3], Bg: U[1], B: true}
	if g.Plain {
		barSt, sel = St{}, St{B: true}
	}
	p, ids := a.p, stageIDs()
	sid := a.stage
	if sid == "" {
		sid = ids[0]
	}
	th, sc, no := themeStage(sid), stageC(sid), stageNo(sid)
	tot, gg, wide := totals(p), stageProgress(p, sid), w >= 100
	L := W.Labels
	name := playerName(p)
	NAME := strings.ToUpper(name)
	style := p.Character
	if style == "" {
		style = W.Player.Characters[a.charCursor].ID
	}
	plan := mentorPlan(name)
	mm := mentorByID(plan[sid])
	xp := fmt.Sprintf("XP %04d ", p.XP)
	D := " " + G.Dot + " "
	keys := func(s string) {
		if a.toast != "" {
			s = a.toast
		}
		g.bar(h-1, " "+s, "", barSt)
	}
	stGlyph := func(s string) string {
		return map[string]string{"cleared": G.Ok, "current": G.Now, "skipped": G.Skip, "locked": G.Lock}[s]
	}
	pspr := func(x, y int, pose string) { m, f := playerFrame(style, pose); g.sprite(x, y, m, PL, f, -1) }
	kspr := func(x, y int, anim string) { m, f := kaiFrame(anim); g.sprite(x, y, m, K, f, -1) }
	duo := func(x, y int, pose, kpose string) { pspr(x, y, pose); kspr(x+18, y, kpose) }

	switch a.view {
	case "title":
		g.bar(0, " "+W.Game.Title+" "+W.Game.Edition, "kai ", barSt)
		lx := (w - 36) / 2
		g.sprite(lx, 2, S.Logos["kairos"], pal(mode, "kairos"), false, -1)
		g.sprite(lx+20, 2, S.Logos["hadron"], pal(mode, "hadron"), false, -1)
		g.center(11, strings.Join(strings.Split(W.Game.Title, ""), " ")+"   "+strings.Join(strings.Split(W.Game.Edition, ""), " "), St{B: true})
		g.center(12, "with "+W.Game.Subtitle+" Linux", St{})
		y := 14
		if h >= 40 {
			scene(g, (w-40)/2, 14, 40, mode)
			kspr((w-40)/2+12, 14, "walk")
			y = 24
		}
		cont := "no save yet"
		if p.Started {
			cont = name + D + fmt.Sprintf("%d/%d steps", tot.Done, tot.Total)
		}
		items := [][2]string{{"New game", ""}, {"Continue", cont}, {"Plain view", W.Links.PlainView}}
		for i, it := range items {
			pre, st := "  ", St{}
			if i == a.cursor {
				pre, st = G.Cur+" ", sel
			}
			g.put((w-48)/2, y+i*2, pad(pre+fmt.Sprintf("%-12s", it[0])+it[1], 48), st)
		}
		g.put(2, h-3, clip(W.Footer, w-4), St{})
		keys("up/down move" + D + "Enter select" + D + "q quit")

	case "name":
		g.bar(0, " NEW GAME", "kai ", barSt)
		g.put(2, 2, "What's your name?", St{B: true})
		cw := w - 4
		if wide {
			cw = w - 26
		}
		g.para(2, 3, "KAI calls you by this name, and it goes on your badge.", cw, St{})
		g.box(2, 6, 20, 3, St{}, G)
		g.put(4, 7, a.nameDraft+"_", St{B: true})
		g.put(2, 10, fmt.Sprintf("Type up to %d characters. Backspace deletes.", W.Player.NameMax), St{})
		g.put(2, 11, "Empty is fine: KAI will call you "+W.Player.DefaultName+".", St{})
		if wide {
			kspr(w-20, 2, "wave")
		} else {
			kspr(w-18, 6, "wave")
		}
		keys("type your name" + D + "Enter confirm" + D + "Esc back")

	case "welcome":
		wm := mentorByID(W.Welcome.Mentor)
		pi := mini(a.welcomePage, len(W.Welcome.Pages)-1)
		g.bar(0, " WELCOME"+D+NAME, fmt.Sprintf("Page %d of %d ", pi+1, len(W.Welcome.Pages)), barSt)
		g.box(1, 1, 28, 14, St{}, G)
		g.sprite(3, 2, S.Portraits[wm.Portrait], PO, false, -1)
		g.put(31, 2, wm.Name, St{B: true})
		g.put(31, 3, wm.Country, St{})
		n := g.para(31, 5, mdPlain(fill(W.Welcome.Pages[pi].Md, map[string]string{"name": name})), w-33, St{})
		var dots []string
		for i := range W.Welcome.Pages {
			if i <= pi {
				dots = append(dots, G.Full)
			} else {
				dots = append(dots, G.Empty)
			}
		}
		g.put(31, mini(h-3, 6+n), strings.Join(dots, " "), St{})
		next := "next"
		if pi == len(W.Welcome.Pages)-1 {
			next = strings.ToLower(W.Welcome.Start)
		}
		keys("Enter " + next + D + "left back" + D + "q quit")

	case "character":
		g.bar(0, " NEW GAME"+D+NAME, "kai ", barSt)
		g.put(2, 2, "Pick your look", St{B: true})
		cs := W.Player.Characters
		cw := (w - 4) / len(cs)
		for i, c := range cs {
			x, on := 2+i*cw, i == a.charCursor
			g.sprite(x+(cw-16)/2, 4, S.Frames["p-"+c.ID+"-down"], PL, false, -1)
			lab, st := " "+c.Label+" ", St{B: true}
			if on {
				lab, st = "["+c.Label+"]", sel
			}
			g.put(x+(cw-rlen(lab))/2, 13, lab, st)
			for j, l := range wrap(c.Desc, cw-2) {
				g.put(x+1, 15+j, l, St{})
			}
		}
		keys("left/right choose" + D + "Enter confirm" + D + "Esc back")

	case "loadout":
		LO := W.Loadout
		qs := loadoutQuestions(p.Facts)
		qi := mini(a.lq, len(qs)-1)
		q := qs[qi]
		g.bar(0, " LOADOUT"+D+NAME, fill(LO.Progress, map[string]string{"n": strconv.Itoa(qi + 1), "total": strconv.Itoa(len(qs))})+" ", barSt)
		cw := w - 4
		if wide {
			cw = w - 26
			g.sprite(w-20, 2, S.Frames["front"], K, false, -1)
		}
		y := 2
		mdp := func(s string, x int) { y += g.para(x, y, mdPlain(s), cw-(x-2), St{}) }
		if q.Type == "notice" {
			nt := LO.Notices[q.ID]
			g.put(2, y, nt.Title, St{B: true})
			y += 2
			mdp(nt.Md, 2)
		} else {
			fd, qd := fact(q.ID), LO.Questions[q.ID]
			title := qd.Title
			if title == "" {
				title = fd.Question
			}
			g.put(2, y, title, St{B: true})
			y += 2
			for i, op := range fd.Options {
				od := qd.Options[op.ID]
				mark, st := " ", St{B: true}
				if i == a.optCursor {
					mark, st = G.Cur, sel
				}
				radio := "○ "
				if !unicode {
					radio = "( ) "
				}
				if p.Facts[q.ID] == op.ID {
					radio = "● "
					if !unicode {
						radio = "(*) "
					}
				}
				line := mark + " " + radio + op.Label
				if od.Badge != "" {
					line += "  [" + od.Badge + "]"
				}
				g.put(2, y, pad(line, mini(cw, 40)), st)
				y++
				if od.Md != "" {
					if h >= 30 {
						mdp(od.Md, 8)
					} else {
						g.put(8, y, clip(mdPlain(od.Md), cw-6), St{})
						y++
					}
				}
			}
			y++
			if qd.Md != "" {
				mdp(qd.Md, 2)
			}
			for _, x := range qd.When {
				if strict(x.Only, p.Facts) {
					mdp(x.Md, 2)
				}
			}
			if qd.Help != nil {
				y++
				g.put(2, y, qd.Help.Label+" "+mdPlain(qd.Help.Md), St{B: true})
				g.put(6, y+1, qd.Help.Code, St{B: true})
				y += 2
				mdp(qd.Help.After, 2)
			}
		}
		last := "next"
		if qi == len(qs)-1 {
			last = "start"
		}
		keys("up/down choose" + D + "Enter " + last + D + "Esc back" + D + "q quit")

	case "map":
		pg := S.Palettes[mode].Page
		if pg == nil {
			pg = S.Palettes["dmg"].Page
		}
		g.bar(0, " "+msg("map_title")+D+NAME, xp, barSt)
		cur := a.mapCursor
		y0 := 2
		if wide {
			eu, stops := S.Europe, routeStops(len(ids))
			ww, hh, sx := w-4, 32, 2
			ox := maxi(0, mini(eu.W/2-ww, stops[cur][0]/2-ww/2))
			oy := maxi(0, mini(eu.H/2-hh, stops[cur][1]/2-hh/2))
			land := func(x, y int) bool { return y >= 0 && y < len(eu.Rows) && x >= 0 && x < len(eu.Rows[y]) && eu.Rows[y][x] == '1' }
			rows := make([][]byte, hh)
			for yy := 0; yy < hh; yy++ {
				rows[yy] = make([]byte, ww)
				for xx := 0; xx < ww; xx++ {
					ax, ay := (ox+xx)*2, (oy+yy)*2
					l := land(ax, ay)
					coast := l && (!land(ax-2, ay) || !land(ax+2, ay) || !land(ax, ay-2) || !land(ax, ay+2))
					switch {
					case coast:
						rows[yy][xx] = '3'
					case l:
						rows[yy][xx] = '2'
					case (xx+yy*3)%11 == 0:
						rows[yy][xx] = '1'
					default:
						rows[yy][xx] = '0'
					}
				}
			}
			for _, s := range stops {
				x2, y2 := (s[0]+1)/2-ox, (s[1]+1)/2-oy
				for _, d := range [][2]int{{0, 0}, {1, 0}, {0, 1}, {1, 1}} {
					if yy, xx := y2+d[1], x2+d[0]; yy >= 0 && yy < hh && xx >= 0 && xx < ww {
						rows[yy][xx] = '0'
					}
				}
			}
			var rs []string
			for _, r := range rows {
				rs = append(rs, string(r))
			}
			g.sprite(sx, 2, rs, pal(mode, "world"), false, -1)
			for i, s := range stops {
				x2, y2 := sx+(s[0]+1)/2-ox, 2+((s[1]+1)/2-oy)/2
				if x2 >= sx && x2 < w-4 && y2 >= 2 && y2 < 2+hh/2 {
					st := barSt
					if i == cur {
						st = sel
					}
					g.put(x2+2, y2, stGlyph(stageState(p, ids[i]))+strconv.Itoa(i+1), st)
				}
			}
			y0 = 3 + hh/2
		}
		g.put(2, y0, clip(fmt.Sprintf("%d of %d stops done", tot.Cleared+tot.Skipped, tot.Stages)+D+fmt.Sprintf("%d/%d steps", tot.Done, tot.Total)+D+fmt.Sprintf("%d XP", p.XP), w-4), St{B: true})
		rowsN := maxi(1, (h-2-(y0+2))/2)
		start := maxi(0, mini(cur-rowsN/2, len(ids)-rowsN))
		for j := 0; j < rowsN && start+j < len(ids); j++ {
			i := start + j
			id := ids[i]
			state, q, y := stageState(p, id), stageProgress(p, id), y0+2+j*2
			m2 := mentorByID(plan[id])
			mark, st := " ", St{B: state != "locked"}
			if i == cur {
				mark, st = G.Cur, sel
			}
			head := mark + " " + stGlyph(state) + " " + fmt.Sprintf("%-17s", strconv.Itoa(i+1)+" "+themeStage(id).Location)
			if state == "cleared" && i != cur {
				st = St{B: true}
				if !g.Plain {
					st = St{Fg: pg["onCleared"], Bg: pg["cleared"], B: true}
				}
			}
			g.put(1, y, pad(clip(head+stageC(id).Title, w-2), w-2), st)
			tail := state
			if r := skipBlock(p, id); state == "current" && r != "" {
				tail += D + strings.ToLower(L["no_skip"]) + ": " + r
			}
			if state == "locked" {
				tail = "locked" + D + "finish or skip stop " + strconv.Itoa(i) + " first"
			} else if q.Side > 0 {
				tail += D + G.Side + fmt.Sprintf(" %d/%d", q.SideDone, q.Side)
			}
			g.put(7, y+1, clip(pbar(q.Done, q.Total, 8, G)+fmt.Sprintf(" %d/%d", q.Done, q.Total)+D+"with "+first(m2)+D+tail, w-8), St{})
		}
		if start > 0 {
			g.put(w-2, y0+2, G.Up, St{B: true})
		}
		if start+rowsN < len(ids) {
			g.put(w-2, h-3, G.Down, St{B: true})
		}
		if a.skipAsk {
			keys(clip("Skip "+themeStage(ids[cur]).Location+"? You can come back any time. y yes"+D+"n no", w-2))
		} else {
			keys("up/down move" + D + "Enter open" + D + "s skip" + D + "l loadout" + D + "q quit")
		}

	case "mentor":
		g.bar(0, fmt.Sprintf(" STOP %d %s", no, th.Location)+D+NAME, xp, barSt)
		g.box(1, 1, 28, 14, St{}, G)
		g.sprite(3, 2, S.Portraits[mm.Portrait], PO, false, -1)
		g.put(31, 2, "Mentor", St{})
		g.put(31, 3, mm.Name, St{B: true})
		g.put(31, 4, mm.Country, St{})
		g.para(31, 6, fill(msg("mentor_intro"), map[string]string{"mentor": first(mm), "goal": sc.Goal}), w-33, St{B: true})
		duo(31, 9, "happy", "wave")
		keys("Enter start" + D + "m route" + D + "q quit")

	case "stage":
		sts := steps(sid, p.Facts)
		si := mini(a.step, len(sts)-1)
		st := sts[si]
		failed := a.status == "failed"
		g.bar(0, fmt.Sprintf(" ST%d %s", no, th.Location)+D+NAME, "STEPS "+pbar(gg.Done, gg.Total, gg.Total, G)+fmt.Sprintf(" %d/%d  ", gg.Done, gg.Total)+xp, barSt)
		iw := w - 2
		if wide {
			iw = w - 44
		}
		ins := a.instructions(st, sid, iw, sel)
		anim := "read"
		if failed {
			anim = "sad"
		} else if len(a.cmds) > 0 {
			anim = "point"
		}
		dlg := []string{st.Title, st.Line}
		if failed {
			dlg = []string{msg("fail_head") + D + msg("fail_sub"), msg("fail_line")}
		} else if a.status == "tip" {
			dlg = []string{st.Title, msg("tip_line")}
		}
		sub := fmt.Sprintf(" Step %d of %d", si+1, len(sts)) + D + st.Title
		if st.Optional {
			sub += D + G.Side + " side quest (optional)"
		}
		scene(g, 0, 1, 40, mode)
		pspr(4, 1, anim)
		kspr(22, 1, anim)
		type dl struct {
			l string
			b bool
		}
		var dls []dl
		var ix, iy, ih int
		if !wide {
			bw := w - 41
			g.box(41, 1, bw, 8, St{}, G)
			for i, d := range dlg {
				for _, l := range wrap(d, bw-4) {
					dls = append(dls, dl{l, i == 0})
				}
			}
			for i, d := range dls {
				if i < 6 {
					g.put(43, 2+i, d.l, St{B: d.b})
				}
			}
			g.bar(9, sub, "", sel)
			ix, iy, ih = 0, 10, h-12
		} else {
			g.box(0, 9, 40, 8, St{}, G)
			for i, d := range dlg {
				for _, l := range wrap(d, 36) {
					dls = append(dls, dl{l, i == 0})
				}
			}
			for i, d := range dls {
				if i < 6 {
					g.put(2, 10+i, d.l, St{B: d.b})
				}
			}
			g.put(1, 18, "Steps"+D+"with "+first(mm), St{B: true})
			for i, x := range sts {
				m := G.Todo
				if p.Done[stepKey(sid, x.ID)] {
					m = G.Ok
				} else if x.Optional {
					m = G.Side
				}
				mark, s2 := " ", St{}
				if i == si {
					mark, s2 = G.Cur, sel
				}
				g.put(1, 19+i, clip(mark+" "+m+" "+strconv.Itoa(i+1)+" "+x.Title, 38), s2)
			}
			g.put(1, 20+len(sts), "Loadout", St{B: true})
			for i, l := range wrap(loadoutText(p.Facts), 37) {
				g.put(2, 21+len(sts)+i, l, St{})
			}
			g.fill(42, 1, w-42, 1, sel)
			g.put(42, 1, clip(sub, w-42), sel)
			ix, iy, ih = 42, 2, h-5
		}
		a.scroll = maxi(0, mini(a.scroll, maxi(0, len(ins)-ih)))
		for j := 0; j < ih && a.scroll+j < len(ins); j++ {
			x := ix
			for _, sg := range ins[a.scroll+j].Segs {
				g.put(x, iy+j, sg.S, sg.St)
				x += rlen(sg.S)
			}
		}
		if a.scroll > 0 {
			g.put(w-1, iy, G.Up, St{B: true})
		}
		if a.scroll+ih < len(ins) {
			g.put(w-1, iy+ih-1, G.Down, St{B: true})
		}
		done := p.Done[stepKey(sid, st.ID)]
		cx, cw := 0, w
		if wide {
			cx, cw = 42, w-42
		}
		chk := " Check (" + checkKind(st) + "): " + st.Check.Prompt
		if done {
			chk += "  " + G.Ok + " cleared"
		}
		g.put(cx, h-2, clip(chk, cw), St{B: true})
		if done {
			tipK := ""
			if isMaster(p.Facts) {
				tipK = D + "t TIP"
			}
			keys("Enter next step" + D + "left/right steps" + D + "up/down scroll" + D + "Tab cmd" + D + "c copy" + tipK + D + "m route")
		} else {
			tipK := ""
			if isMaster(p.Facts) {
				tipK = D + "t TIP"
			}
			if a.editVirt {
				keys("Virtualization software: " + p.VirtName + "_" + D + "Enter done")
			} else {
				keys("Enter " + strings.ToLower(L["next_step"]) + D + "n " + strings.ToLower(L["did_not_work"]) + D + "up/down" + D + "Tab" + D + "c copy" + tipK + D + "m route")
			}
		}

	case "clear-step", "clear-stage", "items", "complete", "badge":
		g.bar(0, fmt.Sprintf(" ST%d %s", no, th.Location)+D+NAME, xp, barSt)
		kx := (w - 34) / 2
		switch a.view {
		case "clear-step":
			duo(kx, 2, "celebrate", "celebrate")
			head := msg("step_clear")
			if a.clearOptional {
				head = msg("side_clear")
			}
			g.center(11, head, St{B: true})
			g.center(12, clip(fmt.Sprintf("+%d XP", a.clearXP)+D+fmt.Sprintf("%d of %d steps at %s", gg.Done, gg.Total, th.Location), w-4), St{})
			g.center(14, clip(fill(msg("step_clear_line"), map[string]string{"name": name}), w-4), St{})
			keys("Enter continue" + D + "m route" + D + "q quit")
		case "clear-stage":
			g.sprite(kx-10, 2, S.Portraits[mm.Portrait], PO, false, -1)
			kspr(kx+18, 2, "jump")
			pspr(kx+36, 2, "celebrate")
			g.center(15, msg("stage_clear")+D+fmt.Sprintf("STOP %d %s", no, th.Location), St{B: true})
			g.center(16, clip(fill(msg("mentor_outro"), map[string]string{"name": name, "mentor": first(mm)}), w-4), St{B: true})
			g.center(17, clip(sc.Title+D+fmt.Sprintf("%d/%d steps", gg.Done, gg.Total), w-4), St{})
			keys("Enter collect items" + D + "m route" + D + "q quit")
		case "items":
			g.put(2, 2, msg("item_head"), St{B: true})
			inv := inventory(p)
			for i, it := range stageItems(sid) {
				y := 4 + i*5
				if it.Part > 0 {
					var mg Inv
					for _, x := range inv {
						if x.ID == it.ID {
							mg = x
						}
					}
					g.sprite(3, y, S.Icons[mg.Icon], I, false, -1)
					g.put(14, y, fmt.Sprintf("%s %d/%d", mg.Name, mg.Have, mg.Total)+D+fmt.Sprintf("part %d: %s", it.Part, mg.Parts[it.Part-1].Label), St{B: true})
					g.put(14, y+1, clip(mg.Desc, w-16), St{})
					next := "Complete!"
					for _, pt := range mg.Parts {
						if !pt.Owned {
							if pt.Soon {
								next = fmt.Sprintf("Part %d, %s: coming soon", pt.N, pt.Label)
							} else {
								next = fmt.Sprintf("Next part: %s (stop %d)", pt.Label, stageNo(pt.Stage))
							}
							break
						}
					}
					g.put(14, y+2, clip(next, w-16), St{})
					continue
				}
				d := W.Items[it.ID]
				icon, ok := S.Icons[d.Icon]
				if !ok {
					icon = S.Icons["unknown"]
				}
				g.sprite(3, y, icon, I, false, -1)
				g.put(14, y, d.Name, St{B: true})
				g.put(14, y+1, clip(d.Desc, w-16), St{})
			}
			keys("Enter continue" + D + "m route" + D + "q quit")
		case "complete":
			g.bar(0, " "+msg("complete_head")+D+NAME, xp, barSt)
			g.put(2, 2, clip(fill(msg("complete_line"), map[string]string{"name": name}), w-4), St{B: true})
			g.put(2, 3, clip(fmt.Sprintf("%d/%d steps", tot.Done, tot.Total)+D+fmt.Sprintf("%d cleared", tot.Cleared)+D+fmt.Sprintf("%d skipped", tot.Skipped)+D+fmt.Sprintf("%d XP", p.XP), w-4), St{})
			for i, id := range ids {
				q, s2, m2 := stageProgress(p, id), stageState(p, id), mentorByID(plan[id])
				cnt := fmt.Sprintf("%d/%d", q.Done, q.Total)
				if s2 == "skipped" {
					cnt = "skipped"
				}
				g.put(2, 5+i, clip(stGlyph(s2)+" "+fmt.Sprintf("%-17s%-9s%-10s", strconv.Itoa(i+1)+" "+themeStage(id).Location, cnt, first(m2))+stageC(id).Title, w-4), St{})
			}
			var parts []string
			for _, it := range inventory(p) {
				switch {
				case it.Mega:
					s := fmt.Sprintf("%s %d/%d", it.Name, it.Have, it.Total)
					for _, pt := range it.Parts {
						if pt.Soon {
							s += " (+" + strings.ToLower(pt.Label) + " soon)"
						}
					}
					parts = append(parts, s)
				case it.Owned:
					parts = append(parts, it.Name)
				default:
					parts = append(parts, msg("unknown_item"))
				}
			}
			y1 := 6 + len(ids)
			n := 2
			if h >= 40 {
				n = 6
			}
			for i, l := range wrap("Items: "+strings.Join(parts, "  "), w-4) {
				if i < n {
					g.put(2, y1+i, l, St{})
				}
			}
			cy := h - 3
			if h >= 40 {
				cy = y1 + 7
			}
			g.put(2, cy, clip(L["cta"], w-4), St{B: true})
			if h >= 40 {
				yy := cy + 1
				for _, b := range stageC(ids[0]).Steps[0].Blocks {
					if b.Type != "alternatives" {
						continue
					}
					for i, it := range b.Items {
						if i >= 2 || !matches(it.Only, p.Facts) {
							continue
						}
						g.put(4, yy, it.Label+" ["+onlyText(it.Only)+"]", St{})
						yy++
						for _, l := range strings.Split(it.Blocks[0].Code, "\n") {
							g.put(6, yy, clip(l, w-8), St{B: true})
							yy++
						}
						yy++
					}
				}
			}
			keys("Enter badge" + D + "m route" + D + "q quit")
		case "badge":
			g.bar(0, " "+msg("badge_title")+D+NAME, "", barSt)
			bw := 36
			bx := (w - bw) / 2
			g.box(bx, 2, bw, 16, St{}, G)
			g.sprite(bx+10, 3, S.Frames["front"][:10], K, false, -1)
			g.center(10, msg("badge_title"), St{B: true})
			nm := []rune(NAME)
			g.center(12, string(nm[:mini(12, len(nm))]), St{B: true})
			date := p.CompletedAt
			if date == "" {
				date = today()
			}
			g.center(14, date, St{})
			g.center(16, G.Side+fmt.Sprintf(" %d stops", tot.Cleared)+D+fmt.Sprintf("%d XP ", p.XP)+G.Side, St{})
			keys("m route" + D + "q quit")
		}
	}
	return g
}

// ---------------------------------------------------------------- actions (mirror KAI Workshop)

func (a *App) save() {
	if a.persist {
		saveProgress(a.p)
	}
}

func (a *App) curStep() Step {
	sts := steps(a.stage, a.p.Facts)
	return sts[mini(a.step, len(sts)-1)]
}

func indexOf(ids []string, id string) int {
	for i, x := range ids {
		if x == id {
			return i
		}
	}
	return 0
}

func (a *App) goMap() {
	target := a.stage
	if a.view != "stage" && a.view != "mentor" {
		if c := currentStage(a.p); c != "" {
			target = c
		}
	}
	a.view, a.skipAsk = "map", false
	a.mapCursor = indexOf(stageIDs(), target)
}

func (a *App) openStage(id string) {
	if stageState(a.p, id) == "locked" {
		a.toast = "Locked. Finish or skip the stop before it first."
		return
	}
	a.view, a.stage, a.step, a.status, a.scroll, a.focus = "mentor", id, firstOpenStep(a.p, id), "todo", 0, 0
	a.mapCursor = indexOf(stageIDs(), id)
}

func (a *App) doSkip() {
	id := stageIDs()[a.mapCursor]
	a.p.Skipped[id] = true
	a.skipAsk = false
	if allDone(a.p) && a.p.CompletedAt == "" {
		a.p.CompletedAt = today()
	}
	a.save()
	if allDone(a.p) {
		a.view = "complete"
		return
	}
	a.mapCursor = indexOf(stageIDs(), currentStage(a.p))
}

func (a *App) didIt() {
	st := a.curStep()
	key := stepKey(a.stage, st.ID)
	was := stageCleared(a.p, a.stage)
	gain := W.XP.Step
	if st.Optional {
		gain = W.XP.SideQuest
	}
	if !a.p.Done[key] {
		a.p.Done[key] = true
		a.p.XP += gain
	}
	if stageCleared(a.p, a.stage) {
		delete(a.p.Skipped, a.stage)
	}
	if allDone(a.p) && a.p.CompletedAt == "" {
		a.p.CompletedAt = today()
	}
	a.save()
	a.clearXP, a.clearOptional = gain, st.Optional
	a.clearStageCleared = !was && stageCleared(a.p, a.stage)
	a.view, a.status = "clear-step", "done"
}

func (a *App) nextIndex() int {
	sts := steps(a.stage, a.p.Facts)
	for i := a.step + 1; i < len(sts); i++ {
		if !a.p.Done[stepKey(a.stage, sts[i].ID)] {
			return i
		}
	}
	for i, s := range sts {
		if !s.Optional && !a.p.Done[stepKey(a.stage, s.ID)] {
			return i
		}
	}
	return mini(a.step+1, len(sts)-1)
}

func (a *App) clearNext() {
	switch a.view {
	case "clear-step":
		if a.clearStageCleared {
			a.view = "clear-stage"
		} else {
			a.view, a.step, a.status, a.scroll, a.focus = "stage", a.nextIndex(), "todo", 0, 0
		}
	case "clear-stage":
		if len(stageItems(a.stage)) > 0 {
			a.view = "items"
		} else {
			a.afterItems()
		}
	case "items":
		a.afterItems()
	}
}

func (a *App) afterItems() {
	if allDone(a.p) {
		a.view = "complete"
		return
	}
	a.goMap()
}

func (a *App) optIndex(lq int) int {
	qs := loadoutQuestions(a.p.Facts)
	q := qs[mini(lq, len(qs)-1)]
	if q.Type != "fact" {
		return 0
	}
	for i, o := range fact(q.ID).Options {
		if o.ID == a.p.Facts[q.ID] {
			return i
		}
	}
	return 0
}

// focusPrompt moves the Tab focus to the AI prompt (the last command block).
func (a *App) focusPrompt(w, h int) {
	iw := w - 2
	if w >= 100 {
		iw = w - 44
	}
	a.instructions(a.curStep(), a.stage, iw, St{})
	a.focus = maxi(0, len(a.cmds)-1)
	a.revealFocus(w, h)
}

func (a *App) continueGame() {
	switch {
	case !a.p.Started:
		return
	case a.p.Name == "":
		a.view, a.nameDraft = "name", ""
	case a.p.Character == "":
		a.view = "character"
	case allDone(a.p):
		a.view = "complete"
	default:
		a.goMap()
	}
}

func osc52(s string) string {
	return "\x1b]52;c;" + base64.StdEncoding.EncodeToString([]byte(s)) + "\a"
}

// ---------------------------------------------------------------- terminal I/O

func termSize() (int, int) {
	cmd := exec.Command("stty", "size")
	cmd.Stdin = os.Stdin
	if out, err := cmd.Output(); err == nil {
		f := strings.Fields(string(out))
		if len(f) == 2 {
			r, e1 := strconv.Atoi(f[0])
			c, e2 := strconv.Atoi(f[1])
			if e1 == nil && e2 == nil && r > 0 && c > 0 {
				return c, r
			}
		}
	}
	c, _ := strconv.Atoi(os.Getenv("COLUMNS"))
	r, _ := strconv.Atoi(os.Getenv("LINES"))
	if c <= 0 {
		c = 80
	}
	if r <= 0 {
		r = 24
	}
	return c, r
}

func stty(args ...string) bool {
	cmd := exec.Command("stty", args...)
	cmd.Stdin = os.Stdin
	return cmd.Run() == nil
}

// Key is a named key ("up", "enter", "bs", ...) or a single printable character.
type Key string

func readKey(raw bool, in *bufio.Reader) Key {
	if !raw {
		line, err := in.ReadString('\n')
		if err != nil {
			return "quit"
		}
		line = strings.TrimRight(line, "\r\n")
		switch strings.TrimSpace(line) {
		case "":
			return "enter"
		case "up":
			return "up"
		case "down":
			return "down"
		case "left":
			return "left"
		case "right":
			return "right"
		case "tab":
			return "tab"
		case "esc":
			return "esc"
		}
		return Key(line)
	}
	b, err := in.ReadByte()
	if err != nil {
		return "quit"
	}
	switch b {
	case 3:
		return "quit"
	case 13, 10:
		return "enter"
	case 9:
		return "tab"
	case 127, 8:
		return "bs"
	case 27:
		if in.Buffered() == 0 {
			return "esc"
		}
		b2, _ := in.ReadByte()
		if b2 == '[' || b2 == 'O' {
			b3, _ := in.ReadByte()
			switch b3 {
			case 'A':
				return "up"
			case 'B':
				return "down"
			case 'C':
				return "right"
			case 'D':
				return "left"
			case 'Z':
				return "tab"
			}
		}
		return "esc"
	}
	if b >= 0x80 {
		// read the rest of a UTF-8 rune so names like "Jürgen" work
		buf := []byte{b}
		for !utf8.FullRune(buf) && len(buf) < 4 {
			c, err := in.ReadByte()
			if err != nil {
				break
			}
			buf = append(buf, c)
		}
		return Key(string(buf))
	}
	return Key(string(b))
}

func draw(a *App, w, h int) {
	var sb strings.Builder
	sb.WriteString("\x1b[H")
	ls := a.render(w, h).lines()
	for i, l := range ls {
		sb.WriteString(l + "\x1b[K")
		if i < len(ls)-1 {
			sb.WriteString("\r\n")
		}
	}
	fmt.Print(sb.String())
}

func play(a *App, fixedW, fixedH int) {
	if !isTTY {
		w, h := fixedW, fixedH
		if w == 0 {
			w, h = 80, 24
		}
		for _, l := range a.render(w, h).lines() {
			fmt.Println(l)
		}
		return
	}
	raw := stty("raw", "-echo")
	restore := func() {
		fmt.Print("\x1b[0m\x1b[?25h\x1b[?1049l")
		if raw {
			stty("-raw", "echo")
		}
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt)
	go func() { <-sig; restore(); os.Exit(130) }()
	fmt.Print("\x1b[?1049h\x1b[?25l\x1b[2J")
	in := bufio.NewReader(os.Stdin)
	for {
		w, h := fixedW, fixedH
		if w == 0 {
			w, h = termSize()
		}
		draw(a, w, h)
		k := readKey(raw, in)
		a.toast = ""
		if k == "quit" || (k == "q" && a.view != "name" && !a.editVirt) {
			if a.view == "stage" || a.view == "loadout" || a.view == "mentor" {
				a.goMap()
				continue
			}
			break
		}
		if a.view == "stage" && !a.editVirt && len(a.cmds) > 0 && (k == "o" || k == "c") {
			cmd := a.cmds[mini(a.focus, len(a.cmds)-1)]
			if k == "c" {
				fmt.Print(osc52(cmd))
				a.toast = "Copied with OSC 52. Nothing pasted? Press o to print it plain and select it."
				continue
			}
			restore()
			fmt.Print("\r\n" + cmd + "\r\n\r\nSelect the command above, then press Enter to go back.\r\n")
			bufio.NewReader(os.Stdin).ReadString('\n')
			raw = stty("raw", "-echo")
			in = bufio.NewReader(os.Stdin)
			fmt.Print("\x1b[?1049h\x1b[?25l\x1b[2J")
			continue
		}
		a.handle(k, w, h)
	}
	restore()
	fmt.Println(plain(fill(msg("goodbye"), map[string]string{"name": playerName(a.p)})))
}

func typed(cur string, k Key, max int) string {
	s := string(k)
	switch {
	case k == "bs":
		if r := []rune(cur); len(r) > 0 {
			return string(r[:len(r)-1])
		}
		return cur
	case rlen(s) == 1 && (s >= " " || []rune(s)[0] >= 0x80) && s != "\x7f":
		if rlen(cur) < max {
			return cur + s
		}
	case rlen(s) > 1 && !strings.ContainsAny(s, "\x1b") && len([]rune(s)) <= 8 && s != "enter" && s != "tab" && s != "up" && s != "down" && s != "left" && s != "right" && s != "esc" && s != "quit":
		r := []rune(cur + s)
		return string(r[:mini(max, len(r))])
	}
	return cur
}

func (a *App) handle(k Key, w, h int) {
	ids := stageIDs()
	if a.editVirt {
		if k == "enter" || k == "esc" {
			a.editVirt = false
			a.save()
		} else {
			a.p.VirtName = typed(a.p.VirtName, k, 40)
		}
		return
	}
	switch a.view {
	case "title":
		switch k {
		case "up", "down":
			d := 1
			if k == "up" {
				d = 2
			}
			for {
				a.cursor = (a.cursor + d) % 3
				if a.cursor != 1 || a.p.Started {
					break
				}
			}
		case "enter":
			switch a.cursor {
			case 0:
				s := a.p.Settings
				a.p = newProgress()
				a.p.Settings, a.p.Started = s, true
				a.save()
				a.view, a.nameDraft, a.factCursor, a.charCursor = "name", "", 0, 0
			case 1:
				a.continueGame()
			case 2:
				a.toast = plain("Plain view: " + W.Links.PlainView)
			}
		}
	case "name":
		switch k {
		case "enter":
			n := strings.TrimSpace(a.nameDraft)
			if n == "" {
				n = W.Player.DefaultName
			}
			a.p.Name, a.p.Started = n, true
			a.save()
			a.view, a.welcomePage = "welcome", 0
		case "esc":
			a.view = "title"
		default:
			a.nameDraft = typed(a.nameDraft, k, W.Player.NameMax)
		}
	case "welcome":
		switch k {
		case "enter", "right":
			if a.welcomePage+1 < len(W.Welcome.Pages) {
				a.welcomePage++
			} else {
				a.view = "character"
			}
		case "left", "esc":
			if a.welcomePage > 0 {
				a.welcomePage--
			} else {
				a.view, a.nameDraft = "name", a.p.Name
			}
		}
	case "character":
		n := len(W.Player.Characters)
		switch k {
		case "left":
			a.charCursor = (a.charCursor + n - 1) % n
		case "right":
			a.charCursor = (a.charCursor + 1) % n
		case "enter":
			a.p.Character = W.Player.Characters[a.charCursor].ID
			a.save()
			a.view, a.lq, a.optCursor = "loadout", 0, a.optIndex(0)
		case "esc":
			a.view, a.welcomePage = "welcome", len(W.Welcome.Pages)-1
		}
	case "loadout":
		qs := loadoutQuestions(a.p.Facts)
		qi := mini(a.lq, len(qs)-1)
		q := qs[qi]
		switch k {
		case "up", "down", "left", "right":
			if q.Type == "fact" {
				n := len(fact(q.ID).Options)
				if k == "up" || k == "left" {
					a.optCursor = (a.optCursor + n - 1) % n
				} else {
					a.optCursor = (a.optCursor + 1) % n
				}
				a.p.Facts = withFact(a.p.Facts, q.ID, fact(q.ID).Options[a.optCursor].ID)
				a.p.Started = true
				a.save()
			}
		case "enter":
			if q.Type == "fact" && unset(a.p.Facts, q.ID) {
				a.p.Facts = withFact(a.p.Facts, q.ID, fact(q.ID).Options[a.optCursor].ID)
				a.save()
			}
			qs = loadoutQuestions(a.p.Facts)
			if qi+1 < len(qs) {
				a.lq = qi + 1
				a.optCursor = a.optIndex(a.lq)
			} else {
				a.goMap()
			}
		case "esc", "bs":
			if qi > 0 {
				a.lq = qi - 1
				a.optCursor = a.optIndex(a.lq)
			} else {
				a.view = "character"
			}
		}
	case "map":
		if a.skipAsk {
			if k == "y" {
				a.doSkip()
			} else {
				a.skipAsk = false
			}
			return
		}
		switch k {
		case "up", "left":
			a.mapCursor = maxi(0, a.mapCursor-1)
		case "down", "right":
			a.mapCursor = mini(len(ids)-1, a.mapCursor+1)
		case "enter":
			a.openStage(ids[a.mapCursor])
		case "s":
			if r := skipBlock(a.p, ids[a.mapCursor]); r != "" {
				a.toast = plain(W.Labels["no_skip"] + ": " + r)
			} else if stageState(a.p, ids[a.mapCursor]) == "current" {
				a.skipAsk = true
			} else {
				a.toast = "Only the current stop can be skipped."
			}
		case "l":
			a.view, a.lq, a.optCursor = "loadout", 0, a.optIndex(0)
		}
	case "mentor":
		switch k {
		case "enter":
			a.view = "stage"
		case "m", "esc":
			a.goMap()
		}
	case "stage":
		sts := steps(a.stage, a.p.Facts)
		done := a.p.Done[stepKey(a.stage, a.curStep().ID)]
		switch k {
		case "up", "k":
			a.scroll = maxi(0, a.scroll-1)
		case "down", "j":
			a.scroll++
		case " ":
			a.scroll += h / 2
		case "tab":
			if len(a.cmds) > 0 {
				a.focus = (a.focus + 1) % len(a.cmds)
				a.revealFocus(w, h)
			}
		case "left":
			if a.step > 0 {
				a.step, a.status, a.scroll, a.focus = a.step-1, "todo", 0, 0
			}
		case "right":
			if a.step < len(sts)-1 {
				a.step, a.status, a.scroll, a.focus = a.step+1, "todo", 0, 0
			}
		case "y":
			if !done {
				a.didIt()
			}
		case "n":
			a.status, a.scroll = "failed", 1<<20
			a.focusPrompt(w, h)
		case "t":
			if isMaster(a.p.Facts) {
				if a.status == "tip" {
					a.status = "todo"
				} else {
					a.status, a.scroll = "tip", 0
					a.focusPrompt(w, h)
				}
			}
		case "v":
			if isMaster(a.p.Facts) && (a.status == "failed" || a.status == "tip") {
				a.editVirt = true
			}
		case "enter":
			if !done {
				a.didIt()
			} else {
				if a.step < len(sts)-1 {
					a.step, a.status, a.scroll, a.focus = a.step+1, "todo", 0, 0
				} else {
					a.goMap()
				}
			}
		case "a":
			key := stepKey(a.stage, a.curStep().ID)
			for bi, b := range a.curStep().Blocks {
				if b.Type == "alternatives" {
					k2 := key + "/" + strconv.Itoa(bi)
					a.showAll[k2] = !a.showAll[k2]
				}
			}
		case "l":
			a.view = "loadout"
		case "esc":
			if a.status != "todo" {
				a.status = "todo"
			} else {
				a.goMap()
			}
		case "m":
			a.goMap()
		}
	case "clear-step", "clear-stage", "items":
		switch k {
		case "enter":
			a.clearNext()
		case "m":
			a.goMap()
		}
	case "complete":
		switch k {
		case "enter":
			a.view = "badge"
		case "m":
			a.goMap()
		}
	case "badge":
		if k == "m" || k == "esc" {
			a.goMap()
		}
	}
}

func (a *App) revealFocus(w, h int) {
	iw, ih := w-2, h-12
	if w >= 100 {
		iw, ih = w-44, h-5
	}
	for i, l := range a.instructions(a.curStep(), a.stage, iw, St{}) {
		if l.Label && l.Cmd == a.focus {
			if i < a.scroll || i >= a.scroll+ih-3 {
				a.scroll = maxi(0, i-1)
			}
			return
		}
	}
}

// ---------------------------------------------------------------- CLI

func main() {
	cmd := "play"
	args := os.Args[1:]
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		cmd, args = args[0], args[1:]
	}
	fs := flag.NewFlagSet(cmd, flag.ExitOnError)
	assets := fs.String("assets", "", "directory with kai-sprites.json, theme.json and content.json")
	color := fs.String("color", "auto", "auto | truecolor | 256 | 16 | none | ascii")
	palette := fs.String("palette", "", "dmg | kairos | gbc (default: saved setting)")
	size := fs.String("size", "", "fixed size WxH, e.g. 80x24 or 120x40")
	screen := fs.String("screen", "title", "render: title | name | character | loadout | map | mentor | stage | clear-step | clear-stage | items | complete | badge")
	stage := fs.String("stage", "", "stage id (slug), e.g. build-image")
	step := fs.Int("step", 0, "step index within the stage (0-based)")
	status := fs.String("status", "todo", "render: todo | failed | tip")
	wpage := fs.Int("welcome-page", 0, "render: welcome page (0-based)")
	lq := fs.Int("lq", 0, "render: loadout question index (0-based)")
	virt := fs.String("virt", "", "render: your virtualization software (Master)")
	cleared := fs.Int("cleared", 0, "render: pretend the first N stages are cleared")
	skipped := fs.String("skipped", "", "render: comma-separated stage ids to mark skipped")
	facts := fs.String("facts", "", "render: os=macos,arch=arm64,runtime=docker,virtualization=kairos-lab")
	pname := fs.String("name", "", "render: player name")
	pchar := fs.String("character", "", "render: hoodie | cap | beanie")
	reset := fs.Bool("reset", false, "play: erase saved progress first")
	fs.Parse(args)
	load(*assets)
	detect(*color)

	a := &App{view: "title", status: "todo", showAll: map[string]bool{}}
	fw, fh := 0, 0
	if *size != "" {
		if parts := strings.SplitN(strings.ToLower(*size), "x", 2); len(parts) == 2 {
			fw, _ = strconv.Atoi(parts[0])
			fh, _ = strconv.Atoi(parts[1])
		}
	}

	switch cmd {
	case "play":
		a.persist = true
		if *reset {
			a.p = newProgress()
			saveProgress(a.p)
		} else {
			a.p = loadProgress()
		}
		a.palette = a.p.Settings.Palette
		if *palette != "" {
			a.palette = *palette
		}
		a.stage = currentStage(a.p)
		for i, c := range W.Player.Characters {
			if c.ID == a.p.Character {
				a.charCursor = i
			}
		}
		play(a, fw, fh)
	case "render":
		a.p = newProgress()
		a.p.Started, a.p.Name, a.p.Character = true, *pname, *pchar
		if a.p.Name == "" {
			a.p.Name = W.Player.DefaultName
		}
		if a.p.Character == "" {
			a.p.Character = W.Player.Characters[0].ID
		}
		for _, kv := range strings.Split(*facts, ",") {
			if p := strings.SplitN(kv, "=", 2); len(p) == 2 {
				a.p.Facts[strings.TrimSpace(p[0])] = strings.TrimSpace(p[1])
			}
		}
		for i, s := range C.Stages {
			if i < *cleared {
				for _, st := range s.Steps {
					if !st.Optional {
						a.p.Done[stepKey(s.ID, st.ID)] = true
						a.p.XP += W.XP.Step
					}
				}
			}
		}
		for _, id := range strings.Split(*skipped, ",") {
			if id = strings.TrimSpace(id); id != "" {
				a.p.Skipped[id] = true
			}
		}
		if allDone(a.p) {
			a.p.CompletedAt = today()
		}
		a.palette = *palette
		if a.palette == "" {
			a.palette = "dmg"
		}
		a.stage = *stage
		if a.stage == "" {
			a.stage = stageIDs()[0]
		}
		a.view, a.step, a.status, a.clearXP = *screen, *step, *status, W.XP.Step
		a.welcomePage, a.lq, a.p.VirtName = *wpage, *lq, *virt
		a.optCursor = a.optIndex(a.lq)
		a.mapCursor = indexOf(stageIDs(), a.stage)
		if fw == 0 {
			fw, fh = 80, 24
		}
		for _, l := range a.render(fw, fh).lines() {
			fmt.Println(l)
		}
	case "say":
		mode := "dmg"
		if *palette != "" {
			mode = *palette
		}
		g, G := newGrid(80, 9), glyphs()
		scene(g, 0, 0, 40, mode)
		m, f := kaiFrame("talk")
		g.sprite(12, 0, m, pal(mode, "kai"), f, -1)
		g.box(41, 0, 39, 8, St{}, G)
		for i, l := range wrap(strings.Join(fs.Args(), " "), 35) {
			if i < 6 {
				g.put(43, 1+i, l, St{})
			}
		}
		for _, l := range g.lines() {
			fmt.Println(l)
		}
	default:
		usage()
		os.Exit(1)
	}
}

func usage() {
	fmt.Println(`kai: the KAI workshop guide in your terminal

  kai [play] [--palette dmg|kairos|gbc] [--size 80x24] [--reset]
      keys: arrows (or j/k to scroll), Enter, Tab next command, c copy (OSC 52),
      o print the command plain, y / n check, a show all options, s skip stop,
      l loadout, m route, q quit
  kai render --screen map --stage fleet --size 120x40 --name Ana --character cap \
             --cleared 3 --skipped build-image --facts os=macos,runtime=docker
      print one frame (docs, CI, piping)
  kai say TEXT      KAI says TEXT

  --color auto|truecolor|256|16|none|ascii   --assets DIR`)
}
