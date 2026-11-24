const el = id => document.getElementById(id);
let session;
let hiddenAt;
const hosted = el("welcome").dataset;
const storageKey = "focus-monitor:pending:" + location.pathname;
let pending = [];
let sending = false;
let storageAvailable = true;
if (hosted.ticket) {
  el("notice").textContent = "Your teacher receives your name and the fullscreen and visibility events for this attempt.";
  el("name-field").hidden = false;
  el("full-name").disabled = false;
  const templateValues = [...new URL(hosted.form).searchParams.values()];
  if (templateValues.includes("FIRST_NAME") && templateValues.includes("LAST_NAME")) {
    const hint = document.createElement("small");
    hint.id = "name-format";
    hint.textContent = "For a compound name, separate given names and family name with a comma (e.g. Giuseppe Antonio, De Luca).";
    el("full-name").after(hint);
    el("full-name").setAttribute("aria-describedby", hint.id);
  }
  el("form-choice").hidden = true;
  el("url").disabled = true;
  try {
    pending = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(pending)) pending = [];
  } catch { pending = []; }
  window.addEventListener("online", flush);
  setInterval(flush, 4000);
  flush();
}
function persist() {
  try {
    if (pending.length) sessionStorage.setItem(storageKey, JSON.stringify(pending));
    else sessionStorage.removeItem(storageKey);
  } catch { storageAvailable = false; }
}
async function flush() {
  if (sending || !pending.length) return;
  sending = true;
  try {
    while (pending.length) {
      const { ticket, event } = pending[0];
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + ticket },
        body: JSON.stringify(event),
        keepalive: true
      });
      if (!response.ok) throw new Error(String(response.status));
      pending.shift();
      persist();
    }
    el("delivery").hidden = true;
  } catch {
    el("delivery").textContent = storageAvailable
      ? "Events awaiting delivery. Keep this tab open to retry."
      : "Events awaiting delivery in memory. Keep this page open to retry.";
    el("delivery").hidden = false;
  } finally { sending = false; }
}
const sharedForm = new URLSearchParams(location.hash.slice(1)).get("form");
if (sharedForm) el("url").value = sharedForm;

function recordEvent(type, durationMs) {
  const event = { type, timestamp: new Date().toISOString() };
  if (durationMs !== undefined) event.durationMs = durationMs;
  if (type === "Session started" && hosted.ticket) event.fullName = session.fullName;
  session.events.push(event);
  if (hosted.ticket) {
    pending.push({ ticket: hosted.ticket, event: { ...event, student: session.student, seq: session.events.length } });
    persist();
    flush();
  }
}

async function enterFullscreen() {
  try {
    await document.documentElement.requestFullscreen();
  } catch {
    el("status").textContent = "Fullscreen unavailable. The quiz can continue.";
    el("resume").hidden = false;
  }
}

function prefillStudentFields(url, fullName, attempt) {
  const parts = fullName.match(/^(.+?),\s*(.+)$/u) || fullName.match(/^(\S+)\s+(.+)$/u);
  const values = new Map([
    ["FIRST_NAME", parts ? parts[1].trim() : fullName],
    ["LAST_NAME", parts ? parts[2].trim() : ""],
    ["MONITOR_ATTEMPT", attempt]
  ]);
  for (const [key, marker] of [...url.searchParams]) {
    if (!/^entry\.\d+$/.test(key)) continue;
    if (values.has(marker)) url.searchParams.set(key, values.get(marker));
    else url.searchParams.delete(key);
  }
}

el("setup").addEventListener("submit", event => {
  event.preventDefault();
  const url = new URL(hosted.form || el("url").value);
  if (url.origin !== "https://docs.google.com" || !/^\/forms\/d\/(?:e\/)?[\w-]+\/viewform\/?$/.test(url.pathname)) {
    el("error").textContent = "Paste the full docs.google.com respondent link ending in /viewform.";
    return;
  }
  const student = hosted.ticket?.split(".")[0];
  const fullName = hosted.ticket ? el("full-name").value.trim() : "";
  if (hosted.ticket && (!fullName || /[\x00-\x1f\x7f-\x9f]/u.test(fullName))) {
    el("error").textContent = "Enter your first and last name.";
    el("full-name").focus();
    return;
  }
  if (student) prefillStudentFields(url, fullName, student);
  session = { events: [], student, fullName };
  hiddenAt = null;
  recordEvent("Session started");
  url.searchParams.set("embedded", "true");
  el("quiz").src = url.href;
  el("welcome").hidden = true;
  el("exam").hidden = false;
  enterFullscreen();
});

document.addEventListener("fullscreenchange", () => {
  if (!session) return;
  const full = Boolean(document.fullscreenElement);
  el("resume").hidden = full;
  el("status").textContent = full ? "Fullscreen active" : "Fullscreen exited";
  recordEvent(full ? "Entered fullscreen" : "Exited fullscreen");
});

document.addEventListener("visibilitychange", () => {
  if (!session) return;
  if (document.hidden && hiddenAt === null) {
    hiddenAt = performance.now();
    recordEvent("Page hidden");
  } else if (!document.hidden && hiddenAt !== null) {
    recordEvent("Page visible again", Math.round(performance.now() - hiddenAt));
    hiddenAt = null;
  }
});

el("resume").addEventListener("click", enterFullscreen);
el("finish").addEventListener("click", () => {
  if (!confirm("Finish monitoring? Submit your answers inside Google Forms first.")) return;
  recordEvent("Session finished");
  const events = session.events;
  session = null;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  el("log").replaceChildren(...events.map(event => {
    const item = document.createElement("li");
    const duration = event.durationMs === undefined ? "" : " (" + (event.durationMs / 1000).toFixed(1) + " s hidden)";
    item.textContent = event.timestamp + " — " + event.type + duration;
    return item;
  }));
  el("exam").hidden = true;
  el("quiz").removeAttribute("src");
  el("summary").hidden = false;
});
el("again").addEventListener("click", () => location.reload());

window.addEventListener("pagehide", event => {
  if (hosted.ticket && session && !event.persisted) recordEvent("Page closed");
});
