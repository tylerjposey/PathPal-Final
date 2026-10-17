# PathPal: AI for Safer Walks Home from School

Client: City of San José, Community Safety
Team: Tyler Posey, Ryan Morla, Desiree Lopez, Man Ngo, Rishaan Singh, Aug–Oct 2026

My part: I wrote the AI governance analysis (who is accountable when the AI flags a risk) and helped red-team the prototype using the TRACE framework.

## The problem
Parents like Elena, a single parent in San José, can’t see when her child’s route is disrupted or whether the child arrived safely. Safety incidents along school routes have no shared, real-time channel, so families find out too late.

## What we built
What it does: PathPal is a Replit prototype that combines route and transit planning, milestone check-ins (not continuous GPS), and resident hazard reports. AI scores each report for severity and drafts SOS interactions, using text generation, image recognition, and structured extraction with tool use.
What the user sees: Parents see the child’s planned journey and check-in status. Neighbors submit hazard reports. City teams get a queue of AI-scored reports.
What a human still decides: A School Safety Coordinator approves any report involving a person before it becomes “Verified.” Reports the AI can’t handle route to a human review queue, and any immediate risk needs a live handoff to emergency dispatch.

## Result
In red-teaming, a real crime report with the police report linked was scored Severity 4 / Low priority. The malformed link also caused an endless loading state that could deny service to other users. We traced it to a dependency, decode-uri-component, and added a human-review fallback.

## What I would do next
The gap: No prompt can answer who is accountable when the AI flags a risk. That takes staffing, decision authority, and an agreement with emergency services.
What I’d build or learn: Draft a response-time standard for AI-flagged reports and child-safety alerts, with an escalation path to dispatch. Then prototype a human review queue with timeouts, so an unreviewed report escalates instead of waiting.
