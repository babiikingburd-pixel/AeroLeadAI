# SHARED OPPORTUNITY CONTRACT — AEROLEADAI -> DIAL-A-TRADE

This is the eventual integration boundary. It is deliberately data-contract
based so the two projects can evolve independently.

Required fields:
- opportunity_id
- property_id
- trade
- evidence[]
- evidence_timestamp
- confidence
- predicted_need
- predicted_time_window
- estimated_value
- customer_authorization_status
- provenance[]
- model_version

Rules:
1. AeroLeadAI may create and update opportunities.
2. Dial-A-Trade may accept, reject, request clarification, match, schedule,
   dispatch, verify, and report outcomes.
3. No system may silently convert an inference into a fact.
4. Every action must be traceable to evidence and model/version state.
5. Outcomes flow back as observations; they do not rewrite historical evidence.
6. Integration happens only after both tracks pass their own 90-day gates.
