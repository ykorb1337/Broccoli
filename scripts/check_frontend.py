#!/usr/bin/env python3
"""Run all deterministic browser checks, including newly added modules."""
import shutil
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
def main():
    node=shutil.which('node')
    if not node:raise SystemExit('Node.js is required for browser checks')
    for path in sorted((ROOT/'web').glob('*.js')):subprocess.run([node,'--check',str(path)],cwd=ROOT,check=True)
    tests=sorted((ROOT/'tests').glob('*.test.cjs'))
    for path in tests:subprocess.run([node,str(path)],cwd=ROOT,check=True)
    print(str(len(tests))+' browser test files passed')
if __name__=='__main__':main()
