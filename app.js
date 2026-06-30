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

let ANN = {};                         // room-id -> {doors,traps,teleports,runes,keydrops}
async function loadAnn(){
  try { const r = await fetch("ta-annotations.json"); if (r.ok) return await r.json(); } catch(e){}
  return {};
}
// is there a door between rooms a and b? returns the door record or null
function doorBetween(a, b){
  for (const [x, y] of [[a, b], [b, a]]){
    const da = (ANN[x] || {}).doors;
    if (da) for (const dr of da) if (dr.to === y) return dr;
  }
  return null;
}
const stripSrc = s => String(s).replace(/\s*\[[^\]]*\]\s*$/, "").trim();

let RUNES = { rune:{}, order:[] };    // zone -> rune tier, plus grouped order
async function loadRunes(){
  try { const r = await fetch("zone-runes.json"); if (r.ok) return await r.json(); } catch(e){}
  return { rune:{}, order:[] };
}
let PASS = {};                        // room-id -> paid-passage transport (ship/buy passage)
async function loadPass(){
  try { const r = await fetch("passages.json"); if (r.ok) return await r.json(); } catch(e){}
  return {};
}

/* ---- cross-zone navigation: find every transition that leaves the zone ---- */
const ARROW = {n:"↑",s:"↓",e:"→",w:"←",ne:"↗",nw:"↖",se:"↘",sw:"↙",up:"↑",down:"↓"};
function crossZoneLinks(ids){
  const out = [], seen = new Set();
  const push = (fromId, toId, dir, kind, extra) => {
    const tr = DB.rooms[toId];
    if (!tr || !tr.area || tr.area === CUR) return;        // same zone -> not a portal
    const k = fromId + ">" + toId;
    if (seen.has(k)) return; seen.add(k);
    out.push({ fromId: Number(fromId), toId: Number(toId), dir, kind, zone: tr.area, ...(extra || {}) });
  };
  for (const id of ids){
    const room = DB.rooms[id]; if (!room) continue;
    const p = PASS[id];                                    // paid passage (incl. exit-less docks ship)
    if (p) push(id, p.to, null, "passage", { method: p.method, cost: p.cost });
    const ex = room.exits || {};
    for (const d of [...Object.keys(DIR), "up", "down"]) if (ex[d]){
      if (p && p.to === ex[d]) continue;                   // this exit IS the passage (don't label as stair)
      push(id, ex[d], d, "exit");
    }
    const an = ANN[id] || {};
    for (const dr of (an.doors || [])) push(id, dr.to, dr.dir, "door");
    for (const t of (an.teleports || [])){
      if (t.to) push(id, t.to, null, "tele", { trigger: t.trigger });
      else if (t.fail_to) push(id, t.fail_to, null, "tele", { trigger: (t.trigger || "go") + " fail" });
    }
  }
  return out;
}
function portalArrow(l){
  if (l.kind === "passage") return "⛴";
  if (l.kind === "tele") return "✦";
  if (l.dir === "up") return "↑";
  if (l.dir === "down") return "↓";
  return ARROW[l.dir] || "→";
}
// bias chips to the right (horizontal exits) or below (vertical/teleport) so they
// never clip past the map's top/left origin; the arrow in the label shows true direction
const sideOf = d => ["e","ne","se","w","nw","sw"].includes(d) ? "e" : "s";
function linkLabel(l){
  if (l.kind === "passage") return `⛴ buy passage to ${l.zone}${l.cost ? ` · ${l.cost}` : ""}`;
  if (l.kind === "tele") return `✦ ${l.trigger || "teleport"} → ${l.zone}`;
  if (l.dir === "up")   return `↑ up to ${l.zone}`;
  if (l.dir === "down") return `↓ down to ${l.zone}`;
  return `${ARROW[l.dir] || "→"} ${l.zone}${l.kind === "door" ? " (door)" : ""}`;
}
const abbr = z => String(z).replace(/\bLevel (\d)/g, "L$1");
function chipLabel(l){
  if (l.kind === "tele") return `✦ ${l.trigger || "go"}→${abbr(l.zone)}`;
  const ar = l.dir === "up" ? "↑" : l.dir === "down" ? "↓" : (ARROW[l.dir] || "→");
  return `${ar} ${abbr(l.zone)}`;
}
function hiList(ids, on){
  for (const id of ids){
    const c = document.querySelector(`.room[data-id="${id}"]`);
    if (c) c.classList.toggle("portal-hi", !!on);
  }
}
function renderPortals(links){
  let box = document.getElementById("portals");
  if (!box){ box = document.createElement("div"); box.id = "portals";
    document.getElementById("map-wrap").appendChild(box); }
  if (!links.length){ box.style.display = "none"; box.innerHTML = ""; return; }
  box.style.display = "block";
  // group identical transitions (e.g. 13 springboards -> Stone Passages L1) with a count
  const groups = new Map();
  for (const l of links){
    const lab = linkLabel(l);
    if (!groups.has(lab)) groups.set(lab, { label: lab, zone: l.zone, toId: l.toId, from: [l.fromId] });
    else groups.get(lab).from.push(l.fromId);
  }
  const items = [...groups.values()].sort((a,b) => a.zone.localeCompare(b.zone));
  box.innerHTML = `<b>↗ exits to other areas</b>` + items.map(g => {
    const tail = g.from.length === 1
      ? `<span class="pfrom"> · from ${esc(clean((DB.rooms[g.from[0]]||{}).name))}</span>`
      : ` <span class="pcount">×${g.from.length}</span>`;
    return `<a href="#" class="portal-link" onclick="gotoRoom(${g.toId});return false;" ` +
      `onmouseenter="hiList([${g.from}],1)" onmouseleave="hiList([${g.from}],0)">` +
      `${esc(g.label)}${tail}</a>`;
  }).join("");
}

