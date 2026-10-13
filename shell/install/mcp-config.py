#!/usr/bin/env python3
"""Read the repo MCP template and add one server to host configs when absent.

The template owns the server command. Existing host entries with the same name
are never modified; Codex config text is only appended to, never re-rendered.
"""

import argparse
import json
import sys
import tomllib
from pathlib import Path

ABSENT = 1
INVALID = 2
PRESENT = 3


def server_argv(template, name, windows):
    server = json.loads(template.read_text(encoding="utf-8"))["mcpServers"][name]
    argv = [server["command"], *server.get("args", [])]
    # Windows cannot spawn npx.cmd directly without a shell.
    return ["cmd", "/c", *argv] if windows else argv


def claude_has(path, name):
    if not path.exists():
        return ABSENT
    try:
        servers = json.loads(path.read_text(encoding="utf-8")).get("mcpServers") or {}
    except (OSError, UnicodeError, ValueError):
        return INVALID
    return PRESENT if name in servers else ABSENT


def codex_add(path, argv, name):
    try:
        text = path.read_text(encoding="utf-8") if path.exists() else ""
        servers = tomllib.loads(text).get("mcp_servers") or {}
    except (OSError, UnicodeError, tomllib.TOMLDecodeError):
        return INVALID, ""
    if name in servers:
        return PRESENT, text
    # JSON strings are valid TOML basic strings for these ASCII values.
    table = (
        f"[mcp_servers.{name}]\n"
        f"command = {json.dumps(argv[0])}\n"
        f"args = [{', '.join(json.dumps(arg) for arg in argv[1:])}]\n"
    )
    separator = "" if not text or text.endswith("\n\n") else ("\n" if text.endswith("\n") else "\n\n")
    updated = text + separator + table
    tomllib.loads(updated)
    return 0, updated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("argv", "claude-has", "codex-add"))
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--windows", action="store_true")
    args = parser.parse_args()
    try:
        argv = server_argv(args.template, args.name, args.windows)
    except (OSError, ValueError, KeyError, TypeError):
        print("template-unsupported", file=sys.stderr)
        return INVALID
    if args.action == "argv":
        sys.stdout.write("\0".join(argv) + "\0")
        return 0
    if args.config is None:
        parser.error(f"{args.action} requires --config")
    if args.action == "claude-has":
        return claude_has(args.config, args.name)
    status, text = codex_add(args.config, argv, args.name)
    if status == 0:
        sys.stdout.buffer.write(text.encode("utf-8"))
    return status


if __name__ == "__main__":
    sys.exit(main())
