# Prompt: generate a click-to-answer question deck

Paste everything below into the AI. Replace the CONTENT BRIEF at the bottom with
your topic/questions. The AI must return ONE complete `.html` file.

---

You are generating a **question deck** for the LessonForge presenter. Output a
single self-contained HTML file (inline CSS + JS, no external resources, no
build step). The teacher loads it via **Master Library → "Load slides file"**.

## Hard rules — do not break these

1. **Each slide is `<section class="page">…</section>`.** The presenter shows one
   `.page` at a time and forces it to `display:block!important`.
2. **Never put layout on `.page`.** Put every slide's content inside
   `<div class="q-wrap">…</div>` (use `class="q-wrap center"` for title slides).
   `.q-wrap` is the full-height flex container that fills the frame.
3. **`clickable` is the ONLY way an element receives taps** (the presenter passes
   real clicks through the ink layer to `.clickable` elements; everything else is
   inkable/annotatable). Rules for where it goes:
   - MCQ options: put `clickable` on the **letter badge** (`.key`) only — NOT on
     the whole option card, so the teacher can still write over the option text.
   - Buttons (Check / Reset) and numeric keypad keys: `clickable` on the button.
4. **Declare the answer in data attributes on the `<section>`** (the shared script
   reads these — never hardcode answers in JS):
   - Single: `data-qtype="single"  data-answer="C"`
   - Multiple: `data-qtype="multi"  data-answer="A,C,D"`
   - Numerical: `data-qtype="numerical"  data-answer="20"  data-tolerance="0.5"`
5. **Keep the `<style>` and `<script>` blocks below verbatim.** Only author the
   question `<section>` blocks. The script auto-wires every slide by its
   `data-qtype`, so correct markup is all that's needed.
6. Sizing uses `vmin` units so it scales to any board. Don't switch to px.
7. Optional: a `<p class="step ...">` is revealed only on the presenter's
   "Next Step" — use it for a delayed explanation (at most one per slide).

## Question-type markup templates

**Single correct** — one badge tap reveals right/wrong and locks:
```html
<section class="page" data-qtype="single" data-answer="C">
 <div class="q-wrap">
  <div class="q-head"><span class="q-type">Single correct</span><span class="q-num">Q1</span></div>
  <p class="q-text">QUESTION TEXT?</p>
  <div class="opts">
    <button class="opt" data-key="A"><span class="key clickable">A</span><span>OPTION A</span><span class="mark"></span></button>
    <button class="opt" data-key="B"><span class="key clickable">B</span><span>OPTION B</span><span class="mark"></span></button>
    <button class="opt" data-key="C"><span class="key clickable">C</span><span>OPTION C</span><span class="mark"></span></button>
    <button class="opt" data-key="D"><span class="key clickable">D</span><span>OPTION D</span><span class="mark"></span></button>
  </div>
  <div class="row">
    <button class="btn ghost clickable" data-role="reset">Reset</button>
    <span class="verdict" data-role="verdict"></span>
  </div>
  <p class="step hint">Explanation shown on Next Step (optional).</p>
 </div>
</section>
```

**Multiple correct** — toggle several badges, then Check grades them:
```html
<section class="page" data-qtype="multi" data-answer="A,C,D">
 <div class="q-wrap">
  <div class="q-head"><span class="q-type multi">Multiple correct</span><span class="q-num">Q2</span></div>
  <p class="q-text">QUESTION TEXT? (Select all that apply)</p>
  <div class="opts">
    <button class="opt" data-key="A"><span class="key clickable">A</span><span>OPTION A</span><span class="mark"></span></button>
    <button class="opt" data-key="B"><span class="key clickable">B</span><span>OPTION B</span><span class="mark"></span></button>
    <button class="opt" data-key="C"><span class="key clickable">C</span><span>OPTION C</span><span class="mark"></span></button>
    <button class="opt" data-key="D"><span class="key clickable">D</span><span>OPTION D</span><span class="mark"></span></button>
  </div>
  <div class="row">
    <button class="btn clickable" data-role="check">Check answer</button>
    <button class="btn ghost clickable" data-role="reset">Reset</button>
    <span class="verdict" data-role="verdict"></span>
  </div>
  <p class="hint">Tap the letter badge to select / deselect, then press <b>Check&nbsp;answer</b>.</p>
 </div>
</section>
```

