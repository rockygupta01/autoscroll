# Contact Extractor — Chrome Extension

A powerful Chrome Extension that automatically scrolls webpages, extracts contact information (emails, phone numbers, company names, LinkedIn profiles), and exports the data to CSV or Excel.

## Features

- **Auto-Scroll** — Smoothly scrolls from top to bottom, waiting for lazy-loaded content
- **Contact Extraction** — Detects emails, phone numbers, LinkedIn URLs, websites, company names, and person names
- **Duplicate Detection** — Uses email as unique identifier to prevent duplicates
- **Data Table** — View extracted contacts in a sortable table inside the popup
- **Export** — Export to CSV (.csv) or Excel (.xlsx) with one click
- **Auto-Save** — Data persists in Chrome Storage even if the popup closes
- **Progress Dashboard** — Real-time stats for contacts found, emails, phones, and scroll progress
- **Configurable Settings** — Adjust scroll speed, pause duration, max attempts, and more
- **Premium UI** — Modern dark theme with glassmorphism effects and micro-animations

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `autoscroll/` folder
6. The extension icon will appear in your toolbar

## Usage

1. Navigate to any webpage with contact information
2. Click the Contact Extractor icon in your toolbar
3. Click **Start** to begin auto-scrolling and extracting
4. Use **Pause**, **Resume**, or **Stop** to control the scroll
5. View extracted contacts in the data table
6. Click **CSV** or **Excel** to export your data
7. Click **Clear** to remove all stored contacts

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Scroll Speed | Pixels per scroll step | 300px |
| Pause Duration | Wait time after each scroll (for lazy loading) | 2.0s |
| Max Scroll Attempts | Attempts before declaring bottom reached | 3 |
| Ignore Duplicates | Skip contacts with duplicate emails | On |
| Enable Phone Extraction | Extract phone numbers | On |

## Project Structure

```
autoscroll/
├── manifest.json        # Chrome Extension manifest (V3)
├── background.js        # Service worker — message relay & downloads
├── content.js           # Content script — auto-scroll & extraction engine
├── utils.js             # Shared regex patterns & extraction utilities
├── exporter.js          # CSV & XLSX export (no external dependencies)
├── popup.html           # Popup UI structure
├── popup.css            # Premium dark theme styling
├── popup.js             # Popup controller logic
├── icons/               # Extension icons (16, 48, 128px)
└── README.md            # This file
```

## Permissions

| Permission | Purpose |
|------------|---------|
| `activeTab` | Access the current tab to inject the content script |
| `scripting` | Programmatically inject content.js into the active tab |
| `storage` | Persist extracted contacts and user settings |
| `downloads` | Trigger CSV/XLSX file downloads |
| `tabs` | Read the active tab URL to record the source page |

## Technical Notes

- **Manifest V3** — Uses modern service worker architecture
- **No external libraries** — Pure JavaScript, including the XLSX generator
- **Deduplication** — Email-based dedup across sessions
- **Non-blocking extraction** — Content script yields to the main thread between scan batches
- **Ephemeral service worker** — All state in `chrome.storage`, never in global variables

## Known Limitations

- **Person name extraction** is heuristic-based and may not work on all page layouts
- **Phone number extraction** may pick up false positives (e.g., order numbers, zip codes)
- **Single page at a time** — Extension scrolls the active tab only
- **XLSX export** produces basic formatting (no cell colors or auto-filters)

## License

MIT
