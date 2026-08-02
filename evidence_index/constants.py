"""
constants.py — every tunable threshold in one place. When you get real
outcome data (closed deals), these are the first numbers to revisit —
most of them start as reasonable, documented defaults rather than
fitted values, because there's no closed-deal history yet to fit them to.
"""

# --- chapter_1 / maturity (roof age) ---
MATURITY_TIERS = [
    # (min_age, level, points)
    (25, 3, 60),
    (20, 2, 50),
    (15, 1, 40),
]
PERMIT_RECENCY_YEARS = 10  # a permit within this window zeroes out maturity evidence

# --- evidence_engine: storm thresholds ---
HAIL_INCHES_THRESHOLD = 1.75
HAIL_POINTS = 14
WIND_MPH_THRESHOLD = 70
WIND_POINTS = 12
SNOW_POINTS = 7
RAIN_POINTS = 5

# --- evidence_engine: ancillary service flags ---
# Initial point values, same order of magnitude as the storm flags above.
# These are starting weights, not fitted ones — there's no ancillary-service
# outcome data yet to fit them to. Revisit once tree/gutter/driveway jobs
# have enough closed-deal volume to compute real effect sizes, the same
# way AeroLeadAI's JS layer learns county/storm/roof weights from outcomes.
TREE_RISK_POINTS = 10
GUTTER_DAMAGE_POINTS = 6
DRIVEWAY_CRACK_POINTS = 5

# --- confidence_engine ---
HUMAN_REVIEW_CONFIDENCE_BOOST = 20  # a human-confirmed lead gets a flat confidence bump, capped at 100

# --- opportunity_engine ---
PROPERTY_VALUE_WEIGHT = 0.4
ROOF_ESTIMATE_WEIGHT = 0.3
ANCILLARY_SERVICE_WEIGHT = 0.5  # ancillary job estimates count at half weight vs. the primary roof estimate

# The original chapter_4 formula produces raw dollar figures (a $320k home
# alone scores ~133,400), but chapter_5's human-review threshold expects a
# 0-100-ish scale (opportunity >= 75) — those two files were inconsistent
# with each other. OPPORTUNITY_NORMALIZATION_DIVISOR converts the raw
# dollar score to a 0-100 scale for review-threshold comparisons; the raw
# dollar figure is still returned separately for real display use. Chosen
# so that a ~$150k raw opportunity score (a strong, typical lead) lands
# around 75 on the normalized scale — revisit once real deal volume shows
# what opportunity level actually predicts conversion.
OPPORTUNITY_NORMALIZATION_DIVISOR = 2000

# --- human_review ---
EVIDENCE_REVIEW_THRESHOLD = 80
CONFIDENCE_REVIEW_THRESHOLD = 60  # review triggers when confidence is AT OR BELOW this
OPPORTUNITY_REVIEW_THRESHOLD = 75

# --- evidence decay (chapter_6, unchanged) ---
DECAY_TIERS = [
    (1, 1.0),
    (3, 0.85),
    (5, 0.7),
]
DECAY_DEFAULT = 0.5
