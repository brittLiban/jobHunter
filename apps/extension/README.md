# JobHunter Browser Extension (MVP)

This extension enables **in-tab autofill** for real application pages.

It uses a user-scoped extension token to fetch prepared packets from JobHunter and fills the current page in your browser session. You submit manually.

## Folder

- Chrome extension source: `apps/extension/chrome`

## Install (Edge Recommended)

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select `apps/extension/chrome`.

Chrome also works with the same folder using `chrome://extensions`.

## Configure

1. In JobHunter, open **Settings** and create an extension token.
2. Click the extension icon.
3. Set:
   - API Base URL (default `http://localhost:3000`)
   - Extension Token (`jhx_...`)
4. Save config.

## Usage

Option A:

1. In Review Queue, click **Open for extension autofill**.
2. The page opens with `jhApplicationId` in the URL.
3. Extension auto-fills once.

Option B:

1. Open any supported application page.
2. Open extension popup.
3. Optionally paste Application ID.
4. Click **Autofill current tab**.

## Notes

- Autofill runs across embedded application frames (for hosted ATS embeds like Greenhouse-in-company-page).
- Form fields are discovered across open shadow roots, not only flat DOM.
- Resume upload is attempted in-tab via file input assignment and attach/upload button reveal pass.
- If upload is blocked by site controls, upload manually.
- CAPTCHA and verification prompts are not bypassed.
- **Refresh tailored resume + answers** is enabled by default so each fill can use job-specific material.
- LLM refresh requests are semantically cached in `data/cache/llm-semantic-cache.json` to avoid repeated token spend for equivalent inputs.
- Saved unresolved-answer overrides from JobHunter are reused by extension autofill when labels match.
- Popup status now reports no-fill cases explicitly instead of showing a false successful done state.
