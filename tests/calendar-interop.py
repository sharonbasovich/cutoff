"""Parse actual Cutoff exports with the independent icalendar package.

Optional offline test after dependency installation. No browser, provider import,
or network call is made. Expected UTC instants below are explicit test oracles,
not values returned by Cutoff's analysis/formatting functions.
"""
import base64
from copy import deepcopy
from datetime import datetime, timedelta
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import re
import subprocess
import unittest

from icalendar import Calendar


ROOT = Path(__file__).resolve().parents[1]
STAMP = "2026-10-19T06:00:00Z"
BRIDGE = """
import { readFileSync } from 'node:fs';
import { exportCalendar } from './src/model.js';
import { examples } from './src/examples.js';
const requests = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify(requests.map(request => {
  const data = request.case || structuredClone(examples.find(e => e.id === request.example).case);
  Object.assign(data, request.overrides || {});
  for (const [index, changes] of Object.entries(request.sources || {})) Object.assign(data.sources[index], changes);
  // Preserve the oracle before invoking the exporter: an input-mutating regression
  // must not change both the exported text and its expected source text together.
  const expectedData = structuredClone(data);
  const bytes = Buffer.from(exportCalendar(data, { now: request.stamp }), 'utf8').toString('base64');
  return { name: request.name, data: expectedData, bytes };
})));
"""


def simple_case(date, time, zone, buffer=0):
    return {
        "title": "Synthetic calendar boundary", "localZone": "UTC", "bufferMinutes": buffer,
        "sources": [{"id": "synthetic", "label": "Synthetic source", "quote": "Synthetic test only.",
                     "date": date, "time": time, "zone": zone, "weekday": "", "url": "https://example.com/test",
                     "resolution": {}}],
    }


def identity_case(title, time="21:00"):
    # Match the recorded collision inputs exactly; adding optional source fields
    # would change the saved evidence identity and no longer test those vectors.
    return {
        "title": title, "localZone": "UTC", "bufferMinutes": 60,
        "sources": [{"id": "deadline", "label": "Rules",
                     "quote": f"Deadline: October 31, 2026 at {time} UTC",
                     "date": "2026-10-31", "time": time, "zone": "UTC"}],
    }


def text_value(value):
    """Expected source TEXT semantics: CR/LF normalization and forbidden controls removed."""
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value).replace("\r\n", "\n").replace("\r", "\n")


