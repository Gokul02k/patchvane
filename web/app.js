/* Patchvane -- upstream patch tracker.
   Views and data.  The engine underneath is in ui.js. */

const S = {
  data: null,
  view: "overview",
  busy: false,
  offline: false,
  status: {},
  tabs: {},
  chat: [],
  /* The patch being read in full, if any. */
  thread: null,
  /* Whose chat this is.  A conversation is about one person's patches and
     often quotes their reviewers, so it must not outlive their session. */
  chatWho: "",
  asking: false,
  /* The conversation on screen, as the server knows it.  Empty until the
     first answer, because a conversation with nothing in it is not one. */
  chatId: "",
  chats: [],
  histOpen: false,
};

/* ------------------------------------------------------------- constants */

const STATES = {
  "merged":            { label: "In mainline",        cls: "green",  rank: 0 },
  "in-next":           { label: "In linux-next",      cls: "cyan",   rank: 1 },
  "in-tree":           { label: "In maintainer tree", cls: "cyan",   rank: 2 },
  "accepted":          { label: "Accepted",           cls: "green",  rank: 3 },
  "queued":            { label: "Queued",             cls: "cyan",   rank: 4 },
  "awaiting-upstream": { label: "Awaiting upstream",  cls: "cyan",   rank: 5 },
  "reviewed":          { label: "Reviewed",           cls: "blue",   rank: 6 },
  "under-review":      { label: "In discussion",      cls: "amber",  rank: 7 },
  "needs-ack":         { label: "Needs ack",          cls: "amber",  rank: 8 },
  "awaiting":          { label: "No reply yet",       cls: "grey",   rank: 9 },
  "changes-requested": { label: "Changes requested",  cls: "purple", rank: 10 },
  "superseded":        { label: "Superseded",         cls: "grey",   rank: 11 },
  "not-applicable":    { label: "Not applicable",     cls: "red",    rank: 12 },
  "handled-elsewhere": { label: "Handled elsewhere",  cls: "grey",   rank: 13 },
  "deferred":          { label: "Deferred",           cls: "grey",   rank: 14 },
  "rejected":          { label: "Rejected",           cls: "red",    rank: 15 },
};

const C = {
  green: "#3fb950", blue: "#4c8dff", amber: "#e3a008",
  purple: "#a371f7", red: "#f85149", cyan: "#2dd4bf", grey: "#7d8590",
};

const PALETTE = ["#4c8dff", "#3fb950", "#e3a008", "#a371f7", "#f85149",
                 "#2dd4bf", "#db61a2", "#e3b341", "#7d8590", "#58a6ff"];

const NAV = [
  ["overview",    "Overview",    "\u25F0"],
  ["owed",        "Your turn",   "\u2691"],
  ["patches",     "Patches",     "\u2261"],
  ["outcomes",    "Outcomes",    "\u2713"],
  ["discussions", "Discussions", "\u2709"],
  ["insights",    "Insights",    "\u2197"],
  ["discover",    "Discover",    "\u2315"],
];

/* Terminal states: the patch has stopped moving, one way or another. */
const CLOSED = ["superseded", "rejected", "not-applicable", "handled-elsewhere",
                "deferred"];
const LANDED = ["merged", "in-next", "in-tree", "accepted", "queued",
                "awaiting-upstream"];

/* Where every patch stands.  One bucket each, no patch in two, and between
   them they have to cover all of STATES: the whole point is that the total
   adds back up to the number of patches posted.  A state nobody thought of
   lands in "unaccounted" and shows up on screen rather than quietly
   disappearing from the arithmetic. */
const LEDGER = [
  { key: "mainline", label: "In mainline", cls: "green", color: C.green,
    blurb: "the commit is in Linus' tree",
    states: ["merged"] },
  { key: "onway", label: "Accepted, on the way", cls: "cyan", color: C.cyan,
    blurb: "a maintainer took it; heading for a merge window",
    states: ["in-next", "in-tree", "accepted", "queued", "awaiting-upstream"] },
  { key: "review", label: "Being reviewed", cls: "amber", color: C.amber,
    blurb: "someone is looking at it, or has already tagged it",
    states: ["reviewed", "under-review", "needs-ack"] },
  { key: "respin", label: "Needs a new version", cls: "purple", color: C.purple,
    blurb: "changes were requested, so a v2 is owed",
    states: ["changes-requested"] },
  { key: "quiet", label: "No reply yet", cls: "grey", color: C.grey,
    blurb: "posted, and nobody has said anything",
    states: ["awaiting"] },
  { key: "dropped", label: "Dropped", cls: "red", color: C.red,
    blurb: "superseded, rejected, or picked up somewhere else",
    states: CLOSED },
];

const BUCKET_OF = (() => {
  const m = {};
  LEDGER.forEach((b) => b.states.forEach((s) => { m[s] = b.key; }));
  return m;
})();

function bucketOf(patch) { return BUCKET_OF[patch.state] || "unaccounted"; }

/* The ledger for a set of patches, plus whatever failed to classify. */
function ledger(patches) {
  const count = {};
  LEDGER.forEach((b) => { count[b.key] = 0; });
  let loose = [];
  patches.forEach((p) => {
    const k = bucketOf(p);
    if (k === "unaccounted") loose.push(p);
    else count[k]++;
  });
  const rows = LEDGER.map((b) => Object.assign({}, b, { value: count[b.key] }));
  if (loose.length) {
    rows.push({ key: "unaccounted", label: "Unaccounted", cls: "red",
      color: C.red, value: loose.length,
      blurb: "states this dashboard does not know about: "
             + [...new Set(loose.map((p) => p.state))].join(", ") });
  }
  return rows;
}

const SUGGESTIONS = [
  "What needs my attention today?",
  "Which series are stuck and why?",
  "Summarise the review feedback I have received.",
  "Which trees have accepted the most of my work?",
  "What should I do next to get more patches into mainline?",
];

/* --------------------------------------------------------------- domain */

function state(name) {
  return STATES[name] || { label: name || "unknown", cls: "grey", rank: 20 };
}

function pill(name) {
  const s = state(name);
  return `<span class="pill ${s.cls}">${esc(s.label)}</span>`;
}

/* Subsystem is the first component of the subject prefix, which is what the
   kernel uses: "net: cortina: fix ..." belongs to net. */
function subsystem(subject) {
  const m = /^([^:]{1,40}):/.exec(subject || "");
  if (!m) return "other";
  let p = m[1].trim();
  if (p.includes(" ")) p = p.split(" ")[0];
  return p.split("/")[0].toLowerCase() || "other";
}

function treeOf(r) { return r.tree_hint || r.list || "unspecified"; }

function link(url, label) {
  if (!url) return `<span class="muted">\u2014</span>`;
  return `<a href="${esc(url)}" target="_blank" rel="noreferrer">${label || "lore \u2197"}</a>`;
}

/* ------------------------------------------------------- grid definitions */

/* Filters on the ledger bucket as well as the exact state, so "Dropped" and
   "Rejected" are both reachable and mean different things. */
/* Read out of the thread by a model rather than taken from a commit or a
   patchwork state.  Worth saying so: it is a good guess, not a fact. */
function byAI(r) {
  return r.state_by_ai
    ? ` <span class="readmark" title="A model read this status out of the replies. It is a reading, not a record.">read</span>`
    : "";
}

function stateFilter() {
  return {
    key: "state", all: "Any status",
    values: (rows) => {
      const buckets = {}, exact = {};
      rows.forEach((r) => {
        buckets[bucketOf(r)] = (buckets[bucketOf(r)] || 0) + 1;
        exact[r.state] = (exact[r.state] || 0) + 1;
      });
      return LEDGER.filter((b) => buckets[b.key])
        .map((b) => ({ value: "~" + b.key,
                       label: `${b.label} (${buckets[b.key]})` }))
        .concat(Object.keys(exact)
          .sort((a, b) => state(a).rank - state(b).rank)
          .map((k) => ({ value: k, label: `\u00a0\u00a0${state(k).label} (${exact[k]})` })));
    },
    match: (r, v) => (v.charAt(0) === "~" ? bucketOf(r) === v.slice(1)
                                          : r.state === v),
  };
}

function treeFilter() {
  return {
    key: "tree", all: "Any tree",
    values: (rows) => {
      const c = {};
      rows.forEach((r) => { c[treeOf(r)] = (c[treeOf(r)] || 0) + 1; });
      return Object.keys(c).sort().map((k) => ({ value: k, label: `${k} (${c[k]})` }));
    },
    match: (r, v) => treeOf(r) === v,
  };
}

function subsystemFilter() {
  return {
    key: "sub", all: "Any subsystem",
    values: (rows) => {
      const c = {};
      rows.forEach((r) => { const s = subsystem(r.subject); c[s] = (c[s] || 0) + 1; });
      return Object.entries(c).sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ value: k, label: `${k}/ (${v})` }));
    },
    match: (r, v) => subsystem(r.subject) === v,
  };
}

const PATCH_FIELDS = {
  tree: (r) => treeOf(r),
  state: (r) => r.state,
  status: (r) => state(r.state).label,
  sub: (r) => subsystem(r.subject),
  subsystem: (r) => subsystem(r.subject),
  v: (r) => r.version,
  version: (r) => r.version,
  replies: (r) => r.reply_count,
  date: (r) => (r.date || "").slice(0, 10),
  series: (r) => r.series_name,
};

function patchColumns() {
  return [
    { key: "subject", label: "Patch", cls: "subject", width: "44%",
      csv: (r) => r.subject,
      render: (r) => `${subj(r.msgid || r.series, r.subject)}
        ${r.version > 1 ? `<span class="tag">v${r.version}</span>` : ""}
        <div class="sub2">${mark(r.state_detail)}${byAI(r)}</div>` },
    { key: "tree", label: "Tree", sort: treeOf,
      render: (r) => `<span class="nowrap muted">${mark(treeOf(r))}</span>` },
    { key: "state", label: "Status", sort: (r) => state(r.state).rank,
      csv: (r) => state(r.state).label, render: (r) => pill(r.state) },
    { key: "date", label: "Posted", csv: (r) => (r.date || "").slice(0, 10),
      render: (r) => `<span class="nowrap muted">${ago(r.date)}</span>` },
    { key: "reply_count", label: "Replies", cls: "num",
      render: (r) => r.reply_count || `<span class="muted">0</span>` },
    { key: "links", label: "Links", sortable: false, cls: "nowrap links",
      csv: (r) => r.lore,
      render: (r) => [
        link(r.lore, "lore"),
        r.pw_url ? `<a href="${esc(r.pw_url)}" target="_blank" rel="noreferrer">pw</a>` : "",
        r.landed[0] ? `<a href="${esc(r.landed[0].url)}" target="_blank"
          rel="noreferrer" class="mono">${esc(r.landed[0].short)}</a>` : "",
      ].filter(Boolean).join(" ") },
  ];
}

function patchGridOpts(extra) {
  return Object.assign({
    placeholder: "Search, or try tree:net-next state:awaiting v>1\u2026",
    searchIn: (r) => [r.subject, r.tree_hint, r.list, r.state, r.series_name,
                      r.pw_project, r.state_detail].join(" "),
    fields: PATCH_FIELDS,
    filters: [stateFilter(), subsystemFilter(), treeFilter()],
    groups: [{ key: "tree", label: "by tree", of: treeOf },
             { key: "state", label: "by status", of: (r) => state(r.state).label },
             { key: "sub", label: "by subsystem", of: (r) => subsystem(r.subject) + "/" }],
    rowKey: (r) => r.msgid || r.lore || r.subject,
    sort: "date", dir: "desc", per: 25,
  }, extra || {});
}

function funnelStages() {
  const d = S.data, k = d.kpis;
  const engaged = d.patches.filter((p) => p.reply_count > 0
    || !["awaiting", "superseded"].includes(p.state)).length;
  return [
    { label: "Posted", value: k.patches, color: C.blue,
      hint: "Every patch mail sent to a kernel list." },
    { label: "Got a response", value: engaged, color: C.amber,
      hint: "Someone replied, or patchwork moved it off the default state." },
    { label: "Accepted", value: k.merged + k.in_next + k.in_tree + k.accepted,
      color: C.purple,
      hint: "A maintainer applied it, or patchwork says accepted." },
    { label: "In linux-next", value: k.merged + k.in_next, color: C.cyan,
      hint: "Reached linux-next, so it is lined up for a merge window." },
    { label: "In mainline", value: k.merged, color: C.green,
      hint: "The commit is in Linus' tree." },
  ];
}

/* ----------------------------------------------------------------- views */

function viewOverview() {
  const d = S.data, k = d.kpis;
  const attention = d.threads.filter((t) => t.waiting_on_us);
  const owed = owedWork();
  const book = ledger(d.patches);

  const cards = [
    ["blue", "Patches posted", k.patches, `across ${plural(k.series, "series", "series")}`,
     "\u2191", () => go("patches"), ""],
    ["green", "In mainline", k.merged, `${pct(k.merged, k.patches)} of everything posted`,
     "\u2713", () => go("outcomes"), ""],
    ["amber", "Waiting on a reply from you", owed.replies.threads.length,
     `${plural(owed.replies.patches.length, "patch", "patches")} in those threads`,
     "\u2709", () => go("owed"), owed.replies.threads.length ? "urgent" : ""],
    ["purple", "Needs a new version", owed.respin.series.length,
     `${plural(owed.respin.patches.length, "patch", "patches")} to respin`,
     "\u27F3", () => go("owed"), owed.respin.patches.length ? "urgent" : ""],
  ].map(([cls, label, value, sub, icon, onclick, extra], i) => `
    <div class="kpi ${cls} ${extra}" data-reveal style="--i:${i}"
         tabindex="0" ${act(onclick)}>
      <div class="badge">${icon}</div>
      <div class="label">${esc(label)}</div>
      ${counter(value, "kpi-" + label)}
      <div class="sub">${esc(sub)}</div>
    </div>`).join("");

  const fn = chartSlot("fn", 190, (w, h) => funnel(funnelStages(), w, h));

  const tl = d.timeline.slice(-45);
  const chart = chartSlot("ov-time", 168, (w, h) => lineChart(
    tl.map((t) => t.date.slice(5)), [
      { name: "Posted", color: C.blue, points: tl.map((t) => t.sent), fill: true },
      { name: "Landed", color: C.green, points: tl.map((t) => t.merged) },
    ], w, h));

  const attentionList = attention.slice(0, 5).map((t, i) => `
    <div class="attn" data-reveal style="--i:${i}">
      <div class="who">${esc(t.last_from)}<span class="when">${ago(t.last_date)}</span></div>
      ${subj(t.id, t.series, "sj")}
      <p>${esc(t.excerpt)}</p>
    </div>`).join("") || `<div class="empty"><div class="emptyicon">\u2713</div>
      <p>Your inbox is clear. Nothing on the list needs an answer.</p></div>`;

  const feed = d.activity.slice(0, 7).map(feedItem).join("");

  /* A step that fails is recorded and the run carries on, so a collection
     that could not read a single message still writes a file and still
     arrives here as a confident zero. Say which part failed and why,
     rather than letting the page report that you have posted nothing. */
  const SOURCE = {
    lore: ["Reading the mailing lists", "lore.kernel.org"],
    patchwork: ["Checking patchwork", "patchwork.kernel.org"],
    korg: ["Looking through the trees", "git.kernel.org"],
  };
  /* What to say about each kind of failure.  Never the exception text: it
     names libraries and files that mean nothing to somebody who opened a
     dashboard, and reads like something broke in the page rather than
     something being in the way of it. The exact reason is in the server's
     own log, where whoever runs it can act on it. */
  const TROUBLE = {
    untrusted: "Something on this network is inspecting secure connections, "
      + "and this computer has not been set up to trust it, so the archives "
      + "cannot be read. On a company network the IT team will know what to "
      + "install; on your own, connecting another way will avoid it.",
    tls: "The secure connection to the archives could not be established.",
    dns: "The archives could not be looked up, which usually means this "
      + "computer has no working network connection.",
    timeout: "The archives did not answer in time. They may be busy, or "
      + "this connection may be very slow.",
    refused: "The connection to the archives was closed before anything "
      + "could be read.",
    blocked: "This network turned the request away before it reached the "
      + "archives.",
    offline: "This computer could not reach the archives.",
  };
  const src = d.sources || {};
  const broke = Object.keys(SOURCE).filter(
    (n) => src[n] && src[n].ok === false && src[n].error !== "skipped");
  const missed = (src.cache || {}).errors || 0;
  /* A collection from before the codes existed has none, so fall back to
     saying only what is certainly true. */
  const why = TROUBLE[(broke.length && src[broke[0]].code) || ""]
    || "The archives could not be read from this computer.";

  const shortfall = !broke.length && !missed ? "" : `
  <div class="panel warn" data-reveal><div class="body">
    ${broke.length ? `<strong>${broke.map((n) => SOURCE[n][0]).join(", ")}
      did not work last time.</strong> ${why}`
      : `<strong>${plural(missed, "request")} to the archives did not come
         back.</strong>`}
    ${k.patches
      ? " Some of what is below may be missing or out of date."
      : " That is why there is nothing below: this is what could be read, "
        + "not an answer about your patches."}
    <span class="muted"> Once the connection works, refresh to collect
    again.</span>
  </div></div>`;

  return `
  ${shortfall}
  <div class="kpis">${cards}</div>

  <div class="panel wide" data-reveal>
    <header><h2>The road to mainline</h2>
      <span class="sub">how far each patch got, stage by stage</span>
      <div class="spacer"></div>
      <button class="link" ${act(go, "patches")}>See every patch</button></header>
    <div class="body flush">${fn}</div>
  </div>

  ${stalePanel()}
  ${ledgerPanel(book, k.patches)}

  <div class="split">
    <div class="stack">
      <div class="panel" data-reveal>
        <header><h2>Needs a reply from you</h2>
          <div class="spacer"></div>
          ${attention.length ? `<span class="pill amber">${attention.length}</span>` : ""}
          <button class="link" ${act(go, "discussions")}>All threads</button></header>
        <div class="body flush attnlist">${attentionList}</div>
      </div>
      <div class="panel" data-reveal>
        <header><h2>Last six weeks</h2><div class="spacer"></div>
          <div class="chartlegend">
            <span><i style="background:${C.blue}"></i>posted</span>
            <span><i style="background:${C.green}"></i>landed</span>
          </div></header>
        <div class="body">${chart}</div>
      </div>
    </div>
    <div class="rail">
      <div class="panel" data-reveal>
        <header><h2>Latest activity</h2><div class="spacer"></div>
          <button class="link" ${act(go, "discussions")}>More</button></header>
        <div class="feed">${feed}</div>
      </div>
    </div>
  </div>`;
}

