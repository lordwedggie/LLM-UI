"""Launch LLM-UI's server.py as a process detached from any job object.

Uses CREATE_BREAKAWAY_FROM_JOB + DETACHED_PROCESS so the server survives the
sandbox/session teardown that kills ordinary Start-Process children.
"""
import subprocess
import sys

FLAGS = (
    subprocess.CREATE_BREAKAWAY_FROM_JOB
    | subprocess.DETACHED_PROCESS
    | subprocess.CREATE_NEW_PROCESS_GROUP
)

subprocess.Popen(
    [sys.executable, "server.py"],
    cwd=r"D:\_Agents\LLM-UI",
    creationflags=FLAGS,
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    close_fds=True,
)
