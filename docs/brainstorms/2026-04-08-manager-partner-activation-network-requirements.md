---
date: 2026-04-08T00:00:00.000Z
topic: manager-partner-activation-network
---

# Partner Activation Network for Manager App

## Problem Frame

The manager app is currently built for internal operators, but distribution outcomes depend on partners who need localized guidance and collaboration space. A stronger next phase is a partner-facing network inside the manager ecosystem: partner profiles with location and audience context, AI-recommended next steps, campaign collaboration, and lightweight community mechanics such as chat rooms. That turns manager from a production console into an activation system.

## Requirements

- R1. Introduce a dedicated Partner role in the manager auth model with its own dashboard and permissions.
- R2. Each partner has a profile with location, audience, ministry context, preferred languages, and allowed campaign scope.
- R3. The partner dashboard recommends videos, topic pages, and next steps based on location, topic fit, and partner profile.
- R4. Managers can package and share campaign kits that partners can launch or localize.
- R5. The portal includes lightweight partner collaboration spaces for campaign coordination, similar to a focused chat workspace rather than a public social network.
- R6. Partner activity and feedback improve future recommendations and reveal which audiences need more support.

## Success Criteria

- A partner can log in and immediately see what to do next for their audience without needing manual coaching.
- Managers can coordinate distributed campaigns without leaving the platform.
- Partner activity produces usable signals for improving recommendations and support.

## Scope Boundaries

- Not a full CRM replacement.
- Not a public community platform open to everyone.
- Not a payment, prize-fulfillment, or grant-management system.

## Key Decisions

- Partner profile data is treated as core recommendation input, not optional metadata.
- Chat and campaign workflows live inside authenticated partner contexts, because the goal is activation and coordination rather than open conversation.
- The portal stays manager-adjacent so internal teams and partners operate from the same source of truth.

## Dependencies / Assumptions

- Recommendation quality improves materially once topic programming and localized content packaging exist.
- Strapi roles and manager auth can support a second external-facing role without a separate application.

## Outstanding Questions

### Deferred to Planning

- [Affects R3][Technical] What minimum partner profile fields are required for good recommendations without making onboarding too heavy?
- [Affects R5][Technical] Should collaboration start as channel-style threads attached to campaigns, or as direct partner-to-manager messaging only?

## Next Steps

-> `/ce:plan` for structured implementation planning