/* The funnel above is a flow: a patch counted at "accepted" was also counted
   at "posted".  This is the opposite, and the one that has to balance.  Each
   patch appears exactly once, and the sum is stated on screen so a bucket
   that stops adding up is visible rather than merely wrong. */
/* When a source could not be reached, the numbers that come from it are the
   ones from before.  Say which, rather than letting them pass as today's. */
function stalePanel() {
  const old = S.data.stale;
  if (!old) return "";
  return `<div class="panel wide warn" data-reveal>
    <div class="body">
      <p class="hint" style="margin:0">Could not reach
      <strong>${old.hosts.map(esc).join(", ")}</strong> on the last collection,
      so ${plural(old.count, "answer")} from an earlier run
      ${old.count === 1 ? "was" : "were"} kept. Which trees have your patches
      may be out of date; everything from the mailing list is current. The next
      refresh will try again.</p>
    </div>
  </div>`;
}

function ledgerPanel(book, total) {
  const sum = book.reduce((a, b) => a + b.value, 0);
  const rows = book.map((b, i) => `
    <button class="ledrow ${b.value ? "" : "nil"}" data-reveal style="--i:${i}"
      ${act(showBucket, b.key)}>
      <span class="sw" style="background:${b.color}"></span>
      <span class="nm">${esc(b.label)}<i>${esc(b.blurb)}</i></span>
      <span class="tr"><i style="width:${(b.value / (total || 1)) * 100}%;
        background:${b.color}"></i></span>
      <span class="vl">${b.value}</span>
      <span class="pc">${pct(b.value, total)}</span>
    </button>`).join("");

  return `<div class="panel wide" data-reveal>
    <header><h2>Where all ${total} patches stand</h2>
      <span class="sub">one bucket each, so it adds up</span>
      <div class="spacer"></div>
      <span class="tally ${sum === total ? "ok" : "bad"}">
        ${book.map((b) => b.value).join(" + ")} = ${sum}${
          sum === total ? "" : `, but ${total} were posted`}</span>
    </header>
    <div class="body flush"><div class="ledger">${rows}</div></div>
  </div>`;
}

/* Every bucket is a saved query on the patch list, so clicking one lands on
   the actual patches rather than a dead end. */
function showBucket(key) {
  const b = LEDGER.find((x) => x.key === key);
  go("patches");
  const st = gridState("patches", patchGridOpts());
  st.q = "";
  st.filters = { state: b ? "~" + key : "" };
  st.page = 1;
  gridSave("patches");
  render();
}

function feedItem(a, i) {
  const meta = {
    sent:    { c: "blue",   i: "\u2191", t: "Posted" },
    reply:   { c: "amber",  i: "\u21A9", t: "Reply" },
    applied: { c: "green",  i: "\u2713", t: "Applied" },
    merged:  { c: "green",  i: "\u2713", t: "Merged" },
    queued:  { c: "cyan",   i: "\u21E7", t: "Queued" },
    ci:      { c: "purple", i: "\u2699", t: "CI" },
  }[a.kind] || { c: "grey", i: "\u2022", t: a.kind };
  const col = C[meta.c];
  return `<div class="feeditem" data-reveal style="--i:${i}">
    <div class="ic" style="background:${col}22;color:${col}">${meta.i}</div>
    <div class="tx">
      <div class="t1" style="color:${col}">${esc(meta.t)}</div>
      <div class="t2">${a.url ? `<a href="${esc(a.url)}" target="_blank"
        rel="noreferrer">${esc(a.text)}</a>` : esc(a.text)}</div>
      <div class="t3">${esc(a.note || "")} \u00b7 ${ago(a.ts)}</div>
    </div></div>`;
}

function viewPatches() {
  const d = S.data, k = d.kpis;
  const st = GRIDS["patches"];
  const on = (st && st.filters.state) || "";
  const book = ledger(d.patches);

  /* Same buckets as the overview, so a number clicked there and a chip
     pressed here can never disagree. */
  const chips = `<div class="chipbar">`
    + `<button class="chip grey ${on === "" ? "on" : ""}" data-reveal
        ${act(gridFilter, "patches", "state", "")}>Everything<b>${k.patches}</b></button>`
    + book.filter((b) => b.value).map((b, i) => `<button class="chip ${b.cls} ${
        on === "~" + b.key ? "on" : ""}" data-reveal style="--i:${i + 1}"
        title="${esc(b.blurb)}"
        ${act(gridFilter, "patches", "state", "~" + b.key)}
        >${esc(b.label)}<b>${b.value}</b></button>`).join("")
    + `</div>`;

  return grid("patches", d.patches, patchColumns(), patchGridOpts({
    title: "Every patch you posted",
    subtitle: `${k.patches} patches, ${k.series} series, since ${day(k.first)}`,
    chips,
  }));
}

function viewOutcomes() {
  const d = S.data;
  const dropped = d.patches.filter((p) => CLOSED.includes(p.state));
  return tabs("out", [
    ["landed", `Landed (${d.merged.length})`, viewLanded],
    ["dropped", `Dropped (${dropped.length})`, () => viewDropped(dropped)],
  ]);
}

/* The patches that went nowhere.  Worth a page of its own: superseded is
   normal and healthy, rejected is a lesson, and "handled elsewhere" means
   somebody else fixed it first. */
function viewDropped(rows) {
  const why = {
    "superseded": ["A later version replaced it", "grey"],
    "rejected": ["A maintainer said no", "red"],
    "not-applicable": ["Did not apply, or the tree had moved on", "red"],
    "handled-elsewhere": ["Someone else's patch got there first", "grey"],
    "deferred": ["Put off until later", "grey"],
  };
  const counts = {};
  rows.forEach((r) => { counts[r.state] = (counts[r.state] || 0) + 1; });

  const cards = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([st, n], i) => `<div class="kpi ${(why[st] || ["", "grey"])[1]} flat"
      data-reveal style="--i:${i}" title="${esc((why[st] || [""])[0])}">
      <div class="label">${esc(state(st).label)}</div>${counter(n, "dr-" + st)}
      <div class="sub">${esc((why[st] || [""])[0])}</div></div>`).join("");

  const supers = rows.filter((r) => r.state === "superseded").length;

  return `<div class="kpis four">${cards}</div>
    <p class="hint standalone">${plural(rows.length, "patch", "patches")} stopped
    moving${supers ? `, and ${supers} of those only because you sent a better
    version, which is how it is meant to go` : ""}.</p>`
    + grid("dropped", rows, [
      { key: "subject", label: "Patch", cls: "subject", width: "44%",
        csv: (r) => r.subject,
        render: (r) => `${subj(r.msgid || r.series, r.subject)}${r.version > 1
            ? `<span class="tag">v${r.version}</span>` : ""}` },
      { key: "state", label: "What happened", sort: (r) => state(r.state).rank,
        csv: (r) => state(r.state).label, render: (r) => pill(r.state) },
      { key: "state_detail", label: "Why", width: "26%",
        csv: (r) => r.state_detail,
        render: (r) => r.state_detail
          ? `<span class="muted">${mark(r.state_detail)}${byAI(r)}</span>`
          : `<span class="muted">\u2014</span>` },
      { key: "tree", label: "Tree", sort: treeOf,
        render: (r) => `<span class="nowrap muted">${mark(treeOf(r))}</span>` },
      { key: "date", label: "Posted", csv: (r) => (r.date || "").slice(0, 10),
        render: (r) => `<span class="nowrap muted">${ago(r.date)}</span>` },
    ], {
      placeholder: "Search, or try state:rejected tree:net-next\u2026",
      searchIn: (r) => [r.subject, r.state, r.state_detail, treeOf(r)].join(" "),
      fields: PATCH_FIELDS,
      filters: [stateFilter(), treeFilter()],
      groups: [{ key: "state", label: "by outcome", of: (r) => state(r.state).label },
               { key: "tree", label: "by tree", of: treeOf }],
      rowKey: (r) => r.msgid || r.lore || r.subject,
      sort: "date", dir: "desc", per: 25,
    });
}

function viewLanded() {
  const d = S.data, k = d.kpis;
  const rows = d.merged;
  const mainline = rows.filter((r) => r.mainline).length;

  const cards = [
    ["green", "Commits in mainline", mainline],
    ["cyan", "Queued in linux-next", k.in_next],
    ["blue", "In a maintainer tree", k.in_tree],
    ["purple", "Marked accepted", k.accepted],
  ].map(([cls, label, v], i) => `<div class="kpi ${cls} flat" data-reveal style="--i:${i}">
    <div class="label">${esc(label)}</div>${counter(v, "ld-" + label)}</div>`).join("");

  return `<div class="kpis four">${cards}</div>` +
    grid("landed", rows, [
      { key: "short", label: "Commit", cls: "mono nowrap", csv: (r) => r.short,
        render: (r) => `<a href="${esc(r.url)}" target="_blank" rel="noreferrer">${mark(r.short)}</a>` },
      { key: "subject", label: "Subject", cls: "subject", width: "46%",
        csv: (r) => r.subject,
        render: (r) => subj(r.msgid || r.series, r.subject) + (r.versions > 1
          ? `<span class="tag">${r.versions} versions</span>` : "")
          + (r.series && r.series !== r.subject
            ? `<div class="sub2">posted as: ${mark(r.series)}</div>` : "") },
      { key: "where", label: "Where it is", sortable: false,
        csv: (r) => r.trees.join(" "),
        render: (r) => `<div class="chips">` + r.trees.map((t) =>
          `<span class="pill ${t === "mainline" ? "green" : t === "linux-next" ? "cyan" : "blue"}">${esc(t)}</span>`
        ).join("") + `</div>` },
      { key: "date", label: "Landed",
        render: (r) => `<span class="nowrap muted">${esc(r.date)}</span>` },
      { key: "lore", label: "Thread", sortable: false, cls: "links",
        csv: (r) => r.lore, render: (r) => link(r.lore) },
    ], {
      title: "Commits that landed",
      subtitle: `${rows.length} commits, ${mainline} of them already in Linus' tree`,
      placeholder: "Search a commit or a subject\u2026",
      searchIn: (r) => [r.subject, r.short, r.trees.join(" ")].join(" "),
      fields: { tree: (r) => r.trees.join(" "), mainline: (r) => r.mainline,
                date: (r) => r.date, versions: (r) => r.versions || 1 },
      groups: [{ key: "where", label: "by tree", of: (r) => r.trees[0] || "\u2014" }],
      rowKey: (r) => r.commit || r.short,
      sort: "date", dir: "desc", per: 25,
    });
}

function viewDiscussions() {
  const d = S.data;
  return tabs("disc", [
    ["threads", `Threads (${d.threads.length})`, discThreads],
    ["people", `People (${d.people.length})`, discPeople],
    ["tags", `Review tags (${d.tagrows.length})`, discTags],
  ]);
}

function discThreads() {
  return grid("threads", S.data.threads, [
    { key: "series", label: "Thread", cls: "subject", width: "46%",
      csv: (r) => r.series,
      render: (r) => `${subj(r.id || r.series, r.series)}
        <div class="sub2">${mark(r.excerpt)}</div>` },
    { key: "last_from", label: "Last word from", csv: (r) => r.last_from,
      render: (r) => `${mark(r.last_from)}<div class="sub2">${ago(r.last_date)}</div>` },
    { key: "state", label: "Status", sort: (r) => state(r.state).rank,
      csv: (r) => state(r.state).label, render: (r) => pill(r.state) },
    { key: "count", label: "Msgs", cls: "num", render: (r) => r.count },
    { key: "waiting_on_us", label: "Action", sort: (r) => (r.waiting_on_us ? 1 : 0),
      csv: (r) => (r.waiting_on_us ? "reply needed" : ""),
      render: (r) => r.waiting_on_us
        ? `<span class="pill amber">reply needed</span>` : `<span class="muted">\u2014</span>` },
    { key: "ai", label: "", sortable: false, cls: "nowrap",
      render: (r) => `<button class="ai-inline" title="Ask the assistant about this thread"
        ${act(askAboutThread, r)}>\u2726</button>` },
  ], {
    title: "Conversations on the lists",
    subtitle: "every thread you started, and what came back",
    placeholder: "Search, or try state:reviewed replies>2\u2026",
    searchIn: (r) => [r.series, r.last_from, r.excerpt, r.tree].join(" "),
    fields: { tree: (r) => r.tree, state: (r) => r.state,
              from: (r) => r.last_from, replies: (r) => r.count,
              waiting: (r) => (r.waiting_on_us ? "yes" : "no") },
    groups: [{ key: "tree", label: "by tree", of: (r) => r.tree || "\u2014" },
             { key: "state", label: "by status", of: (r) => state(r.state).label }],
    rowKey: (r) => r.id || r.series,
    sort: "last_date", dir: "desc", per: 25,
    headerRight: link(S.data.profile.lore, "open lore \u2197"),
  });
}

function discPeople() {
  return grid("people", S.data.people, [
    { key: "name", label: "Person", width: "40%", csv: (r) => r.name,
      render: (r) => `<strong>${mark(r.name)}</strong><div class="sub2">${esc(r.addr)}</div>` },
    { key: "replies", label: "Replies", cls: "num", render: (r) => r.replies },
    { key: "series", label: "Threads", cls: "num", render: (r) => r.series },
    { key: "tags", label: "Tags given", cls: "num", render: (r) => r.tags },
    { key: "kinds", label: "Which", sortable: false,
      csv: (r) => Object.entries(r.kinds).map(([t, n]) => `${t} ${n}`).join(" "),
      render: (r) => `<div class="chips">` + Object.entries(r.kinds).map(([t, n]) =>
        `<span class="pill ${t === "Nacked-by" ? "red" : "green"}">${esc(t)} ${n}</span>`
      ).join("") + `</div>` },
  ], {
    title: "People who engaged with your work",
    placeholder: "Search, or try replies>3\u2026",
    searchIn: (r) => r.name + " " + r.addr,
    fields: { name: (r) => r.name, replies: (r) => r.replies,
              tags: (r) => r.tags, threads: (r) => r.series },
    rowKey: (r) => r.addr || r.name,
    sort: "replies", dir: "desc", per: 25,
  });
}

function discTags() {
  const rows = S.data.tagrows;
  const byTag = {};
  rows.forEach((r) => { byTag[r.tag] = (byTag[r.tag] || 0) + 1; });
  const cards = Object.entries(byTag).sort((a, b) => b[1] - a[1])
    .map(([t, n], i) => `<div class="kpi ${["green", "blue", "cyan", "purple", "amber", "red"][i % 6]} flat"
      data-reveal style="--i:${i}">
      <div class="label">${esc(t)}</div>${counter(n, "tag-" + t)}</div>`).join("");

  return `<div class="kpis four">${cards}</div>` + grid("tags", rows, [
    { key: "tag", label: "Tag", csv: (r) => r.tag,
      render: (r) => `<span class="pill ${r.tag === "Nacked-by" ? "red" : "green"}">${esc(r.tag)}</span>` },
    { key: "who", label: "From", csv: (r) => r.who,
      render: (r) => `${mark(r.who)}<div class="sub2">${esc(r.addr)}</div>` },
    { key: "subject", label: "On patch", cls: "subject", width: "42%",
      csv: (r) => r.subject,
      render: (r) => `${subj(r.msgid || r.series, r.subject)}` },
    { key: "state", label: "Now", sort: (r) => state(r.state).rank,
      csv: (r) => state(r.state).label, render: (r) => pill(r.state) },
    { key: "date", label: "Given",
      render: (r) => `<span class="nowrap muted">${day(r.date)}</span>` },
  ], {
    title: "Review tags you collected",
    placeholder: "Search, or try tag:Reviewed-by\u2026",
    searchIn: (r) => [r.tag, r.who, r.subject].join(" "),
    fields: { tag: (r) => r.tag, who: (r) => r.who, state: (r) => r.state },
    groups: [{ key: "tag", label: "by tag", of: (r) => r.tag },
             { key: "who", label: "by person", of: (r) => r.who }],
    rowKey: (r) => r.tag + r.addr + r.subject,
    sort: "date", dir: "desc", per: 25,
  });
}

