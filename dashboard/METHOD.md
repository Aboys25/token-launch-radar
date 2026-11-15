# How this radar works

## The question

Which protocol with no token on record is worth farming next, what would
its launch be worth, and what should a reader do? The radar
answers from one frozen snapshot of the protocol universe. On the sealed
snapshot: 758 protocols, of which 342 record no token. It never predicts
whether or when a token is issued. A protocol is called pre-token only
because its record carries no token; the record is not proof it has none.

## The board

198 rows on the sealed snapshot: all 40 watchlist protocols, plus every
other rankable pre-token protocol the watchlist leaves out. 144
pre-token protocols are set aside by the house's exclusion rule —
wrapped, staked or bridged category, a versioned name, a wrapped or
staked word, an exchange's name — because each is a product of a token
that already trades. The protocols whose
token already trades are kept apart: they calibrate the model and appear
in their own view at market values.

## The value model (radar-3)

A comps curve, fitted at run time from the snapshot's traded protocols:
least squares of ln(market cap) on ln(TVL) over the comps resembling the
ranked set; each category's yardstick is its comps' median miss, shrunk
toward zero so thin categories barely move it; growth and maturity tilt
the result within stated bounds.
A curve, not one multiple: the fitted slope is well below 1, so one flat
multiple overvalues the biggest protocols many times over.

## The tests

The curve is tested blind. Leave-one-out: each comp is predicted by a
curve fitted without it. Cohort holdout: the model is fitted on the
earlier-listed half and tested on the later half, on current values
throughout — a holdout by cohort, not a historical forecast — beside a
flat multiple with no adjustments, so the gap is the full model's, not
the curve's alone. Bootstrap: the slope is refitted on 200 resamples.
The page's numbers are the measured results, computed from this snapshot
at run time — including the wide band, the blind test's typical miss,
not a chosen margin.

## The farm plans

Seven steps per protocol, derived from its category, chains, size and
age, each with a cost and a time. The last step nets the plan: the
band's low end times a stated 10% farmer share, against the whole gas
bill, gives the farmers covered and the verdict: FARM, THIN or SKIP.
The 10% is an assumption, labelled as one. The model and the plan
generator are the same code the program runs, so the page recomputes
the opened row and checks the board's numbers.
