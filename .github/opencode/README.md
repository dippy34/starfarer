# Starting the outside AI's runs

Claude starts a run of the OpenCode task workflow (`.github/workflows/opencode-task.yml`) by saving a
start note on the live branch: `start/<task>.txt`, where `<task>` is a task on `TASKS.md` (the part
after `task/`). A push that adds or changes start notes starts one run for each, at most 5 a push, one
at a time. The owner asked for this on 25 Nov 2026 ("I want you to do everything"), so that runs no
longer wait for a tap on Run workflow; every start is a commit in the history.

A note's text:

- lines starting `#` are for the history only (when it was started, and why);
- a line `model: opencode-go/<model>` or `model: anthropic/claude-<model>` picks the model (else the
  one the task names in `TASKS.md`);
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
week stood at 63 % used (it resets on Sundays) and the month at 31 % in its first day: about eight
runs of up to 140 minutes. So since then a run lasts at most 80 minutes, one runs at a time, and
Claude starts only small, clear tasks: roughly one every two days until the month resets.

A stop note ends a run within about 5 minutes and keeps its work so far: `stop/<the run's id>.txt`
pushed to the live branch (its text is for the history). Claude cannot cancel a run itself: GitHub
refuses it that permission. The owner can, from the run's page (Cancel workflow).

From 27 Nov 2026 the runs can also use Claude models on the owner's Claude API credits ($200 a
month, which expire at the month's end): a start note's line `model: anthropic/claude-sonnet-5-5` or
`model: anthropic/claude-haiku-5-5`. Their key is the repository secret `ANTHROPIC_API_KEY`, set by
the owner on GitHub (never pasted in a chat). The run puts it in a file outside the repository for
OpenCode alone: the AI's commands don't get it, and any copy in the run's files is blanked before
they are uploaded (they can be downloaded, unlike the masked logs). Such a run uses only Anthropic's
API: no OpenCode sign-in, and its junior is Claude Haiku 5.5. List prices per million tokens: Haiku
5.5 $0.10 in and $0.50 out ($0.50 and $2.50 once a request passes 100,000 tokens), Sonnet 5.5 $2 and
$10; context read again from the cache costs a tenth of that or less. Claude's first estimate was
$5–10 for a Sonnet run. The first real one (task/offline's second try, 27 Nov 2026, run 45920621727)
cost $1.33 for 39 minutes of work: 290,000 tokens written to the cache, 1.9 million read back from
it and 22,000 written by the model. At that rate the $200 is over 100 Sonnet runs a month. The
night of 27 Nov ran four more on Sonnet: task/watch-button $1.28, task/make-anything $4.27 (the whole
80 minutes, a large task), task/time-panel $1.34, task/name-it $1.67; the evening, task/comet-powers
$1.76 (its first step of three) and $3.24 (the other two), task/plain-physics $1.66. Each
run's `usage.txt` holds what it really used. When the credits run out, requests are refused until
the next month's; nothing more is charged unless the owner adds paid credit. Which plan a task uses
is Claude's call, written in its start note: Sonnet for the tasks that most need care, Haiku for
small or wording jobs, the Go plan for the rest.

The same day the owner asked about a $10 add-on for unlimited smaller models. Claude advised against
it for now. The slow step is reviewing the runs' work, which uses the owner's Claude limit, and weaker
models' work takes more review. Look again if runs start hitting the weekly limit before Sunday.
"Unlimited" model services from other companies are never connected to the project.