function viewInsights() {
  return tabs("ins", [
    ["activity", "Activity", insActivity],
    ["subsystem", "Subsystems", insSubsystems],
    ["trees", "Trees", insTrees],
    ["numbers", "Every number", insNumbers],
  ]);
}

function insActivity() {
  const d = S.data, tl = d.timeline;
  const byDate = {};
  tl.forEach((t) => { byDate[t.date] = t.sent; });
  const labels = tl.map((t) => t.date.slice(5));
  const daily = chartSlot("ins-daily", 230, (w, h) => lineChart(labels, [
    { name: "Patches posted", color: C.blue, points: tl.map((t) => t.sent), fill: true },
    { name: "Series posted", color: C.amber, points: tl.map((t) => t.series) },
    { name: "Landed", color: C.green, points: tl.map((t) => t.merged) },
  ], w, h));
  const cumulative = chartSlot("ins-total", 190, (w, h) => lineChart(labels, [
    { name: "Running total", color: C.purple, points: tl.map((t) => t.cumulative), fill: true },
  ], w, h));

  const busiest = tl.slice().sort((a, b) => b.sent - a.sent).slice(0, 8);
  const bmax = Math.max(...busiest.map((t) => t.sent), 1);

  return `<div class="stack">
    <div class="panel" data-reveal>
      <header><h2>When you post</h2>
        <span class="sub">a square per day, the last six months</span></header>
      <div class="body">${heatmap(byDate, 26)}</div>
    </div>
    <div class="panel" data-reveal>
      <header><h2>Day by day</h2><div class="spacer"></div>
        <div class="chartlegend">
          <span><i style="background:${C.blue}"></i>patches</span>
          <span><i style="background:${C.amber}"></i>series</span>
          <span><i style="background:${C.green}"></i>landed</span>
        </div></header>
      <div class="body">${daily}</div>
    </div>
    <div class="row2">
      <div class="panel" data-reveal><header><h2>Running total</h2></header>
        <div class="body">${cumulative}</div></div>
      <div class="panel" data-reveal><header><h2>Busiest days</h2></header>
        <div class="body"><div class="bars">${busiest.map((t, i) => `<div class="barrow"
          data-reveal style="--i:${i}">
          <span class="nm">${esc(t.date)}</span>
          <div class="tr"><i style="width:${(t.sent / bmax) * 100}%;background:${C.blue}"></i></div>
          <span class="vl">${t.sent}</span></div>`).join("")}</div></div></div>
    </div>
  </div>`;
}

function subsystemRows() {
  const map = {};
  S.data.patches.forEach((p) => {
    const s = subsystem(p.subject);
    const g = map[s] || (map[s] = { name: s, patches: 0, merged: 0, next: 0,
                                    review: 0, open: 0, bad: 0 });
    g.patches++;
    if (p.state === "merged") g.merged++;
    else if (["in-next", "in-tree", "accepted", "queued"].includes(p.state)) g.next++;
    else if (["reviewed", "under-review"].includes(p.state)) g.review++;
    else if (CLOSED.includes(p.state) || p.state === "changes-requested") g.bad++;
    else g.open++;
  });
  return Object.values(map).sort((a, b) => b.patches - a.patches);
}

function insSubsystems() {
  const d = S.data;
  const rows = subsystemRows();
  const items = rows.slice(0, 7).map((r, i) =>
    ({ label: r.name + "/", value: r.patches, color: PALETTE[i] }));
  const rest = rows.slice(7).reduce((a, b) => a + b.patches, 0);
  if (rest) items.push({ label: "everything else", value: rest, color: C.grey });

  return `<div class="panel" data-reveal>
      <header><h2>Where your work goes</h2>
        <span class="sub">${plural(rows.length, "subsystem")} touched</span></header>
      <div class="body"><div class="donutwrap">
        ${donut(items, 170, rows.length, "areas")}
        ${legend(items, d.kpis.patches)}</div></div>
    </div>` + grid("subsystems", rows, [
      { key: "name", label: "Subsystem", csv: (r) => r.name,
        render: (r) => `<strong>${mark(r.name)}/</strong>` },
      { key: "patches", label: "Patches", cls: "num", render: (r) => r.patches },
      { key: "bar", label: "How they are doing", sortable: false, width: "38%",
        csv: (r) => `${r.merged} mainline, ${r.next} accepted, ${r.open} waiting`,
        render: (r) => `<div class="barrow" style="grid-template-columns:1fr">
          ${stackBar([
            { label: "in mainline", value: r.merged, color: C.green },
            { label: "accepted", value: r.next, color: C.cyan },
            { label: "in review", value: r.review, color: C.amber },
            { label: "no reply yet", value: r.open, color: C.grey },
            { label: "closed out", value: r.bad, color: C.red },
          ], r.patches)}</div>` },
      { key: "merged", label: "Mainline", cls: "num", render: (r) => r.merged },
      { key: "next", label: "Accepted", cls: "num", render: (r) => r.next },
      { key: "open", label: "Waiting", cls: "num", render: (r) => r.open },
    ], {
      placeholder: "Search, or try patches>10\u2026",
      searchIn: (r) => r.name,
      fields: { name: (r) => r.name, patches: (r) => r.patches,
                merged: (r) => r.merged, open: (r) => r.open },
      rowKey: (r) => r.name, sort: "patches", dir: "desc", per: 25,
    });
}

function insTrees() {
  const d = S.data, cap = d.kpis.netdev_cap, open = d.kpis.netdev_open;
  const over = open >= cap;
  const budget = `<div class="panel" data-reveal>
    <header><h2>net-next budget</h2>
      <span class="sub">Documentation/process/maintainer-netdev.rst</span></header>
    <div class="body">
      <div class="gauge"><i style="width:${Math.min(100, (open / cap) * 100)}%;
        background:${over ? C.red : C.amber}"></i></div>
      <p class="hint"><strong>${open} of ${cap}</strong> patches outstanding against
      net-next. Netdev asks for no more than ${cap} across all your series, so
      ${over ? "anything further has to wait for this batch to be applied."
             : `you have room for ${cap - open} more.`}</p>
    </div></div>`;

  return budget + grid("trees", d.trees, [
    { key: "tree", label: "Tree or list", csv: (r) => r.tree,
      render: (r) => `<strong>${mark(r.tree)}</strong>` },
    { key: "patches", label: "Patches", cls: "num", render: (r) => r.patches },
    { key: "bar", label: "How they are doing", sortable: false, width: "32%",
      csv: (r) => `${r.merged} mainline, ${r.in_next} next, ${r.open} open`,
      render: (r) => `<div class="barrow" style="grid-template-columns:1fr">
        ${stackBar([
          { label: "in mainline", value: r.merged, color: C.green },
          { label: "in linux-next", value: r.in_next, color: C.cyan },
          { label: "accepted", value: r.accepted, color: C.blue },
          { label: "reviewed", value: r.reviewed, color: C.amber },
          { label: "open", value: r.open, color: C.grey },
          { label: "closed out", value: r.problems, color: C.red },
        ], r.patches)}</div>` },
    { key: "merged", label: "Mainline", cls: "num", render: (r) => r.merged },
    { key: "in_next", label: "linux-next", cls: "num", render: (r) => r.in_next },
    { key: "open", label: "Open", cls: "num", render: (r) => r.open },
    { key: "tags", label: "Tags", cls: "num", render: (r) => r.tags },
  ], {
    placeholder: "Search, or try open>5\u2026",
    searchIn: (r) => r.tree,
    fields: { tree: (r) => r.tree, patches: (r) => r.patches,
              merged: (r) => r.merged, open: (r) => r.open, tags: (r) => r.tags },
    rowKey: (r) => r.tree, sort: "patches", dir: "desc", per: 25,
  });
}

function insNumbers() {
  const d = S.data, k = d.kpis;
  const rows = [
    ["Patches posted", k.patches], ["Series", k.series],
    ["Distinct subjects", k.unique_patches], ["Series respun as v2 or later", k.versions],
    ["In mainline", k.merged], ["In linux-next", k.in_next],
    ["In a maintainer tree", k.in_tree], ["Marked accepted", k.accepted],
    ["Carrying a review tag", k.reviewed], ["Being discussed", k.under_review],
    ["No response yet", k.awaiting], ["Changes requested", k.changes_requested],
    ["Superseded by a later version", k.superseded], ["Rejected", k.rejected],
    ["Not applicable or handled elsewhere", k.not_applicable],
    ["Review tags collected", k.review_tags], ["People who replied", k.reviewers],
    ["Replies received", k.replies], ["Threads waiting on you", k.waiting_on_us],
    ["Trees and lists targeted", k.trees], ["Patchwork projects", k.pw_projects],
    ["First patch posted", day(k.first)], ["Most recent patch posted", day(k.last)],
  ];

  const buckets = { "1 patch": 0, "2 to 4": 0, "5 to 9": 0, "10 to 19": 0, "20 or more": 0 };
  d.series.forEach((s) => {
    if (s.count === 1) buckets["1 patch"]++;
    else if (s.count < 5) buckets["2 to 4"]++;
    else if (s.count < 10) buckets["5 to 9"]++;
    else if (s.count < 20) buckets["10 to 19"]++;
    else buckets["20 or more"]++;
  });
  const bmax = Math.max(...Object.values(buckets), 1);

  return `<div class="row2" style="align-items:start">
    <div class="panel" data-reveal><header><h2>Every number</h2></header>
      <div class="body"><dl class="kv">${rows.map(([a, b]) =>
        `<dt>${esc(a)}</dt><dd class="num">${esc(b)}</dd>`).join("")}</dl></div></div>
    <div class="panel" data-reveal><header><h2>How big your series are</h2></header>
      <div class="body"><div class="bars">${Object.entries(buckets).map(([nm, v], i) =>
        `<div class="barrow" data-reveal style="--i:${i}"><span class="nm">${esc(nm)}</span>
          <div class="tr"><i style="width:${(v / bmax) * 100}%;background:${PALETTE[i]}"></i></div>
          <span class="vl">${v}</span></div>`).join("")}</div></div></div>
  </div>`;
}

/* What you owe the lists, as against what the lists owe you.  Two kinds:
   a thread where someone asked you something last, and a series where the
   answer was "change this", which means a new version is due. */
function owedWork() {
  const d = S.data;
  const byId = new Map(d.series.map((s) => [s.id, s]));
  const waiting = new Set(d.series.filter((s) => s.waiting_on_us).map((s) => s.id));

  const groups = new Map();
  d.patches.filter((p) => p.state === "changes-requested").forEach((p) => {
    let g = groups.get(p.series);
    if (!g) {
      const s = byId.get(p.series) || {};
      groups.set(p.series, g = {
        id: p.series,
        name: s.name || p.series_name || p.subject,
        tree: s.tree_hint || s.list || treeOf(p),
        lore: s.lore || p.lore,
        date: s.last_activity || s.date || p.date,
        sent: s.version || p.version || 1,
        patches: [],
      });
    }
    g.patches.push(p);
    g.sent = Math.max(g.sent, p.version || 1);
  });
  const respins = [...groups.values()]
    .sort((a, b) => compare(b.date, a.date));

  return {
    replies: {
      threads: d.threads.filter((t) => t.waiting_on_us),
      patches: d.patches.filter((p) => waiting.has(p.series)),
    },
    respin: {
      series: respins,
      patches: d.patches.filter((p) => p.state === "changes-requested"),
    },
    dropped: d.patches.filter((p) => CLOSED.includes(p.state)),
  };
}

function viewOwed() {
  const owed = owedWork();
  return tabs("owed", [
    ["replies", `Replies (${owed.replies.threads.length})`,
     () => owedReplies(owed)],
    ["respin", `New versions (${owed.respin.series.length})`,
     () => owedRespins(owed)],
    ["notes", `Your notes (${(S.data.notes || []).length})`, owedNotes],
  ]);
}

function owedReplies(owed) {
  const list = owed.replies.threads;
  if (!list.length) {
    return `<div class="panel" data-reveal><div class="empty">
      <div class="emptyicon">\u2713</div>
      <p>Nothing on the lists is waiting for you.</p></div></div>`;
  }
  const cards = list.map((t, i) => `
    <div class="notecard" data-reveal style="--i:${i}">
      <span class="pill amber">reply</span>
      <div class="tx">
        <h4>${subj(t.id, t.series)}</h4>
        <p><strong>${esc(t.last_from)}</strong> wrote ${ago(t.last_date)}:
           ${esc(t.excerpt)}</p>
        <div class="next">
          <button class="link" ${act(askAboutThread, t)}>ask the assistant what to say</button>
          <span class="muted"> \u00b7 ${esc(t.tree || "list")} \u00b7 ${
            plural(t.count, "message")}</span>
        </div>
      </div></div>`).join("");

  return `<div class="panel" data-reveal>
    <header><h2>Someone asked you something</h2>
      <span class="sub">${plural(list.length, "thread")}, covering ${
        plural(owed.replies.patches.length, "patch", "patches")}</span></header>
    <div class="body flush">${cards}</div></div>`;
}

function owedRespins(owed) {
  const list = owed.respin.series;
  if (!list.length) {
    return `<div class="panel" data-reveal><div class="empty">
      <div class="emptyicon">\u2713</div>
      <p>Nobody has asked for changes. Nothing to respin.</p></div></div>`;
  }
  const cards = list.map((g, i) => `
    <div class="notecard" data-reveal style="--i:${i}">
      <span class="pill purple">v${g.sent + 1} due</span>
      <div class="tx">
        <h4>${subj(g.id, g.name)}</h4>
        <p>${plural(g.patches.length, "patch", "patches")} with changes
           requested, last moved ${ago(g.date)}. You sent v${g.sent}, so the
           next one goes out as <strong>v${g.sent + 1}</strong>.</p>
        <ul class="tight">${g.patches.map((p) =>
          `<li>${subj(p.msgid || p.series, p.subject)}${p.state_detail
              ? ` <span class="muted">\u2014 ${esc(p.state_detail)}</span>` : ""}</li>`
          ).join("")}</ul>
        <div class="next">
          <button class="link" ${act(askAboutRespin, g)}>ask the assistant what to change</button>
        </div>
      </div>
      <span class="muted nowrap">${esc(g.tree)}</span>
    </div>`).join("");

  return `<div class="panel" data-reveal>
    <header><h2>Changes were requested</h2>
      <span class="sub">${plural(list.length, "series", "series")}, ${
        plural(owed.respin.patches.length, "patch", "patches")} to respin</span>
      <div class="spacer"></div>
      <button class="link" ${act(showBucket, "respin")}>see them in the list</button>
    </header>
    <div class="body flush">${cards}</div></div>`;
}

function owedNotes() {
  const notes = S.data.notes || [];
  const withheld = S.status.notes_withheld || S.data.notes_withheld || 0;
  const colour = { blocked: "red", todo: "amber", waiting: "purple",
                   held: "grey", rule: "blue" };
  const cards = notes.map((n, i) => `<div class="notecard" data-reveal style="--i:${i}">
      <span class="pill ${colour[n.state] || "grey"}">${esc(n.state)}</span>
      <div class="tx"><h4>${esc(n.title)}</h4><p>${esc(n.detail)}</p>
        ${n.next ? `<div class="next">Next: ${esc(n.next)}</div>` : ""}</div>
      <span class="muted nowrap">${esc(n.tree || "")}</span>
    </div>`).join("") || (withheld
      ? `<div class="empty"><div class="emptyicon">\u26BF</div>
         <p>${plural(withheld, "private note")} withheld by this deployment.<br>
         They stay on the machine that collected them.</p></div>`
      : `<div class="empty"><div class="emptyicon">\u2691</div>
         <p>Nothing written down yet.</p></div>`);

  return `<div class="panel" data-reveal>
    <header><h2>Things you wrote down</h2>
      <span class="sub">what is blocked, and what to fix next time</span></header>
    <div class="body flush">${cards}</div></div>`;
}

/* -------------------------------------------------------------- settings */

function viewSettings() {
  return tabs("set", [
    ["general", "General", setGeneral],
    ["ai", "Assistant", setAI],
    ["sources", "Data sources", setSources],
  ]);
}

const INTERVAL_PRESETS = [2, 5, 15, 30, 60, 240, 1440];

function prettyInterval(m) {
  if (!m) return "\u2014";
  if (m < 60) return `${+m.toFixed(2)} min`;
  if (m < 1440) return `${+(m / 60).toFixed(m % 60 ? 1 : 0)} hr`;
  return `${+(m / 1440).toFixed(m % 1440 ? 1 : 0)} day`;
}

