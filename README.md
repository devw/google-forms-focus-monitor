# Google Forms Focus Monitor

Run a Google Forms quiz in fullscreen and see when each student's quiz page was hidden. Students use their usual browser. Google Forms handles answers and submission. This project records browser events around the embedded form.

## Self-host a class session

Install Node.js 24 or later on the teacher's computer. The server uses Node's built-in HTTP and SQLite modules.

```sh
git clone https://github.com/devw/google-forms-focus-monitor.git
cd google-forms-focus-monitor
cp .env.example .env
```

Open `.env` in a text editor. Set `FORM_URL` to the full respondent link ending in `/viewform`. For a local trial, leave `HOST=127.0.0.1`. For a classroom on your network, set `HOST=0.0.0.0`. Set `PORT` to an available port (default 8000). Then run:

```sh
node --env-file=.env server.mjs
```

Open the **Quiz** URL printed in the terminal. In LAN mode, share the URL containing the teacher computer's classroom-network IP address. The computer must stay awake, the process must stay running, and the student network and firewall must allow connections to that port. Test from a student device before the quiz. For off-campus access, use a reachable HTTPS reverse proxy or an institutional VPN. Use HTTPS on shared networks to protect traffic in transit.

1. Students open the class link and select **Start quiz**. They enter their personal details only in Google Forms.
2. The session continues after a fullscreen exit. Students can return to fullscreen without reloading the quiz.
3. Students submit their answers inside Google Forms, then select **Finish session** to end monitoring. They can see their own event timeline.
4. The teacher can read all received events at any time in a second terminal on the host:

```sh
node server.mjs --report
```

The report is local to the teacher's machine. It groups events by student and attempt and includes UTC timestamps and hidden durations in milliseconds. Rerun the command to refresh it. The attempt column distinguishes reloads or repeated attempts by the same identifier.

To start with an empty local report, finish any active attempts and close their tabs, then run:

```sh
node server.mjs --clear-report
```

This permanently clears all local events, participant details and imported email addresses. The class link and quiz configuration can be reused. Responses submitted to Google Forms are managed separately.

## Match names from submitted Google Forms responses

Add a short-answer question titled `Monitor attempt` and generate a prefilled respondent URL with `MONITOR_ATTEMPT` as its sample answer. Leave personal information and quiz answers blank. Put the complete link in `FORM_URL`, restart the server, and use the newly printed class link. A plain URL supports anonymous monitoring but provides no join key for importing names.

The monitor prefills the attempt code. Students enter First Name, Last Name and Student ID once inside Google Forms. After submission, download the response CSV, unzip it, and run:

```sh
python3 import_responses.py ~/Downloads/responses.csv
node server.mjs --report
```

The importer matches the exact attempt code and reads available identity columns. Email is optional. Override headers with `--first-name-column`, `--last-name-column`, `--student-id-column`, `--email-column` or `--attempt-column` if they differ. Before import, events appear under the generated attempt code. Duplicate or unknown codes are skipped. Keep the CSV outside the repository.

## Static demo

Publish the repository on GitHub Pages or serve just the two frontend files locally:

```sh
demo_dir=$(mktemp -d)
cp index.html monitor.js "$demo_dir/"
python3 -m http.server 8080 --bind 127.0.0.1 --directory "$demo_dir"
```

Open `http://localhost:8080` and paste a Google Forms respondent URL. To prefill a shared static link, append `#form=` followed by the URL-encoded respondent URL. Events stay in the tab until reload. The static demo makes no event POSTs.

## How monitoring works

| Signal | What it records |
| --- | --- |
| Fullscreen change | Entry or exit, including when a student chooses to return |
| Page visibility | The time the page becomes hidden and the interval until it becomes visible again |
| Session lifecycle | Start, explicit finish, and a best-effort page-close event |

A hidden page may mean that the student switched tabs or minimized the browser. It doesn't identify another website or prove misconduct. Clicking a question inside the form doesn't count as leaving. Opening the original Google Forms URL directly bypasses the surrounding page. Browser crashes or a closed offline tab can leave gaps.

In hosted mode the browser POSTs events to a same-origin endpoint. Each visit receives its own signed write token. Events carry sequence numbers so retries do not duplicate records. Pending events retry while the tab is open and can survive a reload in the same tab when session storage is available. Treat the class link as an invitation: anyone who receives it can start an attempt. The form URL and event endpoint are necessarily visible in the participant's browser.

Local configuration lives in `.env`. The SQLite database and signing key live in `data/`. Git ignores both locations. The server exposes only the class page, frontend script and event intake. The register has no HTTP read endpoint. Keep local files private.

## Contributing

Test with a sample form and fictitious identifiers. Try answering a question, switching tabs, pressing Escape and returning to fullscreen. Verify the event sequence in the local report and confirm that submissions reach Google Forms. For sign-in-required quizzes, check the embedded Google sign-in flow using your students' browser and account settings. Include browser and operating system details when [reporting an issue](https://github.com/devw/google-forms-focus-monitor/issues).
