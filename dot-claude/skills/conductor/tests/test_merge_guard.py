"""conductor-guard payments gate: finds the PR wherever it sits in `gh pr merge`, fails closed (Q692)."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BIN = Path(__file__).resolve().parents[1] / "bin"

GH = r'''#!/usr/bin/env python3
import json, os, sys
open(os.environ["GH_LOG"], "a").write(" ".join(sys.argv[1:]) + "\n")
pr = sys.argv[3]
files = [{"path": "app/models/payment.rb"}] if pr == "7" else [{"path": "README.md"}]
print(json.dumps({"baseRefName": "main", "headRefOid": "abc1234def", "files": files}))
'''


class MergeGuard(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        for f in ("conductor-guard", "process_guard.py"):
            shutil.copy(BIN / f, self.dir / f)
        stubs = {"conductor-hours": "#!/bin/sh\nexit 0\n",
                 "conductor-ledger": "#!/bin/sh\necho '{}'\n",
                 "gh": GH}
        for name, body in stubs.items():
            (self.dir / name).write_text(body)
            (self.dir / name).chmod(0o755)
        self.log = self.dir / "gh.log"
        self.env = {**os.environ, "PATH": f"{self.dir}:{os.environ['PATH']}", "GH_LOG": str(self.log)}

    def tearDown(self):
        shutil.rmtree(self.dir)

    def run_guard(self, command):
        r = subprocess.run([sys.executable, str(self.dir / "conductor-guard")], env=self.env, text=True,
                           capture_output=True, input=json.dumps({"tool_input": {"command": command}}))
        return r.returncode, r.stderr

    def gh_calls(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_payments_pr_refused_wherever_the_number_is(self):
        for cmd in ["gh pr merge --admin --merge 7", "gh pr merge 7 --admin --merge",
                    "gh pr merge --squash -R acme/via 7 --admin",
                    "gh pr merge https://github.com/acme/via/pull/7 --admin --merge",
                    'gh pr merge --body "fixes 12" --subject 99 --admin 7']:
            with self.subTest(cmd=cmd):
                code, err = self.run_guard(cmd)
                self.assertEqual(code, 2, err)
                self.assertIn("PR #7 merges payments code", err)

    def test_repo_and_url_passed_to_gh(self):
        self.run_guard("gh pr merge --admin --repo acme/via --merge 7")
        self.run_guard("gh pr merge https://github.com/acme/via/pull/7 --admin")
        self.assertEqual(self.gh_calls(), ["pr view 7 --json baseRefName,headRefOid,files -R acme/via"] * 2)

    def test_bare_merge_refused(self):
        for cmd in ["gh pr merge", "gh pr merge --admin --merge", "gh pr merge --admin && echo done",
                    "gh pr merge my-branch --squash"]:
            with self.subTest(cmd=cmd):
                code, err = self.run_guard(cmd)
                self.assertEqual(code, 2, err)
                self.assertIn("refused:", err)
                self.assertIn("PR number", err)

    def test_non_payments_pr_allowed(self):
        for cmd in ["gh pr merge --admin --merge 8", "gh pr merge 8 --squash --delete-branch",
                    "gh pr merge https://github.com/acme/via/pull/8 --admin"]:
            with self.subTest(cmd=cmd):
                self.assertEqual(self.run_guard(cmd)[0], 0)

    def test_payments_ok_allows(self):
        (self.dir / "conductor-ledger").write_text(
            "#!/bin/sh\necho '{\"1\": {\"payments_ok\": {\"question\": \"Q1\", \"pr\": 7, \"sha\": \"abc1234\"}}}'\n")
        self.assertEqual(self.run_guard("gh pr merge --admin --merge 7")[0], 0)

    def test_unrelated_commands_untouched(self):
        self.assertEqual(self.run_guard("echo gh pr view 7")[0], 0)
        self.assertEqual(self.gh_calls(), [])


if __name__ == "__main__":
    unittest.main()
