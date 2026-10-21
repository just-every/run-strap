# Inquiry and attendance funnel

Open **Lead follow-up** as the studio owner. An inquiry can retain its actual source, such as a phone inquiry or community event. Leave the source empty when it is unknown. The source is captured with the inquiry and retained in its original event; later follow-up edits do not rewrite it.

The funnel counts each member under their first retained inquiry, ordered by creation instant and then ID. Further inquiries retain their own sources and histories but do not count the member's acquisition or visits again. Source filters match the exact trimmed source. Members without a source remain visible as **Unknown source**. The owner can read the same projection at `GET /api/strap/reports/leads?funnelSource=Phone`.

Recorded intro bookings and external membership outcomes drill through the inquiry history. These are recorded pipeline facts, not intro purchases or native membership conversions. Visits come from current corrected attended bookings whose classes have started since the first retained inquiry, through the report instant inclusive. Two visits constitute repeat attendance; future check-ins, no-shows, excused and canceled bookings do not count. The visit links open their authoritative rosters.

Incomplete follow-ups are current inquiries outside the membership and lost stages; overdue follow-ups have a due instant before the report instant. A lost inquiry is an owner-recorded outcome, not an inferred lapse. Campaigns, intro purchases, native membership conversion, campaign spending and attributed revenue remain unavailable. Packs, receipts and recorded external agreements do not establish campaign attribution or marketing consent. RPT-005 remains partial.