**Numerical** — build the value on the keypad, Check compares within tolerance:
```html
<section class="page" data-qtype="numerical" data-answer="20" data-tolerance="0.5">
 <div class="q-wrap">
  <div class="q-head"><span class="q-type num">Numerical</span><span class="q-num">Q3</span></div>
  <p class="q-text">QUESTION TEXT? (answer in UNITS)</p>
  <div class="num-body">
    <div class="row">
      <div class="num-display" data-role="display">0</div>
      <span class="verdict" data-role="verdict"></span>
    </div>
    <div class="keypad">
      <button class="key-btn clickable" data-num="7">7</button>
      <button class="key-btn clickable" data-num="8">8</button>
      <button class="key-btn clickable" data-num="9">9</button>
      <button class="key-btn clickable" data-num="4">4</button>
      <button class="key-btn clickable" data-num="5">5</button>
      <button class="key-btn clickable" data-num="6">6</button>
      <button class="key-btn clickable" data-num="1">1</button>
      <button class="key-btn clickable" data-num="2">2</button>
      <button class="key-btn clickable" data-num="3">3</button>
      <button class="key-btn clickable op" data-num=".">.</button>
      <button class="key-btn clickable" data-num="0">0</button>
      <button class="key-btn clickable op" data-role="back">&#9003;</button>
    </div>
  </div>
  <div class="row">
    <button class="btn clickable" data-role="check">Check answer</button>
    <button class="btn ghost clickable" data-role="reset">Reset</button>
  </div>
  <p class="hint">Build the number on the keypad, then press <b>Check&nbsp;answer</b>.</p>
 </div>
</section>
```

## Fixed engine — paste once per file, KEEP VERBATIM

