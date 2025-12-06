import { google } from 'googleapis';
import { ensureAuth } from '../lib/sheetsClient.js'; 
import { buildOffersXml } from '../lib/feedBuilder.js'; 

const CACHE_TTL_SECONDS = 300; 

async function readSheetData(sheets, spreadsheetId) {
  const importRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Import!A1:ZZ' });
  const controlRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Feed Control List!A1:F' });
  const deliveryRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Delivery!A1:C' });

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

  try {
    const { sheets, spreadsheetId } = await ensureAuth();
    const { importValues, controlValues, deliveryValues } = await readSheetData(
      sheets,
      spreadsheetId
    );

    const xmlOutput = await buildOffersXml(importValues, controlValues, deliveryValues);

    res.setHeader('Content-Type', "application/xml; charset=utf-8");
    res.setHeader('Cache-Control', `public, s-maxage=${CACHE_TTL_SECONDS}, max-age=0`);
    res.status(200).send(xmlOutput);
    
  } catch (e) {
    console.error('Error in /api/monomarket-offers', e);
    res.status(502).json({ error: 'Bad Gateway', details: e.message });
  }
}
