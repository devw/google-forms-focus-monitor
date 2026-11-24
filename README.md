# Google Forms Focus Monitor

Google Forms Focus Monitor is a browser-based prototype for teachers who already use Google Forms for quizzes. Students open a link, start their existing quiz in fullscreen, and answer it directly in Google Forms. The goal is to give teachers two pieces of context about an attempt: when the student exited fullscreen and how long the quiz page was hidden. Students would use their usual browser without installing an extension.

**Project status:** static prototype with an in-memory event log.

## Try it locally

Run `python3 -m http.server 8000` from the repository root and open `http://localhost:8000`. Paste the full Google Forms respondent URL and select **Start quiz**. Submit answers inside the form before selecting **Finish session**. Refreshing or closing the tab clears the log.

To share a prefilled quiz link, append `#form=` followed by the URL-encoded respondent URL to the page address. Students can then select **Start quiz** directly.

For GitHub Pages, publish the root of the main branch. A future collector can accept HTTPS POST requests from the Pages origin. For a collector on a teacher’s computer, every student device must be able to reach its address. Use the teacher's network hostname rather than localhost and restrict access to the event reports.

## Student experience

1. A welcome screen explains which events the page records. The student clicks **Start quiz** to request fullscreen.
2. The Google Form opens inside the page. Google Forms handles questions, answers, and submission. If the browser declines the fullscreen request, the page explains what happened.
3. If the student leaves fullscreen, a **Return to fullscreen** button lets them resume. Their attempt continues.
4. After submitting the form, the student clicks **Finish session** on the surrounding page. The prototype should then show the local event history.

## What the browser can report

| Observation | Browser signal | Interpretation |
| --- | --- | --- |
| Fullscreen ended | `fullscreenchange` with no active fullscreen element | Record the time and allow the student to resume. |
| The quiz page was hidden, then visible again | `visibilitychange` | Record both timestamps and calculate the elapsed time. Switching tabs and minimizing the browser can produce the same signal. |

A click inside the embedded form is part of taking the quiz. A window losing focus alone is too ambiguous to flag. The events describe what happened to the quiz page. They cannot identify which other page or application a student used or establish why they left.

## Hosting and teacher reports

The prototype runs entirely on GitHub Pages using HTML, CSS, and vanilla JavaScript. An HTML iframe displays the form, and the surrounding page handles fullscreen and visibility events. Event history for this prototype stays in the student's browser.

A later teacher report would need a private service to receive and store events from different devices. The same GitHub Pages frontend could send a session identifier, event type, and timestamp to that service. Student records and service credentials belong outside the public repository.

## Contributing

The first useful contribution is an end-to-end test with a sample Google Form. Check that selecting an answer produces no event, switching tabs and returning produces a hidden interval, and pressing Escape records a fullscreen exit without losing answers. Testing a form that requires Google sign-in would also help establish which browser configurations the project can support.

[Open a GitHub issue](https://github.com/devw/google-forms-focus-monitor/issues) with the browser, operating system, and observed behavior. Use a sample form and fictitious student data when sharing test results.