async function boot(){
  DB = await loadData();
  ANN = await loadAnn();
  RUNES = await loadRunes();
  PASS = await loadPass();
  // Group rooms by their `area` field.
  const order = (DB.areas || []).map(a => a.name);
  const groups = {};
  for (const id in DB.rooms){ const a = DB.rooms[id].area || "Unknown"; (groups[a] ||= []).push(+id); }
  DB.areas = [...new Set([...order, ...Object.keys(groups)])]
    .filter(n => groups[n] && groups[n].length)
    .map(name => ({ name, rooms: groups[name] }));
  // Order the nav by rune progression (non-rune → White → … → Violet).
  const oidx = new Map((RUNES.order || []).map((n, i) => [n, i]));
  DB.areas.sort((a, b) => (oidx.has(a.name) ? oidx.get(a.name) : 999) - (oidx.has(b.name) ? oidx.get(b.name) : 999));
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
  const rq = new URLSearchParams(location.search).get("room");
  if (rq && DB.rooms[rq]) requestAnimationFrame(() => gotoRoom(Number(rq)));
}

async function loadData(){
  for (const f of ["ta-rooms.json","sample-rooms.json"]){
    try { const r = await fetch(f); if (r.ok) return await r.json(); } catch(e){}
  }
  document.getElementById("map").textContent = "Could not load ta-rooms.json.";
  return { rooms:{}, areas:[] };
}

const RUNE_LABEL = { none:"○ No rune needed", white:"◆ White Rune", yellow:"◆ Yellow Rune",
                     green:"◆ Green Rune", blue:"◆ Blue Rune", violet:"◆ Violet Rune" };
function renderNav(){
  const nav = document.getElementById("areas");
  nav.innerHTML = "";
  const tierOf = n => (RUNES.rune || {})[n] || "none";
  let cur = null;
  for (const a of DB.areas){
    const tier = tierOf(a.name);
    if (tier !== cur){
      cur = tier;
      const div = document.createElement("div");
      div.className = "rune-divider rune-" + tier;
      div.textContent = RUNE_LABEL[tier] || tier;
      nav.appendChild(div);
    }
    const b = document.createElement("button");
    b.className = "rune-" + tier;
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
  }).join("")
    + `<span style="color:var(--c-brown)">╪ door</span>`
    + `<span class="trap">! trap</span>`
    + `<span class="tele">✦ teleport</span>`
    + `<span class="rune">◆ rune</span>`
    + `<span style="color:var(--c-lgreen)">⌐ → other area (click)</span>`;
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

