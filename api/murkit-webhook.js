import { createWixOrder, getProductsBySkus, findWixOrderByExternalId } from '../lib/wixClient.js';
import { ensureAuth } from '../lib/sheetsClient.js'; 

const WIX_STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e"; 

// === НАСТРОЙКИ НАЗВАНИЙ ДОСТАВКИ ===
const SHIPPING_TITLES = {
    BRANCH: "НП Відділення", 
    COURIER: "НП Кур'єр"
};

function checkAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;
  const b64auth = authHeader.split(' ')[1];
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');
  return login === process.env.MURKIT_USER && password === process.env.MURKIT_PASS;
}

async function readSheetData(sheets, spreadsheetId) {
  const importRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Import!A1:ZZ' });
  const controlRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Feed Control List!A1:F' });
  return { 
    importValues: importRes.data.values || [], 
    controlValues: controlRes.data.values || [] 
  };
}

function getProductSkuMap(importValues, controlValues) {
    const headers = importValues[0] || [];
    const rows = importValues.slice(1);
    const controlHeaders = controlValues[0] || [];
    const controlRows = controlValues.slice(1);

    const idxImportField = controlHeaders.indexOf('Import field');
    const idxFeedName = controlHeaders.indexOf('Feed name');

    let murkitCodeColRaw = '';
    let wixSkuColRaw = '';

    controlRows.forEach(row => {
        const importField = row[idxImportField];
        const feedName = row[idxFeedName];
        if (feedName === 'code') murkitCodeColRaw = String(importField).trim();
        if (feedName === 'id') wixSkuColRaw = String(importField).trim();
    });
    
    const murkitCodeColIndex = headers.indexOf(murkitCodeColRaw);
    const wixSkuColIndex = headers.indexOf(wixSkuColRaw);
    
    if (murkitCodeColIndex === -1 || wixSkuColIndex === -1) return {};

    const map = {};
    rows.forEach(row => {
        const mCode = row[murkitCodeColIndex] ? String(row[murkitCodeColIndex]).trim() : '';
        const wSku = row[wixSkuColIndex] ? String(row[wixSkuColIndex]).trim() : '';
        if (mCode && wSku) map[mCode] = wSku;
    });
    return map;
}

const fmtPrice = (num) => parseFloat(num || 0).toFixed(2);

function getFullName(nameObj) {
    if (!nameObj) return { firstName: "Client", lastName: "" };
    return {
        firstName: String(nameObj.first || nameObj.firstName || "Client"),
        lastName: String(nameObj.last || nameObj.lastName || "")
    };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  if (!checkAuth(req)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const murkitData = req.body;
    const murkitOrderId = String(murkitData.number);
    console.log(`Processing Murkit Order #${murkitOrderId}`);

    // === ШАГ 0: ДЕДУПЛИКАЦИЯ ===
    const existingOrder = await findWixOrderByExternalId(murkitOrderId);
    if (existingOrder) {
        console.log(`Order #${murkitOrderId} already exists. ID: ${existingOrder.id}`);
        return res.status(200).json({ "id": existingOrder.id });
    }

    // === СОЗДАНИЕ ЗАКАЗА ===
    const murkitItems = murkitData.items || [];
    if (murkitItems.length === 0) return res.status(400).json({ error: 'No items in order' });

    const currency = "UAH";

    // 1. Sheets
    const { sheets, spreadsheetId } = await ensureAuth();
    const { importValues, controlValues } = await readSheetData(sheets, spreadsheetId);
    const codeToSkuMap = getProductSkuMap(importValues, controlValues);
    
    // 2. Resolve SKUs
    const wixSkusToFetch = [];
    const itemsWithSku = murkitItems.map(item => {
        const mCode = String(item.code).trim();
        const wSku = codeToSkuMap[mCode] || mCode;
        if(wSku) wixSkusToFetch.push(wSku);
        return { ...item, wixSku: wSku };
    });

    if (wixSkusToFetch.length === 0) {
        return res.status(400).json({ error: 'No valid SKUs found to fetch from Wix' });
    }

    // 3. Fetch Wix Products
    const wixProducts = await getProductsBySkus(wixSkusToFetch);
    
    // 4. Line Items
    const lineItems = [];
    
    for (const item of itemsWithSku) {
        const requestedQty = parseInt(item.quantity || 1, 10);
        const targetSku = item.wixSku;

        const productMatch = wixProducts.find(p => {
            if (String(p.sku) === targetSku) return true;
            if (p.variants) return p.variants.some(v => String(v.variant?.sku) === targetSku);
            return false;
        });

        if (!productMatch) {
            throw new Error(`Product with SKU '${targetSku}' (Murkit Code: ${item.code}) not found in Wix.`);
        }

        let catalogItemId = productMatch.id; 
        let variantId = null;
        let stockData = productMatch.stock;
        let productName = productMatch.name;
        
        // Картинка
        let imageObj =
