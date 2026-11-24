const el = id => document.getElementById(id);
let session;
let hiddenAt;
const hosted = el("welcome").dataset;
const storageKey = "focus-monitor:pending:" + location.pathname;
let pending = [];
let sending = false;
let storageAvailable = true;
if (hosted.ticket) {
  el("notice").textContent = "Start the quiz in fullscreen. Your teacher receives your identifier, fullscreen changes, and the times this quiz page is hidden or visible. Google Forms collects your answers separately.";
  el("identity").hidden = false;
  el("student").required = true;
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

el("setup").addEventListener("submit", event => {
  event.preventDefault();
  const url = new URL(hosted.form || el("url").value);
  if (url.origin !== "https://docs.google.com" || !/^\/forms\/d\/(?:e\/)?[\w-]+\/viewform\/?$/.test(url.pathname)) {
    el("error").textContent = "Paste the full docs.google.com respondent link ending in /viewform.";
    return;
  }
  const student = el("student").value.trim();
  if (hosted.ticket && (!student || /[\u0000-\u001f\u007f-\u009f]/u.test(student))) {
    el("error").textContent = "Enter a valid student identifier.";
    return;
  }
  session = { events: [], student };
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