function setGeneral() {
  const d = S.data, st = S.status;
  const auto = st.auto !== false;
  const now = st.interval || 15;
  return `<div class="row2" style="align-items:start">
    <div class="panel" data-reveal><header><h2>Automatic refresh</h2></header><div class="body">
      <p class="hint" style="margin-top:0">The server re-reads lore, patchwork and
      git.kernel.org on a timer, so this page stays current on its own. Responses
      are cached, so a scheduled run is cheap and usually finishes in a second.</p>
      <div class="switchrow">
        <label class="switch"><input type="checkbox" ${auto ? "checked" : ""}
          ${actv("change", setAuto)}><span></span></label>
        <div><strong>${auto ? "On" : "Off"}</strong>
          <div class="sub2">${auto
            ? "next run " + (st.next_run ? "in " + until(st.next_run) : "shortly")
            : "the page will only update when you refresh by hand"}</div></div>
      </div>

      <div class="field">
        <label>How often</label>
        <div class="intervalrow">
          <input type="number" id="ivnum" min="1" max="10080" step="1" value="${now}">
          <span class="unit">minutes</span>
          <button class="btn sm" ${act(applyInterval)}>Apply</button>
        </div>
        <div class="presets">
          ${INTERVAL_PRESETS.map((m) => `<button class="chip ${
            Math.abs(now - m) < 0.01 ? "on" : ""}" ${act(setInterval_, m)}
            >${prettyInterval(m)}</button>`).join("")}
        </div>
          <p class="hint">Anything from one minute to a week. Currently
          <strong>${prettyInterval(now)}</strong>. This is yours and is
          remembered, so signing in again, or from another machine, finds
          the same schedule.</p>
      </div>

      <div class="btnrow">
        <button class="btn primary" ${act(doRefresh, false)}>Refresh now</button>
        <button class="btn" ${act(doRefresh, true)}>Full rescan</button>
      </div>
      <p class="hint">A full rescan walks every maintainer tree on git.kernel.org
      and takes several minutes. You only need it if a commit landed somewhere
      unusual.</p>
    </div></div>

    <div class="panel" data-reveal><header><h2>When a patch lands</h2></header>
    <div class="body">
      <p class="hint" style="margin-top:0">A patch reaching Linus' tree is the
      end of the whole thing, and the one part of it nobody announces: the
      maintainer said "applied" weeks ago, and then one day the commit is
      simply there. This is the only message Patchvane will send you about
      your own patches.</p>
      <div class="switchrow">
        <label class="switch"><input type="checkbox" ${st.merged_mail ? "checked" : ""}
          ${actv("change", setMergedMail)}><span></span></label>
        <div><strong>${st.merged_mail ? "On" : "Off"}</strong>
          <div class="sub2">${st.merged_mail
            ? "you will hear from us when one reaches mainline, and not "
              + "otherwise"
            : "nothing is sent"}</div></div>
      </div>
      <p class="hint">It goes to <strong>${esc(st.who || "your address")}</strong>
      after a collection finds a commit of yours in mainline that was not
      there last time, with the subject, the commit and when it landed.
      Switching it on now does not mean hearing about everything that has
      already landed: what has been seen is remembered either way, so you get
      the next one, not the back catalogue.</p>
      ${st.mail === false ? `<p class="testline bad">This server has no way to
        send mail configured, so nothing can go out even with this on.</p>` : ""}
    </div></div>
  </div>

  <div class="row2" style="align-items:start">
    <div class="panel" data-reveal><header><h2>This server</h2></header><div class="body">
      <dl class="kv">
        <dt>Running as</dt><dd>${esc(st.mode || "local")}</dd>
        <dt>Data collected</dt><dd>${esc(new Date(d.generated).toLocaleString())}
          <span class="muted">(${ago(d.generated)})</span></dd>
        <dt>Collection took</dt><dd>${esc(d.collect_seconds)} seconds</dd>
      </dl>
      <div class="field">
        <label>Appearance</label>
        <div class="presets">
          ${["dark", "light"].map((t) => `<button class="chip ${
            (document.documentElement.dataset.theme || "dark") === t ? "on" : ""}"
            ${act(setTheme, t)}>${t === "dark" ? "Dark" : "Light"}</button>`).join("")}
        </div>
        <p class="hint">Remembered against your account, so it follows you to
        another machine rather than living in this browser alone.</p>
      </div>
    </div></div>
  </div>`;
}

const ZONE_NAME = {
  code: "code and patches", writing: "drafting replies",
  reasoning: "working things out", summary: "counting and listing",
  long: "reading a lot at once",
};

