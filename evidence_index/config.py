"""
config.py

COUNTY_MULTIPLIERS starts fully neutral (1.0 everywhere) on purpose.
There's no real historical performance data for these six counties yet —
AeroLeadAI's JS intelligence layer already builds exactly this kind of
learned weight (see county_weights / strategyEngine.js) from actual
closed-deal outcomes. Once this Python pipeline and that system share a
data store (or once this pipeline accumulates its own closed-deal
history), replace these 1.0s with real computed values the same way —
never hand-tune a plausible-sounding number here.
"""

SUPPORTED_COUNTIES = ["hennepin", "ramsey", "dakota", "scott", "carver", "anoka"]

COUNTY_MULTIPLIERS = {county: 1.0 for county in SUPPORTED_COUNTIES}

# NWS/NOAA is free and keyless — https://www.weather.gov/documentation/services-web-api
NWS_API_BASE = "https://api.weather.gov"
NWS_USER_AGENT = "AeroLeadAI EvidenceIndex (contact: set-your-email-here@example.com)"
