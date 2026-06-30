/* Tele-Arena Atlas — renders rooms from ta-rooms.json as retro grid maps. */
"use strict";

const DIR = { // grid offset [col,row] per exit direction
  n:[0,-1], s:[0,1], e:[1,0], w:[-1,0],
  ne:[1,-1], nw:[-1,-1], se:[1,1], sw:[-1,1],
};
const CORR = { // corridor glyph at the mid-cell, keyed by offset
  "0,-1":"│","0,1":"│","1,0":"─","-1,0":"─",
  "1,-1":"╱","-1,1":"╱","1,1":"╲","-1,-1":"╲",
};
const TYPE = [ // [match(room) -> {glyph, cls, label}] first match wins
  [r => /plaza|square/i.test(r.name), {g:"O", c:"t-plaza", l:"plaza"}],
  [r => r.shop, {g:"$", c:"t-shop", l:"shop"}],
  [r => /temple/i.test(r.name), {g:"†", c:"t-temple", l:"temple"}],
  [r => /guild/i.test(r.name), {g:"G", c:"t-guild", l:"guild"}],
  [r => /arena/i.test(r.name), {g:"A", c:"t-arena", l:"arena"}],
  [r => r.monsters && r.monsters.length, {g:"M", c:"t-monster", l:"monsters"}],
  [r => (r.doors && r.doors.length), {g:"+", c:"t-door", l:"door"}],
  [() => true, {g:"·", c:"", l:"room"}],
];
const typeOf = r => (TYPE.find(([m]) => m(r)) || TYPE[TYPE.length-1])[1];

let DB = { rooms:{}, areas:[] };
let CUR = null;                       // current area name

// assign each distinct monster in a zone a short 1-2 char code for the map legend
function monsterCodes(ids){
  const names = [];
  for (const id of ids)
    for (const m of (DB.rooms[id].monsters || []))
      if (!names.includes(m)) names.push(m);
  const codes = {}, used = new Set();
  for (const nm of names){
    const w = nm.split(/\s+/);
    const cands = [
      nm[0].toUpperCase(),
      (nm[0] + (nm[1] || "")).replace(/^./, c => c.toUpperCase()),       // First+second
      w.length > 1 ? (w[0][0] + w[1][0]).toUpperCase() : null,           // initials
      nm.slice(0, 2).toUpperCase(),
    ].filter(Boolean);
    let code = cands.find(c => !used.has(c));
    if (!code){ let i = 2; do { code = nm[0].toUpperCase() + i++; } while (used.has(code)); }
    used.add(code); codes[nm] = code;
  }
  return codes;
}

async function boot(){
  DB = await loadData();
  // Group rooms by their `area` field, ordered by the areas list (towns first).
  const order = (DB.areas || []).map(a => a.name);
  const groups = {};
  for (const id in DB.rooms){ const a = DB.rooms[id].area || "Unknown"; (groups[a] ||= []).push(+id); }
  DB.areas = [...new Set([...order, ...Object.keys(groups)])]
    .filter(n => groups[n] && groups[n].length)
    .map(name => ({ name, rooms: groups[name] }));
  renderNav();
  renderLegend();
  if (DB.areas.length){
    const fromHash = decodeURIComponent(location.hash.slice(1));
    selectArea(DB.areas.some(a => a.name === fromHash) ? fromHash : DB.areas[0].name);
  }
  window.addEventListener("hashchange", () => {
    const n = decodeURIComponent(location.hash.slice(1));
    if (DB.areas.some(a => a.name === n)) selectArea(n);
  });
}

async function loadData(){
  for (const f of ["ta-rooms.json","sample-rooms.json"]){
    try { const r = await fetch(f); if (r.ok) return await r.json(); } catch(e){}
  }
  document.getElementById("map").textContent = "Could not load ta-rooms.json.";
  return { rooms:{}, areas:[] };
}

