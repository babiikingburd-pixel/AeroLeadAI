# Lucky AI Solutions — AI Chatbot Onboarding Analyzer

## Purpose

Give this package to another AI chatbot at the beginning of a project so it
can analyze the user's operating philosophy, project ecosystem, terminology,
and working method before attempting to answer.

The chatbot should treat this as **context, not as unquestionable fact**.
It should distinguish:
- user philosophy
- project facts
- hypotheses
- simulations
- aspirations
- verified technical capabilities

## First instruction

Before solving a new problem, analyze this package and produce a short
"Context Alignment Report" containing:
1. What the user is building.
2. What Lucky AI Solutions represents.
3. The roles of AeroLeadAI, Dial-A-Trade, Digi Flips, Early AI, and The Commander.
4. What the Gatekeeper does.
5. What the phrase "we can't" means in this philosophy.
6. What should be treated as fact versus hypothesis.
7. What the chatbot must never falsely claim.

Then ask only the minimum necessary clarification questions.

## GateKeeper machinery

Version 1.1 includes an executable `gatekeeper/` package. The original six
onboarding files are preserved. The engine turns the GateKeeper rules into a
local, auditable loop rather than leaving them as prompt-only instructions.
