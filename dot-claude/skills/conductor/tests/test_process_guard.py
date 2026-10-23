import sys
import json
import subprocess
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'bin'))
from process_guard import unsafe_process_command


class ProcessSafety(unittest.TestCase):
    def test_blocked(self):
        commands = [
            'pkill -f vite', 'pkill vite -f', '/usr/bin/pkill -f vite',
            'killall node', '/usr/bin/killall -TERM node',
            'sudo -u andrew /usr/bin/pkill -f vite',
            'env FOO=x command pkill vite', 'nohup killall node',
            'xargs -r kill', 'timeout 2 pkill vite',
            'true && pkill vite', 'echo ok; killall node',
            '(pkill vite)', '{ killall node; }',
            'bash -lc "pkill -f vite"', "sh -c 'sudo killall node'",
            'echo "$(pkill vite)"', 'echo `killall node`',
            'kill 0', 'kill -0 123', 'kill -9 -1', 'kill -- -123',
            'kill $PID', 'kill "$PID"', 'kill $(pgrep vite)',
            'kill 123 456', 'kill -STOP 123', 'kill %1', 'kill',
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertTrue(unsafe_process_command(command))

    def test_hook(self):
        guard = Path(__file__).resolve().parents[1] / "bin" / "conductor-guard"
        for command, code in [("pkill -f vite", 2), ("developerly work-items create test", 2), ("echo safe", 0)]:
            with self.subTest(command=command):
                result = subprocess.run([sys.executable, str(guard)], input=json.dumps({"tool_input": {"command": command}}), text=True, capture_output=True)
                self.assertEqual(result.returncode, code, result.stderr)

    def test_allowed(self):
        commands = [
            'kill 123', '/bin/kill -TERM 123', 'kill -s INT 123',
            'kill -9 123', 'kill -- 123', 'ps -p 123 -o command=',
            'echo "never use pkill -f vite"', "printf '%s\\n' 'killall node'",
            "echo '$(pkill vite)'", '# pkill vite\necho ok',
            "rg 'pkill|killall' README.md", "cat <<'EOF'\nNever use pkill\nEOF",
        ]
        for command in commands:
            with self.subTest(command=command):
                self.assertFalse(unsafe_process_command(command))


if __name__ == '__main__':
    unittest.main()