function renderNav(){
  const nav = document.getElementById("areas");
  nav.innerHTML = "";
  for (const a of DB.areas){
    const b = document.createElement("button");
    b.textContent = `${a.name} (${a.rooms.length})`;
    b.dataset.area = a.name;
    b.onclick = () => selectArea(a.name);
    nav.appendChild(b);
  }
}

function renderLegend(){
  const seen = ["plaza","shop","temple","guild","arena","monsters","door","room"];
  document.getElementById("legend").innerHTML = seen.map(l => {
    const t = TYPE.find(([,v]) => v.l === l)[1];
    return `<span class="${t.c}">${t.g} ${l}</span>`;
  }).join("") + `<span style="color:var(--amber)">↕ stairs</span>`;
}

function selectArea(name){
  CUR = name;
  if (decodeURIComponent(location.hash.slice(1)) !== name) location.hash = encodeURIComponent(name);
  document.querySelectorAll("#areas button").forEach(b =>
    b.classList.toggle("active", b.dataset.area === name));
  const area = DB.areas.find(a => a.name === name);
  if (area) layoutAndRender(area.rooms);
}

/* ---- grid layout: BFS from a seed, place neighbours by direction ---- */
function layout(ids){
  const set = new Set(ids.map(Number));
  const pos = new Map();                 // id -> [col,row]
  const taken = new Map();               // "c,r" -> id
  const place = (id,c,r) => { pos.set(id,[c,r]); taken.set(c+","+r,id); };
  const seed = ids.find(id => /plaza|square|entrance/i.test((DB.rooms[id]||{}).name||"")) ?? ids[0];
  place(Number(seed),0,0);
  const q = [Number(seed)];
  while (q.length){
    const id = q.shift(); const [c,r] = pos.get(id);
    const ex = (DB.rooms[id]||{}).exits || {};
    for (const d in DIR){
      const nb = Number(ex[d]); if (!nb || !set.has(nb) || pos.has(nb)) continue;
      const [dc,dr] = DIR[d], nc=c+dc, nr=r+dr;
      if (taken.has(nc+","+nr)) continue;      // cell conflict -> place later
      place(nb,nc,nr); q.push(nb);
    }
  }
  // drop any unplaced rooms into the first free cells so nothing is lost
  let scan = 1;
  for (const id of ids.map(Number)) if (!pos.has(id)){
    while (taken.has(scan+","+0)) scan++;
    place(id, scan++, -3);
  }
  return pos;
}

function layoutAndRender(ids){
  const map = document.getElementById("map");
  map.innerHTML = "";
  const pos = layout(ids);
  let minC=Infinity,minR=Infinity,maxC=-Infinity,maxR=-Infinity;
  for (const [,[c,r]] of pos){ minC=Math.min(minC,c);minR=Math.min(minR,r);maxC=Math.max(maxC,c);maxR=Math.max(maxR,r); }
  // 2x grid so corridors get their own mid-cells
  map.style.gridTemplateColumns = `repeat(${(maxC-minC)*2+1}, var(--cell))`;
  const gx = c => (c-minC)*2+1, gy = r => (r-minR)*2+1;

  // corridors first (under rooms)
  const drawn = new Set();
  for (const [id,[c,r]] of pos){
    const ex = (DB.rooms[id]||{}).exits || {};
    for (const d in DIR){
      const nb = Number(ex[d]); if (!nb || !pos.has(nb)) continue;
      const [dc,dr]=DIR[d];
      const key = [Math.min(id,nb),Math.max(id,nb),d].join();
      if (drawn.has(key)) continue; drawn.add(key);
      const mx = gx(c)+dc, my = gy(r)+dr;        // mid-cell between the two rooms
      const cell = document.createElement("div");
      cell.className = "link";
      cell.style.gridColumn = mx; cell.style.gridRow = my;
      cell.textContent = CORR[dc+","+dr] || "+";
      map.appendChild(cell);
    }
  }
  // monster codes for this zone + corner legend
  const codes = monsterCodes(ids);
  renderMonLegend(codes);

  // rooms on top
  for (const [id,[c,r]] of pos){
    const room = DB.rooms[id];
    let glyph, cls;
    if (room.shop){ glyph = "$"; cls = "t-shop"; }
    else if (room.monsters && room.monsters.length && codes[room.monsters[0]]){
      glyph = codes[room.monsters[0]]; cls = "t-monster";
    } else { const t = typeOf(room); glyph = t.g; cls = t.c; }
    const cell = document.createElement("div");
    cell.className = "room " + cls + (glyph.length > 1 ? " code2" : "");
    cell.dataset.id = id;
    cell.style.gridColumn = gx(c); cell.style.gridRow = gy(r);
    const ex0 = room.exits || {};
    const sd = (ex0.up && ex0.down) ? "↕" : ex0.up ? "↑" : ex0.down ? "↓" : "";
    const badge = sd ? `<i class="stair">${sd}</i>` : "";
    cell.innerHTML = `${esc(glyph)}${badge}<span class="num">#${id} ${esc(clean(room.name))}${sd}</span>`;
    cell.onmouseenter = () => showDetail(id);
    cell.onclick = () => { document.querySelectorAll(".room.sel").forEach(e=>e.classList.remove("sel")); cell.classList.add("sel"); showDetail(id); };
    map.appendChild(cell);
  }
}

