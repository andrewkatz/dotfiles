---
name: ynab
description: "Use the local ynab-cli-rs command line client for You Need A Budget (YNAB): budgets/plans, accounts, transactions, categories, payees, scheduled transactions, monthly budget summaries, and safe read-only budget analysis."
---

# YNAB CLI Skill

Use this skill when the user asks about YNAB, budgeting, accounts, categories, payees, scheduled transactions, spending, cash flow, subscriptions, unapproved transactions, or budget/month analysis.

This skill uses the installed `ynab-cli-rs` CLI, whose executable is `ynab`. The CLI calls YNAB budgets "plans".

## Safety and privacy rules

- Treat YNAB data as sensitive personal financial data.
- Prefer aggregate summaries. Do not dump large raw transaction lists unless the user asks.
- Never print, request, or store the YNAB access token in chat, files, shell history, or command arguments.
- Do not use `ynab auth token`; it prints the secret token.
- Do not pass `--token ...`; use `YNAB_ACCESS_TOKEN` or the CLI's stored auth instead.
- Use read-only commands by default.
- Before any budget mutation, account creation, transaction create/update/delete/import, category update/budget change, payee update, scheduled delete, or mutating raw API call:
  1. Explain the exact change.
  2. Run a dry-run/preview when possible.
  3. Ask for explicit confirmation.
  4. Only then run with writes enabled.
- For temporary analysis files, use `/tmp` and delete them when done. Do not write financial exports into the current repo unless the user explicitly asks.

## Setup

The CLI should already be installed globally:

```bash
ynab --version
```

If missing, install it:

```bash
npm install -g ynab-cli-rs
```

Authenticate one of two ways:

```bash
# Option A: interactive/local auth; paste token only into the CLI prompt
ynab auth login --pat

# Option B: environment variable inherited by pi
export YNAB_ACCESS_TOKEN="..."
```

Optionally set a default budget/plan:

```bash
ynab plans list --output-format json --dollars --fields id,name,last_modified_on
ynab plans set-default <plan-id>
# Or for the current shell/session:
export YNAB_PLAN_ID="<plan-id>"
```

## Preferred wrapper

Use the skill-local wrapper for normal work:

```bash
~/.agents/skills/ynab/bin/ynab-safe <command> [args]
```

`ynab-safe` adds JSON output and `--dollars` by default, refuses token-printing/token-argument patterns, and converts known write commands to `--dry-run` unless `YNAB_ALLOW_WRITES=1` is set.

For confirmed writes, first preview without `YNAB_ALLOW_WRITES`, ask the user, then run:

```bash
YNAB_ALLOW_WRITES=1 ~/.agents/skills/ynab/bin/ynab-safe <write-command> [args]
```

## Output and amount conventions

- Use JSON output for parsing: `--output-format json`.
- Use `--dollars` for user-facing reads so amounts are standard currency units.
- Use `--fields` to keep outputs small.
- Use date filters such as `--since-date YYYY-MM-DD` when listing transactions.
- Important: write inputs generally use YNAB milliunits. Convert dollars to milliunits by multiplying by 1000. Examples: `$12.34` => `12340`; `-$12.34` outflow => `-12340`.

## Common read commands

```bash
# Budgets/plans
~/.agents/skills/ynab/bin/ynab-safe plans list --fields id,name,last_modified_on
~/.agents/skills/ynab/bin/ynab-safe plans get --id <plan-id>
~/.agents/skills/ynab/bin/ynab-safe plans settings --id <plan-id>

# Accounts
~/.agents/skills/ynab/bin/ynab-safe accounts list --fields id,name,type,balance,cleared_balance,uncleared_balance,closed,deleted
~/.agents/skills/ynab/bin/ynab-safe accounts get --account-id <account-id>

# Categories and monthly budget
~/.agents/skills/ynab/bin/ynab-safe categories list
~/.agents/skills/ynab/bin/ynab-safe categories get --category-id <category-id>
~/.agents/skills/ynab/bin/ynab-safe months list --fields month,income,budgeted,activity,to_be_budgeted,age_of_money
~/.agents/skills/ynab/bin/ynab-safe months get --month YYYY-MM-01

# Transactions
~/.agents/skills/ynab/bin/ynab-safe transactions list --since-date YYYY-MM-DD --fields id,date,account_name,payee_name,category_name,amount,approved,cleared,memo
~/.agents/skills/ynab/bin/ynab-safe transactions list --type unapproved --fields id,date,account_name,payee_name,category_name,amount,memo
~/.agents/skills/ynab/bin/ynab-safe transactions by-account --account-id <account-id> --since-date YYYY-MM-DD
~/.agents/skills/ynab/bin/ynab-safe transactions by-category --category-id <category-id> --since-date YYYY-MM-DD
~/.agents/skills/ynab/bin/ynab-safe transactions by-payee --payee-id <payee-id> --since-date YYYY-MM-DD
~/.agents/skills/ynab/bin/ynab-safe transactions by-month --month YYYY-MM-01
~/.agents/skills/ynab/bin/ynab-safe transactions search --memo "text"
~/.agents/skills/ynab/bin/ynab-safe transactions search --payee-name "name"

# Payees and scheduled transactions
~/.agents/skills/ynab/bin/ynab-safe payees list --fields id,name,deleted
~/.agents/skills/ynab/bin/ynab-safe payees get --payee-id <payee-id>
~/.agents/skills/ynab/bin/ynab-safe scheduled list --fields id,date,account_name,payee_name,category_name,amount,frequency,next_occurrence
```

## Write command pattern

Always dry-run first and ask for confirmation.

```bash
# Example: create transaction preview. Amount is milliunits.
~/.agents/skills/ynab/bin/ynab-safe transactions create --json '{"account_id":"...","date":"YYYY-MM-DD","amount":-12340,"payee_name":"Example","memo":"...","cleared":"uncleared","approved":false}'

# After explicit confirmation only:
YNAB_ALLOW_WRITES=1 ~/.agents/skills/ynab/bin/ynab-safe transactions create --json '{"account_id":"...","date":"YYYY-MM-DD","amount":-12340,"payee_name":"Example","memo":"...","cleared":"uncleared","approved":false}'
```

Other guarded writes include:

```bash
~/.agents/skills/ynab/bin/ynab-safe transactions update --transaction-id <id> --json '{...}'
~/.agents/skills/ynab/bin/ynab-safe transactions delete --transaction-id <id>
~/.agents/skills/ynab/bin/ynab-safe categories budget --month YYYY-MM-01 --category-id <id> --budgeted <milliunits>
~/.agents/skills/ynab/bin/ynab-safe categories update --category-id <id> --json '{...}'
~/.agents/skills/ynab/bin/ynab-safe api POST /v1/... --body '{...}'
```

## Troubleshooting

```bash
ynab auth status
ynab plans list --output-format json --dollars
ynab <command> --help
ynab schema --help
```

If a command returns too much JSON, rerun with narrower `--fields`, date filters, or pipe to a short Python script for aggregation.
