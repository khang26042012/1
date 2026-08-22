#!/usr/bin/env python3
"""
Real-time log viewer for Railway deployments via GraphQL API.
Supports both build logs and runtime/deployment logs.

Usage:
  python3 railway-logs.py --token <RAILWAY_TOKEN> --project <PROJECT_ID> [--service <SERVICE_NAME>] [--follow] [--limit 100]

Examples:
  python3 railway-logs.py --token abc123 --project de1e3f13-... --follow
  python3 railway-logs.py --token abc123 --project f15757bf-... --service 1 --limit 50
"""

import argparse
import json
import sys
import time
import urllib.request
import urllib.error

RAILWAY_GQL = "https://backboard.railway.app/graphql/v2"


def gql_request(token, query):
    """Execute a GraphQL request against Railway API."""
    payload = json.dumps({"query": query}).encode("utf-8")
    req = urllib.request.Request(
        RAILWAY_GQL,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="ignore")
        print(f"HTTP {e.code}: {body[:500]}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"Request error: {e}", file=sys.stderr)
        return None


def get_services(token, project_id):
    """List all services in a project."""
    q = f'{{ project(id: "{project_id}") {{ services {{ edges {{ node {{ id name }} }} }} }} }}'
    data = gql_request(token, q)
    if not data or "data" not in data:
        return []
    edges = data["data"]["project"]["services"]["edges"]
    return [(e["node"]["id"], e["node"]["name"]) for e in edges]


def get_latest_deployment(token, service_id):
    """Get the latest deployment ID for a service."""
    q = f'{{ service(id: "{service_id}") {{ deployments(first: 1) {{ edges {{ node {{ id status createdAt }} }} }} }} }}'
    data = gql_request(token, q)
    if not data or "data" not in data:
        return None, None
    edges = data["data"]["service"]["deployments"]["edges"]
    if not edges:
        return None, None
    node = edges[0]["node"]
    return node["id"], node.get("status", "?")


def fetch_build_logs(token, deployment_id, limit=100):
    """Fetch build logs for a deployment."""
    q = f'{{ buildLogs(deploymentId: "{deployment_id}", limit: {limit}) {{ timestamp message }} }}'
    data = gql_request(token, q)
    if not data or "data" not in data:
        return []
    return data["data"].get("buildLogs", [])


def fetch_deployment_logs(token, deployment_id, limit=100):
    """Fetch runtime/deployment logs."""
    q = f'{{ deploymentLogs(deploymentId: "{deployment_id}", limit: {limit}) {{ timestamp message }} }}'
    data = gql_request(token, q)
    if not data or "data" not in data:
        return []
    return data["data"].get("deploymentLogs", [])


def print_logs(logs, prefix=""):
    """Print log entries to stdout."""
    for entry in logs:
        ts = entry.get("timestamp", "")
        msg = entry.get("message", "")
        if ts:
            short_ts = ts[:19].replace("T", " ")
        else:
            short_ts = "?"
        print(f"{prefix}{short_ts} | {msg}")


def main():
    parser = argparse.ArgumentParser(description="Railway Log Viewer")
    parser.add_argument("--token", required=True, help="Railway API token")
    parser.add_argument("--project", required=True, help="Railway project ID")
    parser.add_argument("--service", default=None, help="Service name filter (default: first service)")
    parser.add_argument("--follow", action="store_true", help="Continuously poll for new logs")
    parser.add_argument("--limit", type=int, default=100, help="Max log entries per fetch")
    parser.add_argument("--build", action="store_true", help="Show build logs instead of runtime logs")
    args = parser.parse_args()

    # List services
    services = get_services(args.token, args.project)
    if not services:
        print("No services found or invalid project/token", file=sys.stderr)
        sys.exit(1)

    # Pick target service
    target = None
    if args.service:
        for sid, sname in services:
            if sname == args.service or sid == args.service:
                target = (sid, sname)
                break
        if not target:
            print(f"Service '{args.service}' not found. Available: {[s[1] for s in services]}", file=sys.stderr)
            sys.exit(1)
    else:
        target = services[0]

    print(f"Service: {target[1]} ({target[0]})")

    seen_ids = set()
    poll_interval = 3 if args.follow else 0

    while True:
        dep_id, status = get_latest_deployment(args.token, target[0])
        if not dep_id:
            print("No deployments found", file=sys.stderr)
            if not args.follow:
                break
            time.sleep(poll_interval)
            continue

        print(f"\n=== Deployment: {dep_id[:12]}... (status: {status}) ===")

        if args.build:
            logs = fetch_build_logs(args.token, dep_id, args.limit)
            label = "BUILD"
        else:
            logs = fetch_deployment_logs(args.token, dep_id, args.limit)
            label = "RUNTIME"

        new_logs = []
        for entry in logs:
            eid = entry.get("timestamp", "") + entry.get("message", "")
            if eid not in seen_ids:
                seen_ids.add(eid)
                new_logs.append(entry)

        if new_logs:
            print(f"[{label}] {len(new_logs)} new entries:")
            print_logs(new_logs)
        elif not args.follow:
            print(f"[{label}] No logs available")

        if not args.follow:
            break

        time.sleep(poll_interval)


if __name__ == "__main__":
    main()

