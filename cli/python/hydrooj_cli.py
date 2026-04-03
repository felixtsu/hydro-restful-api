#!/usr/bin/env python3
"""
HydroOJ CLI - Client for HydroOJ REST API addon
Usage:
    python3 hydrooj_cli.py login <username>
    python3 hydrooj_cli.py list [--page N] [--tag X] [--keyword X]
    python3 hydrooj_cli.py show <problem_id>
    python3 hydrooj_cli.py submit <problem_id> -f <code_file>
    python3 hydrooj_cli.py status [submission_id]
    python3 hydrooj_cli.py contests
"""
import argparse
import configparser
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

CONFIG_FILE = Path.home() / '.config' / 'hydrooj_cli' / 'config.ini'
SESSION_FILE = Path.home() / '.config' / 'hydrooj_cli' / 'session.json'


def load_config():
    """Load configuration from file."""
    config = configparser.ConfigParser()
    if CONFIG_FILE.exists():
        config.read(CONFIG_FILE)
        base_url = config.get('DEFAULT', 'base_url', fallback='http://localhost:3000')
    else:
        base_url = os.environ.get('HYDRO_API_URL', 'http://localhost:3000')
    return base_url.rstrip('/')


def load_session():
    """Load saved session token."""
    if SESSION_FILE.exists():
        with open(SESSION_FILE) as f:
            return json.load(f).get('token')
    return None


def save_session(token):
    """Save session token."""
    SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SESSION_FILE, 'w') as f:
        json.dump({'token': token}, f)
    os.chmod(SESSION_FILE, 0o600)


