# ledgerline

Import the CSV statements your bank lets you download, and reconcile them
against a plain JSON ledger.

```sh
ledgerline import statements/2026-09.csv
ledgerline reconcile
```

Amounts are stored as integer cents. Dates are read in the bank's locale and
stored as UTC days.
