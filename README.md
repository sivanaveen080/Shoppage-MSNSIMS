# MSN Mobile — SIM plans and recharge request demo

This is the updated SimStore project with operator branding set to **MSN**.

## Install and run
1. Stop the currently running server with Ctrl+C.
2. Extract this ZIP into a new folder, and open the folder that directly contains `package.json`.
3. In VS Code Terminal run:
   ```powershell
   npm.cmd install
   npm.cmd start
   ```
4. Open http://localhost:3000.

This version uses Express and `sql.js` (SQLite via WebAssembly), so it avoids native C++ compilation.

## New behavior
- Operator branding and sample plan names use MSN.
- Clicking a plan opens the order form and asks for the customer's name and mobile number.
- "Search previous orders for this number" looks up previously saved orders for the exact number.
- "Create order" writes a new order to the SQLite database with Pending status.
- Existing product records are migrated from Jawwy to MSN automatically on server startup.

## Database
The database is `simstore.sqlite`, created beside `server.js`. It contains:
- `products`: plan name, category, description, price and allowances.
- `orders`: customer, phone, selected product, amount, status and created timestamp.

## Important
Sample prices/allowances are for prototype purposes only. This is not affiliated with Jawwy/stc. The site does not process payments, activate SIM/eSIM, or execute real recharges. Order lookup is a demo and should be protected with customer verification/authentication before production. Use authorized telecom and payment APIs for real transactions.
