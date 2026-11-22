# How this radar works

Which protocol with no token on record is worth farming next, what would
its launch be worth, and what should a reader do? One frozen snapshot:
758 protocols, 342 with no token on record. It never predicts whether or
when a token is issued.

198 rows: all 40 watchlist protocols, plus every other rankable
pre-token protocol. 144 are set aside by the house rule (wrapped/staked/
bridged category, versioned name, wrapped/staked word, exchange name),
listed by name on the Set aside tab. Live-token protocols calibrate the
model.

Every term is fitted at run time from the traded comps by median
regression on ln(market cap): ln(mcap) = b0 + b1 ln(TVL) + b2 growth +
b3 ln(1+age) + category. No tilt is hand-set. Growth is winsorized,
unknown ages take the comps' median age, each category's effect is its
shrunken median residual, the shrinkage chosen by leave-one-out. The
fitted growth coefficient is positive, the age coefficient slightly
negative. Launch odds are empirical, by age/TVL cohort.

Three blind tests, all computed at run time. Leave-one-out: each comp
predicted by a model fitted without it; the median miss is the band on
every row. Walk-forward: four expanding windows on listing date. Random
holdouts: five seeded 70/30 splits against a flat multiple, median
reported with the worst seed included.

Seven steps per protocol, each varying with a fact about it: wallet by
chain family, action and weekly action by category group, hold by age
band and peers' launch odds, claim by category group, log by verdict.
Each step carries a cost and a time. The last step nets the plan: the
band's low end times a stated 10% farmer share, against the whole gas
bill, gives the farmers covered and the verdict: FARM, THIN or SKIP. The
10% is an assumption, labelled as one. Rows carry integrity flags where
the model leans on a fallback.
