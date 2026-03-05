# FOIA Fluent

### A civic AI platform that cuts through government opacity — finding existing public records, drafting optimized requests under federal and state transparency laws, and tracking agency responses so documents reach the people who need them.

**[View the full product overview](https://foia-fluent.edgeone.app/)**

---

## The Problem

The Freedom of Information Act promises government transparency, but the reality is broken:

- **Documents already exist in the public domain** but are scattered across dozens of repositories, reading rooms, and databases with no unified search
- **Every jurisdiction has different rules** — federal FOIA, New York's FOIL, California's CPRA, Texas's PIA — each with unique exemptions, deadlines, appeal processes, and fee structures. Requesters must be legal experts in whichever state they're filing in
- **Requests fail at alarming rates** — poorly worded requests, wrong agencies, missing legal citations, and vague scope give agencies easy reasons to deny or delay
- **Requesters are on their own** — journalists, lawyers, and civic organizations each reinvent the wheel, with no shared intelligence on what works, which agencies cooperate, or how to appeal denials
- **The process is deliberately opaque** — response timelines stretch from weeks to years, improper redactions go unchallenged, and most people give up before getting results

The information belongs to the public. The process shouldn't be this hard.

## How It Works

FOIA Fluent guides users through five integrated phases — from finding existing documents to building collective transparency intelligence.

```
  USER (journalist, lawyer, researcher, organization)
                        |
                        v
  +---------------------------------------------+
  |  PHASE 1 : DOCUMENT DISCOVERY               |
  |  Search MuckRock, DocumentCloud, data.gov,   |
  |  agency reading rooms, and open requests.    |
  |  Assess whether a FOIA filing is needed.     |
  +---------------------------------------------+
                        |
            +-----------+-----------+
            |                       |
      Already exists          Not found
            |                       |
            v                       v
      Direct to              +---------------------------------------------+
      source                 |  PHASE 2 : REQUEST INTELLIGENCE             |
                             |  Generate optimized request language.        |
                             |  Predict success from similar past cases.    |
                             |  Apply state-specific FOIA/public records    |
                             |  laws. Strategy for sensitive agencies.      |
                             +---------------------------------------------+
                                                |
                                                v
                             +---------------------------------------------+
                             |  PHASE 3 : RESPONSE & NEGOTIATION           |
                             |  Track full correspondence timeline.         |
                             |  Draft follow-up responses.                  |
                             |  Detect improper redactions.                 |
                             |  Guide appeals, mediation, litigation.       |
                             +---------------------------------------------+
                                                |
                                  +-------------+-------------+
                                  |                           |
                              Fulfilled                 Blocked/Delayed
                                  |                           |
                                  |             +-------------+-------------+
                                  |             |                           |
                                  |   +-----------------------+   +-----------------------+
                                  |   | PHASE 4 : BEYOND FOIA |   | PHASE 5 : DATA HUB   |
                                  |   | Alt records pathways   |   | Trends by agency      |
                                  |   | State-level options    |   | Denial & success rate |
                                  |   | Journalist networks    |   | tracking              |
                                  |   | Whistleblower &        |   | Benchmark vs.         |
                                  |   | congressional paths    |   | historical outcomes   |
                                  |   +-----------+-----------+   +-----------+-----------+
                                  |               |                           |
                                  +-------+-------+---------------------------+
                                          |
                                          v
                             +---------------------------------------------+
                             |  OUTCOME : GOVERNMENT ACCOUNTABILITY        |
                             |  Documents released. Patterns exposed.       |
                             |  Collective knowledge base grows.            |
                             +---------------------------------------------+
                                          |
                                          |  Every outcome feeds back into
                                          |  the system's intelligence
                                          +-----------------------------------> PHASE 2
```

## Who It's For

- **Journalists** investigating government activity and needing documents fast
- **Lawyers and legal organizations** filing records requests on behalf of clients
- **Researchers and academics** studying government policy, enforcement, and spending
- **Civic organizations and nonprofits** holding agencies accountable
- **Concerned citizens** exercising their right to public information

## Multi-Jurisdiction Support

FOIA is just the federal law. Every US state has its own public records law with different names, rules, and teeth:

| State | Law Name | Key Differences |
|-------|----------|----------------|
| Federal | FOIA | 9 exemptions, 20 business day deadline, OGIS mediation |
| New York | FOIL (Freedom of Information Law) | 5 business day acknowledge, 20 day response, COOG appeals |
| California | CPRA (California Public Records Act) | 10-day deadline, "catch-all" exemption, strong fee waivers |
| Texas | PIA (Public Information Act) | 10 business days, AG decides disputes, narrow exemptions |
| Florida | Sunshine Law | No specific deadline, broad access, criminal penalties for violations |
| ... | ... | 50 states + DC + territories |

FOIA Fluent starts with **New York (FOIL)** and **federal FOIA**, then expands state by state. The platform automatically applies the correct law based on the target agency's jurisdiction — citing the right statute, enforcing the right deadlines, and knowing the right appeal body.

## Key Data Sources

| Source | What It Provides |
|--------|-----------------|
| [MuckRock](https://www.muckrock.com) | Existing FOIA requests, agency response data, request templates |
| [DocumentCloud](https://www.documentcloud.org) | Searchable repository of public-interest documents |
| [data.gov](https://data.gov) | Federal open data across agencies |
| Agency reading rooms | Documents proactively disclosed by federal agencies |
| State FOIA portals | State-level public records request systems |

## Project Status

FOIA Fluent is in **early development**. We are building the platform as open-source software with the goal of making government transparency accessible to everyone — not just those with legal expertise or institutional backing.

## Contributing

This project is open source. If you're interested in civic tech, FOIA, or government accountability, we welcome contributions. See the issues tab or reach out.

## License

MIT
