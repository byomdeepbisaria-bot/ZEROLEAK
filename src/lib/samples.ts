export const SYNTHETIC_SAMPLES = [
  {
    id: "incident-log",
    label: "Incident log",
    text: `2026-03-14T09:42:11Z level=warn service=demo-gateway
request_id=EXAMPLE-REQUEST-0007 user=Morgan Example email=morgan@example.com
source_ip=198.51.100.42 contact=+1 (202) 555-0147
api_key=EXAMPLE_SYNTHETIC_KEY_NOT_VALID
authorization=Bearer DEMO_TOKEN_NOT_VALID
note="Password value is intentionally omitted from this synthetic log."`,
  },
  {
    id: "support-note",
    label: "Support note",
    text: `Ticket DEMO-1042
Contact: Riley Sample <riley.sample@example.net>
Callback: +1 (202) 555-0138
Test host: 203.0.113.24
Assigned team: Example Operations
No real customer information or valid credentials are present.`,
  },
] as const;