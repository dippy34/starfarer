# Starting the outside AI's runs

Claude starts a run of the OpenCode task workflow (`.github/workflows/opencode-task.yml`) by saving a
start note on the live branch: `start/<task>.txt`, where `<task>` is a task on `TASKS.md` (the part
after `task/`). A push that adds or changes start notes starts one run for each, at most 5 a push and 3
at a time. The owner asked for this on 25 Nov 2026 ("I want you to do everything"), so that runs no
longer wait for a tap on Run workflow; every start is a commit in the history.

A note's text:

- lines starting `#` are for the history only (when it was started, and why);
- a line `model: opencode-go/<model>` picks the model (else the one the task names in `TASKS.md`);
- everything else goes to the AI as the reviewer's notes on its last try. A first try has none.

The runs work on a read-only copy and push nothing: their changes come back as files attached to the
run, which Claude reviews, tests and, if good, puts live. Starting a note never changes the site
(`deploy-pages.yml` ignores this folder).
