import builtins
import sys

MARKER = "__CODESSESSIE_INPUT_REQUEST__"

def patched_input(prompt=""):
    sys.stdout.write(prompt)
    sys.stdout.write(MARKER + "\n")
    sys.stdout.flush()
    line = sys.stdin.readline()
    if not line:
        raise EOFError("EOF when reading a line")
    return line.rstrip("\n")

builtins.input = patched_input

path = sys.argv[1]
globals_dict = {"__name__": "__main__"}

with open(path, "r", encoding="utf-8") as f:
    source = f.read()

exec(compile(source, path, "exec"), globals_dict, globals_dict)