function renderMonLegend(codes){
  const box = document.getElementById("mlegend");
  const entries = Object.entries(codes).sort((a,b) => a[1].localeCompare(b[1]));
  if (!entries.length){ box.style.display = "none"; box.innerHTML = ""; return; }
  box.style.display = "block";
  box.innerHTML = "<b>monsters here</b><br>" + entries
    .map(([nm, code]) => `<span class="t-monster">${code}</span> ${esc(nm)}`).join("<br>");
}

// navigate to a room, switching zones if needed (used by clickable exits)
function gotoRoom(id){
  const r = DB.rooms[id]; if (!r) return;
  if (r.area !== CUR) selectArea(r.area);
  requestAnimationFrame(() => {
    const cell = document.querySelector(`.room[data-id="${id}"]`);
    if (cell){
      document.querySelectorAll(".room.sel").forEach(e => e.classList.remove("sel"));
      cell.classList.add("sel");
      cell.scrollIntoView({ block:"center", inline:"center" });
    }
    showDetail(id);
  });
}

function showDetail(id){
  const r = DB.rooms[id]; if (!r) return;
  const ex = r.exits||{};
  const exits = Object.keys(DIR).concat(["up","down"]).filter(d=>ex[d])
    .map(d => {
      const t = ex[d], tr = DB.rooms[t] || {};
      const xz = tr.area && tr.area !== r.area ? ` <span class="xz">→ ${esc(tr.area)}</span>` : "";
      return `<a href="#" class="exlink" onclick="gotoRoom(${t});return false;">${d.toUpperCase()}→#${t} ${esc(clean(tr.name) || "?")}</a>${xz}`;
    }).join("<br>") || "—";
  document.getElementById("detail").innerHTML = `
    <h2><span class="rid">#${id}</span> ${esc(clean(r.name))}</h2>
    <dl>
      <dt>area</dt><dd>${esc(r.area||"—")}</dd>
      ${r.shop?`<dt>shop</dt><dd class="t-shop">${esc(r.shop)} shop</dd>`:""}
      ${r.monsters&&r.monsters.length?`<dt>monsters</dt><dd class="t-monster">${r.monsters.map(esc).join(", ")}</dd>`:""}
      ${r.doors&&r.doors.length?`<dt>doors</dt><dd>${r.doors.map(esc).join(", ")}</dd>`:""}
      <dt>exits</dt><dd>${exits}</dd>
    </dl>
    ${r.desc?`<div class="desc">${esc(r.desc)}</div>`:""}`;
}

const esc = s => String(s).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
// "You're in the north plaza." -> "north plaza"
const clean = n => String(n||"")
  .replace(/^you(?:'re| are)\s+(?:in|standing|inside|at|on|near|by)\s+(?:the\s+|a\s+|an\s+)?/i,"")
  .replace(/[.!]\s*$/,"").trim() || String(n||"");
boot();