def api_request(base_url, path, method='GET', data=None, token=None):
    """Make API request."""
    url = f"{base_url}{path}"
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'

    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            error = json.loads(body)
            print(f"Error: {error.get('message', body)}", file=sys.stderr)
        except:
            print(f"Error: {body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Network error: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_login(base_url, username):
    """Login to HydroOJ."""
    import getpass
    password = getpass.getpass('Password: ')
    data = api_request(base_url, '/api/login', method='GET', data={
        'username': username,
        'password': password
    })
    if 'token' in data:
        save_session(data['token'])
        print(f"Logged in as {data['uname']} (uid={data['uid']})")
    else:
        print("Login failed")
        sys.exit(1)


def cmd_list(base_url, token, args):
    """List problems."""
    params = f"?page={args.page}&pageSize={args.page_size}"
    if args.tag:
        params += f"&tag={args.tag}"
    if args.keyword:
        params += f"&keyword={args.keyword}"

    data = api_request(base_url, f'/api/problems{params}', token=token)
    print(f"\nProblems (Total: {data['total']})")
    print(f"Page {data['page']}/{data['totalPages']}\n")
    for p in data['items']:
        print(f"  [{p['pid']}] {p['title']} (Difficulty: {p['difficulty']}, Tags: {', '.join(p.get('tag') or [])})")


def cmd_show(base_url, token, problem_id):
    """Show problem details."""
    data = api_request(base_url, f'/api/problems/{problem_id}', token=token)
    print(f"\n#{data['pid']}: {data['title']}")
    print(f"Difficulty: {data['difficulty']}")
    print(f"Tags: {', '.join(data.get('tag') or [])}")
    print(f"Time Limit: {data.get('timeLimit', 1000)}ms")
    print(f"Memory Limit: {data.get('memoryLimit', 256)}MB")
    print(f"AC/Submit: {data.get('accepted', 0)}/{data.get('submission', 0)}")
    print(f"\n{data.get('content', 'No description')}")

    samples = data.get('samples') or []
    if samples:
        print("\nSamples:")
        for i, s in enumerate(samples, 1):
            print(f"\nSample {i}:")
            print(f"  Input: {s.get('input', '')}")
            print(f"  Output: {s.get('output', '')}")


def cmd_submit(base_url, token, args):
    """Submit code."""
    if args.file:
        with open(args.file, encoding='utf-8') as f:
            code = f.read()
    else:
        print("Enter code (Ctrl+D to finish):")
        code = sys.stdin.read()

    data = api_request(base_url, '/api/submit', method='POST', data={
        'problemId': args.problem_id,
        'code': code,
        'language': args.language
    }, token=token)

    print(f"Submitted! Submission ID: {data['id']}")
    print("Use `hydrooj status <id>` to check the result.")


def cmd_status(base_url, token, submission_id):
    """Check submission status."""
    if submission_id:
        data = api_request(base_url, f'/api/submissions/{submission_id}', token=token)
        print(f"\nSubmission #{data['id']}")
        print(f"Problem: #{data['pid']}")
        print(f"Status: {data['status']}")
        print(f"Score: {data['score']}%")
        print(f"Time: {data['time']}ms")
        print(f"Memory: {data['memory']}KB")
        print(f"Language: {data['language']}")
    else:
        data = api_request(base_url, f'/api/submissions?page=1&pageSize=20', token=token)
        print("\nRecent Submissions")
        for s in data['items']:
            print(f"  [{s['id']}] #{s['pid']} - {s['status']} ({s['score']}%)")


def cmd_contests(base_url, token, args):
    """List contests."""
    data = api_request(base_url, f'/api/contests?page={args.page}&pageSize={args.page_size}', token=token)
    print(f"\nContests (Total: {data['total']})")
    for c in data['items']:
        print(f"  [{c['id']}] {c['title']} ({c['status']})")


def main():
    parser = argparse.ArgumentParser(description='HydroOJ CLI')
    subparsers = parser.add_subparsers(dest='command')

    # Login
    login_parser = subparsers.add_parser('login', help='Login to HydroOJ')
    login_parser.add_argument('username', help='Username')

    # List
    list_parser = subparsers.add_parser('list', help='List problems')
    list_parser.add_argument('--page', type=int, default=1)
    list_parser.add_argument('--page-size', type=int, default=20)
    list_parser.add_argument('--tag', help='Filter by tag')
    list_parser.add_argument('--keyword', '-k', help='Search keyword')

    # Show
    show_parser = subparsers.add_parser('show', help='Show problem details')
    show_parser.add_argument('problem_id', help='Problem ID')

    # Submit
    submit_parser = subparsers.add_parser('submit', help='Submit code')
    submit_parser.add_argument('problem_id', help='Problem ID')
    submit_parser.add_argument('-f', '--file', help='Code file')
    submit_parser.add_argument('-l', '--language', default='cpp', help='Language')

    # Status
    status_parser = subparsers.add_parser('status', help='Check submission status')
    status_parser.add_argument('submission_id', nargs='?', help='Submission ID')

    # Contests
    contests_parser = subparsers.add_parser('contests', help='List contests')
    contests_parser.add_argument('--page', type=int, default=1)
    contests_parser.add_argument('--page-size', type=int, default=20)

    args = parser.parse_args()
    base_url = load_config()
    token = load_session()

    if args.command == 'login':
        cmd_login(base_url, args.username)
    elif args.command == 'list':
        if not token:
            print("Not logged in. Run 'hydrooj login' first.")
            sys.exit(1)
        cmd_list(base_url, token, args)
    elif args.command == 'show':
        if not token:
            print("Not logged in. Run 'hydrooj login' first.")
            sys.exit(1)
        cmd_show(base_url, token, args.problem_id)
    elif args.command == 'submit':
        if not token:
            print("Not logged in. Run 'hydrooj login' first.")
            sys.exit(1)
        cmd_submit(base_url, token, args)
    elif args.command == 'status':
        if not token:
            print("Not logged in. Run 'hydrooj login' first.")
            sys.exit(1)
        cmd_status(base_url, token, args.submission_id)
    elif args.command == 'contests':
        if not token:
            print("Not logged in. Run 'hydrooj login' first.")
            sys.exit(1)
        cmd_contests(base_url, token, args)
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
