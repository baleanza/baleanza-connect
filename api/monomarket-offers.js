import { google } from 'googleapis';
import { ensureAuth } from '../lib/sheetsClient.js'; 
import { buildOffersXml } from '../lib/feedBuilder.js'; 
import { getInventoryBySkus } from '../lib/wixClient.js';

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

async function getInventory(importValues, controlValues) {
    const headers = importValues[0] || [];
    const rows = importValues.slice(1);
    const controlHeaders = controlValues[0] || [];
    const controlRows = controlValues.slice(1);

    const idxImportField = controlHeaders.indexOf('Import field');
    const idxFeedName = controlHeaders.indexOf('Feed name');
    
    // 1. Создаем маппинг полей
    const fieldMapping = {};
    controlRows.forEach(row => {
        const importField = row[idxImportField];
        const feedName = row[idxFeedName];
        if (importField && feedName) {
            fieldMapping[String(feedName).trim()] = String(importField).trim();
        }
    });

    // 2. Находим индекс колонки SKU
    const skuSheetHeader = fieldMapping['sku'] || 'SKU';
    const skuHeaderIndex = headers.indexOf(skuSheetHeader);
    
    if (skuHeaderIndex === -1) {
        console.warn(`SKU column '${skuSheetHeader}' not found in Import sheet.`);
        return { inventoryMap: {} };
    }

    // 3. Собираем уникальные SKU
    const skus = [];
    rows.forEach(row => {
        const sku = row[skuHeaderIndex] ? String(row[skuHeaderIndex]).trim() : '';
        if (sku) skus.push(sku);
    });

    const uniqueSkus = [...new Set(skus)];

    // 4. Запрашиваем остатки
    const inventory = await getInventoryBySkus(uniqueSkus);
    
    // 5. Создаем карту SKU -> Inventory Item
    const inventoryMap = {};
    inventory.forEach(item => {
        inventoryMap[String(item.sku).trim()] = item;
    });
    
    return { inventoryMap };
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

    // Получаем данные о запасах из Wix
    const { inventoryMap } = await getInventory(importValues, controlValues);
    
    // Передаем inventoryMap в buildOffersXml (четвертым аргументом)
    const xmlOutput = await buildOffersXml(importValues, controlValues, deliveryValues, inventoryMap);

    res.setHeader('Content-Type', "application/xml; charset=utf-8");
    res.setHeader('Cache-Control', `public, s-maxage=${CACHE_TTL_SECONDS}, max-age=0`);
    res.status(200).send(xmlOutput);
    
  } catch (e) {
    console.error('Error in /api/monomarket-offers', e);
    res.status(502).json({ error: 'Bad Gateway', details: e.message });
  }
}