`<style>` block (goes in the file head area, before the sections):
```html
<style>
  html,body{height:100%;margin:0}
  .page{font-family:system-ui,'Segoe UI',sans-serif;color:#0f172a;height:100%;
    box-sizing:border-box;background:radial-gradient(circle at 25% 15%,#eef2ff,#faf5ff)}
  .q-wrap{height:100%;box-sizing:border-box;overflow:auto;display:flex;
    flex-direction:column;gap:2.4vmin;padding:5vmin 7vmin}
  .q-wrap.center{align-items:center;justify-content:center;text-align:center}
  .q-head{display:flex;align-items:center;gap:1.4vmin;flex-wrap:wrap}
  .q-type{font:700 1.9vmin system-ui;letter-spacing:.08em;text-transform:uppercase;
    color:#4f46e5;background:#e0e7ff;padding:.5em 1em;border-radius:999px}
  .q-type.multi{color:#0e7490;background:#cffafe}
  .q-type.num{color:#b45309;background:#fef3c7}
  .q-num{font:700 1.9vmin system-ui;color:#64748b}
  .q-text{margin:0;font-size:3.4vmin;font-weight:600;line-height:1.4;max-width:80ch}
  .opts{display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:1fr;gap:2vmin;
    margin-top:1vmin;flex:1 1 auto;align-content:stretch}
  @media (max-width:820px){.opts{grid-template-columns:1fr}}
  .opt{display:flex;align-items:center;gap:1.6vmin;text-align:left;background:#fff;
    border:2px solid #e2e8f0;border-radius:16px;padding:2vmin 3vmin;font-size:3.2vmin;
    color:#1e293b;min-height:0;transition:border-color .15s,background .15s;
    box-shadow:0 2px 8px rgba(15,23,42,.05)}
  .opt .key{flex:none;width:5.6vmin;height:5.6vmin;border-radius:12px;cursor:pointer;
    display:flex;align-items:center;justify-content:center;font:700 2.8vmin system-ui;
    background:#eef2ff;color:#4f46e5;transition:transform .1s,box-shadow .15s,background .15s}
  .opt .key:hover{transform:scale(1.08);box-shadow:0 0 0 3px rgba(99,102,241,.25)}
  .opt.correct{border-color:#22c55e;background:#f0fdf4}
  .opt.correct .key{background:#22c55e;color:#fff}
  .opt.wrong{border-color:#ef4444;background:#fef2f2}
  .opt.wrong .key{background:#ef4444;color:#fff}
  .opt.selected{border-color:#6366f1;background:#eef2ff}
  .opt.selected .key{background:#6366f1;color:#fff}
  .opt .mark{margin-left:auto;font-size:3vmin;font-weight:800;opacity:0;transition:opacity .15s}
  .opt.correct .mark::after{content:'\2713';color:#16a34a;opacity:1}
  .opt.wrong .mark::after{content:'\2717';color:#dc2626;opacity:1}
  .row{display:flex;align-items:center;gap:1.6vmin;flex-wrap:wrap;margin-top:.6vmin}
  .btn{border:0;border-radius:12px;padding:1.4vmin 2.6vmin;font:700 2.6vmin system-ui;
    color:#fff;cursor:pointer;background:linear-gradient(135deg,#6366f1,#8b5cf6);
    box-shadow:0 4px 14px rgba(99,102,241,.35);transition:filter .15s,transform .08s}
  .btn:hover{filter:brightness(1.08)}
  .btn:active{transform:translateY(1px)}
  .btn.ghost{background:#fff;color:#475569;border:2px solid #e2e8f0;box-shadow:none}
  .verdict{font-size:2.8vmin;font-weight:700;padding:.2em 0;min-height:1.2em}
  .verdict.ok{color:#16a34a}
  .verdict.no{color:#dc2626}
  .num-body{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;
    justify-content:center;gap:2.4vmin}
  .num-display{font:800 6vmin ui-monospace,monospace;color:#0f172a;background:#fff;
    border:2px solid #e2e8f0;border-radius:14px;padding:1.4vmin 3vmin;min-width:12ch;
    text-align:right;letter-spacing:.05em}
  .keypad{display:grid;grid-template-columns:repeat(3,9vmin);gap:1.6vmin}
  .key-btn{width:9vmin;height:9vmin;border-radius:14px;border:2px solid #e2e8f0;
    background:#fff;font:700 4vmin system-ui;color:#1e293b;cursor:pointer;display:flex;
    align-items:center;justify-content:center;transition:background .12s,transform .08s}
  .key-btn:hover{background:#eef2ff;border-color:#a5b4fc}
  .key-btn:active{transform:scale(.94)}
  .key-btn.op{background:#f8fafc;color:#4f46e5}
  .hint{font-size:2.2vmin;color:#64748b;margin:0}
  code{background:#eef2ff;color:#4338ca;padding:.1em .4em;border-radius:6px;font-size:.9em}
</style>
```

