const { google } = require('googleapis');

function getJwtClientFromEnv() {
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!key) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is required');
  const credentials = JSON.parse(key);
  return new google.auth.JWT(
    credentials.client_email,
    null,
    credentials.private_key,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
}

async function readSheets(spreadsheetId) {
  const auth = getJwtClientFromEnv();
  await auth.authorize();
  const sheets = google.sheets({ version: 'v4', auth });
  const importRange = 'Import!A1:ZZ1000';
  const controlRange = 'Feed Control List!A1:D1000';
  const resp = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [importRange, controlRange]
  });
  const importValues = (resp.data.valueRanges && resp.data.valueRanges[0].values) || [];
  const controlValues = (resp.data.valueRanges && resp.data.valueRanges[1].values) || [];
  return { importValues, controlValues };
}

module.exports = { readSheets };
