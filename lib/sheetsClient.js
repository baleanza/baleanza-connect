import { google } from 'googleapis';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export async function ensureAuth() {
  const keyJson = requireEnv('GOOGLE_SERVICE_ACCOUNT_KEY');
  const spreadsheetId = requireEnv('SPREADSHEET_ID');
  const keyObj = JSON.parse(keyJson);

  const jwtClient = new google.auth.JWT(
    keyObj.client_email,
    null,
    keyObj.private_key,
    ['https://www.googleapis.com/auth/spreadsheets.readonly']
  );
  await jwtClient.authorize();


  const sheets = getSheetsClient(jwtClient); 
  return { sheets, spreadsheetId };
}

export function getSheetsClient(auth) {
  return google.sheets({ version: 'v4', auth });
}
