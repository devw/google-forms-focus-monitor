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

1. Students open the class link, enter their assigned identifier and select **Start quiz**. The welcome screen explains which events will reach the teacher. An identifier is self-reported.
2. The session continues after a fullscreen exit. Students can return to fullscreen without reloading the quiz.
3. Students submit their answers inside Google Forms, then select **Finish session** to end monitoring. They can see their own event timeline.
4. The teacher can read all received events at any time in a second terminal on the host:

```sh
node server.mjs --report
```

The report is local to the teacher's machine. It groups events by student and attempt and includes UTC timestamps and hidden durations in milliseconds. Rerun the command to refresh it. The attempt column distinguishes reloads or repeated attempts by the same identifier.

## Collect the same personal details locally and in Google Forms

In the form editor, choose **Pre-fill form**. In each short-answer identity question on the first section enter its label as a sample answer (for example, `Nome`, `Cognome`, `Matricola`). Leave all quiz answers empty. Generate the full prefilled link and paste it as the quoted value of `FORM_URL` in the local `.env`. Restart the server and distribute its newly printed class URL. Anyone updating from an earlier clone can keep the existing database and environment file.

The local welcome page creates one required input per prefilled entry. Starting the session records those values in SQLite and substitutes them into the embedded form. Use `First Name`, `Last Name`, and `Student ID` as the sample answers for those three questions. The report displays them as `nome`, `cognome`, and `student_id`. Older ID-only attempts retain their original identifier. Google Forms stores its copy when the student submits the quiz. Students can review or edit prefilled answers inside Google Forms; subsequent edits do not update the local copy. Google's verified account-email collection is separate from these self-reported text fields. A plain respondent URL keeps the single student-code flow.

### Google account email in the teacher report

For a verified address, configure **Collect email addresses → Verified** in Google Forms. Add an optional short-answer question titled `Monitor attempt`. In the prefilled template, enter `MONITOR_ATTEMPT` for this question. Keep the three personal information placeholders above. Paste the new full URL into `.env` and restart the server. The monitor fills the attempt code automatically. Leave any ExtendedForms ID blank in the template; the add-on owns that field.

After submission, export the responses from Google Forms as CSV and unzip the download if needed. Keep this file outside the public repository. Import it into the local database with Python 3:

```sh
python3 import_responses.py ~/Downloads/responses.csv --email-column "Email Address"
node server.mjs --report
```

Use the actual CSV header, such as `Indirizzo email`, for the collected address. The `email_google` column is populated after import. Each match requires one exact attempt code. Edited, missing, conflicting or ambiguous identifiers may prevent a match. The importer trusts the selected CSV column; verify the form's email-collection setting before treating an address as verified. A requested sign-in alone does not expose an account in the embedded page.

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
