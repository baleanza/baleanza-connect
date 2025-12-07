import { createWixOrder, getProductsBySkus } from '../lib/wixClient.js';
import { ensureAuth } from '../lib/sheetsClient.js'; // Добавлен импорт для работы с Google Sheets

// Проверка Basic Auth (Логин/Пароль, которые вы зададите в Murkit)
function checkAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;

  const b64auth = authHeader.split(' ')[1];
  const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

  const expectedUser = process.env.MURKIT_USER;
  const expectedPass = process.env.MURKIT_PASS;

  return login === expectedUser && password === expectedPass;
}

// Новая функция для чтения данных Sheets
async function readSheetData(sheets, spreadsheetId) {
  const importRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Import!A1:ZZ' });
  const controlRes = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'Feed Control List!A1:F' });

  return { 
    importValues: importRes.data.values || [], 
    controlValues: controlRes.data.values || [] 
  };
}

// Функция для создания карты: Murkit Code -> Wix SKU
function getProductSkuMap(importValues, controlValues) {
    const headers = importValues[0] || [];
    const rows = importValues.slice(1);
    const controlHeaders = controlValues[0] || [];
    const controlRows = controlValues.slice(1);

    const idxImportField = controlHeaders.indexOf('Import field');
    const idxFeedName = controlHeaders.indexOf('Feed name');

    // 1. Определяем имена колонок в Sheets для Murkit Code (из фида code) и Wix SKU (из фида id)
    let murkitCodeSheetField = '';
    let wixSkuSheetField = '';

    controlRows.forEach(row => {
        const importField = row[idxImportField];
        const feedName = row[idxFeedName];
        if (feedName === 'code') murkitCodeSheetField = String(importField).trim();
        if (feedName === 'id') wixSkuSheetField = String(importField).trim();
    });
    
    // 2. Находим индексы этих колонок
    const murkitCodeColIndex = headers.indexOf(murkitCodeSheetField);
    const wixSkuColIndex = headers.indexOf(wixSkuSheetField);
    
    if (murkitCodeColIndex === -1 || wixSkuColIndex === -1) {
        console.warn(`Cannot find required mapping columns (Code: ${murkitCodeSheetField}, SKU: ${wixSkuSheetField}) in Import sheet.`);
        return {};
    }

    // 3. Создаем карту Murkit Code -> Wix SKU
    const map = {};
    rows.forEach(row => {
        const murkitCode = row[murkitCodeColIndex] ? String(row[murkitCodeColIndex]).trim() : '';
        const wixSku = row[wixSkuColIndex] ? String(row[wixSkuColIndex]).trim() : '';
        if (murkitCode && wixSku) {
            map[murkitCode] = wixSku;
        }
    });
    
    return map;
}


export default async function handler(req, res) {
  // Murkit шлет POST запрос
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // 1. Проверяем авторизацию
  if (!checkAuth(req)) {
    console.warn('Unauthorized access attempt to Murkit Webhook');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const murkitData = req.body;
    console.log('New Order from Murkit:', JSON.stringify(murkitData, null, 2));

    const murkitItems = murkitData.items || [];
    if (murkitItems.length === 0) {
      res.status(400).json({ error: 'No items in order' });
      return;
    }

    // **** КЛЮЧЕВОЙ ШАГ: ЗАГРУЗКА И СОЗДАНИЕ КАРТЫ СОПОСТАВЛЕНИЯ ****
    const { sheets, spreadsheetId } = await ensureAuth();
    const { importValues, controlValues } = await readSheetData(sheets, spreadsheetId);
    
    const codeToSkuMap = getProductSkuMap(importValues, controlValues);
    if (Object.keys(codeToSkuMap).length === 0) {
        throw new Error('Failed to load Murkit Code -> Wix SKU mapping from Google Sheets.');
    }
    // ***************************************************************

    // 2. Собираем все Wix SKU из заказа Murkit (через сопоставление)
    const murkitCodes = murkitItems.map(item => String(item.code).trim()).filter(Boolean);
    const wixSkus = murkitCodes
      .map(code => codeToSkuMap[code])
      .filter(Boolean);

    if (wixSkus.length === 0) {
        res.status(400).json({ error: 'None of the Murkit product codes could be mapped to a Wix SKU.' });
        return;
    }

    // 3. Ищем эти товары в Wix, чтобы получить их ID
    const wixProducts = await getProductsBySkus(wixSkus);
    
    // Создаем карту: Wix SKU -> Wix Product ID
    const skuToIdMap = {};
    wixProducts.forEach(p => {
      skuToIdMap[p.sku] = p.id;
    });

    // 4. Формируем Line Items для Wix
    const lineItems = murkitItems.map(item => {
        // Получаем Wix SKU из Murkit Code
        const murkitCode = String(item.code).trim();
        const wixSku = codeToSkuMap[murkitCode];
        
        // Получаем Wix Product ID
        const wixId = wixSku ? skuToIdMap[wixSku] : null;

        if (!wixId) {
            console.warn(`Murkit Code ${murkitCode} (Wix SKU: ${wixSku}) not found in Wix, adding as custom item.`);
            return {
                // Если WixId не найден, Murkit Code будет использоваться для имени
                name: item.name || `Item ${murkitCode}`, 
                quantity: parseInt(item.quantity || 1, 10),
                price: {
                    amount: String(item.price || 0),
                    currency: "UAH"
                },
                // Важно! Для товаров без Wix ID нужно включать SKU в свойства
                // чтобы его можно было найти вручную в Wix Order.
                customFields: [{ title: "SKU", value: wixSku || murkitCode }] 
            };
        }

        return {
            catalogReference: {
                catalogItemId: wixId,
                appId: "1380b703-ce81-ff05-f115-39571d94dfcd", // Wix Stores App ID
            },
            quantity: parseInt(item.quantity || 1, 10),
            price: {
                amount: String(item.price || 0),
                currency: "UAH"
            },
            // Добавляем SKU как свойство, чтобы оно отображалось в Wix Order Details
            customFields: [{ title: "SKU", value: wixSku }]
        };
    });

    // 5. Собираем данные получателя
    const recipient = murkitData.recipient || {};
    const delivery = murkitData.delivery || {};
    
    // Формируем объект заказа Wix
    const wixOrderPayload = {
      channelInfo: {
        type: "API",
        externalId: String(murkitData.id) // ID заказа в Murkit
      },
      lineItems: lineItems,
      billingInfo: {
        address: {
          country: "UA",
          city: delivery.city || recipient.city || "Kyiv", 
          addressLine1: delivery.address || recipient.address || "TBD",
          email: recipient.email || "no-email@example.com",
          firstName: recipient.firstName || recipient.name || "Client",
          lastName: recipient.lastName || "",
          phone: recipient.phone || ""
        }
      },
      // Ставим статус оплаты
      paymentStatus: murkitData.payment_status === 'paid' ? 'PAID' : 'NOT_PAID',
    };

    // 6. Отправляем в Wix
    const createdOrder = await createWixOrder(wixOrderPayload);
    console.log('Order created in Wix:', createdOrder.order?.id);

    // 7. Отвечаем Murkit успешным статусом
    res.status(200).json({ 
        success: true, 
        wix_order_id: createdOrder.order?.id 
    });

  } catch (e) {
    console.error('Error processing Murkit webhook:', e);
    // Возвращаем ошибку 500
    res.status(500).json({ error: e.message });
  }
}
