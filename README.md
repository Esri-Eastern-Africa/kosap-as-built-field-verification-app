# Minigrid Asset Verification

A full-screen web map (Esri **Calcite Components** + **ArcGIS Maps SDK for JavaScript 4.33**)
for field-verifying as-built minigrid assets.

It signs users in with **OAuth 2.0** against the Esri Eastern Africa enterprise portal,
shows only the **unverified** features of the *Minigrid Assets* feature service
(Utility Poles, Transformers, Lines), and lets a signed-in user verify an asset from
its popup — stamping `is_verified = 'True'`, `verified_by`, and `verification_date`.
Once verified, the feature drops out of the filter and disappears from the map.

## Files
- `index.html` — Calcite shell, sign-in overlay, map container
- `app.js` — OAuth, layers, popups, verify logic (**all config lives in `CONFIG` at the top**)
- `style.css` — layout

---

## One-time setup: get your OAuth App ID

OAuth needs a registered **Application** item in the portal to obtain a Client ID (App ID).
An application item has already been created for you:

- **Title:** `Minigrid Asset Verification App`
- **Item id:** `95b1af9c29fe41d09a122428f3425ee0`
- **URL:** https://development.esriea.com/portal/home/item.html?id=95b1af9c29fe41d09a122428f3425ee0

> This portal (ArcGIS Enterprise 2025.2) does not allow completing app registration
> over the REST API, so finish it in the portal UI:

1. Open the item URL above and sign in as the item owner.
2. Go to the **Settings** tab → scroll to **App Registration** → click **Registered Info**
   (or **Register** if it hasn't been registered yet).
3. Under **Redirect URIs**, add the URL(s) you will load the app from, e.g.:
   - `http://localhost:8080`
   - (and your production URL later, e.g. `https://gis.example.com/verify`)
4. Copy the **App ID** (Client ID).
5. Paste it into `app.js`:
   ```js
   const CONFIG = {
     ...
     appId: "PASTE_YOUR_APP_ID_HERE",
     ...
   };
   ```

> The redirect URI must match **exactly** the origin + path the app is served from.
> Serving at `http://localhost:8080/` → register `http://localhost:8080`.

---

## Run it

OAuth will not work from `file://` — serve over HTTP:

```bash
# from this folder
python -m http.server 8080
#  → open http://localhost:8080
```
or
```bash
npx http-server -p 8080
```

Then open the URL, click **Sign in with ArcGIS**, and authenticate.

---

## Notes
- **Filter:** `is_verified = 'False' OR is_verified IS NULL` (the `is_verified` field is a
  string with coded domain `True`/`False`).
- **Editing:** all three layers expose `Update` capability; `verified_by` is set to the
  signed-in username, `verification_date` to the current date/time.
- To change field names, the service URL, or the portal, edit the `CONFIG` object in `app.js`.
