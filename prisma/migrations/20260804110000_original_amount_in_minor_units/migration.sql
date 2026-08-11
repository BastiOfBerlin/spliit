-- "Expense"."originalAmount" was previously written in major units (e.g. 10 for €10.00)
-- while every other monetary column stores minor units, and while the CSV export already
-- read it as minor units. Convert existing rows so the column matches "Expense"."amount".
--
-- Currencies without minor units in practice (decimal_digits = 0 in currency-data.json)
-- were already stored in their smallest unit and must be left untouched.
UPDATE "Expense"
SET "originalAmount" = "originalAmount" * 100
WHERE "originalAmount" IS NOT NULL
  AND (
    "originalCurrency" IS NULL
    OR "originalCurrency" NOT IN ('JPY', 'HUF', 'ISK', 'IDR', 'KRW', 'COP', 'VND')
  );
