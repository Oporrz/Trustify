# Trustify Multi-role Starter (Web + Server)
## Frontend
Open `web/splash.html` with Live Server → follow flow (Welcome → Login/Guest → Home → Scan/History/Report).
## Backend + SQL
```
cd server
cp .env.example .env
# Fill SQL or AAD credentials
npm i
npm start
```
Then set backend URL in browser console:
```js
localStorage.setItem('backend_url','http://localhost:8787')
```
Product lookups will use your SQL via `/api/products?code=...`.
## Trustify AI
- OCR: Tesseract.js in `scan.html`
- Risk scoring: `trustify-ai.js`
- Points/History: localStorage
