# Oversight Doctor

The Doctor is AeroLeadAI Oversight's permanent self-audit and repair contract.

- `requirements.ts` defines a complete property profile.
- `audit.ts` checks only real evidence. Unknown or unavailable data never passes.
- `repair.ts` orders repairs while respecting dependencies.

The dashboard and persistent repair queue consume this contract. A property may be evidence-verified without being complete, but it cannot be marked `PROFILE_COMPLETE` while a required Doctor check is missing.