/* ---- ASCII-art map renderer: rooms as [XX] boxes, line corridors, margin labels ---- */
const CARD8 = ["n","s","e","w","ne","nw","se","sw"];
// diagonal connector glyph + the two gap-cell offsets [dcol,drow] from the box origin
const DIAG = { ne:["/",[4,-1],[5,-2]], nw:["\\",[-1,-1],[-2,-2]],
               se:["\\",[4,1],[5,2]],  sw:["/",[-1,1],[-2,2]] };

function boxCode(id, room, codes, seedId){
  if (id === seedId) return "*";
  if (room.shop) return "$";
  if (room.monsters && room.monsters.length && codes[room.monsters[0]]) return codes[room.monsters[0]];
  const g = typeOf(room).g;
  return (g === "·" || g === "+") ? " " : g;          // plain rooms render as blank [ ]
}
function boxCls(id, room, codes, seedId){
  if (id === seedId) return "t-seed";
  if (room.shop) return "t-shop";
  if (room.monsters && room.monsters.length) return "t-monster";
  return typeOf(room).c || "";
}
function portalText(l){
  if (l.kind === "passage") return "Passage to " + abbr(l.zone);
  if (l.kind === "tele")    return (l.trigger ? l.trigger + " " : "") + "→" + abbr(l.zone);
  if (l.dir === "up")   return "up to " + abbr(l.zone);
  if (l.dir === "down") return "down to " + abbr(l.zone);
  return abbr(l.zone);                                 // cardinal: the line shows the direction
}
function boxClick(id){
  document.querySelectorAll(".box.sel").forEach(e => e.classList.remove("sel"));
  const el = document.querySelector(`.box[data-id="${id}"]`);
  if (el) el.classList.add("sel");
  showDetail(id);
}