def utc(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def snapshot(component):
    """Compare decoded values/parameters, independent of serialization order/folding."""
    return (
        component.name,
        sorted((key, value.dt.isoformat() if hasattr(value, "dt") else str(value),
                sorted((str(k), str(v)) for k, v in value.params.items()))
               for key, value in component.items()),
        [snapshot(child) for child in component.subcomponents],
    )


SCENARIOS = [
    {"name": "agreement", "example": "agreement", "start": "2026-10-31T05:59:00Z", "agreed": "2026-10-31T06:59:00Z"},
    {"name": "fold-earlier", "example": "fold", "start": "2026-11-01T05:00:00Z", "agreed": "2026-11-01T05:30:00Z",
     "sources": {"0": {"resolution": {"fold": "earlier", "note": "Synthetic earlier occurrence chosen."}}},
     "decisions": ["You chose the earlier occurrence (-04:00). The original repeated time is retained."]},
    {"name": "fold-later", "example": "fold", "start": "2026-11-01T06:00:00Z", "agreed": "2026-11-01T06:30:00Z",
     "sources": {"0": {"resolution": {"fold": "later", "note": "Synthetic later occurrence chosen."}}},
     "decisions": ["You chose the later occurrence (-05:00). The original repeated time is retained."]},
    {"name": "missing-zone-clarified", "example": "missing-zone", "start": "2026-10-30T10:30:00Z", "agreed": "2026-10-30T11:30:00Z",
     "sources": {"0": {"resolution": {"zone": "Asia/Kolkata", "note": "Synthetic zone confirmed as Asia/Kolkata."}}},
     "decisions": ["Your clarification uses Asia/Kolkata. The original source zone remains unspecified."]},
    {"name": "weekday-clarified", "example": "weekday", "start": "2026-10-30T16:00:00Z", "agreed": "2026-10-30T17:00:00Z",
     "sources": {"0": {"resolution": {"weekday": "date", "note": "Synthetic numeric date confirmed."}}},
     "decisions": ["You chose the entered calendar date (Friday) over the source weekday (Thursday). The mismatch is retained."]},
    {"name": "combined-clarifications", "example": "fold", "start": "2026-11-01T06:00:00Z", "agreed": "2026-11-01T06:30:00Z",
     "sources": {"0": {"zone": "", "weekday": "Saturday", "resolution": {
         "zone": "America/New_York", "fold": "later", "weekday": "date", "note": "Synthetic zone, occurrence, and date decisions."}}},
     "decisions": ["Your clarification uses America/New_York. The original source zone remains unspecified.",
                   "You chose the entered calendar date (Sunday) over the source weekday (Saturday). The mismatch is retained.",
                   "You chose the later occurrence (-05:00). The original repeated time is retained."]},
    {"name": "text-escaping", "example": "agreement", "start": "2026-10-31T05:59:00Z", "agreed": "2026-10-31T06:59:00Z",
     "overrides": {"title": "Café, 東京; 🕰️ e\u0301 \\ literal\\n\r\nEND:VCALENDAR"},
     "sources": {"0": {
         "label": "Synthetic, source; \\ 東京\r\nATTENDEE:mailto:nobody@example.com",
         "quote": "Comma, semicolon; slash\\ literal\\n tab\t CR\rLF\nCRLF\r\n"
                  "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT1M\r\nEND:VALARM\r\n"
                  "END:VEVENT\nBEGIN:VEVENT\nUID:injected\nNUL\x00VT\x0bDEL\x7f café 🕰️ 東京 e\u0301",
         "url": "https://example.com/synthetic?q=a,b;c\\d\r\nORGANIZER:mailto:nobody@example.com",
         "resolution": {"note": "Synthetic note, semi; slash\\ literal\\n\nSTATUS:CONFIRMED\nBEGIN:VALARM"}}}},
    {"name": "historical-offset-seconds", "case": simple_case("1850-01-01", "12:00", "Europe/Paris", 30),
     "start": "1850-01-01T11:20:39Z", "agreed": "1850-01-01T11:50:39Z"},
    {"name": "lower-year-boundary", "case": simple_case("0001-01-01", "00:00", "UTC"),
     "start": "0001-01-01T00:00:00Z", "agreed": "0001-01-01T00:00:00Z"},
    {"name": "upper-year-boundary", "case": simple_case("9999-12-31", "23:58", "UTC"),
     "start": "9999-12-31T23:58:00Z", "agreed": "9999-12-31T23:58:00Z"},
    {"name": "quarter-hour-offset", "case": simple_case("2026-10-30", "17:00", "+05:45", 15),
     "start": "2026-10-30T11:00:00Z", "agreed": "2026-10-30T11:15:00Z"},
]
for prefix in range(96):
    # Move 1-, 2-, 3-, and 4-byte characters and TEXT escapes across folding boundaries.
    text = "A" * prefix + (" café 東京 🕰️ e\u0301,;\\ literal\\n\r\n" * 12)
    SCENARIOS.append({
        "name": f"utf8-fold-boundary-{prefix:02d}", "example": "agreement",
        "start": "2026-10-31T05:59:00Z", "agreed": "2026-10-31T06:59:00Z",
        "overrides": {"title": text}, "sources": {"0": {"quote": text, "resolution": {"note": text}}},
    })


# These fixed UID oracles were independently calculated with Python integer
# arithmetic for the identity regression, not read from the current exporter.
IDENTITY_SCENARIOS = [
    {"name": "old-collision-morning", "case": identity_case("Deadline sahj5s", "04:15"),
     "uid": "cutoff-4a293c58a12a4c4dd9c4797b21f62d7f@local.invalid",
     "start": "2026-10-31T03:15:00Z", "agreed": "2026-10-31T04:15:00Z"},
    {"name": "old-collision-afternoon", "case": identity_case("Deadline 7lmvrk", "15:43"),
     "uid": "cutoff-6ca45c332fc6d7d1a1c74175a0a8cca7@local.invalid",
     "start": "2026-10-31T14:43:00Z", "agreed": "2026-10-31T15:43:00Z"},
    {"name": "old-collision-same-time-a", "case": identity_case("Deadline 1q3w3i8 1odysdb"),
     "uid": "cutoff-428cdf50370a67b8a213ce1e7e92adde@local.invalid",
     "start": "2026-10-31T20:00:00Z", "agreed": "2026-10-31T21:00:00Z"},
    {"name": "old-collision-same-time-b", "case": identity_case("Deadline ultjtk 1cf642f"),
     "uid": "cutoff-8611a41e9dfe1591f70308b8540ecff6@local.invalid",
     "start": "2026-10-31T20:00:00Z", "agreed": "2026-10-31T21:00:00Z"},
    {"name": "utf8-identity", "case": identity_case("é ☕ 🗓️"),
     "uid": "cutoff-b532fb94fb4d0ce539431071ff46dad4@local.invalid",
     "start": "2026-10-31T20:00:00Z", "agreed": "2026-10-31T21:00:00Z"},
]
IDENTITY_SCENARIOS.append({
    **deepcopy(IDENTITY_SCENARIOS[0]), "name": "repeat-later-stamp", "stamp": "2026-10-20T12:34:56Z",
})
IDENTITY_SCENARIOS.append({
    **deepcopy(IDENTITY_SCENARIOS[0]), "name": "repeat-different-display-zone", "overrides": {"localZone": "Asia/Tokyo"},
})


class CalendarInteroperability(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if version("icalendar") != "7.3.0":
            raise RuntimeError("Use the pinned test parser in requirements-calendar-interop.txt")
        requests = [{**deepcopy(scenario), "stamp": scenario.get("stamp", STAMP)}
                    for scenario in SCENARIOS + IDENTITY_SCENARIOS]
        result = subprocess.run(["node", "--input-type=module", "-e", BRIDGE], input=json.dumps(requests),
                                text=True, capture_output=True, cwd=ROOT, check=True)
        exports = json.loads(result.stdout)
        cls.exports = exports[:len(SCENARIOS)]
        cls.identity_exports = exports[len(SCENARIOS):]

    def parse_strictly(self, raw, uid_digits=32):
        self.assertTrue(raw.endswith(b"\r\n"), "missing final CRLF")
        self.assertNotRegex(raw.replace(b"\r\n", b""), rb"[\r\n]", "bare newline")
        for line in raw.split(b"\r\n")[:-1]:
            self.assertLessEqual(len(line), 75, "fold exceeds 75 UTF-8 octets")
            line.decode("utf-8", errors="strict")  # A fold must not split a UTF-8 character.
        calendars = Calendar.from_ical(raw, multiple=True)
        self.assertEqual(len(calendars), 1)
        cal = calendars[0]
        cal.validate()
        self.assertEqual([part.name for part in cal.walk()], ["VCALENDAR", "VEVENT"])
        for part in cal.walk():
            self.assertEqual(part.errors, [], "parser tolerated invalid property values")
            self.assertFalse(any(isinstance(value, list) for value in part.values()), "duplicate property")
        self.assertEqual(set(cal.keys()), {"VERSION", "PRODID", "CALSCALE"})
        self.assertEqual(str(cal["VERSION"]), "2.0")
        self.assertEqual(str(cal["CALSCALE"]), "GREGORIAN")
        event = cal.walk("VEVENT")[0]
        self.assertEqual(set(event.keys()), {"UID", "DTSTAMP", "DTSTART", "DTEND", "SUMMARY", "DESCRIPTION", "STATUS", "TRANSP"})
        self.assertRegex(str(event["UID"]), rf"^cutoff-[0-9a-f]{{{uid_digits}}}@local\.invalid$")
        self.assertEqual(str(event["STATUS"]), "TENTATIVE")
        self.assertEqual(str(event["TRANSP"]), "TRANSPARENT")
        self.assertEqual(cal.walk("VALARM"), [])
        for key in ("DTSTAMP", "DTSTART", "DTEND"):
            self.assertRegex(event[key].to_ical(), rb"^[0-9]{8}T[0-9]{6}Z$")
            self.assertEqual(event.decoded(key).utcoffset(), timedelta(0))
            self.assertEqual(dict(event[key].params), {})  # UTC, no floating time/TZID.
        self.assertEqual(event.decoded("DTEND") - event.decoded("DTSTART"), timedelta(minutes=1))
        return cal, event

    def test_107_generated_exports_and_independent_parser_roundtrips(self):
        self.assertEqual(len(self.exports), 107)
        for expected, export in zip(SCENARIOS, self.exports, strict=True):
            with self.subTest(export=expected["name"]):
                self.assertEqual(export["name"], expected["name"])
                raw = base64.b64decode(export["bytes"], validate=True)
                cal, event = self.parse_strictly(raw)
                data = export["data"]
                self.assertEqual(event.decoded("DTSTART"), utc(expected["start"]))
                self.assertEqual(event.decoded("DTSTAMP"), utc(STAMP))
                self.assertEqual(str(event["SUMMARY"]), text_value("Planning target: " + data["title"].strip()))
                description = str(event["DESCRIPTION"])
                self.assertIn("This is a personal planning target, not an official deadline.", description)
                self.assertIn("Source statements were entered manually and have not been verified by Cutoff.", description)
                self.assertIn("Agreed source instant: " + expected["agreed"], description)
                self.assertIn(f"Planning buffer: {data['bufferMinutes']} minutes before the agreed instant.", description)
                for source in data["sources"]:
                    for fragment in (
                        "SOURCE: " + source["label"].strip(), "Original statement: " + source["quote"],
                        f"Entered date/time: {source['date']} {source['time']}; zone: {source['zone'] or '(missing)'}; weekday: {source['weekday'] or '(not stated)'}",
                        "URL: " + source["url"], "Interpreted instant: " + expected["agreed"],
                    ):
                        self.assertIn(text_value(fragment), description)
                    if source["resolution"].get("note"):
                        self.assertIn(text_value("Your note: " + source["resolution"]["note"]), description)
                for decision in expected.get("decisions", []):
                    self.assertIn(decision, description)
                reparsed, _ = self.parse_strictly(cal.to_ical())
                self.assertEqual(snapshot(cal), snapshot(reparsed))

    def test_7_identity_exports_preserve_fixed_collision_vectors_and_roundtrip(self):
        self.assertEqual(len(self.identity_exports), 7)
        parsed_uids = []
        for expected, export in zip(IDENTITY_SCENARIOS, self.identity_exports, strict=True):
            with self.subTest(export=expected["name"]):
                self.assertEqual(export["name"], expected["name"])
                cal, event = self.parse_strictly(base64.b64decode(export["bytes"], validate=True))
                parsed_uids.append(str(event["UID"]))
                self.assertEqual(str(event["UID"]), expected["uid"])
                self.assertEqual(event.decoded("DTSTART"), utc(expected["start"]))
                self.assertEqual(event.decoded("DTSTAMP"), utc(expected.get("stamp", STAMP)))
                self.assertEqual(str(event["SUMMARY"]), "Planning target: " + expected["case"]["title"])
                description = str(event["DESCRIPTION"])
                self.assertIn("Original statement: " + expected["case"]["sources"][0]["quote"], description)
                self.assertIn("Agreed source instant: " + expected["agreed"], description)
                self.assertIn("Planning buffer: 60 minutes before the agreed instant.", description)
                reparsed, _ = self.parse_strictly(cal.to_ical())
                self.assertEqual(snapshot(cal), snapshot(reparsed))
        self.assertEqual(len(set(parsed_uids[:5])), 5, "distinct plans must keep distinct parsed identities")
        self.assertEqual(parsed_uids[0], parsed_uids[5], "export timestamp must not change identity")
        self.assertEqual(parsed_uids[0], parsed_uids[6], "display zone must not change identity")

    def test_retained_model_generated_example(self):
        raw = (ROOT / "evidence/model-generated-example.ics").read_bytes()
        # Retain the immutable pre-fix export as historical evidence. New exports
        # must use 32 hex digits; only this old fixture expects the old UID format.
        cal, event = self.parse_strictly(raw, uid_digits=8)
        self.assertEqual(event.decoded("DTSTART"), utc("2026-10-31T05:59:00Z"))
        self.assertEqual(str(event["SUMMARY"]), "Planning target: Ready for the calendar")
        self.assertIn("https://example.com/competition/rules", str(event["DESCRIPTION"]))
        reparsed, _ = self.parse_strictly(cal.to_ical(), uid_digits=8)
        self.assertEqual(snapshot(cal), snapshot(reparsed))

    def test_negative_controls_reject_tolerated_dates_and_injected_alarm(self):
        raw = base64.b64decode(self.exports[0]["bytes"])
        malformed = raw.replace(b"DTSTART:20261031T055900Z", b"DTSTART:INVALID-DATE")
        # A successful library parse alone is insufficient; it can tolerate errors.
        self.assertTrue(Calendar.from_ical(malformed).walk("VEVENT")[0].errors)
        with self.assertRaises(AssertionError):
            self.parse_strictly(malformed)
        alarm = b"BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT1M\r\nDESCRIPTION:Injected\r\nEND:VALARM\r\n"
        with self.assertRaises(AssertionError):
            self.parse_strictly(raw.replace(b"END:VEVENT", alarm + b"END:VEVENT"))


if __name__ == "__main__":
    print(f"Independent parser: icalendar {version('icalendar')}", flush=True)
    print("Scope: 114 fresh exports (11 scenarios + 96 UTF-8 boundary variants + 7 identity regression exports), "
          "1 retained export, and 2 negative controls.", flush=True)
    print(f"src/model.js SHA-256: {hashlib.sha256((ROOT / 'src/model.js').read_bytes()).hexdigest()}", flush=True)
    unittest.main(verbosity=2)
