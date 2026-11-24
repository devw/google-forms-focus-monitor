const el = id => document.getElementById(id);
let session;
let hiddenAt;
const sharedForm = new URLSearchParams(location.hash.slice(1)).get("form");
if (sharedForm) el("url").value = sharedForm;

function recordEvent(type, durationMs) {
  const event = { type, timestamp: new Date().toISOString() };
  if (durationMs !== undefined) event.durationMs = durationMs;
  session.events.push(event);
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
  const url = new URL(el("url").value);
  if (url.origin !== "https://docs.google.com" || !/^\/forms\/d\/(?:e\/)?[\w-]+\/viewform\/?$/.test(url.pathname)) {
    el("error").textContent = "Paste the full docs.google.com respondent link ending in /viewform.";
    return;
  }
  session = { events: [] };
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
