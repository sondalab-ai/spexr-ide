"""
Run an interactive shell on a pty and report what it printed (S6l's script tests).

stdin (JSON): {"cmd": [...], "env": {...}, "files": {"relative/path": "content"}, "inputs": ["line", ...], "settle": 1.0}
The files are written under a fresh HOME (which is put in env as HOME and TMPDIR-independent).
stdout (JSON): {"marks": ["<OSC 133 payload>", ...], "text": "...", "exited": bool}
"""
import json, os, pty, re, select, sys, tempfile, time

spec = json.load(sys.stdin)
home = tempfile.mkdtemp(prefix="spexr-pty-home-")
for rel, content in spec.get("files", {}).items():
    path = os.path.join(home, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)
env = dict(os.environ)
for k in [k for k in env if k.startswith(("SPEXR_", "THEIA_", "ZDOTDIR", "P9K_", "PROMPT_COMMAND", "BASH_ENV", "ENV"))]:
    del env[k]
env.update(spec.get("env", {}))
env.update(HOME=home, TERM="xterm-256color", PS1="$ ")
env = {k: v.replace("{HOME}", home) if isinstance(v, str) else v for k, v in env.items()}
pid, fd = pty.fork()
if pid == 0:
    os.chdir(home)
    os.execvpe(spec["cmd"][0], spec["cmd"], env)
out = b""
alive = True


def drain(t):
    global out, alive
    end = time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try:
                d = os.read(fd, 65536)
            except OSError:
                alive = False
                return
            if not d:
                alive = False
                return
            out += d


settle = spec.get("settle", 1.0)
drain(settle + 1.0)
for line in spec.get("inputs", []):
    if not alive:
        break
    os.write(fd, line.encode() + b"\n")
    drain(settle)
if alive:
    try:
        os.write(fd, b"exit\n")
    except OSError:
        pass
    drain(0.5)
try:
    os.kill(pid, 9)
except OSError:
    pass
try:
    os.waitpid(pid, 0)
except OSError:
    pass
text = out.decode(errors="replace")
marks = [m.group(1) for m in re.finditer(r"\x1b\]133;([^\x07]*)\x07", text)]
print(json.dumps({"marks": marks, "text": text, "alive_at_end": alive}))
