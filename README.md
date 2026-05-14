# Parametric Insurance Actuarial Demo

This repository contains a front-end demo that turns the source actuarial framework into four interactive modules:

- Pricing engine: Poisson trigger probability, linear parametric payout, pure premium, and gross premium.
- Capital & risk transfer: illustrative loss simulation, 99.5% VaR / TVaR, retention, reinsurance, and Cat Bond layers.
- IFRS 17 PAA: simplified revenue recognition, LRC runoff, and claim recognition for a short-duration contract.
- ALM: rapid payout liquidity pool, short-duration asset mix, stablecoin payout pool, and capital charge lens.

## Key assumptions

- `lambda` is interpreted as the annual intensity of trigger-eligible events, not all weather events.
- Conditional on a trigger, the hazard index `Z` is approximated with a normal distribution for demo purposes.
- The affected portfolio share is a common-shock exposure assumption, not a statistical correlation model.
- Capital simulation uses 8,000 scenarios and is illustrative. A production actuarial model should use calibrated hazard distributions, tail stress testing, and a larger or variance-reduced simulation setup.
- The IFRS 17 module is a simplified PAA illustration and is not a complete IFRS 17 valuation engine.

Open `index.html` directly, or serve the folder locally:

```bash
python3 -m http.server 8765
```

Then visit `http://127.0.0.1:8765/index.html`.
