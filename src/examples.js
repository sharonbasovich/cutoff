const source = (id, label, quote, date, time, zone, weekday = '', url = '') => ({ id, label, quote, date, time, zone, weekday, url, resolution: {} });

export const examples = [
  {
    id: 'disagreement', name: 'Conflicting sources', description: 'Two pages. Two different cutoffs.',
    case: {
      title: 'The final submission', localZone: 'America/New_York', bufferMinutes: 60,
      sources: [
        source('rules', 'Competition rules', 'Submit your project by October 30, 2026 at 11:59 PM Pacific Time.', '2026-10-30', '23:59', 'America/Los_Angeles', '', 'https://example.com/competition/rules'),
        source('portal', 'Submission portal', 'Submissions close October 31, 2026 at 06:00 UTC.', '2026-10-31', '06:00', 'UTC', '', 'https://example.com/competition/submit'),
      ],
    },
  },
  {
    id: 'fold', name: 'The repeated hour', description: 'A clock change creates two answers.',
    case: { title: 'A deadline in the repeated hour', localZone: 'Europe/London', bufferMinutes: 30, sources: [
      source('fold-source', 'Event notice', 'Registration closes November 1, 2026 at 1:30 AM New York time.', '2026-11-01', '01:30', 'America/New_York', '', 'https://example.com/event'),
    ] },
  },
  {
    id: 'gap', name: 'The missing hour', description: 'This local clock time never happens.',
    case: { title: 'A deadline in the missing hour', localZone: 'America/New_York', bufferMinutes: 30, sources: [
      source('gap-source', 'Application notice', 'Applications close March 8, 2026 at 2:30 AM in New York.', '2026-03-08', '02:30', 'America/New_York', '', 'https://example.com/application'),
    ] },
  },
  {
    id: 'missing-zone', name: 'The missing zone', description: 'A precise time, but where?',
    case: { title: 'A deadline without a time zone', localZone: 'Europe/London', bufferMinutes: 60, sources: [
      source('zone-source', 'Project brief', 'Send your final project by October 30, 2026 at 5:00 PM.', '2026-10-30', '17:00', '', '', 'https://example.com/brief'),
    ] },
  },
  {
    id: 'weekday', name: 'The wrong weekday', description: 'The day and the date do not match.',
    case: { title: 'A day that does not match its date', localZone: 'UTC', bufferMinutes: 60, sources: [
      source('weekday-source', 'Event brief', 'The deadline is Thursday, October 30, 2026, at 17:00 UTC.', '2026-10-30', '17:00', 'UTC', 'Thursday', 'https://example.com/event/brief'),
    ] },
  },
  {
    id: 'agreement', name: 'Same instant, confirmed', description: 'Different zones. One matching time.',
    case: { title: 'Ready for the calendar', localZone: 'America/New_York', bufferMinutes: 60, sources: [
      source('agreed-rules', 'Competition rules', 'Submissions close October 30, 2026 at 11:59 PM Pacific Time.', '2026-10-30', '23:59', 'America/Los_Angeles', '', 'https://example.com/competition/rules'),
      source('agreed-portal', 'Submission portal', 'The deadline is October 31, 2026 at 06:59 UTC.', '2026-10-31', '06:59', 'UTC', '', 'https://example.com/competition/submit'),
    ] },
  },
];