`<script>` block (goes after all the sections):
```html
<script>
(function(){
  "use strict";
  var parseList=function(s){return (s||"").split(",").map(function(x){return x.trim()}).filter(Boolean)};
  function setVerdict(page,msg,ok){var v=page.querySelector('[data-role="verdict"]');if(!v)return;
    v.textContent=msg;v.className="verdict "+(ok===true?"ok":ok===false?"no":"")}
  function initSingle(page){var answer=page.dataset.answer,done=false;
    page.querySelectorAll(".opt").forEach(function(opt){opt.addEventListener("click",function(){
      if(done)return;var key=opt.dataset.key;
      if(key===answer){opt.classList.add("correct");setVerdict(page,"Correct!",true)}
      else{opt.classList.add("wrong");var r=page.querySelector('.opt[data-key="'+answer+'"]');
        if(r)r.classList.add("correct");setVerdict(page,"Not quite — the correct answer is highlighted.",false)}
      done=true})});
    page.querySelector('[data-role="reset"]').addEventListener("click",function(){done=false;
      page.querySelectorAll(".opt").forEach(function(o){o.classList.remove("correct","wrong")});
      setVerdict(page,"",null)})}
  function initMulti(page){var answer=parseList(page.dataset.answer).sort();
    page.querySelectorAll(".opt").forEach(function(opt){opt.addEventListener("click",function(){
      if(page.dataset.locked)return;opt.classList.toggle("selected")})});
    page.querySelector('[data-role="check"]').addEventListener("click",function(){
      page.dataset.locked="1";
      var chosen=Array.prototype.slice.call(page.querySelectorAll(".opt.selected")).map(function(o){return o.dataset.key}).sort();
      page.querySelectorAll(".opt").forEach(function(o){var isAns=answer.indexOf(o.dataset.key)>-1;
        o.classList.remove("selected");if(isAns)o.classList.add("correct")});
      chosen.forEach(function(k){if(answer.indexOf(k)<0)page.querySelector('.opt[data-key="'+k+'"]').classList.add("wrong")});
      var exact=chosen.length===answer.length&&chosen.every(function(k,i){return k===answer[i]});
      setVerdict(page,exact?"All correct!":"Correct options are highlighted in green.",exact)});
    page.querySelector('[data-role="reset"]').addEventListener("click",function(){delete page.dataset.locked;
      page.querySelectorAll(".opt").forEach(function(o){o.classList.remove("selected","correct","wrong")});
      setVerdict(page,"",null)})}
  function initNumerical(page){var answer=parseFloat(page.dataset.answer),
    tol=parseFloat(page.dataset.tolerance||"0"),display=page.querySelector('[data-role="display"]'),buf="";
    var render=function(){display.textContent=buf===""?"0":buf};
    page.querySelectorAll("[data-num]").forEach(function(btn){btn.addEventListener("click",function(){
      var ch=btn.dataset.num;if(ch==="."&&buf.indexOf(".")>-1)return;if(buf.length>=10)return;buf+=ch;render()})});
    var back=page.querySelector('[data-role="back"]');
    if(back)back.addEventListener("click",function(){buf=buf.slice(0,-1);render()});
    page.querySelector('[data-role="check"]').addEventListener("click",function(){
      if(buf===""||buf==="."){setVerdict(page,"Enter a number first.",null);return}
      var val=parseFloat(buf),ok=Math.abs(val-answer)<=tol;
      setVerdict(page,ok?"Correct! ("+answer+")":"Incorrect — try again.",ok)});
    page.querySelector('[data-role="reset"]').addEventListener("click",function(){buf="";render();setVerdict(page,"",null)})}
  var INIT={single:initSingle,multi:initMulti,numerical:initNumerical};
  document.querySelectorAll(".page[data-qtype]").forEach(function(page){
    var fn=INIT[page.dataset.qtype];if(fn)fn(page)});
})();
</script>
```

## Output checklist (self-check before returning)

- [ ] One `.html` file, fully self-contained, `<style>` and `<script>` unchanged.
- [ ] Every slide is `<section class="page">` with an inner `.q-wrap`.
- [ ] `clickable` is on `.key` badges (MCQ) and on buttons/keypad — never on the `.opt` card.
- [ ] Each question `<section>` has the right `data-qtype` + `data-answer`
      (+ `data-tolerance` for numerical).
- [ ] Answer keys (`data-key`) match the letters shown, and `data-answer`
      points at the correct one(s).
- [ ] Optional first title slide uses `q-wrap center`.

---

## CONTENT BRIEF  (fill this in)

Topic / subject: ____
Difficulty / grade: ____
Number of questions and mix, e.g. "6 questions: 3 single, 2 multiple, 1 numerical": ____
Paste specific questions here if you have them, otherwise let the AI write them: ____
