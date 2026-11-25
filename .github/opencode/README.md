# Starting the outside AI's runs

Claude starts a run of the OpenCode task workflow (`.github/workflows/opencode-task.yml`) by saving a
start note on the live branch: `start/<task>.txt`, where `<task>` is a task on `TASKS.md` (the part
after `task/`). A push that adds or changes start notes starts one run for each, at most 5 a push and 3
at a time. The owner asked for this on 25 Nov 2026 ("I want you to do everything"), so that runs no
longer wait for a tap on Run workflow; every start is a commit in the history.

A note's text:

- lines starting `#` are for the history only (when it was started, and why);
- a line `model: opencode-go/<model>` picks the model (else the one the task names in `TASKS.md`);
- a line `base: <a commit's full id>` starts the copy at that commit instead of the live branch: a
  second try then starts from its first try's work (as Claude's checker applied it), and fixes what
  the review found;
- everything else goes to the AI as the reviewer's notes on its last try. A first try has none.

The runs work on a read-only copy and push nothing: their changes come back as files attached to the
run, which Claude reviews, tests and, if good, puts live. Starting a note never changes the site
(`deploy-pages.yml` ignores this folder).

## Budget

The runs use the owner's OpenCode Go plan ("Go Plus"). It has a 5-hour, a weekly and a monthly
limit and no paid credit: at a limit the runs stop, and nothing more is charged. On 25 Nov 2026 the
week stood at 63 % used (it resets on Sundays), so Claude starts at most 2 runs at a time.

The same day the owner asked about a $10 add-on for unlimited smaller models. Claude advised against
it for now. The slow step is reviewing the runs' work, which uses the owner's Claude limit, and weaker
models' work takes more review. Look again if runs start hitting the weekly limit before Sunday.
"Unlimited" model services from other companies are never connected to the project.
