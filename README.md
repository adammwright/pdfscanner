# PDF Scanner

A browser-based tool for scanning PDF documents for sensitive keywords and flagged image content.

> **Security**: Documents are processed entirely in your browser. No files are ever uploaded or stored anywhere.

---

## Enabling GitHub Pages (one-time setup)

1. Go to your repository on GitHub: `https://github.com/adammwright/pdfscanner`
2. Click the **Settings** tab (top right area of the repo page)
3. In the left sidebar, click **Pages**
4. Under **Source**, select **Deploy from a branch**
5. Set **Branch** to `main` and the folder to `/ (root)`
6. Click **Save**
7. Wait about 60 seconds, then refresh the page — you'll see a banner with your live URL:

```
https://adammwright.github.io/pdfscanner/
```

Share this URL with your team. That's it — no accounts, no installs.

---

## How to use

1. Open the URL in any modern browser (Chrome, Firefox, Edge, Safari)
2. The **Keywords** panel shows the default list — you can remove any or add new ones
3. Click the upload area or drag a PDF onto it
4. Click **Scan PDF**
5. A progress bar tracks the scan page by page
6. Results appear in a table when complete
7. Click **Download CSV** to save the findings

---

## What the CSV contains

| Column   | Description                                              |
|----------|----------------------------------------------------------|
| Keyword  | The keyword or phrase matched (or `[image]` for images)  |
| Page     | Page number in the document                              |
| Context  | ~120 characters of surrounding text                     |

Pages containing embedded images are listed separately (highlighted yellow in the results table) for manual review — check these pages for maps.

---

## Keywords

- Keywords are **saved in your browser** and remembered between sessions
- Each team member's browser saves their own keyword list independently
- To reset to the original defaults, clear your browser's local storage for this site:
  - Chrome: Settings → Privacy → Clear browsing data → Cached images and files / Site data

---

## Notes

- Works with **native digital PDFs** (where you can highlight and copy text)
- Matching is **case-insensitive** — `Tibet` matches `tibet`, `TIBET`, `Tibetan`
- Multi-word phrases (`Hong Kong`, `Dalai Lama`) are matched correctly
- If a page has no text (e.g. a full-page image), keywords won't be found there — but the page will still be flagged if it contains an embedded image
