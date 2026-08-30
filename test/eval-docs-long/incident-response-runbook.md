# Incident Response Runbook

This runbook covers alerting, on-call rotation, incident classification,
communication, and the review process that follows an incident. It applies to
all production services.

## Alerting

Alerts are generated from service level objectives rather than from raw resource
metrics. An alert fires when the error budget burn rate exceeds a threshold over
a rolling window. Two windows are used: a fast window that catches sudden total
outages, and a slow window that catches gradual degradation which would
otherwise exhaust the budget unnoticed.

Alerts must be actionable. An alert that cannot be acted upon by the person
receiving it is a defect and should be either routed elsewhere or deleted. Every
alert carries a link to the relevant dashboard and to the section of this
runbook that describes the response.

Symptom-based alerting is preferred over cause-based alerting. A cause-based
alert on CPU saturation fires constantly during harmless batch work. A
symptom-based alert on request latency fires when users are actually affected.

## On-Call Rotation

The rotation is weekly, handing over on Wednesday mornings so that a difficult
week does not span a weekend handover. Each rotation has a primary and a
secondary responder. The secondary is paged only when the primary does not
acknowledge within five minutes.

Handover includes a written summary of open incidents, ongoing degradations, and
any silenced alerts with their expiry times. A silenced alert without an expiry
is treated as a defect during review.

On-call responders are expected to have authority to act without seeking
approval, including rolling back a deployment, shifting traffic between regions,
and scaling capacity. Requiring approval during an incident is a process failure.

## Classification

Incidents are classified by customer impact, not by internal severity of the
technical fault. A crashed replica with no user-visible effect is not an
incident. A slow page that every user encounters is an incident even if every
service reports healthy.

Severity one covers total unavailability or data loss affecting many customers.
Severity two covers major degradation or unavailability of a single significant
feature. Severity three covers minor degradation with a workaround available.
Classification may be revised upward or downward as understanding improves.

## Communication

The incident commander owns communication and is explicitly not the person
performing remediation. Splitting these roles prevents the common failure where
the only person who understands the fault is also the person writing updates.

Status updates are posted at fixed intervals regardless of whether progress has
been made. An update saying that there is no new information is more useful than
silence, because silence is indistinguishable from an unattended incident.

Customer-facing communication is drafted by the incident commander and reviewed
by support before publication. Internal channels carry raw technical detail;
external channels carry impact, scope, and expected resolution time only.

## Remediation

Mitigate before diagnosing. Restoring service takes priority over understanding
the fault, and evidence should be preserved by capturing logs, heap dumps, and
metrics snapshots rather than by leaving the system broken while investigating.

Roll back before rolling forward. A rollback to a known-good state is almost
always faster and lower risk than a fix applied under time pressure. Forward
fixes during an incident should be reserved for cases where rollback is
impossible, such as an irreversible schema migration.

## Review

Every severity one and severity two incident gets a written review.
MARKER_POSTMORTEM the postmortem owner is assigned by the incident commander
before the incident is closed, and never later than twenty-four hours after
resolution; the owner is accountable for the document and for tracking the
resulting action items to completion, though they need not write it alone.

Reviews are blameless. The document describes what happened, what was believed
at each point in time, and why the actions taken were reasonable given that
belief. Naming individuals as causes is prohibited, because it reliably
suppresses the reporting the process depends on.

Action items must have an owner and a due date, and are tracked in the normal
backlog rather than in the review document. An action item without an owner is
a wish, not a commitment.
