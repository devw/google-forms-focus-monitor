"""Import Google Forms email addresses joined by the exact monitor attempt code."""
import argparse
import csv
import re
import sqlite3
from collections import Counter
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_file", type=Path)
    parser.add_argument("--email-column", default="Email Address")
    parser.add_argument("--attempt-column", default="Monitor attempt")
    args = parser.parse_args()
    dbfile = Path(__file__).resolve().parent / "data" / "monitor.sqlite"
    if not dbfile.is_file():
        parser.error("Start the monitor server before importing responses.")
    with args.csv_file.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        headers = reader.fieldnames or []
        for name in [args.email_column, args.attempt_column]:
            if headers.count(name) != 1:
                parser.error(f"Expected exactly one CSV column named {name!r}. Available: {headers}")
        records = [(row[args.attempt_column] or "", row[args.email_column] or "") for row in reader]
    counts = Counter(key.strip() for key, _ in records)
    matched = 0
    with sqlite3.connect(dbfile) as db:
        db.execute("CREATE TABLE IF NOT EXISTS response_emails (attempt TEXT PRIMARY KEY, email TEXT NOT NULL)")
        for key, email in records:
            key, email = key.strip(), email.strip()
            if counts[key] != 1 or not re.fullmatch(r"[0-9a-f]{32}", key):
                continue
            if not re.fullmatch(r"[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+", email):
                continue
            if not db.execute("SELECT 1 FROM events WHERE attempt=? LIMIT 1", (key,)).fetchone():
                continue
            old = db.execute("SELECT email FROM response_emails WHERE attempt=?", (key,)).fetchone()
            if old and old[0] != email:
                continue
            db.execute("INSERT OR IGNORE INTO response_emails VALUES (?, ?)", (key, email))
            matched += 1
    print(f"Matched {matched} responses; skipped {len(records) - matched} unmatched, ambiguous or invalid rows.")


if __name__ == "__main__":
    main()