function setAI() {
  const st = S.status;
  const list = S.providers || [];
  const ready = list.filter((p) => p.ready);

  const cards = list.map((p, i) => {
    const open = S.keyOpen === p.id;
    /* A deployment-specific address that nobody has filled in yet: the key
       alone will not reach anything. */
    const unset = p.where && /YOUR-|example\.com/.test(p.endpoint || "");
    return { id: p.id, ready: p.ready, html:
      `<div class="provider ${p.ready ? "on" : ""}" data-reveal style="--i:${i}">
      <div class="ph">
        <span class="pdot ${p.ready ? "on" : ""}"></span>
        <div class="pn"><strong>${esc(p.label)}</strong>
          <i>${p.good_at.map((g) => esc(ZONE_NAME[g] || g)).join(", ") || "general"}</i></div>
        <div class="spacer"></div>
        ${p.ready
          ? `<span class="pill green">ready</span>`
          : `<span class="pill grey">no key</span>`}
      </div>
      <dl class="kv tight2">
        <dt>Model</dt><dd>${modelChoice(p)}</dd>
        ${p.ready ? `<dt>Key from</dt><dd>${esc(p.source)}</dd>` : ""}
        <dt>Get a key</dt><dd class="mono">${esc(p.where)}</dd>
      </dl>
      ${unset ? `<p class="hint">This provider gives every deployment its own
        address, and this server has not been pointed at one, so a key added
        here will not reach anything until it is.</p>` : ""}
      ${S.keyTest && S.keyTest.id === p.id
        ? `<p class="testline ${S.keyTest.pending ? "waiting"
            : S.keyTest.ok ? "ok" : "bad"}">${esc(S.keyTest.msg)}</p>`
        : ""}
      ${open ? `
        <div class="field">
          <input type="password" data-key="${p.id}" placeholder="${
            p.ready ? "paste a new key to replace the current one"
                    : "paste the key from " + esc(p.where)}">
        </div>
        ${st.can_store_key === false
          ? `<p class="hint">This deployment will not write keys to disk, so
             it will live in memory only until the server restarts.</p>`
          : `<label class="check"><input type="checkbox" data-remember="${p.id}"
             checked> Remember this key</label>`}
        <div class="btnrow">
          <button class="btn primary sm" ${act(saveKey, p.id)}>Save</button>
          <button class="btn ghost sm" ${act(toggleKey, "")}>Cancel</button>
        </div>`
        : `<div class="btnrow">
          <button class="btn sm" ${act(toggleKey, p.id)}>${
            p.ready ? "Replace key" : "Add key"}</button>
          ${p.ready ? `<button class="btn ghost sm" ${act(testKey, p.id)}>Test</button>` : ""}
          ${p.ready
            ? `<button class="btn ghost sm" ${act(clearKey, p.id)}>Remove</button>` : ""}
        </div>`}
    </div>` };
  });

  /* Twenty cards at once is a wall.  What is already working comes first,
     and the rest stay folded away until someone goes looking. */
  const done = cards.filter((c) => c.ready).map((c) => c.html).join("");
  const rest = cards.filter((c) => !c.ready);
  const open = S.allModels || S.keyOpen;

  return `<div class="panel wide" data-reveal>
    <header><h2>Models the assistant can use</h2>
      <span class="sub">${ready.length
        ? `${plural(ready.length, "provider")} ready, ${rest.length} more available`
        : `none set up yet, ${rest.length} to choose from`}</span>
      <div class="spacer"></div>
      ${ready.length ? `<button class="btn sm" ${act(askAI)}>Open the assistant</button>` : ""}
    </header>
    <div class="body">
      <p class="hint" style="margin-top:0">Add a key for any of these and the
      assistant can use it. One is enough. Every question goes out with a
      digest of what this dashboard collected: totals, per tree numbers,
      landed commits, open threads and review tags. Reviewer addresses are
      masked before they leave. No mail bodies and no credentials go with
      them.</p>
      ${done ? `<div class="providers">${done}</div>` : ""}
      ${rest.length ? `
        <button class="disclose ${open ? "on" : ""}" ${act(toggleAllModels)}>
          <span class="caret">\u25BE</span>
          ${open ? "Hide" : "Show"} the other ${rest.length}</button>
        ${open ? `<div class="providers">${
          rest.map((c) => c.html).join("")}</div>` : ""}` : ""}
    </div>
  </div>

  ${readingPanel()}

  <div class="row2" style="align-items:start">
    <div class="panel" data-reveal><header><h2>How Auto picks</h2></header>
      <div class="body">
      <p class="hint" style="margin-top:0">On Auto the question is read for
      what kind of question it is, and the models suited to that go first. If
      one is rate limited or overloaded, the next takes it and the answer says
      who ended up replying. Pick a model by name in the assistant to override
      this; it still falls back if that one is down.</p>
      <dl class="kv">
        ${Object.entries(ZONE_NAME).map(([z, name]) => `
          <dt>${esc(name)}</dt>
          <dd>${(S.zones && S.zones[z] ? S.zones[z] : [])
            .map((id) => {
              const p = list.find((x) => x.id === id);
              return p ? `<span class="pill ${p.ready ? "green" : "grey"}">${
                esc(p.label)}</span>` : "";
            }).join(" ") || `<span class="muted">\u2014</span>`}</dd>`).join("")}
      </dl>
      <p class="hint">Greyed out means no key, so it is skipped.</p>
    </div></div>

    <div class="panel" data-reveal><header><h2>What you can ask</h2></header>
      <div class="body">
      <ul class="asklist">
        ${SUGGESTIONS.map((s) => `<li ${act(askAI, s)}>${esc(s)}</li>`).join("")}
      </ul>
    </div></div>
  </div>`;
}

/* Most of a patch's status is a fact: a commit in a tree, or a state
   somebody set in patchwork.  What is left is a thread of English, and this
   says how well the last collection managed to read it. */
function readingPanel() {
  const st = S.data.ai_states;
  if (!st) return "";
  const read = S.data.patches.filter((p) => p.state_by_ai).length;
  const firm = S.data.patches.length - read;

  return `<div class="panel wide" data-reveal>
    <header><h2>Reading the threads</h2>
      <span class="sub">where a status came from</span></header>
    <div class="body">
      <p class="hint" style="margin-top:0">A patch in a tree, or one somebody
      marked in patchwork, is a recorded fact and is never second-guessed.
      The rest is a maintainer writing in English, and phrases like "I've
      taken this" or "send it via net-next instead" are easy to misread. On
      the last collection a model was asked about those, and only those.</p>
      <div class="stats3">
        <div><b>${firm}</b><span>from a commit or patchwork</span></div>
        <div><b class="${read ? "ai" : ""}">${read}</b>
          <span>read out of the replies</span></div>
        <div><b>${st.asked || 0}</b><span>${st.asked
          ? "questions it took to do that"
          : "asked last time, the rest was remembered"}</span></div>
      </div>
      ${st.error
        ? `<p class="testline bad">The last collection could not ask:
           ${esc(st.error)} Those threads kept the status worked out from
           their text.</p>`
        : read
          ? `<p class="hint">Those carry a <span class="readmark">read</span>
             mark in the patch list, so a reading is never mistaken for a
             record.</p>`
          : `<p class="hint">Nothing needed a second reading last time.</p>`}
    </div>
  </div>`;
}

/* Which model this provider should use.

   Without a key there is no answer to give.  A name here would be this
   dashboard's opinion from whenever it was last edited, and providers retire
   a model the week the next one ships -- so what used to sit next to "no
   key" was often a model that no longer existed, stated as though it were
   settled.  It says what will happen instead.

   With a key it is a fact: the list came from the provider when the key was
   saved, and the one in the box is the most capable of them.  The rest are
   fetched on demand, because twenty providers' catalogues at once is a lot
   of requests for a page nobody may scroll. */
function modelChoice(p) {
  if (!p.ready) {
    /* Unless this server pinned one, which is a decision somebody made on
       purpose rather than a name nobody checked, so it is shown and said. */
    return p.pinned
      ? `<span class="mono">${esc(p.model)}</span>
         <span class="hint tiny">pinned by this server</span>`
      : `<span class="muted">chosen when you add a key</span>`;
  }

  const got = (S.modelList || {})[p.id];
  if (!got) {
    return `${p.model
        ? `<span class="mono">${esc(p.model)}</span>`
        : `<span class="muted">not chosen yet</span>`}
      <button class="link sm" ${act(loadModels, p.id)}>change</button>`;
  }
  if (got.loading) return `<span class="muted">reading the list\u2026</span>`;
  if (got.error) {
    return `<span class="mono">${esc(p.model)}</span>
      <span class="testline bad">${esc(got.error)}</span>
      <button class="link sm" ${act(loadModels, p.id)}>try again</button>`;
  }

  /* Arrives ranked, so the list opens on the one worth having.  A model
     they are already on that the provider no longer lists still belongs in
     the box, or changing anything else would silently move them off it. */
  const names = got.models || [];
  const known = p.model && !names.includes(p.model)
    ? [p.model].concat(names) : names;
  return `<select class="sel sm" ${actv("change", pickProviderModel, p.id)}>
      ${known.map((m) => `<option value="${esc(m)}" ${
        m === p.model ? "selected" : ""}>${esc(m)}${
        m === got.best ? " \u2014 best on this key" : ""}</option>`).join("")}
    </select>
    <p class="hint tiny">${plural(names.length, "model")} on this key,
    strongest first.${got.best && got.best !== p.model
      ? ` <button class="link" ${act(pickProviderModel, p.id, got.best)}>Use
        ${esc(got.best)}</button>` : ""}</p>
    ${got.spares && got.spares.length
      ? `<p class="hint tiny">If this one runs out for the day the assistant
         falls back to ${got.spares.map(esc).join(", ")}.</p>` : ""}`;
}

async function loadModels(pid) {
  S.modelList = S.modelList || {};
  S.modelList[pid] = { loading: true };
  render();
  try {
    const r = await fetch("/api/ai/models?provider=" + encodeURIComponent(pid),
                          { cache: "no-store" });
    const body = await r.json();
    S.modelList[pid] = body.ok
      ? { models: body.models || [], spares: body.spares || [],
          best: body.best || "" }
      : { error: body.error || "Could not read the list." };
  } catch (e) {
    S.modelList[pid] = { error: "Could not reach the dashboard." };
  }
  render();
}

/* Remember the choice, so it survives a restart and the collector uses it
   too. */
async function pickProviderModel(pid, model) {
  const was = (S.providers.find((x) => x.id === pid) || {}).model;
  if (!model || model === was) return;
  try {
    const r = await post("/api/ai/model", { provider: pid, model: model });
    const body = await r.json();
    if (!body.ok) { toast(body.error || "Could not save that.", "bad"); return; }
    S.providers = S.providers.map(
      (x) => (x.id === pid ? Object.assign({}, x, { model: model }) : x));
    toast(label(pid) + " will use " + model, "ok");
  } catch (e) {
    toast("Could not reach the dashboard.", "bad");
  }
  render();
}

function toggleAllModels() { S.allModels = !S.allModels; render(); }

function toggleKey(id) {
  S.keyOpen = S.keyOpen === id ? "" : id;
  S.keyTest = null;
  render();
}

function setSources() {
  const s = S.data.sources || {};
  const meta = {
    lore: ["lore.kernel.org", "Every message you posted and every reply that came back."],
    patchwork: ["patchwork.kernel.org", "The state a maintainer set, and CI results."],
    korg: ["git.kernel.org", "Whether a commit reached mainline, linux-next or a maintainer tree."],
    cache: ["local cache", "Responses kept on disk so a refresh stays cheap."],
  };
  const cards = Object.entries(meta).map(([key, [title, blurb]], i) => {
    const info = s[key] || {};
    const ok = info.ok !== false && !info.error;
    return `<div class="panel" data-reveal style="--i:${i}">
      <header><h2>${esc(title)}</h2><div class="spacer"></div>
        <span class="pill ${ok ? "green" : "red"}">${ok ? "connected" : "unavailable"}</span></header>
      <div class="body">
        <p class="hint" style="margin:0 0 10px">${esc(blurb)}</p>
        <dl class="kv" style="grid-template-columns:150px 1fr">
          ${Object.entries(info).filter(([k]) => k !== "ok").map(([k, v]) =>
            `<dt>${esc(k.replace(/_/g, " "))}</dt>
             <dd>${esc(Array.isArray(v) ? v.join(", ") : v)}</dd>`).join("")}
        </dl></div></div>`;
  }).join("");
  return `<div class="row2" style="align-items:start">${cards}</div>`;
}

/* ------------------------------------------------------------- discover */

/* The two questions that are not about your own patches: what the public
   archives hold under somebody else's address, and who a patch touching a
   given file is supposed to go to.  Both read the same places the collector
   reads, and neither of them needs anything private of anybody's. */

S.find = { q: "", author: null, busy: false, error: "", poll: 0,
           mq: "", maint: null, mbusy: false, merror: "" };

function viewDiscover() {
  return tabs("find", [
    ["people", "An author", findAuthorView],
    ["send", "Who to send to", findSendView],
  ]);
}

function findTyped(which, value) { S.find[which] = value; }

function searchRow(which, go, value, placeholder, busy, label) {
  return `<div class="findrow" data-reveal>
    <input type="search" data-find="${which}" value="${esc(value)}"
           placeholder="${esc(placeholder)}" spellcheck="false"
           autocapitalize="off" ${actv("input", findTyped, which)}>
    <button class="btn primary" ${act(go)} ${busy ? "disabled" : ""}>${
      busy ? "Looking\u2026" : esc(label)}</button>
  </div>`;
}

/* ---------------------------------------------------------- an author */

async function findGo() {
  const q = (S.find.q || "").trim();
  if (!q) { toast("Type an email address first.", "bad"); return; }
  S.find.busy = true;
  S.find.error = "";
  render();
  const r = await fetch("/api/discover/author?email=" + encodeURIComponent(q),
                        { cache: "no-store" });
  const out = await r.json().catch(() => ({}));
  S.find.busy = false;
  if (!out.ok) {
    S.find.author = null;
    S.find.error = out.error || "That lookup did not work. Try again.";
  } else {
    S.find.author = out;
  }
  render();
  findWatch();
}

/* The maintainer tree sweep runs behind the page, so while it is going the
   answer is asked for again every few seconds.  One timer, ever. */
function findWatch() {
  const a = S.find.author;
  if (!a || !a.deep || a.deep.state !== "running") return;
  if (S.find.poll) return;
  S.find.poll = setTimeout(async () => {
    S.find.poll = 0;
    const who = (S.find.author || {}).email;
    if (!who || S.view !== "discover") return;
    const r = await fetch("/api/discover/author?email=" + encodeURIComponent(who),
                          { cache: "no-store" });
    const out = await r.json().catch(() => ({}));
    if (out.ok && S.find.author && S.find.author.email === out.email) {
      S.find.author = out;
      render();
      findWatch();
    }
  }, 5000);
}

async function findDeep() {
  const who = (S.find.author || {}).email;
  if (!who) return;
  S.find.author.deep = { state: "running", done: 0,
                         total: (S.find.author.deep || {}).total || 80 };
  render();
  const r = await post("/api/discover/deep", { email: who });
  const out = await r.json().catch(() => ({}));
  if (out.deep) S.find.author.deep = out.deep;
  render();
  findWatch();
}

function findAuthorView() {
  const f = S.find;
  const head = searchRow("q", findGo, f.q,
                         "an address they send patches from",
                         f.busy, "Look them up");
  const blurb = `<p class="hint" style="margin:0 0 14px">Counted from
    patchwork and git.kernel.org, which is what everybody can see. Nothing
    here comes from anyone's dashboard.</p>`;

  if (f.busy && !f.author) {
    return head + blurb + `<div class="panel wide"><div class="body">
      <div class="thwait"><span class="spin"></span>
      Reading patchwork and git.kernel.org\u2026</div></div></div>`;
  }
  if (f.error) {
    return head + blurb + `<div class="panel wide"><div class="body">
      <div class="empty"><h3>${esc(f.error)}</h3></div></div></div>`;
  }
  if (!f.author) {
    return head + blurb + `<div class="panel wide"><div class="body">
      <div class="empty tall">
        <h3>Look up anybody who posts patches</h3>
        <p>How much they have sent, how much was taken, what is queued in
        linux-next and what has reached Linus' tree &mdash; with the commit
        and the release it went out in.</p>
      </div></div></div>`;
  }
  return head + authorResult(f.author);
}

function authorResult(a) {
  const c = a.counts;
  const deep = a.deep || {};
  const n = (v) => (v < 0 ? "\u2014" : v);
  const gone = "not reachable just now";
  const cards = [
    ["blue", "Patches sent", n(c.submitted),
     a.sources.patchwork ? "as patchwork counts them" : gone],
    ["purple", "Accepted", n(c.accepted),
     a.sources.patchwork ? "a maintainer took it" : gone],
    ["cyan", "Queued in linux-next", n(c.in_next),
     a.sources.git ? "not in mainline yet" : gone],
    ["green", "In Linus' tree",
     c.merged < 0 ? "\u2014" : c.merged + (a.more.merged ? "+" : ""),
     !a.sources.git ? gone
       : a.more.merged ? "the most recent " + c.merged : "merged upstream"],
  ].map(([cls, label, v, sub], i) =>
    /* A plain value rather than an animated counter: these can read "200+"
       or a dash, and a counter can only count to a number. */
    `<div class="kpi ${cls} flat" data-reveal style="--i:${i}">
      <div class="label">${esc(label)}</div>
      <span class="value">${esc(String(v))}</span>
      <div class="sub">${esc(sub)}</div></div>`).join("");

  const notes = (a.notes || []).length
    ? `<p class="hint" style="margin:-4px 0 14px">${
        a.notes.map(esc).join(" &middot; ")}</p>`
    : "";

  return `<div class="kpis four">${cards}</div>${notes}`
    + `<p class="hint" style="margin:0 0 14px">
       ${esc(a.email)} &middot; <a href="${esc(a.lore)}" target="_blank"
       rel="noreferrer">their posts on lore \u2197</a> &middot;
       <a href="${esc(a.patchwork)}" target="_blank" rel="noreferrer">on
       patchwork \u2197</a> &middot; answered in ${esc(String(a.seconds))}s</p>`
    + mergedTable(a) + treeSweep(a, deep) + queuedPanel(a);
}

function mergedTable(a) {
  if (!a.sources.git) {
    return `<div class="panel wide" data-reveal><header><h2>In Linus' tree</h2>
      </header><div class="body"><div class="empty">
      <h3>git.kernel.org did not answer</h3>
      <p>So there is no list to show. This says nothing about whether their
      patches landed &mdash; only that the place that knows could not be
      reached. Try again in a moment.</p></div></div></div>`;
  }
  if (!a.merged.length) {
    return `<div class="panel wide" data-reveal><header><h2>In Linus' tree</h2>
      </header><div class="body"><div class="empty">
      <h3>Nothing under this address in mainline</h3>
      <p>Which is not the same as nothing landed: a patch applied by a
      maintainer keeps the author line it was posted with, so a different
      address on the Signed-off-by would be counted there and not
      here.</p></div></div></div>`;
  }
  return grid("findmerged", a.merged, [
    { key: "short", label: "Commit", cls: "mono nowrap", csv: (r) => r.short,
      render: (r) => `<a href="${esc(r.url)}" target="_blank"
        rel="noreferrer">${mark(r.short)}</a>` },
    { key: "subject", label: "Subject", cls: "subject", width: "50%",
      csv: (r) => r.subject, render: (r) => mark(r.subject) },
    { key: "tag", label: "Released in", sortable: true,
      csv: (r) => r.tag,
      render: (r) => r.tag
        ? `<span class="pill ${r.shipped ? "green" : "cyan"}"
             title="${r.shipped ? "shipped in this release"
                                : "merged since the last release, so this is "
                                  + "the one it is due in"}">${esc(r.tag)}${
             r.shipped ? "" : " (due)"}</span>`
        : `<span class="muted">\u2014</span>` },
    { key: "date", label: "Merged",
      render: (r) => `<span class="nowrap muted">${esc(r.date)}</span>` },
  ], {
    title: "In Linus' tree",
    subtitle: a.more.merged
      ? "the " + a.merged.length + " most recent; there are more"
      : a.merged.length + " commits",
    placeholder: "Search a commit or a subject\u2026",
    searchIn: (r) => [r.subject, r.short, r.tag].join(" "),
    rowKey: (r) => r.commit,
    sort: "date", dir: "desc", per: 15,
  });
}

function queuedPanel(a) {
  if (!a.sources.git || !a.in_next.length) return "";
  return `<div class="panel wide" data-reveal>
    <header><h2>Waiting in linux-next</h2><div class="spacer"></div>
      <span class="pill cyan">${a.counts.in_next}</span></header>
    <div class="body">
      <p class="hint" style="margin-top:0">Queued for a merge window and not
      in mainline yet.</p>
      <ul class="asklist plain">${a.in_next.map((c) =>
        `<li><a href="${esc(c.url)}" target="_blank" rel="noreferrer"
           class="mono">${esc(c.short)}</a> ${esc(c.subject)}
           <span class="muted">${esc(c.date)}</span></li>`).join("")}</ul>
    </div></div>`;
}

function treeSweep(a, deep) {
  /* The sweep works out what is waiting by subtracting what is already in
     mainline, so without mainline there is nothing it could honestly say. */
  if (!a.sources.git) return "";
  const body = () => {
    if (deep.state === "running") {
      const done = deep.done || 0, total = deep.total || 80;
      return `<p class="hint" style="margin-top:0">Asking each maintainer
        tree in turn. git.kernel.org takes its time over an author search,
        so this runs behind the page &mdash; the rest of it still works.</p>
        <div class="prog"><div class="fill" style="width:${
          pct(done, total)}"></div></div>
        <p class="hint">${done} of ${total} trees</p>`;
    }
    if (deep.state === "done") {
      if (!deep.trees.length) {
        return `<p class="hint" style="margin-top:0">Nothing of theirs is
          sitting in a maintainer tree right now. Anything taken has already
          moved on to linux-next or to mainline.</p>`;
      }
      return `<p class="hint" style="margin-top:0">Taken by a maintainer and
        not yet in mainline. Checked ${esc(ago(deep.at))}.</p>`
        + `<table class="plain"><thead><tr><th>Tree</th><th>Waiting</th>
           <th>Also in next</th><th>Newest</th></tr></thead><tbody>`
        + deep.trees.map((t) => `<tr class="main">
            <td><span class="pill blue">${esc(t.tree)}</span></td>
            <td>${t.count}</td><td class="muted">${t.in_next}</td>
            <td class="muted nowrap">${esc(t.newest)}</td></tr>
            <tr class="sub"><td colspan="4"><div class="sub2">${
              t.commits.slice(0, 4).map((c) =>
                `<a href="${esc(c.url)}" target="_blank" rel="noreferrer"
                   class="mono">${esc(c.short)}</a> ${esc(c.subject)}`)
                .join("<br>")}</div></td></tr>`).join("")
        + `</tbody></table>`;
    }
    return `<p class="hint" style="margin-top:0">There are ${
      deep.total || 80} maintainer trees on git.kernel.org. Asking each one
      whether it is holding their work takes a few minutes, so it is not
      done unless you ask for it. The answer is kept for six hours and
      shared, so the next person to look costs nothing.</p>
      <div class="btnrow"><button class="btn" ${act(findDeep)}>Check the
      maintainer trees</button></div>`;
  };
  return `<div class="panel wide" data-reveal>
    <header><h2>In a maintainer tree</h2><div class="spacer"></div>
      ${deep.state === "done"
        ? `<span class="pill blue">${deep.count}</span>` : ""}
    </header><div class="body">${body()}</div></div>`;
}

/* ------------------------------------------------------ who to send to */

async function findSend() {
  const q = (S.find.mq || "").trim();
  if (!q) { toast("Type a file path or a subsystem first.", "bad"); return; }
  S.find.mbusy = true;
  S.find.merror = "";
  render();
  const r = await fetch("/api/discover/maintainers?q=" + encodeURIComponent(q),
                        { cache: "no-store" });
  const out = await r.json().catch(() => ({}));
  S.find.mbusy = false;
  if (!out.ok) {
    S.find.maint = null;
    S.find.merror = out.error || "That lookup did not work.";
  } else {
    S.find.maint = out;
  }
  render();
}

function findSendView() {
  const f = S.find;
  const head = searchRow("mq", findSend, f.mq,
                         "drivers/gpu/drm/amd/  or  net/ipv4/tcp.c  or  btrfs",
                         f.mbusy, "Find them");
  const blurb = `<p class="hint" style="margin:0 0 14px">Read straight out of
    MAINTAINERS in mainline, by the same rules
    <code>scripts/get_maintainer.pl</code> uses. A path out of a diff works
    as it is, <code>a/</code> and all.</p>`;

  if (f.merror) {
    return head + blurb + `<div class="panel wide"><div class="body">
      <div class="empty"><h3>${esc(f.merror)}</h3></div></div></div>`;
  }
  if (!f.maint) {
    return head + blurb + `<div class="panel wide"><div class="body">
      <div class="empty tall">
        <h3>Who should receive this patch?</h3>
        <p>Give it a file you changed and it names the maintainers to
        address, the reviewers and lists to copy, whether anybody is
        actually looking after that corner, and which tree it goes
        through.</p>
      </div></div></div>`;
  }
  return head + sendResult(f.maint);
}

function addrLine(list) {
  return list.map((p) => p.name ? `${p.name} <${p.email}>` : p.email)
             .join(", ");
}

function people(list, kind) {
  if (!list.length) return "";
  return `<div class="sendbox">
    <div class="sendhead"><b>${esc(kind)}</b>
      <button class="link" ${act(copyText, addrLine(list))}>copy</button></div>
    <ul class="asklist plain">${list.map((p) => `<li>${
      p.list ? `<span class="pill grey">list</span> ` : ""}${
      p.name ? `<b>${esc(p.name)}</b> ` : ""}<span class="mono">${
      esc(p.email)}</span>${p.note
        ? ` <span class="tag">${esc(p.note)}</span>` : ""}</li>`).join("")}</ul>
  </div>`;
}

function sendResult(m) {
  if (!m.sections.length) {
    return `<div class="panel wide"><div class="body"><div class="empty">
      <h3>Nothing in MAINTAINERS claims that</h3>
      <p>${m.path ? `No section lists <code>${esc(m.path)}</code>.`
                  : `No subsystem is named after "${esc(m.query)}".`}
      Try a directory above it, or a word from the subsystem's
      title.</p></div></div></div>`;
  }
  const send = m.send;
  const head = `<div class="panel wide" data-reveal>
    <header><h2>Send it to</h2><div class="spacer"></div>
      <button class="btn sm" ${act(copyText,
        "To: " + addrLine(send.to) + "\nCc: " + addrLine(send.cc))}>Copy
        both</button></header>
    <div class="body">
      <p class="hint" style="margin-top:0">${m.path
        ? `For <code>${esc(m.path)}</code>.`
        : `For anything under "${esc(m.query)}".`} Maintainers are
        addressed, reviewers and lists are copied.</p>
      ${people(send.to, "To")}${people(send.cc, "Cc")}
    </div></div>`;

  const sections = m.sections.map((s, i) => `
    <div class="panel wide" data-reveal style="--i:${i + 1}">
      <header><h2>${esc(s.name)}</h2><div class="spacer"></div>
        ${s.status ? `<span class="pill ${
          /Supported|Maintained/i.test(s.status) ? "green"
            : /Orphan|Obsolete/i.test(s.status) ? "red" : "amber"
          }" title="${esc(s.status_means)}">${esc(s.status)}</span>` : ""}
        ${s.catchall ? `<span class="pill grey">catch-all</span>` : ""}
      </header><div class="body">
        <p class="hint" style="margin-top:0">${s.catchall
          ? "The fallback for the whole tree, which is why its list belongs "
            + "on the Cc and its name does not belong on the To."
          : `Matched on <code>${esc(s.why)}</code>.`}${
          s.status_means ? " " + esc(s.status_means) + "." : ""}</p>
        ${people(s.maintainers, "Maintainers")}
        ${people(s.reviewers, "Reviewers")}
        ${s.lists.length ? `<p class="hint">Lists: ${
          s.lists.map((l) => `<span class="mono">${esc(l)}</span>`).join(", ")
        }</p>` : ""}
        ${s.trees.length ? `<p class="hint">Tree: <span class="mono">${
          esc(s.trees[0])}</span></p>` : ""}
        ${s.files.length ? `<p class="hint">Files: ${s.files.map((x) =>
          `<code>${esc(x)}</code>`).join(" ")}</p>` : ""}
      </div></div>`).join("");

  return head + sections;
}

function copyText(text) {
  navigator.clipboard.writeText(text).then(
    () => toast("Copied.", "ok"),
    () => toast("This browser would not let the page copy that.", "bad"));
}

/* --------------------------------------------------------- your picture */

/* The browser does the shrinking.  A phone camera gives four megabytes and a
   26 pixel circle needs none of it, so the file is drawn into a 256 pixel
   square and what leaves this page is the few tens of kilobytes that
   survive.  Read as a data URL rather than an object URL because this page's
   content policy allows data: images and does not allow blob:. */
const AVATAR_PX = 256;

function shrinkPicture(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("That file could not be read."));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("That is not a picture we can read."));
      img.onload = () => {
        /* The middle square of whatever shape they gave us, because a face
           in a circle should not be a squashed face in a circle. */
        const side = Math.min(img.width, img.height);
        if (!side) { reject(new Error("That picture is empty.")); return; }
        const c = document.createElement("canvas");
        c.width = c.height = AVATAR_PX;
        const g = c.getContext("2d");
        g.imageSmoothingQuality = "high";
        g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2,
                    side, side, 0, 0, AVATAR_PX, AVATAR_PX);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function choosePicture() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.addEventListener("change",
      () => resolve((input.files || [])[0] || null));
    input.click();
  });
}

async function changePicture() {
  const file = await choosePicture();
  if (!file) return;
  let url;
  try {
    url = await shrinkPicture(file);
  } catch (e) {
    toast(e.message, "bad");
    return;
  }
  await putPicture(url, "Profile picture set.");
}

async function removePicture() {
  await putPicture("", "Profile picture removed.");
}

async function putPicture(url, said) {
  const r = await post("/api/avatar", { image: url });
  const body = await r.json();
  if (!body.ok) {
    toast(body.error || "That picture was not accepted.", "bad");
    return;
  }
  S.status.account = Object.assign({}, S.status.account || {},
                                   { avatar: body.avatar });
  toast(said, "ok");
  showWho("");
  render();
}

/* Their face if they gave us one, their initial if they did not.  The tag in
   the URL is the picture's own fingerprint, so replacing it asks for a
   different address and no stale one is left showing. */
function avatarFace(acc, label) {
  const tag = (acc || {}).avatar;
  return tag
    ? `<img src="/api/avatar?v=${encodeURIComponent(tag)}" alt="">`
    : esc(((label || "?")[0] || "?").toUpperCase());
}

/* The account, reached from the menu in the corner rather than the sidebar,
   because it is about you rather than about your patches. */
function viewProfile() {
  const st = S.status;
  const p = (S.data && S.data.profile) || {};
  const acc = st.account || {};
  const who = acc.email || p.email || st.who || "";
  const on = st.privacy || [];
  const cloud = st.mode === "cloud";
  const keys = (S.providers || []).filter((x) => x.ready);
  /* The name on the account is the one they gave; the one on the patches is
     whatever they put in their Signed-off-by. They are usually the same. */
  const called = acc.name || p.name || who.split("@")[0] || "Signed in";

  return `<div class="row2" style="align-items:start">
    <div class="panel" data-reveal><header><h2>You</h2></header><div class="body">
      <div class="profilehead">
        <button class="avatar big shot" ${act(changePicture)}
                title="${acc.avatar ? "Choose a different picture"
                                    : "Add a picture"}">
          ${avatarFace(acc, called)}<span class="shotlb">Change</span>
        </button>
        <div>
          <h3>${esc(called)}</h3>
          <p class="hint" style="margin:2px 0 0">${esc(who)}</p>
          <p class="hint" style="margin:6px 0 0">
            <button class="link" ${act(changePicture)}>${
              acc.avatar ? "Replace picture" : "Add a picture"}</button>${
            acc.avatar
              ? ` &middot; <button class="link" ${act(removePicture)}>Remove</button>`
              : ""}
          </p>
        </div>
      </div>
      <dl class="kv">
        ${acc.username ? `<dt>Username</dt><dd>${esc(acc.username)}</dd>` : ""}
        ${acc.since ? `<dt>Account since</dt><dd>${esc(ago(acc.since))}</dd>` : ""}
        <dt>Patches tracked</dt><dd>${(S.data && S.data.patches || []).length}</dd>
        <dt>Last collected</dt><dd>${st.generated ? esc(ago(st.generated)) : "not yet"}</dd>
        <dt>Assistant keys</dt>
        <dd>${keys.length ? keys.map((k) => esc(k.label)).join(", ")
                          : "none of your own yet"}</dd>
      </dl>
      ${p.lore ? `<p class="hint">Your posts:
        <a href="${esc(p.lore)}" target="_blank" rel="noopener">on lore</a></p>` : ""}
      <div class="btnrow">
        <button class="btn" ${act(() => go("settings"))}>Settings</button>
        <button class="btn danger" ${act(signOut)}>Sign out</button>
      </div>
    </div></div>

    <div class="panel" data-reveal><header><h2>Your data on this server</h2>
      <div class="spacer"></div>
      <span class="pill ${cloud ? "green" : "grey"}">${esc(st.mode || "local")}</span>
    </header><div class="body">
      <ul class="asklist plain">
        <li>Your patches, notes and API keys live in a directory of your own.
            Nobody else who signs in can reach them.</li>
        <li>Your API keys are encrypted where they sit, and are only ever used
            for your own questions and your own collections.</li>
        <li>${on.includes("reviewer addresses masked")
              ? "Reviewer addresses are masked to <code>a***@domain</code> before they leave this machine."
              : "Reviewer addresses are shown in full, because this is running on your own machine."}</li>
        <li>Nothing is ever written to a kernel mailing list. It only reads.</li>
      </ul>
      <p class="hint">Signing out clears this browser's session. Your collected
      patches stay, and are here when you sign back in.</p>
    </div></div>
  </div>`;
}

/* ------------------------------------------------------------------ tabs */

function tabs(id, items, initial) {
  if (!S.tabs[id]) S.tabs[id] = initial || items[0][0];
  const on = S.tabs[id];
  const bar = `<div class="tabs" data-reveal>` + items.map(([k, label]) =>
    `<button class="${k === on ? "on" : ""}" ${act(TAB, id, k)}>${esc(label)}</button>`
  ).join("") + `</div>`;
  return bar + (items.find((i) => i[0] === on) || items[0])[2]();
}

function TAB(id, k) { S.tabs[id] = k; render(); }

/* -------------------------------------------------------------- the AI */

/* Just enough markdown for what the model actually sends back. */
function md(text) {
  const lines = String(text).split("\n");
  let out = "", list = null;
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { close(); continue; }
    let m;
    if ((m = /^#{1,4}\s+(.*)$/.exec(l))) { close(); out += `<h4>${inline(m[1])}</h4>`; }
    else if ((m = /^[-*]\s+(.*)$/.exec(l))) {
      if (list !== "ul") { close(); out += "<ul>"; list = "ul"; }
      out += `<li>${inline(m[1])}</li>`;
    } else if ((m = /^\d+[.)]\s+(.*)$/.exec(l))) {
      if (list !== "ol") { close(); out += "<ol>"; list = "ol"; }
      out += `<li>${inline(m[1])}</li>`;
    } else { close(); out += `<p>${inline(l)}</p>`; }
  }
  close();
  return out;
}

function askAboutRespin(g) {
  askAI(`My series "${g.name}" on ${g.tree} had changes requested on `
    + `${plural(g.patches.length, "patch", "patches")}: `
    + g.patches.map((p) => `"${p.subject}" (${p.state_detail || "no detail"})`)
        .join("; ")
    + `. I sent v${g.sent}. What should change in v${g.sent + 1}, and how `
    + `should I word the cover letter?`);
}

function askAboutThread(t) {
  askAI(`About the thread "${t.series}" on ${t.tree || "the list"}: ${
    t.last_from} wrote "${(t.excerpt || "").slice(0, 200)}". What does that ask `
    + `for, and what should my reply say?`);
}

function aiReady() {
  return (S.providers || []).some((p) => p.ready);
}

function askAI(prompt) {
  openAI();
  /* With no key there is nothing to ask, and the welcome panel already says
     so and offers the way to fix it.  Sending anyway would only produce an
     error the user could have been spared. */
  if (prompt && aiReady()) {
    $("aiinput").value = prompt;
    sendAI();
  } else if (prompt) {
    $("aiinput").value = prompt;
    $("aiinput").focus();
  } else {
    $("aiinput").focus();
  }
}

/* ------------------------------------------------- one patch, in full */

/* Clicking a subject used to throw you at lore in another tab, which knows
   nothing about the versions you sent, where it landed, or whether anybody
   is waiting on you.  All of that is here, so show it here, and keep lore a
   click away for the original. */
function openThread(id, subject) {
  S.thread = { id, subject, loading: true, data: null, error: "" };
  $("thread").classList.add("open");
  $("thscrim").classList.add("on");
  drawThread();
  fetch("/api/thread?id=" + encodeURIComponent(id),
        { headers: { "X-Requested-With": "patchvane" } })
    .then((r) => r.json())
    .then((b) => {
      if (!S.thread || S.thread.id !== id) return;   /* they moved on */
      if (b.ok) S.thread.data = b;
      else S.thread.error = b.error || "could not read that thread";
      S.thread.loading = false;
      drawThread();
    })
    .catch((e) => {
      if (!S.thread || S.thread.id !== id) return;
      S.thread.error = String(e.message || e);
      S.thread.loading = false;
      drawThread();
    });
}

function closeThread() {
  const d = $("thread");
  const inside = d.contains(document.activeElement);
  d.classList.remove("open");
  $("thscrim").classList.remove("on");
  S.thread = null;
  if (inside) document.body.focus();
}

/* A subject that opens the patch here rather than leaving the page. */
function subj(id, text, cls) {
  return `<a class="${cls || ""}" href="#" ${act(openThread, id, text)}
    >${mark(text)}</a>`;
}

function drawThread() {
  const box = $("thbody");
  const st = S.thread;
  if (!st) return;
  $("thtitle").textContent = st.subject || "Patch";
  const lore = $("thlore");

  if (st.loading) {
    $("thsub").textContent = "reading the thread\u2026";
    lore.style.display = "none";
    box.innerHTML = `<div class="thwait"><span class="spin"></span>
      Fetching the conversation from lore\u2026</div>`;
    return;
  }
  if (st.error) {
    $("thsub").textContent = "";
    lore.style.display = "none";
    box.innerHTML = `<div class="thwait">${esc(st.error)}</div>`;
    return;
  }

  const b = st.data, p = b.patch || {}, msgs = b.thread || [];
  lore.style.display = "";
  lore.href = p.lore || "#";
  $("thtitle").textContent = p.subject || st.subject || "Patch";
  $("thsub").textContent = [p.tree_hint || p.list, state(p.state).label]
    .filter(Boolean).join(" \u00b7 ");

  box.innerHTML = whatsNeeded(p, msgs) + whereItLanded(p)
    + versionHistory(p) + inThisSeries(b.series, p)
    + conversation(msgs, b.why);
}

/* The question anybody opening a patch is actually asking. */
function whatsNeeded(p, msgs) {
  const landed = (p.landed || []).length > 0;
  const last = [...msgs].reverse().find((m) => !m.mine && !m.bot);
  const tookIt = msgs.find((m) => m.applied && !m.mine);
  const ACCEPTED = ["accepted", "in-tree", "in-next", "merged", "queued",
                    "awaiting-upstream"];
  let head, note, cls;

  if (p.in_mainline) {
    head = "In mainline. Nothing to do.";
    note = "It is in Linus' tree. The thread is finished with you.";
    cls = "green";
  } else if (landed || p.in_next || ACCEPTED.includes(p.state) || tookIt) {
    /* Whoever said it, however they phrased it, and whatever they called
       the branch. Replying "thanks for applying" is noise on a kernel
       list, so the answer here is to do nothing. */
    const who = tookIt ? tookIt.who : (last ? last.who : "");
    head = p.in_next ? "Applied, and in linux-next. Nothing to do."
                     : "Applied. Nothing to do.";
    note = `${who ? esc(who) + " took this" : "A maintainer took this"}.
      Kernel lists treat a thank-you reply as noise, so no answer is
      expected. Watch for it in linux-next and then in mainline.`;
    cls = "green";
  } else if (p.state === "changes-requested") {
    head = "A new version is owed.";
    note = "Somebody asked for changes. Address them and send the next version.";
    cls = "amber";
  } else if (p.state === "superseded") {
    head = "Replaced by a later version.";
    note = "A newer version of this patch took over. Nothing to do here.";
    cls = "grey";
  } else if (p.state === "rejected") {
    head = "Turned down.";
    note = "A maintainer said no. Read the reason below before resending.";
    cls = "red";
  } else if (last && last.tags.length && !last.question) {
    head = "Reviewed, waiting on a maintainer.";
    note = `${esc(last.who)} gave ${last.tags.map(esc).join(", ")} and asked
      nothing. Nothing is owed from you; it needs a maintainer to pick it up.`;
    cls = "blue";
  } else if (last) {
    head = "Somebody is waiting on you.";
    note = `${esc(last.who)} wrote last${last.question ? " and asked a question"
      : ""}. Their message is below.`;
    cls = "amber";
  } else {
    head = "Posted, nothing back yet.";
    note = "No reply has come in. Give it a week or two before a ping.";
    cls = "grey";
  }
  return `<div class="thneed ${cls}"><h3>${head}</h3><p>${note}</p></div>`;
}

function whereItLanded(p) {
  const rows = p.landed || [];
  if (!rows.length) return "";
  return `<section class="thsec"><h3>The commit</h3>
    <table class="thtable"><tbody>${rows.map((l) => `<tr>
      <td class="thtree">${esc(l.tree)}</td>
      <td><a href="${esc(l.url)}" target="_blank" rel="noreferrer"
        ><code>${esc(l.short)}</code></a></td>
      <td class="thdim">${l.author ? esc(l.author) : ""}</td>
      <td class="thdim">${l.date ? esc(l.date.slice(0, 10)) : ""}</td>
    </tr>`).join("")}</tbody></table></section>`;
}

function versionHistory(p) {
  const vs = p.versions || [];
  if (vs.length < 2) return "";
  return `<section class="thsec"><h3>Versions you sent</h3>
    <ol class="thvers">${vs.map((v) => `<li class="${
      v.version === p.version ? "on" : ""}">
      <b>v${esc(String(v.version))}</b>
      <span class="thdim">${esc((v.date || "").slice(0, 10))}</span>
      ${v.version === p.version ? '<span class="pill grey">this one</span>' : ""}
      ${v.lore ? `<a href="${esc(v.lore)}" target="_blank"
        rel="noreferrer">lore</a>` : ""}
    </li>`).join("")}</ol></section>`;
}

function inThisSeries(rows, p) {
  if (!rows || rows.length < 2) return "";
  return `<section class="thsec"><h3>The rest of the series</h3>
    <ul class="thseries">${rows.map((r) => `<li class="${
      r.msgid === p.msgid ? "on" : ""}">
      ${pill(r.state)}
      ${esc(r.subject || "")}
    </li>`).join("")}</ul></section>`;
}

function conversation(msgs, why) {
  if (!msgs.length) {
    return `<section class="thsec"><h3>The conversation</h3>
      <p class="hint">${esc(why || "Nothing came back on this one yet.")}</p>
      </section>`;
  }
  return `<section class="thsec"><h3>The conversation
    <span class="thdim">${msgs.length} message${msgs.length > 1 ? "s" : ""}</span>
    </h3>
    ${why ? `<p class="hint">${esc(why)}</p>` : ""}
    <div class="thmsgs">${msgs.map((m) => `<article class="thmsg${
      m.mine ? " mine" : ""}${m.bot ? " bot" : ""}">
      <header>
        <b>${esc(m.who || "somebody")}</b>
        ${m.mine ? '<span class="pill grey">you</span>' : ""}
        ${m.bot ? '<span class="pill grey">bot</span>' : ""}
        ${m.applied ? '<span class="pill green">applied it</span>' : ""}
        ${(m.tags || []).map((t) => `<span class="pill blue">${esc(t)}</span>`).join("")}
        <span class="spacer"></span>
        <span class="thdim">${esc(ago(m.date))}</span>
        ${m.lore ? `<a href="${esc(m.lore)}" target="_blank"
          rel="noreferrer" title="this message on lore">\u2197</a>` : ""}
      </header>
      <pre>${esc(trimQuotes(m.body || ""))}</pre>
    </article>`).join("")}</div></section>`;
}

/* A reply that quotes the whole patch back is mostly the patch.  Keep the
   short quotes, which are the thing being answered, and fold the rest. */
function trimQuotes(body) {
  const out = [];
  let run = 0;
  for (const line of body.split("\n")) {
    if (line.startsWith(">")) {
      run++;
      if (run <= 6) out.push(line);
      else if (run === 7) out.push("\u2026");
      continue;
    }
    run = 0;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function openAI() {
  $("ai").classList.add("open");
  $("aiscrim").classList.add("on");
  drawChat();
  /* Fetched when the drawer opens rather than when the panel does, so the
     count under the clock is right the first time it is looked at. */
  loadChats().then(() => { if (S.histOpen) drawHistory(); });
}

function closeAI() {
  const drawer = $("ai");
  /* Focus has to come back out with the drawer.  Left behind in the textarea
     it swallows every keyboard shortcut, since they all stand down while you
     are typing, and the page goes quietly dead. */
  const inside = drawer.contains(document.activeElement);
  drawer.classList.remove("open");
  $("aiscrim").classList.remove("on");
  if (inside) $("aibtn").focus();
}

function openAISettings() {
  closeAI();
  go("settings");
  TAB("set", "ai");
}

/* The picker sits with the input rather than in the header, because it is
   part of asking rather than part of the drawer. */
function modelPicker() {
  const ready = (S.providers || []).filter((p) => p.ready);
  if (!ready.length) return "";
  const on = S.model || "";
  const current = on ? ready.find((p) => p.id === on) : null;
  return `<div class="picker">
    <button class="pk ${S.pickOpen ? "on" : ""}" ${act(togglePicker)}
      title="Which model answers">
      <span class="sparkle">\u2726</span>${
        current ? esc(current.label) : "Auto"}<i>\u25BE</i></button>
    ${S.pickOpen ? `<div class="pkmenu">
      <button class="${on ? "" : "on"}" ${act(pickModel, "")}>
        <strong>Auto</strong><i>best fit for the question, with fallback</i></button>
      ${ready.map((p) => `<button class="${on === p.id ? "on" : ""}"
        ${act(pickModel, p.id)}>
        <strong>${esc(p.label)}</strong><i>${esc(p.model)}</i></button>`).join("")}
      <button class="more" ${act(openAISettings)}>Add another model\u2026</button>
    </div>` : ""}
  </div>`;
}

function togglePicker() { S.pickOpen = !S.pickOpen; drawChat(); }

function pickModel(id) {
  S.model = id;
  S.pickOpen = false;
  drawChat();
  $("aiinput").focus();
}

/* A provider asked twice should be named once, and saying "tried Gemini"
   when Gemini is the only one configured tells you nothing you want to hear
   twice over. */
function tried(trail) {
  const names = [...new Set((trail || []).map((t) => t.label))];
  if (names.length < 2) return "";
  return `<div class="via">tried ${names.map(esc).join(", ")}</div>`;
}

function via(m) {
  if (!m.provider) return "";
  const fell = (m.fellback || []).filter((t) => t.detail);
  return `<div class="via">
    answered by <strong>${esc(m.label || m.provider)}</strong>
    <span class="mono">${esc(m.model || "")}</span>
    ${fell.length ? `<span class="fell" title="${esc(
        fell.map((t) => `${t.label}: ${t.detail}`).join("\n"))}">
        after ${fell.map((t) => esc(t.label)).join(", ")} could not</span>` : ""}
  </div>`;
}

function drawChat() {
  const box = $("aichat");
  if (!box) return;
  const form = $("aipicker");
  if (form) form.innerHTML = modelPicker();

  if (!S.chat.length) {
    const ready = (S.providers || []).filter((p) => p.ready);
    box.innerHTML = `<div class="aiwelcome">
      <div class="aimark">\u2726</div>
      <h3>Ask about your own patches</h3>
      <p>${ready.length
        ? `I can see everything this dashboard collected: totals, per tree
           numbers, landed commits, open threads and review tags. ${
           ready.length > 1
             ? `${plural(ready.length, "model")} are set up, and the one that
                suits the question gets it.`
             : `Using ${esc(ready[0].label)}.`}`
        : "No model has an API key yet. Add one and come back."}</p>
      <div class="aisug">${ready.length
        ? SUGGESTIONS.map((s) => `<button ${act(askAI, s)}>${esc(s)}</button>`).join("")
        : `<button class="btn primary" ${act(openAISettings)}>Open settings</button>`}
      </div></div>`;
    box.scrollTop = 0;
    return;
  }

  box.innerHTML = S.chat.map((m) => m.role === "user"
    ? `<div class="msg me">${esc(m.text)}</div>`
    : m.error
      ? `<div class="msg bot err">${esc(m.text)}${m.key
          ? ` <button class="link" ${act(openAISettings)}>Add a key</button>` : ""}${
        m.retry ? ` <button class="link" ${act(retryAsk, m.retry)}>Ask again</button>` : ""}
         ${tried(m.trail)}</div>`
      : `<div class="msg bot">${md(m.text)}
         <div class="msgfoot">${via(m)}<span class="spacer"></span>
           <button class="link" ${act(copyText, m.text)}>copy</button>
         </div></div>`).join("")
    + (S.asking ? `<div class="msg bot thinking"><i></i><i></i><i></i></div>` : "");
  box.scrollTop = box.scrollHeight;
}

async function sendAI() {
  const input = $("aiinput");
  const q = input.value.trim();
  if (!q || S.asking) return;
  input.value = "";
  input.style.height = "auto";
  S.chat.push({ role: "user", text: q });
  S.asking = true;
  drawChat();
  try {
    /* The conversation so far goes with the question, so a follow-up like
       "what about the other one" reaches the model with the thing it refers
       to still in view.  Errors and the turn just pushed are left out. */
    const past = S.chat
      .slice(0, -1)
      .filter((m) => !m.error && m.text)
      .slice(-12)
      .map((m) => ({ role: m.role === "bot" ? "assistant" : "user",
                     text: m.text }));
    const r = await post("/api/ai",
                         { prompt: q, provider: S.model || "", history: past });
    if (r.status === 401) { location.href = "/login"; return; }
    const body = await r.json();
    S.chat.push(body.ok
      ? { role: "bot", text: body.text, provider: body.provider,
          model: body.model, label: body.label, fellback: body.fellback,
          trail: body.trail }
      : { role: "bot", error: true, key: !!body.needs_key, trail: body.trail,
          text: body.error || "The assistant failed." });
  } catch (e) {
    /* "Failed to fetch" is all the browser says when the connection drops,
       usually because the dashboard was restarted mid-question.  Say what
       that means, and offer the question back rather than losing it. */
    S.chat.push({ role: "bot", error: true, retry: q,
      text: "Could not reach the dashboard. It may have restarted while the "
          + "question was in flight." });
  } finally {
    S.asking = false;
    drawChat();
    rememberChat();
  }
}

/* Put a question that never got through back in the box. */
function retryAsk(text) {
  const input = $("aiinput");
  input.value = text;
  S.chat = S.chat.filter((m) => m.retry !== text);
  drawChat();
  sendAI();
}

async function loadProviders() {
  try {
    const r = await fetch("/api/ai/providers", { cache: "no-store" });
    if (!r.ok) return;
    const body = await r.json();
    S.providers = body.providers || [];
    S.zones = body.zones || {};
    S.status.can_store_key = body.can_store_key;
  } catch (e) { /* the settings page will just show nothing configured */ }
}

function label(id) {
  const p = (S.providers || []).find((x) => x.id === id);
  return p ? p.label : id;
}

async function saveKey(id) {
  const box = document.querySelector(`[data-key="${id}"]`);
  const key = box ? box.value.trim() : "";
  if (!key) { toast("Paste a key first.", "bad"); return; }
  const rem = document.querySelector(`[data-remember="${id}"]`);
  const r = await post("/api/ai/key",
    { provider: id, key, remember: rem ? rem.checked : false });
  const body = await r.json();
  S.providers = body.providers || S.providers;
  S.status.ai = (body.ready || []).length > 0;
  S.status.ai_ready = body.ready || [];
  S.keyOpen = "";
  /* The server asked the key what it runs and picked out of that, so the
     list is already known here and opening the dropdown costs nothing. */
  if (body.models && body.models.length) {
    S.modelList = S.modelList || {};
    S.modelList[id] = { models: body.models, best: body.model,
                        spares: (S.modelList[id] || {}).spares || [] };
  }
  toast(body.stored ? `${label(id)} key saved and remembered.`
                    : `${label(id)} key set for this session.`, "ok");
  if (body.model) {
    toast(body.guessed
      ? `${label(id)} would not list its models, so this is set to `
        + `${body.model} as a guess. Change it if it is wrong.`
      : `Set to ${body.model}, the strongest of the ${body.models.length} `
        + `your key reaches.`, body.guessed ? "" : "ok");
  }
  render();
  testKey(id);          // say straight away whether it actually works
}

async function clearKey(id) {
  const r = await post("/api/ai/key", { provider: id, key: "", remember: true });
  const body = await r.json();
  S.providers = body.providers || S.providers;
  S.status.ai = (body.ready || []).length > 0;
  S.status.ai_ready = body.ready || [];
  S.keyTest = null;
  if (S.model === id) S.model = "";
  toast(`${label(id)} key removed.`);
  render();
}

async function testKey(id) {
  S.keyTest = { id, pending: true, msg: "asking " + label(id) + "\u2026" };
  render();
  try {
    const r = await post("/api/ai/test", { provider: id });
    const body = await r.json();
    if (body.ok && body.switched_from) {
      /* The model that was set is gone, and one that works has been put in
         its place.  Say so plainly rather than silently answering on a
         different model than the one on screen. */
      S.keyTest = { id, ok: true, moved: true,
        msg: `${esc(body.switched_from)} is not available on your key any `
           + `more, so this is now set to ${esc(body.model)}, which answered.` };
      await loadProviders();   // the card must show the model it moved to
    } else {
      S.keyTest = body.ok
        ? { id, ok: true, msg: `${label(id)} answered on ${body.model}.` }
        : { id, ok: false, msg: body.error || "No answer." };
    }
  } catch (e) {
    S.keyTest = { id, ok: false, msg: String(e.message || e) };
  }
  render();
}

/* ------------------------------------------------------------------ shell */

function until(iso) {
  const secs = (new Date(iso).getTime() - Date.now()) / 1000;
  if (secs < 60) return "less than a minute";
  const mins = Math.round(secs / 60);
  return mins < 90 ? plural(mins, "minute") : plural(Math.round(mins / 60), "hour");
}

function navCounts() {
  const d = S.data;
  if (!d) return {};
  const k = d.kpis;
  const owed = owedWork();
  return {
    owed: owed.replies.threads.length + owed.respin.series.length,
    patches: k.patches,
    outcomes: d.merged.length + owed.dropped.length,
    discussions: d.threads.length,
  };
}

function renderNav() {
  const counts = navCounts();
  $("nav").innerHTML = NAV.map(([id, label, icon], i) => `
    <button class="navitem ${S.view === id ? "active" : ""} ${
      !S.data && NO_DATA_NEEDED[id] ? "ready" : ""}" ${act(go, id)}>
      <span class="ico">${icon}</span><span class="lb">${esc(label)}</span>
      ${counts[id] !== undefined ? `<span class="count">${counts[id]}</span>`
        : `<span class="kbd">${i + 1}</span>`}
    </button>`).join("");
}

const VIEWS = {
  overview:    ["Overview", "where everything stands today", viewOverview],
  owed:        ["Your turn", "replies to write and versions to respin", viewOwed],
  patches:     ["Patches", "everything you have posted", viewPatches],
  outcomes:    ["Outcomes", "what landed and what did not", viewOutcomes],
  discussions: ["Discussions", "threads, people and review tags", viewDiscussions],
  insights:    ["Insights", "activity, subsystems and trees", viewInsights],
  discover:    ["Discover", "anybody else's patches, and who to send yours to",
                viewDiscover],
  settings:    ["Settings", "refresh, assistant and sources", viewSettings],
  profile:     ["Profile", "your account and what this server keeps", viewProfile],
};

/* Older links and bookmarks should not land on an error. */
const MOVED = { landed: "outcomes", watchlist: "owed" };

function go(view) {
  view = MOVED[view] || view;
  if (!VIEWS[view]) view = "overview";
  if (S.view === view) { render(); return; }
  S.view = view;
  location.hash = view;
  transition(() => render());
  const content = document.querySelector(".content");
  if (content) content.scrollTo({ top: 0, behavior: MOTION.ok ? "smooth" : "auto" });
}

function signOut() { snapDrop(); location.href = "/logout"; }

/* Start again, with nothing carried over: the whole conversation goes to the
   model with every question, so an old thread is not just clutter on screen,
   it is context the next answer will be built on.

   Nothing is lost by this.  What was on screen was written down as it
   happened and is one click away under the clock. */
function newChat() {
  S.chat = [];
  S.chatId = "";
  S.histOpen = false;
  S.chatWho = (S.status && S.status.who) || "";
  drawChat();
  const input = $("aiinput");
  if (input) { input.value = ""; input.style.height = "auto"; input.focus(); }
}

/* ------------------------------------------------- conversations kept

   A question worth asking once is worth finding again: what somebody asked
   the assistant about a series three weeks ago is often exactly what they
   want when the next version comes back.  So a conversation is written down
   as it happens, on the server rather than in this browser, because the
   dashboard is reachable from more than one machine and a history that only
   exists on the laptop is a history that is missing whenever it matters. */

async function loadChats() {
  try {
    const r = await fetch("/api/ai/chats", { cache: "no-store" });
    if (!r.ok) return;
    const body = await r.json();
    S.chats = body.chats || [];
  } catch (e) { /* the drawer works without the list */ }
}

/* Written down after each answer rather than on the way out: a browser that
   is closed mid-conversation, or a laptop that sleeps and never comes back,
   would otherwise take the whole thing with it. */
async function rememberChat() {
  const turns = S.chat.filter((m) => !m.error && m.text)
    .map((m) => ({ role: m.role, text: m.text, provider: m.provider || "",
                   model: m.model || "", label: m.label || "" }));
  if (!turns.length) return;
  try {
    const r = await post("/api/ai/chat", { id: S.chatId, turns });
    const body = await r.json();
    if (!body.ok) return;
    S.chatId = body.id;
    S.chats = body.chats || S.chats;
    if (S.histOpen) drawHistory();
  } catch (e) { /* it stays on screen either way */ }
}

function toggleHistory() {
  S.histOpen = !S.histOpen;
  $("aipast").setAttribute("aria-expanded", S.histOpen ? "true" : "false");
  if (S.histOpen) loadChats().then(drawHistory);
  drawHistory();
}

function drawHistory() {
  const box = $("aihist");
  if (!box) return;
  box.classList.toggle("hidden", !S.histOpen);
  if (!S.histOpen) return;

  if (!S.chats.length) {
    box.innerHTML = `<div class="histempty">
      <p>Nothing asked yet. Conversations turn up here as you have them, and
      stay until you remove them.</p></div>`;
    return;
  }
  box.innerHTML = `<div class="histhead">
      <strong>${plural(S.chats.length, "conversation")}</strong>
      <span class="spacer"></span>
      <button class="link" ${act(forgetChats)}>Remove all</button>
    </div>
    <div class="histlist">${S.chats.map((c) => `
      <div class="hitem ${c.id === S.chatId ? "on" : ""}">
        <button class="hopen" ${act(openChat, c.id)}>
          <strong>${esc(c.title)}</strong>
          <i>${esc(ago(c.updated))} \u00b7 ${plural(c.turns, "turn")}</i>
        </button>
        <button class="hdrop iconbtn" ${act(forgetChat, c.id)}
          title="Remove this conversation">\u00d7</button>
      </div>`).join("")}</div>`;
}

async function openChat(id) {
  try {
    const r = await fetch("/api/ai/chat?id=" + encodeURIComponent(id),
                          { cache: "no-store" });
    const body = await r.json();
    if (!body.ok) { toast(body.error || "Could not open that.", "bad"); return; }
    S.chat = (body.chat.turns || []).map(
      (t) => ({ role: t.role, text: t.text, provider: t.provider,
                model: t.model, label: t.label }));
    S.chatId = body.chat.id;
    S.histOpen = false;
    $("aipast").setAttribute("aria-expanded", "false");
    drawHistory();
    drawChat();
    const input = $("aiinput");
    if (input) input.focus();
  } catch (e) {
    toast("Could not reach the dashboard.", "bad");
  }
}

async function forgetChat(id) {
  try {
    const r = await post("/api/ai/chat/forget", { id });
    const body = await r.json();
    S.chats = body.chats || [];
    /* Removing the one being read leaves the words on screen but nothing
       behind them, so it becomes a new conversation rather than quietly
       writing itself back on the next answer. */
    if (id === S.chatId) S.chatId = "";
    drawHistory();
  } catch (e) {
    toast("Could not reach the dashboard.", "bad");
  }
}

async function forgetChats() {
  if (!confirm("Remove every saved conversation? This cannot be undone."))
    return;
  try {
    const r = await post("/api/ai/chat/forget", { all: true });
    const body = await r.json();
    S.chats = body.chats || [];
    S.chatId = "";
    drawHistory();
    toast("History cleared.");
  } catch (e) {
    toast("Could not reach the dashboard.", "bad");
  }
}

/* Signing in as somebody else must not inherit their conversation. */
function chatBelongsToMe() {
  const who = (S.status && S.status.who) || "";
  if (S.chatWho && S.chatWho !== who) {
    S.chat = [];
    S.chatId = "";
    S.chats = [];
    S.histOpen = false;
    S.asking = false;
    /* Somebody else is signed in now; the page kept for the last one goes
       with their conversation. */
    snapDrop();
  }
  S.chatWho = who;
}

function toggleWhoMenu(want) {
  const menu = $("whomenu");
  const open = want === undefined ? menu.classList.contains("hidden") : want;
  menu.classList.toggle("hidden", !open);
  $("whobtn").setAttribute("aria-expanded", open ? "true" : "false");
}

/* The one view that is not about the person looking at it, and so is the
   one view that works before their first collection has finished -- or when
   it has failed, which is when being able to reach something is worth the
   most. */
const NO_DATA_NEEDED = { discover: true };

/* keepFocus: the id of a grid whose search box should keep the caret. */
function render(keepFocus) {
  if (!S.data && !NO_DATA_NEEDED[S.view]) return;
  const [title, sub, fn] = VIEWS[S.view] || VIEWS.overview;
  $("viewtitle").textContent = title;
  $("viewsub").textContent = sub;

  /* Typing in a search box re-renders on every keystroke, so remember where
     the caret was before the markup underneath it is thrown away. */
  let caret = null;
  if (keepFocus) {
    const old = document.querySelector(`[data-search="${keepFocus}"]`);
    if (old) caret = old.selectionStart;
  }

  /* Every closure in here belongs to the markup about to be replaced. */
  CMD.clear();
  CHARTS.clear();

  /* Pressing a button inside a view rebuilds that view, and replaying the
     entrance animation and jumping to the top every time makes a toggle look
     like the page reloaded.  Animate on arrival; after that, redraw in
     place. */
  const arriving = S.painted !== S.view;
  /* Which element actually scrolls depends on the window: below a certain
     height the whole document does, above it the content column does.  Put
     both back. */
  const scroller = document.querySelector(".content");
  const wasAt = !arriving && scroller ? scroller.scrollTop : 0;
  const wasWin = arriving ? 0 : window.scrollY;

  const el = $("view");
  el.innerHTML = fn();
  mountCharts();
  runCounters();
  if (arriving) reveal(el);
  else el.querySelectorAll("[data-reveal]").forEach((n) => n.classList.add("seen"));
  renderNav();
  drawStamp();
  S.painted = S.view;
  if (scroller && wasAt) scroller.scrollTop = wasAt;
  if (wasWin) window.scrollTo(0, wasWin);

  /* The drawer lives outside the view but its buttons were registered in the
     same map, so it has to be redrawn alongside. */
  if ($("ai").classList.contains("open")) drawChat();

  if (keepFocus) {
    const box = document.querySelector(`[data-search="${keepFocus}"]`);
    if (box) {
      const at = caret === null ? box.value.length : caret;
      box.focus();
      box.setSelectionRange(at, at);
    }
  }
}

function drawStamp() {
  if (!S.data) return;
  const st = S.status;
  $("stamp").textContent = "updated " + ago(S.data.generated);
  $("live").className = "dot " + (S.busy || st.running ? "working"
    : S.offline || st.auto === false ? "paused" : st.last_error ? "bad" : "live");
  /* Some of what is on screen may be older than the rest, because a host
     could not be reached and the last known answer was used instead.  That
     is better than reporting nothing, but only if it is said out loud. */
  const old = S.data.stale;
  const busy = S.busy || st.running;
  $("stampsub").textContent = S.offline ? "saved snapshot"
    : busy ? ""
    : S.stale ? "new data ready"
    : st.last_error ? "last run failed"
    : old ? "some of this is from an earlier run"
    : st.auto === false ? "auto refresh off"
    : st.next_run ? "next in " + until(st.next_run) : "";
  drawMiniProgress(busy && !S.offline ? st.progress : null);
  $("stampsub").title = old
    ? "Could not reach " + old.hosts.join(", ") + " on the last run, so the "
      + "answers from before were kept rather than reporting nothing."
    : "";
  showWho(S.data.profile.email || "");
}

/* How far the running collection has got, in the corner where the words
   "collecting now" used to be.  Passed null when nothing is running, which
   takes the bar off the page rather than leaving it at whatever it last
   reached. */
function drawMiniProgress(p) {
  const bar = $("minibar"), fill = $("minifill"), pct = $("minipct");
  if (!bar) return;
  if (!p) {
    bar.hidden = true;
    /* Back to nothing, so the next collection grows from the left rather
       than picking up where the previous one stopped. */
    fill.style.width = "0";
    bar.classList.remove("waiting");
    return;
  }
  bar.hidden = false;
  const n = typeof p.percent === "number" ? Math.max(0, Math.min(100, p.percent)) : null;
  /* The collector counts what it has read, not what it has left, so there
     is a stretch at the start with nothing to divide by. */
  bar.classList.toggle("waiting", n === null);
  if (n === null) {
    pct.textContent = "";
    bar.removeAttribute("aria-valuenow");
  } else {
    fill.style.width = n + "%";
    pct.textContent = n + "%";
    bar.setAttribute("aria-valuenow", n);
  }
  bar.title = p.label
    ? p.label + (p.total ? " \u2014 " + p.done + " of " + p.total : "")
    : "Collecting";
}

/* Whose dashboard this is.  Taken from the session rather than the collected
   file, so it is right even before anything has been collected.

   Their name if the account has one, because "Hemanth" in the corner reads
   as your own page in a way that an email address does not.  The address is
   still what identifies it, and is a hover away. */
function showWho(email) {
  const acc = (S.status && S.status.account) || {};
  const who = email || (S.status && S.status.who) || "";
  const label = acc.first || acc.username || who;
  $("userlabel").textContent = label;
  $("userlabel").parentElement.title = who || "Account";
  $("avatar").innerHTML = avatarFace(acc, label);
}

/* ------------------------------------------------------------------ data */

/* The last page this browser was shown, so a sign-in opens on the dashboard
   instead of on nothing while a megabyte of JSON is on its way.

   localStorage belongs to the browser profile rather than to whoever is
   signed in, and it outlives the session, so a snapshot is kept under the
   address it was collected for and thrown away on the way out and on any
   change of account. Two people sharing a machine must not find each
   other's patches in here. It is only ever a head start: what the server
   says replaces it as soon as it arrives. */
const SNAP = "patchvane:snapshot:";

function snapDrop() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.indexOf(SNAP) === 0) localStorage.removeItem(k);
    }
  } catch (e) { /* storage turned off: there is nothing to drop */ }
}

function snapSave(who, data) {
  if (!who || !data) return;
  try {
    localStorage.setItem(SNAP + who, JSON.stringify(data));
  } catch (e) {
    /* Over quota, or storage refused. This is an optimisation and nothing
       depends on it, so clear out rather than leave half a page behind. */
    snapDrop();
  }
}

function snapLoad(who) {
  if (!who) return null;
  try {
    const raw = localStorage.getItem(SNAP + who);
    if (!raw) return null;
    const d = JSON.parse(raw);
    /* Only this person's, and only if it still looks like a dashboard:
       the shape changes between versions and a half-read one would throw
       somewhere deep in a view. */
    return d && d.profile && d.kpis && d.threads ? d : null;
  } catch (e) {
    return null;
  }
}

async function load() {
  const r = await fetch("data.json?t=" + Date.now(), { cache: "no-store" });
  if (r.status === 401) { location.href = "/login"; return false; }
  if (r.status === 404) {
    /* Signed in, but nothing collected for this person yet.  On a first
       sign-in that is normal and already being worked on. */
    const body = await r.json().catch(() => ({}));
    /* The server has nothing for this person, so a snapshot of theirs is
       no longer true. */
    snapDrop();
    firstRun(body.who || "", body.collecting, body.progress);
    return false;
  }
  if (!r.ok) throw new Error("Could not read the collected patches.");
  S.data = await r.json();
  snapSave((S.status && S.status.who) || (S.data.profile || {}).email, S.data);
  return true;
}

/* The first time somebody signs in there is nothing to show yet, because
   reading a few hundred threads off lore takes minutes.  Say that, keep
   checking, and open the dashboard the moment it is there. */
function firstRun(who, collecting, progress) {
  document.body.classList.add("firstrun");
  showWho(who);
  $("bar").classList.add("hidden");
  $("viewtitle").textContent = "Setting up";
  $("viewsub").textContent = who || "";
  $("view").innerHTML = `<div class="panel wide"><div class="body">
    <div class="empty tall">
      <h3>Reading your patches from the archives</h3>
      <p>This is the first time this address has signed in, so everything
      has to be fetched: every message you posted, every thread, and which
      trees they reached.</p>
      <div class="prog waiting" id="prog"><div class="fill" id="progfill"></div></div>
      <p class="progline">
        <span id="progwhat">${collecting === false
          ? "Starting the collection" : "Getting ready"}</span>
        <span class="pct" id="progpct"></span>
      </p>
      <p class="muted" id="firstwait">This page opens by itself when it is
      ready, so there is nothing to do but wait.</p>
      <div class="btnrow" style="justify-content:center">
        <button class="btn" ${act(go, "discover")}>Try Discover meanwhile</button>
      </div>
      <p class="hint">Discover reads the public archives rather than your
      collection, so it works already.</p>
    </div>
  </div></div>`;
  drawProgress(progress);

  /* Poll faster than the collection changes, so the bar moves in step with
     the work rather than in five second jumps. */
  const began = Date.now();
  const tick = setInterval(async () => {
    try {
      const r = await fetch("data.json?t=" + Date.now(), { cache: "no-store" });
      if (r.status === 401) { location.href = "/login"; return; }
      if (r.ok) {
        clearInterval(tick);
        S.data = await r.json();
        snapSave((S.status && S.status.who) || who, S.data);
        document.body.classList.remove("firstrun");
        S.view = location.hash.replace("#", "") || "overview";
        S.painted = "";
        render();
        return;
      }
      const body = await r.json().catch(() => ({}));
      drawProgress(body.progress, Math.round((Date.now() - began) / 1000));
      if (body.failed && !body.collecting) {
        $("progwhat").textContent = "The archives could not be reached";
        $("firstwait").textContent = "Trying again shortly.";
      }
    } catch (e) { /* the server going away for a moment is fine */ }
  }, 1500);
}

/* The collector counts its own work, so the bar is a real share of it and
   never runs ahead of what has been done. */
function drawProgress(p, waited) {
  const bar = $("prog"), fill = $("progfill");
  if (!bar || !fill) return;
  const pct = p && typeof p.percent === "number" ? p.percent : null;
  bar.classList.toggle("waiting", pct === null);
  if (pct !== null) fill.style.width = pct + "%";
  if (p && p.label) {
    const of = p.total ? ` ${p.done} of ${p.total}` : "";
    $("progwhat").textContent = p.label + of + (p.note && p.total
      ? "" : p.note ? " \u2014 " + p.note : "");
  }
  $("progpct").textContent = pct === null ? "" : pct + "%";
  if (waited !== undefined) {
    const mins = Math.floor(waited / 60);
    $("firstwait").textContent = (mins
      ? "waiting " + plural(mins, "minute")
      : "waiting " + waited + " seconds") + " so far";
  }
}

/* A scheduled collection must not rearrange the page under someone's hands.
   Anything typed, any open chooser, and the moment right after a click all
   count as busy; the new numbers wait a few seconds for a gap. */
let LAST_TOUCH = 0;
document.addEventListener("pointerdown", () => { LAST_TOUCH = Date.now(); }, true);

function interacting() {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
  if (document.querySelector(".menu")) return true;
  if ($("ai").classList.contains("open")) return true;
  return Date.now() - LAST_TOUCH < 2500;
}

/* The theme the server is holding for this person, applied once when the
   first status arrives. Only then: after that this machine's own toggle is
   the newer opinion, and adopting the saved one again would undo it. */
function adoptTheme(theme) {
  if (S.themeSettled || !theme) return;
  S.themeSettled = true;
  if (document.documentElement.dataset.theme === theme) return;
  transition(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("patchvane-theme", theme);
    render();
  });
}

/* Twenty seconds is the right distance apart for "has anything changed",
   and far too far apart for a bar that is supposed to be moving, which
   would step once and look stuck between. So the loop closes up while a
   collection is running and opens out again when it finishes. */
function pollLoop() {
  const soon = () => (S.busy || (S.status && S.status.running)) ? 2000 : 20000;
  const again = () => setTimeout(async () => {
    await pollStatus();
    again();
  }, soon());
  again();
}

async function pollStatus() {
  if (S.offline) return;
  try {
    const r = await fetch("/api/status", { cache: "no-store" });
    if (r.status === 401) { location.href = "/login"; return; }
    const st = await r.json();
    const was = S.status.running;
    S.status = st;
    adoptTheme(st.theme);
    chatBelongsToMe();
    if (S.data && st.generated && st.generated !== S.data.generated) {
      await load();
      S.stale = true;
    }
    if (S.stale && !interacting()) {
      S.stale = false;
      render();
      if (was) toast("Fresh data collected.", "ok");
    } else {
      drawStamp();
    }
  } catch (e) { /* the server going away for a moment is fine */ }
}

async function doRefresh(full) {
  if (S.offline) {
    toast("This is a saved snapshot. Run the server to collect fresh data.");
    return;
  }
  if (S.busy) { toast("A collection is already running."); return; }
  S.busy = true;
  $("refresh").classList.add("spin");
  $("bar").classList.remove("hidden");
  drawStamp();
  toast(full ? "Full rescan started, this takes a few minutes\u2026"
             : "Reading lore, patchwork and git.kernel.org\u2026");
  try {
    const r = await post("/api/refresh" + (full ? "?full=1" : ""));
    if (r.status === 401) { location.href = "/login"; return; }
    const body = await r.json();
    if (!body.ok) throw new Error(body.error || "the collector failed");
    await load();
    render();
    toast(body.summary, "ok");
  } catch (e) {
    toast(String(e.message || e), "bad");
  } finally {
    S.busy = false;
    $("refresh").classList.remove("spin");
    $("bar").classList.add("hidden");
    pollStatus();
  }
}

async function pushAuto(on, interval) {
  const r = await post("/api/auto", { on, interval });
  const body = await r.json();
  S.status.auto = body.auto;
  S.status.interval = body.interval;
  await pollStatus();
  render();
  return body;
}

async function setAuto(on) {
  const body = await pushAuto(on, S.status.interval || 15);
  toast(on ? `Refreshing every ${prettyInterval(body.interval)}.`
           : "Automatic refresh is off.");
}

/* The one thing this dashboard will send unasked, so it is off until it is
   asked for and says plainly what turning it on means. */
async function setMergedMail(on) {
  try {
    const r = await post("/api/prefs", { merged_mail: !!on });
    const body = await r.json();
    if (!body.ok) { toast(body.error || "Could not save that.", "bad"); return; }
    S.status.merged_mail = !!(body.prefs && body.prefs.merged_mail);
    toast(S.status.merged_mail
      ? "We will write when a patch of yours reaches mainline."
      : "No more mail about patches landing.");
    render();
  } catch (e) {
    toast("Could not reach the dashboard.", "bad");
  }
}

async function setInterval_(minutes) {
  const body = await pushAuto(true, minutes);
  toast(`Refreshing every ${prettyInterval(body.interval)}.`);
}

async function applyInterval() {
  const box = $("ivnum");
  const v = Number(box ? box.value : 0);
  if (!v || v < 1 || v > 10080) {
    toast("Pick anything from 1 minute to 10080 (a week).", "bad");
    return;
  }
  await setInterval_(v);
}

/* ------------------------------------------------------------------ boot */

function setTheme(next) {
  if (document.documentElement.dataset.theme === next) return;
  transition(() => {
    document.documentElement.dataset.theme = next;
    /* Locally so the next paint on this machine has it before the server
       answers, and on the server so the next machine starts the same way. */
    localStorage.setItem("patchvane-theme", next);
    render();
  });
  post("/api/prefs", { theme: next }).catch(() => {});
}

function toggleTheme() {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
}

function keys(e) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (e.key === "Escape") {
    if ($("help").classList.contains("on")) { $("help").classList.remove("on"); return; }
    if ($("thread").classList.contains("open")) { closeThread(); return; }
    if ($("ai").classList.contains("open")) { closeAI(); return; }
    if (typing) e.target.blur();
    return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "/") {
    const box = document.querySelector("[data-search]");
    if (box) { e.preventDefault(); box.focus(); }
  } else if (e.key === "a") { e.preventDefault(); askAI(); }
  else if (e.key === "r") { e.preventDefault(); doRefresh(false); }
  else if (e.key === "t") { toggleTheme(); }
  else if (e.key === "?") { $("help").classList.toggle("on"); }
  else if (e.key === "g") {
    e.preventDefault();
    go("discover");
    /* Straight into the box: pressing g to look somebody up and then having
       to reach for the mouse is half a shortcut. */
    setTimeout(() => {
      const box = document.querySelector("input[data-find]");
      if (box) box.focus();
    }, 60);
  } else if (/^[1-7]$/.test(e.key)) { go(NAV[+e.key - 1][0]); }
}

async function boot() {
  document.documentElement.dataset.theme =
    localStorage.getItem("patchvane-theme") || "dark";

  bindHandlers();

  /* The shell lives outside every render, so it is wired once and directly
     rather than through the command map, which render() empties. */
  $("refresh").addEventListener("click", () => doRefresh(false));
  $("theme").addEventListener("click", toggleTheme);
  $("aibtn").addEventListener("click", () => askAI());
  $("aiclose").addEventListener("click", closeAI);
  $("ainew").addEventListener("click", newChat);
  $("aipast").addEventListener("click", toggleHistory);
  $("aiscrim").addEventListener("click", closeAI);
  $("thclose").addEventListener("click", closeThread);
  $("thscrim").addEventListener("click", closeThread);
  $("aisend").addEventListener("click", sendAI);
  $("helpopen").addEventListener("click", () => $("help").classList.add("on"));
  $("helpclose").addEventListener("click", () => $("help").classList.remove("on"));
  /* The corner menu: everything about you rather than about your patches,
     which is why Settings moved here off the sidebar. Sign out lives behind
     it too, rather than one stray click away from ending the session. */
  $("whobtn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleWhoMenu();
  });
  $("whomenu").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-who]");
    if (!b) return;
    toggleWhoMenu(false);
    if (b.dataset.who === "signout") signOut();
    else go(b.dataset.who);
  });
  /* A menu that will not close is worse than no menu. */
  document.addEventListener("click", () => toggleWhoMenu(false));
  /* Enter in a Discover search box means search, because pressing it and
     having nothing happen is what every search box has taught people not to
     expect. */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const box = e.target.closest && e.target.closest("input[data-find]");
    if (!box) return;
    e.preventDefault();
    S.find[box.dataset.find] = box.value;
    (box.dataset.find === "q" ? findGo : findSend)();
  });
  $("aiinput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAI(); }
  });
  $("aiinput").addEventListener("input", (e) => {
    e.target.style.height = "auto";
    e.target.style.height = Math.min(140, e.target.scrollHeight) + "px";
  });
  document.addEventListener("keydown", keys);

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(mountCharts, 150);
  });
  window.addEventListener("hashchange", () => {
    const v = location.hash.replace("#", "");
    if (v && v !== S.view) go(v);
  });

  /* collect.py --standalone bakes the data into a single file that answers to
     nobody: no server, no sign-in, no refreshing. */
  S.offline = !!window.__DATA__;
  if (S.offline) document.body.classList.add("offline");

  await pollStatus();
  if (!S.offline) await loadProviders();

  /* Put the last known page up straight away, before asking for a fresh
     one, so signing in lands on the dashboard rather than on a spinner. */
  const cached = S.offline ? null : snapLoad((S.status && S.status.who) || "");
  if (cached) {
    S.data = cached;
    S.view = location.hash.replace("#", "") || "overview";
    render();
    $("bar").classList.add("hidden");
  }

  try {
    if (S.offline) S.data = window.__DATA__;
    else if (!(await load())) return;
  } catch (e) {
    /* A snapshot on screen is better than replacing it with an error. */
    if (cached) {
      toast("Showing the last page saved in this browser.");
      return;
    }
    $("view").innerHTML = `<div class="panel"><div class="empty">
      <div class="emptyicon">\u23F3</div><p>${esc(e.message)}</p></div></div>`;
    $("bar").classList.add("hidden");
    return;
  }

  S.view = location.hash.replace("#", "") || "overview";
  render();
  $("bar").classList.add("hidden");

  if (!S.offline) {
    setInterval(drawStamp, 20000);
    pollLoop();
  }
}

boot();
