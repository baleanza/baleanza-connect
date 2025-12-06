import { google } from 'googleapis';
import { getSheetsClient } from '../lib/sheetsClient.js';
import { getInventoryBySkus } from '../lib/wixClient.js';
import { buildStockJson } from '../lib/stockFeedBuilder.js';

const CACHE_TTL_SECONDS = 300; // 5 минут кеша

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function checkApiKey(req) {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return true;
  const headerKey = req.headers['x-api-key'];
  return headerKey && headerKey === apiKey;
}

async function ensureAuth() {
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

async function readSheetData(sheets, spreadsheetId) {
  // 1. Читаем товары (Import)
  const importRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Import!A1:ZZ'
  });

  // 2. Читаем настройки полей (Feed Control List)
  const controlRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Feed Control List!A1:F'
  });

  // 3. Читаем настройки доставки (Delivery)
  const deliveryRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: 'Delivery!A1:C'
  });

  return { 
    importValues: importRes.data.values || [], 
    controlValues: controlRes.data.values || [],
    deliveryValues: deliveryRes.data.values || [] 
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  if (!checkApiKey(req)) {
    res.status(401).send('Unauthorized');
    return;
  }

  try {
    const { sheets, spreadsheetId } = await ensureAuth();
    const { importValues, controlValues, deliveryValues } = await readSheetData(
      sheets,
      spreadsheetId
    );

    // Генерируем JSON
    const jsonOutput = await buildStockJson(importValues, controlValues, deliveryValues, getInventoryBySkus);

    res.setHeader('Content-Type', "application/json; charset=utf-8");
    res.setHeader('Cache-Control', `public, s-maxage=${CACHE_TTL_SECONDS}, max-age=0`);
    res.status(200).send(jsonOutput);
    
  } catch (e) {
    console.error('Error in /api/monomarket-stock', e);
    // Возвращаем JSON с ошибкой
    res.status(502).json({ error: 'Bad Gateway', details: e.message });
  }
}
