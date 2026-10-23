"""Static shell process-signal checks, not a shell sandbox or ownership verifier."""
import os
import re
import shlex

MESSAGE = ('refused: never use pkill/killall or broad/dynamic kill targets. Use a service/task-scoped '
           'lifecycle tool, or one positive literal PID with optional TERM/INT/HUP/KILL. '
           'Immediately before signaling, verify ownership, cwd and command with ps; ask Andrew if uncertain.')


def _substitutions(text):
    """Find executable substitutions, including inside double quotes, not single quotes."""
    i, quote = 0, None
    while i < len(text):
        c = text[i]
        if c == '\\' and quote != "'":
            i += 2
            continue
        if c == "'" and quote != '"':
            quote = None if quote == "'" else "'"
        elif quote != "'" and (text.startswith('$(', i) or c == '`'):
            backtick = c == '`'
            start = i + (1 if backtick else 2)
            j, depth = start, 1
            while j < len(text):
                if backtick and text[j] == '`':
                    break
                if not backtick:
                    if text[j] == '(':
                        depth += 1
                    elif text[j] == ')':
                        depth -= 1
                        if not depth:
                            break
                j += 1
            yield text[start:j]
            i = j
        elif c == '"' and quote != "'":
            quote = None if quote == '"' else '"'
        i += 1


def _word(token):
    try:
        return shlex.split(token)[0]
    except (ValueError, IndexError):
        return token


def _command(tokens, depth):
    while tokens and (re.match(r'^[A-Za-z_][A-Za-z_0-9]*=', tokens[0]) or
                      _word(tokens[0]) in {'!', 'then', 'do', 'else', 'elif', 'if', 'while', 'until'}):
        tokens = tokens[1:]
    if not tokens:
        return False
    name = os.path.basename(_word(tokens[0]))
    args = tokens[1:]
    if name in {'pkill', 'killall'}:
        return True
    if name == 'kill':
        words = [_word(x) for x in args]
        if words and words[0] in {'-TERM', '-INT', '-HUP', '-KILL', '-SIGTERM', '-SIGINT', '-SIGHUP', '-SIGKILL', '-1', '-2', '-9', '-15'}:
            words = words[1:]
        elif len(words) >= 2 and words[0] in {'-s', '--signal'} and words[1] in {'TERM', 'INT', 'HUP', 'KILL', 'SIGTERM', 'SIGINT', 'SIGHUP', 'SIGKILL', '1', '2', '9', '15'}:
            words = words[2:]
        if words and words[0] == '--':
            words = words[1:]
        return not (len(words) == 1 and re.fullmatch(r'[0-9]+', words[0]) and int(words[0]) > 0)
    if name in {'sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'}:
        for i, arg in enumerate(args):
            if _word(arg).startswith('-') and 'c' in _word(arg):
                return i + 1 < len(args) and unsafe_process_command(_word(args[i + 1]), depth + 1)
    if name == 'eval':
        return unsafe_process_command(' '.join(_word(a) for a in args), depth + 1)
    if name in {'sudo', 'env', 'command', 'builtin', 'exec', 'nohup', 'nice', 'timeout', 'xargs', 'setsid', 'time'}:
        # Wrapper option grammars vary; inspect candidate command suffixes conservatively.
        return any(_command(args[i:], depth + 1) for i in range(len(args)))
    return False


def unsafe_process_command(text, depth=0):
    if depth > 20:
        return True
    if any(unsafe_process_command(s, depth + 1) for s in _substitutions(text)):
        return True
    lexer = shlex.shlex(text, posix=False, punctuation_chars=';&|(){}\n')
    lexer.whitespace = ' \t\r'
    lexer.commenters = '#'
    try:
        tokens = list(lexer)
    except ValueError:
        return bool(re.search(r'\b(?:pkill|killall|kill)\b', text))
    chunk = []
    for token in tokens + [';']:
        if token and all(c in ';&|(){}\n' for c in token):
            if _command(chunk, depth):
                return True
            chunk = []
        else:
            chunk.append(token)
    return False