function layoutAndRender(ids){
  const map = document.getElementById("map");
  const pos = layout(ids);
  const codes = monsterCodes(ids);
  renderMonLegend(codes);
  const seedId = ids.find(id => /plaza|square|entrance/i.test((DB.rooms[id]||{}).name||"")) ?? Number(ids[0]);

  let minC=Infinity,minR=Infinity,maxC=-Infinity,maxR=-Infinity;
  for (const [,[c,r]] of pos){ if(c<minC)minC=c; if(c>maxC)maxC=c; if(r<minR)minR=r; if(r>maxR)maxR=r; }

  // char buffer: box [XX] = 4 wide, h-stride 6, v-stride 3; margins hold the off-zone labels
  const LM=34, TM=4, RM=34, BM=4;
  const bx = c => (c-minC)*6 + LM;
  const by = r => (r-minR)*3 + TM;
  const W = (maxC-minC)*6 + 4 + LM + RM;
  const H = (maxR-minR)*3 + 1 + TM + BM;
  const buf = Array.from({length:H}, () => new Array(W).fill(" "));
  const reg = Array.from({length:H}, () => new Array(W).fill(null));
  const put = (row,col,ch,region) => {
    if (row<0||row>=H||col<0||col>=W) return;
    buf[row][col]=ch; if (region!==undefined) reg[row][col]=region;
  };
  const putStr = (row,col,str,region) => { for (let i=0;i<str.length;i++) put(row,col+i,str[i],region); };
  const rowFree = (row,col,len) => {
    if (row<0||row>=H) return false;
    for (let i=-1;i<=len;i++){ const cc=col+i; if (cc>=0&&cc<W&&buf[row][cc]!==" ") return false; }
    return true;
  };
  const freeRow = (row,col,len) => {            // nudge a margin label to a clear row
    for (const dy of [0,1,-1,2,-2,3,-3]) if (rowFree(row+dy,col,len)) return row+dy;
    return row;
  };

  // ---- intra-zone corridors (one per edge) ----
  const drawn = new Set();
  for (const [id,[c,r]] of pos){
    const ex = (DB.rooms[id]||{}).exits || {};
    const X=bx(c), Y=by(r);
    for (const d in DIR){
      const nb = Number(ex[d]); if (!nb || !pos.has(nb)) continue;
      const ek = Math.min(id,nb)+"_"+Math.max(id,nb);
      if (drawn.has(ek)) continue; drawn.add(ek);
      if (d==="e"){ put(Y,X+4,"-"); put(Y,X+5,"-"); }
      else if (d==="w"){ put(Y,X-1,"-"); put(Y,X-2,"-"); }
      else if (d==="s"){ put(Y+1,X+1,"|"); put(Y+2,X+1,"|"); }
      else if (d==="n"){ put(Y-1,X+1,"|"); put(Y-2,X+1,"|"); }
      else if (DIAG[d]){ const [ch,a,b]=DIAG[d]; put(Y+a[1],X+a[0],ch); put(Y+b[1],X+b[0],ch); }
    }
  }

  // ---- room boxes ----
  for (const [id,[c,r]] of pos){
    const room = DB.rooms[id]; const ex = room.exits||{};
    const code = boxCode(id, room, codes, seedId);
    const elev = (ex.up&&ex.down)?"↕":ex.up?"^":ex.down?"v":"";
    const content = code.length>=2 ? code.slice(0,2) : code + (elev || " ");
    putStr(by(r), bx(c), "["+content+"]", { kind:"room", id, cls:boxCls(id,room,codes,seedId) });
  }

  // ---- exits to other zones: a connector + the destination NAME as a margin label ----
  const links = crossZoneLinks(ids);
  const seen = new Set();
  for (const l of links){
    const sp = pos.get(l.fromId); if (!sp) continue;
    const [c,r]=sp, X=bx(c), Y=by(r);
    const dc = CARD8.includes(l.dir) ? l.dir : "elev";
    const k = l.fromId+":"+dc+":"+l.zone;
    if (seen.has(k)) continue; seen.add(k);
    const text = portalText(l);
    const region = { kind:"portal", toId:l.toId, title:linkLabel(l)+` (room #${l.toId})` };
    if (dc==="e"||dc==="elev"){ if(dc==="e") put(Y,X+4,"-"); putStr(freeRow(Y,X+5,text.length), X+5, text, region); }
    else if (dc==="w"){ put(Y,X-1,"-"); const lc=X-3-text.length; putStr(freeRow(Y,lc,text.length), lc, text, region); }
    else if (dc==="n"){ put(Y-1,X+1,"|"); put(Y-2,X+1,"|"); putStr(Y-3, X+1-(text.length>>1), text, region); }
    else if (dc==="s"){ put(Y+1,X+1,"|"); put(Y+2,X+1,"|"); putStr(Y+3, X+1-(text.length>>1), text, region); }
    else { const [ch,a,b]=DIAG[dc]; put(Y+a[1],X+a[0],ch); put(Y+b[1],X+b[0],ch);
      const lr = Y+b[1], lc = X+b[0];
      if (dc==="ne"||dc==="se") putStr(lr, lc+2, text, region);
      else putStr(lr, lc-2-text.length, text, region);
    }
  }

  // ---- render buffer to clickable HTML, trimming unused margins ----
  let minCol=W, maxCol=0;
  for (let row=0; row<H; row++){
    for (let col=0; col<W; col++) if (buf[row][col]!==" "){ if(col<minCol)minCol=col; if(col>maxCol)maxCol=col; }
  }
  if (minCol>maxCol){ map.innerHTML=""; padForPanels(); return; }
  let html="";
  for (let row=0; row<H; row++){
    let col=minCol;
    while (col<=maxCol){
      const region = reg[row][col];
      let end=col; while (end<=maxCol && reg[row][end]===region) end++;
      const text = buf[row].slice(col,end).join("");
      if (region===null) html += esc(text);
      else if (region.kind==="room")
        html += `<a class="box ${region.cls}" data-id="${region.id}" href="#" `+
          `onclick="boxClick(${region.id});return false;" onmouseenter="showDetail(${region.id})">${esc(text)}</a>`;
      else html += `<a class="plabel" href="#" title="${esc(region.title)}" `+
          `onclick="gotoRoom(${region.toId});return false;">${esc(text)}</a>`;
      col=end;
    }
    html += "\n";
  }
  map.innerHTML = html;
  padForPanels();
}

