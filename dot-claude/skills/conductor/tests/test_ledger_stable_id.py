import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


TOOL = Path(__file__).resolve().parents[1] / 'bin' / 'conductor-ledger'


class StableIdTests(unittest.TestCase):
    def test_reordered_questions_and_compare_failure_preserve_unrelated_state(self):
        with tempfile.TemporaryDirectory() as home:
            env = dict(os.environ, HOME=home)
            def call(*args):
                return subprocess.run([str(TOOL), *args], env=env, capture_output=True, text=True)
            values = [dict(id='Q226', question='migration only', status='open'),
                      dict(id='Q222', question='profile only', status='open')]
            self.assertEqual(call('set', 'questions', json.dumps(values)).returncode, 0)
            expected = json.dumps(dict(question='profile only', status='open'))
            patch = json.dumps(dict(status='answered', answer='Approve this profile'))
            self.assertEqual(call('merge-id', 'questions', 'Q222', expected, patch).returncode, 0)
            after = json.loads(call('get', 'questions').stdout)
            self.assertEqual(after[0], values[0])
            self.assertEqual(after[1]['answer'], 'Approve this profile')
            self.assertNotEqual(call('merge-id', 'questions', 'Q222', expected, patch).returncode, 0)
            self.assertEqual(json.loads(call('get', 'questions').stdout), after)
            self.assertNotEqual(call('merge-id', 'questions', 'Q999', '{}', patch).returncode, 0)
            self.assertNotEqual(call('merge-id', 'questions', 'Q222', '{}', '{"id":"Q223"}').returncode, 0)

    def test_duplicate_ids_refused(self):
        with tempfile.TemporaryDirectory() as home:
            env = dict(os.environ, HOME=home)
            subprocess.run([str(TOOL), 'set', 'questions', '[{"id":"Q1"},{"id":"Q1"}]'], env=env, check=True, capture_output=True)
            result = subprocess.run([str(TOOL), 'merge-id', 'questions', 'Q1', '{}', '{"status":"answered"}'], env=env, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
