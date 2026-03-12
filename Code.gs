/**
 * Olly's Card Scanner — Google Apps Script
 * ─────────────────────────────────────────
 * SETUP STEPS:
 *  1. Go to https://script.google.com → New project
 *  2. Paste this entire file into the editor, replacing any default code
 *  3. Edit SHEET_NAME below if needed
 *  4. Click Deploy → New Deployment → Web App
 *     • Execute as:  Me
 *     • Who has access:  Anyone
 *  5. Authorise when prompted
 *  6. Copy the Web App URL and paste it into your backend .env as GOOGLE_APPS_SCRIPT_URL
 */

const SHEET_NAME = 'Cards';  // ← change if you want a different tab name

// ── Column headers (order matters) ────────────────────────────────────────
const HEADERS = [
  'Timestamp',
  'Contact Name',
  'Brand Name',
  'Store Count',
  'City',
  'Phone',
  'Email',
  'Category',
  'Submitted By',
  'Submitter Email',
];

// ── doPost: receives data from the backend ────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    let sheet   = ss.getSheetByName(SHEET_NAME);

    // Auto-create the sheet + headers if it doesn't exist
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, HEADERS.length)
           .setBackground('#1a1916')
           .setFontColor('#e8a847')
           .setFontWeight('bold');
    }

    const row = [
      data.timestamp      || new Date().toISOString(),
      data.name           || '',
      data.brandName      || '',
      data.storeCount     || '',
      data.city           || '',
      data.phone          || '',
      data.email          || '',
      data.category       || '',
      data.submittedBy    || '',
      data.submitterEmail || '',
    ];

    sheet.appendRow(row);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true, row: row.length }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── doGet: basic health check ─────────────────────────────────────────────
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', service: "Olly's Card Scanner GAS" }))
    .setMimeType(ContentService.MimeType.JSON);
}
