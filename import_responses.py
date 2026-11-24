"""Import Google Forms email addresses joined by the exact monitor attempt code."""
import argparse
import csv
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--email-column", default="Email Address")
    parser.add_argument("--attempt-column", default="Monitor attempt")
    parser.add_argument("--first-name-column", default="First Name")
    parser.add_argument("--last-name-column", default="Last Name")
    parser.add_argument("--student-id-column", default="Student ID")
    args = parser.parse_args()
    dbfile = Path(__file__).resolve().parent / "data" / "monitor.sqlite"
    if not dbfile.is_file():
        parser.error("Start the monitor server before importing responses.")
    with args.csv_file.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        headers = reader.fieldnames or []
        columns = {"First Name": args.first_name_column, "Last Name": args.last_name_column,
                   "Student ID": args.student_id_column}
        if headers.count(args.attempt_column) != 1:
            parser.error(f"Expected one {args.attempt_column!r} column. Available: {headers}")
        for name in [args.email_column, *columns.values()]:
            if headers.count(name) > 1:
                parser.error(f"Ambiguous CSV column: {name!r}")
        if not any(name in headers for name in [args.email_column, *columns.values()]):
            parser.error(f"No matching identity columns. Available: {headers}")
        records = list(reader)
    counts = Counter((row.get(args.attempt_column) or "").strip() for row in records)
    matched = 0
    with sqlite3.connect(dbfile) as db:
        db.execute("CREATE TABLE IF NOT EXISTS response_emails (attempt TEXT PRIMARY KEY, email TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS participants (attempt TEXT PRIMARY KEY, details TEXT NOT NULL)")
        for row in records:
            key = (row.get(args.attempt_column) or "").strip()
            email = (row.get(args.email_column) or "").strip()
            profile = {label: row[name].strip() for label, name in columns.items() if row.get(name) and row[name].strip()}
            if counts[key] != 1 or not re.fullmatch(r"[0-9a-f]{32}", key):
                continue
            if not profile and not email:
                continue
            if email and not re.fullmatch(r"[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+", email):
                continue
            if not db.execute("SELECT 1 FROM events WHERE attempt=? LIMIT 1", (key,)).fetchone():
                continue
            old = db.execute("SELECT email FROM response_emails WHERE attempt=?", (key,)).fetchone()
            if email and old and old[0] != email:
                continue
            if profile:
                existing = db.execute("SELECT details FROM participants WHERE attempt=?", (key,)).fetchone()
                details = json.loads(existing[0]) if existing else {}
                details.update(profile)
                db.execute("INSERT OR REPLACE INTO participants VALUES (?,?)", (key, json.dumps(details)))
            if email:
                db.execute("INSERT OR IGNORE INTO response_emails VALUES (?, ?)", (key, email))
            matched += 1
    print(f"Matched {matched} responses; skipped {len(records) - matched} unmatched, ambiguous or invalid rows.")


if __name__ == "__main__":
    main()
