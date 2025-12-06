// lib/sheetsClient.js
import { google } from 'googleapis';

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export function getSheetsClient(auth) {
  return google.sheets({ version: 'v4', auth });
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

export function cleanPrice(val) {
  if (!val) return 0;
  let str = String(val).trim().replace(/\s/g, '').replace(',', '.');
  return parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
}
