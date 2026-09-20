# 09 — Phase 6: "The Business" (Week 19-24)

> Prev: [08-phase-5-brain-moat](./08-phase-5-brain-moat.md) | Parent: [00-index](./00-index.md) | Next: [10-pricing-model](./10-pricing-model.md)

### *Pitch: "Enterprise AI FinOps. SOC2. Self-hosted. RBAC. SSO."*

## What You Ship
Enterprise features sellable to Series B+ companies.

## Tasks

| # | Task | Output | Time |
|---|------|--------|------|
| 6.1 | **Multi-tenant RBAC** — Admin, Manager, Viewer, Agent roles with granular permissions | Access control | 3 days |
| 6.2 | **SSO/SAML** — Okta, Auth0, Azure AD | Enterprise auth | 3 days |
| 6.3 | **Self-hosted installer** — Helm chart + 1-click AWS/GCP/Azure | Deployment | 5 days |
| 6.4 | **SOC2 preparation** — audit logging, encryption at rest/transit, access controls, incident response docs | Compliance | ongoing |
| 6.5 | **Terraform provider** — budgets, policies, virtual keys as code | IaC | 3 days |
| 6.6 | **OpenTelemetry export** — traces/metrics to any OTel collector (Datadog, Grafana) | Interop | 2 days |
| 6.7 | **API rate limiting** — per-agent/team/model RPM, TPM | Fair usage | 1.5 days |
| 6.8 | **White-label dashboard** — custom branding for agencies/consultancies | Channel sales | 2 days |
| 6.9 | **SLA monitoring** — provider uptime, latency SLA, auto-failover metrics | Reliability | 2 days |
| 6.10 | **Hosted cloud offering** — managed SaaS (revenue engine) | Business | 5 days |

## Acceptance Criteria
- [ ] RBAC: Viewer cannot modify budgets, Manager can modify team budgets, Admin can modify all
- [ ] SSO: Login via Okta end-to-end with role mapping
- [ ] Helm chart deploys on vanilla k8s in <10 min
- [ ] All data encrypted at rest (AES-256) and in transit (TLS 1.3)
- [ ] Terraform `plan` + `apply` creates budget hierarchy from code
- [ ] OTel traces appear in Grafana within 30s of request
- [ ] Cloud handles 10,000 RPM per tenant with <20ms added latency