// Pad the scrollable map so any room can be scrolled clear of the pinned corner
// panels (monster legend = top-right, exits list = bottom-left): each side gets the
// panel's size + a buffer, so nothing stays permanently hidden under them.
function padForPanels(){
  const map = document.getElementById("map");
  const ml = document.getElementById("mlegend");
  const pt = document.getElementById("portals");
  const vis = el => el && el.style.display !== "none";
  const B = 56, base = 16;                     // panel height + buffer of scroll room
  const top    = vis(ml) ? ml.offsetHeight + B : base;
  const bottom = vis(pt) ? pt.offsetHeight + B : base;
  map.style.padding = `${top}px ${base}px ${bottom}px ${base}px`;
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
    const cell = document.querySelector(`.box[data-id="${id}"]`);
    if (cell){
      document.querySelectorAll(".box.sel").forEach(e => e.classList.remove("sel"));
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
  const a = ANN[id] || {};
  const arow = (label, items) => items && items.length ? `<dt>${label}</dt><dd>${items.join("<br>")}</dd>` : "";
  const doorsH = (a.doors||[]).map(d =>
    `<a href="#" class="exlink" onclick="gotoRoom(${d.to});return false;">${(d.dir||"").toUpperCase()}→#${d.to}</a> ` +
    (d.locked ? `<span class="lock">🔒 ${esc(d.key||"locked")}</span>` : `<span class="open">(open)</span>`));
  const trapsH = (a.traps||[]).map(t => `<span class="trap">⚠ ${esc(t.effect||"trap")}</span> ${esc(stripSrc(t.desc||""))}`);
  const teleH  = (a.teleports||[]).map(t =>
    `<span class="tele">✦ ${esc(t.trigger||"")}</span>` +
    (t.to ? ` → <a href="#" class="exlink" onclick="gotoRoom(${t.to});return false;">#${t.to}</a>` : "") +
    (t.fail_to ? ` <span class="xz">(fail→#${t.fail_to})</span>` : "") + ` ${esc(stripSrc(t.note||""))}`);
  const runesH = (a.runes||[]).map(s => `<span class="rune">◆</span> ${esc(stripSrc(s))}`);
  const keysH  = (a.keydrops||[]).map(s => esc(stripSrc(s)));
  document.getElementById("detail").innerHTML = `
    <h2><span class="rid">#${id}</span> ${esc(clean(r.name))}</h2>
    <dl>
      <dt>area</dt><dd>${esc(r.area||"—")}</dd>
      ${r.shop?`<dt>shop</dt><dd class="t-shop">${esc(r.shop)} shop</dd>`:""}
      ${r.monsters&&r.monsters.length?`<dt>monsters</dt><dd class="t-monster">${r.monsters.map(esc).join(", ")}</dd>`:""}
      <dt>exits</dt><dd>${exits}</dd>
      ${arow("doors", doorsH)}
      ${arow("traps", trapsH)}
      ${arow("teleport", teleH)}
      ${arow("runes", runesH)}
      ${arow("key drops", keysH)}
    </dl>
    ${r.desc?`<div class="desc">${esc(r.desc)}</div>`:""}`;
}

const esc = s => String(s).replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
// "You're in the north plaza." -> "north plaza"
const clean = n => String(n||"")
  .replace(/^you(?:'re| are)\s+(?:in|standing|inside|at|on|near|by)\s+(?:the\s+|a\s+|an\s+)?/i,"")
  .replace(/[.!]\s*$/,"").trim() || String(n||"");
boot();
