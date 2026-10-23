import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


BIN = Path(__file__).resolve().parents[1] / 'bin'


class QuestionDedupTests(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.TemporaryDirectory()
        self.env = dict(os.environ, HOME=self.home.name)

    def tearDown(self):
        self.home.cleanup()

    def call(self, tool, *args):
        return subprocess.run([str(BIN / tool), *args], env=self.env, capture_output=True, text=True)

    def questions(self):
        return json.loads(self.call('conductor-ledger', 'get', 'questions').stdout)

    def append(self, q):
        return self.call('conductor-ledger', 'append', 'questions', json.dumps(q))

    def test_same_task_open_question_refused_until_related(self):
        self.assertEqual(self.append(dict(id='Q1', task=2283, question='run APPLY?', status='open')).returncode, 0)
        refused = self.append(dict(id='Q2', task=2283, question='dedup rows?', status='open'))
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('Q1', refused.stderr)
        self.assertEqual(self.append(dict(id='Q2', task=2283, question='dedup rows?', status='open',
                                          distinct_from=['Q1'])).returncode, 0)
        self.assertEqual(self.append(dict(id='Q3', task=9999, question='other task', status='open')).returncode, 0)
        self.assertEqual(len(self.questions()), 3)

    def test_replaces_withdraws_old_question(self):
        self.append(dict(id='Q1', task=1, question='old', status='open'))
        self.assertEqual(self.append(dict(id='Q2', task=1, question='new', status='open', replaces=['Q1'])).returncode, 0)
        old, new = self.questions()
        self.assertEqual((old['status'], old['answer']), ('withdrawn', 'replaced by Q2'))
        self.assertEqual(new['status'], 'open')

    def test_answered_and_closed_questions_ignored(self):
        self.append(dict(id='Q1', task=1, question='done', status='answered'))
        self.assertEqual(self.append(dict(id='Q2', task=1, question='new', status='open')).returncode, 0)
        self.assertEqual(self.append(dict(id='Q3', task=1, question='x', status='answered')).returncode, 0)

    def test_similar_proposal_titles_refused_across_tasks(self):
        args = ['add', '--project', 'VIA', '--what', 'w', '--how', 'h', '--why', 'y']
        first = self.call('conductor-propose', *args, '--title', 'SOC2: narrow kms:* in the Engineers IAM policy', '--from', '10')
        self.assertEqual(first.returncode, 0, first.stderr)
        dup = self.call('conductor-propose', *args, '--title', 'Narrow kms:* in Engineers IAM policy', '--from', '11')
        self.assertNotEqual(dup.returncode, 0)
        other = self.call('conductor-propose', *args, '--title', 'Expire password reset links', '--from', '12')
        self.assertEqual(other.returncode, 0, other.stderr)

    def test_propose_update_rewrites_open_proposal(self):
        qid = self.call('conductor-propose', 'add', '--project', 'VIA', '--title', 'Tighten Engineers policy',
                        '--what', 'kms', '--how', 'h', '--why', 'y', '--from', '5').stdout.strip()
        r = self.call('conductor-propose', 'update', qid, '--what', 'kms and s3', '--add-details', '- protect CloudTrail bucket')
        self.assertEqual(r.returncode, 0, r.stderr)
        q = self.questions()[0]
        self.assertEqual(q['proposal']['what'], 'kms and s3')
        self.assertIn('protect CloudTrail bucket', q['proposal']['details'])
        self.assertIn('What: kms and s3', q['question'])
        self.assertIsNone(q['asked_at'])


if __name__ == '__main__':
    unittest.main()
