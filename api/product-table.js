import { ensureAuth, cleanPrice } from '../lib/sheetsClient.js'; 
import { getInventoryBySkus } from '../lib/wixClient.js';

// Чтение данных из Google Sheets
async function readSheetData(sheets, spreadsheetId) {
    const importRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Import!A1:ZZ'
    });
    const controlRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'Feed Control List!A1:F'
    });
    return { 
        importValues: importRes.data.values || [], 
        controlValues: controlRes.data.values || [] 
    };
}

export default async function handler(req, res) {
  try {
    const { sheets, spreadsheetId } = await ensureAuth();

    const { importValues, controlValues } = await readSheetData(
      sheets,
      spreadsheetId
    );

    if (importValues.length < 2) {
      return res.send('<h1>Таблиця пуста</h1>');
    }

    const headers = importValues[0];
    const dataRows = importValues.slice(1);
    
    // Парсим настройки фида, чтобы найти соответствие колонок
    const controlHeaders = controlValues[0] || [];
    const idxImportField = controlHeaders.indexOf('Import field');
    const idxFeedName = controlHeaders.indexOf('Feed name');

    const fieldMap = {}; 
    controlValues.slice(1).forEach(row => {
      const imp = row[idxImportField];
      const feedName = row[idxFeedName];
      if (imp && feedName) {
        fieldMap[String(feedName).trim()] = String(imp).trim();
      }
    });

    // --- ОПРЕДЕЛЕНИЕ ИНДЕКСОВ КОЛОНОК ---
    
    // 1. Ищем колонку Name/Title
    let colName = -1;
    const nameKeys = [fieldMap['name'], fieldMap['title'], 'Name', 'Title'].filter(Boolean);
    for (const key of nameKeys) {
      colName = headers.indexOf(key);
      if (colName > -1) break;
    }

    // 2. Ищем колонку SKU (для связи с Wix)
    const colSku = headers.indexOf(fieldMap['sku'] || 'SKU'); 
    
    // 3. Ищем колонку Price
    const colPrice = headers.indexOf(fieldMap['price'] || 'Price');

    // 4. Ищем колонку Code (Product ID для вывода в начале)
    // Если в маппинге нет 'code', пробуем искать по имени заголовка 'code' или берем SKU как фоллбэк
    let colCode = headers.indexOf(fieldMap['code']);
    if (colCode === -1) colCode = headers.indexOf('code');
    // Если все еще нет, можно оставить пустым или дублировать SKU. Оставим пустым, если не найдено.

    if (colSku === -1) return res.status(500).send('<h1>Помилка: Не знайдено колонку SKU для синхронізації</h1>');

    const skus = [];
    const tableData = [];

    dataRows.forEach(row => {
      const sku = row[colSku] ? String(row[colSku]).trim() : '';
      if (!sku) return;

      skus.push(sku);
      
      const priceVal = colPrice > -1 ? row[colPrice] : '0';
      const codeVal = colCode > -1 ? (row[colCode] || '') : ''; // Значение Product ID
      
      tableData.push({
        sku: sku,
        code: codeVal, // Добавляем code в объект данных
        name: colName > -1 ? row[colName] : '(Без назви)',
        priceRaw: priceVal,
        price: cleanPrice(priceVal)
      });
    });

    // Запрашиваем остатки из Wix
    const inventory = await getInventoryBySkus(skus);
    
    const stockMap = {};
    inventory.forEach(item => {
      stockMap[String(item.sku).trim()] = item;
    });

    let html = `
    <html>
      <head>
        <title>Product Table</title>
        <meta charset="UTF-8">
        <style>
          body { font-family: sans-serif; padding: 20px; }
          table { border-collapse: collapse; width: 100%; max-width: 1200px; margin-top: 15px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
          .instock { background-color: #d4edda; color: #155724; font-weight: bold; }
          .outstock { background-color: #f8d7da; color: #721c24; }
          .warn { background-color: #fff3cd; color: #856404; }
          h2 { margin-bottom: 5px; }
          .summary { margin-bottom: 20px; font-size: 14px; color: #666; }
        </style>
      </head>
      <body>
        <h2>Product Table</h2>
        
        <div class="summary">
          Усього товарів у таблиці: ${tableData.length} <br>
          Зібрано залишків з Wix: ${inventory.length}
        </div>

        <table>
          <thead>
            <tr>
              <th>Product ID</th> <th>Артикул (SKU)</th>
              <th>Назва</th>
              <th>Ціна (Sheet)</th>
              <th>Наявність (Wix)</th>
              <th>К-сть (Wix)</th>
            </tr>
          </thead>
          <tbody>
    `;

    tableData.forEach(item => {
      const wixItem = stockMap[item.sku];
      
      let stockClass = '';
      let stockText = '';
      let qtyText = '-';

      if (!wixItem) {
        stockClass = 'warn'; 
        stockText = 'Не знайдено в Wix';
      } else if (wixItem.inStock) {
        stockClass = 'instock'; 
        stockText = 'В НАЯВНОСТІ';
        qtyText = wixItem.quantity;
      } else {
        stockClass = 'outstock'; 
        stockText = 'Немає в наявності';
        qtyText = wixItem.quantity;
      }

      html += `
        <tr>
          <td>${item.code}</td> <td>${item.sku}</td>
          <td>${item.name}</td>
          <td>${item.price.toFixed(2)} ₴</td>
          <td class="${stockClass}">${stockText}</td>
          <td>${qtyText}</td>
        </tr>
      `;
    });

    html += `
          </tbody>
        </table>
      </body>
    </html>
    `;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);

  } catch (e) {
    res.status(500).send(`<h1>Помилка</h1><pre>${e.message}\n${e.stack}</pre>`);
  }
}
