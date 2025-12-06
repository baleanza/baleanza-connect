// Функция для определения времени отгрузки (0 - сегодня, 1 - завтра)
function getDaysToDispatch() {
  // Получаем текущее время в Киеве (UTC+2 / UTC+3)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    hour: 'numeric',
    hour12: false
  });
  
  const hourInKyiv = parseInt(formatter.format(new Date()), 10);
  
  // Если время от 00:00 до 14:00 (не включительно, т.е. до 13:59) -> 0
  // Если от 14:00 и позже -> 1
  return hourInKyiv < 14 ? 0 : 1;
}

function parseDeliveryMethods(deliveryValues) {
  // Ожидаем формат: [shipping_method, is_active, price]
  // Пропускаем заголовок
  const rows = deliveryValues.slice(1);
  
  const methods = [];
  
  rows.forEach(row => {
    const method = row[0] ? String(row[0]).trim() : '';
    const isActiveRaw = row[1] ? String(row[1]).trim().toLowerCase() : 'false';
    const priceRaw = row[2] ? String(row[2]).trim() : '0';

    const isActive = ['true', '1', 'yes', 'так'].includes(isActiveRaw);
    
    if (method && isActive) {
      methods.push({
        method: method,
        price: Number(priceRaw) || 0
      });
    }
  });

  return methods;
}

export async function buildStockJson(importValues, controlValues, deliveryValues, getInventoryBySkus) {
  // 1. Подготовка базовой структуры
  const defaultDaysToDispatch = getDaysToDispatch();
  const deliveryMethods = parseDeliveryMethods(deliveryValues || []);
  
  // Маппинг колонок из Feed Control List
  const headers = importValues[0] || [];
  const rows = importValues.slice(1);
  const controlHeaders = controlValues[0] || [];
  const controlRows = controlValues.slice(1);

  const idxImportField = controlHeaders.indexOf('Import field');
  const idxStock = controlHeaders.indexOf('Stock feed'); // Колонка C
  const idxFeedName = controlHeaders.indexOf('Feed name'); // Колонка D (имя поля в JSON)

  // Карта: имя_колонки_в_гугл_шите -> имя_поля_в_json
  const fieldMapping = {};
  
  controlRows.forEach(row => {
    const importField = row[idxImportField];
    const stockEnabledRaw = row[idxStock];
    const jsonName = row[idxFeedName];

    if (!importField || !jsonName) return;

    // Проверяем, включено ли поле для Stock feed
    const isEnabled = stockEnabledRaw && !['false', '0', 'no', 'ni', ''].includes(String(stockEnabledRaw).toLowerCase());
    
    if (isEnabled) {
       fieldMapping[String(importField).trim()] = String(jsonName).trim();
    }
  });

  // 2. Сбор SKU
  const skuHeaderIndex = headers.indexOf('SKU');
  if (skuHeaderIndex === -1) {
    return JSON.stringify({ total: 0, data: [] });
  }

  const skuList = [];
  const rowBySku = {};

  rows.forEach(row => {
    const sku = row[skuHeaderIndex];
    if (!sku) return;
    const skuStr = String(sku).trim();
    if (!skuStr) return;

    skuList.push(skuStr);
    rowBySku[skuStr] = row;
  });

  const uniqueSkus = [...new Set(skuList)];

  // 3. Получение остатков из Wix
  // Ищем по SKU - это надежно, если в Wix артикулы заполнены корректно.
  const inventoryItems = await getInventoryBySkus(uniqueSkus);
  const inventoryBySku = {};
  
  inventoryItems.forEach(item => {
    // API Wix возвращает объект, где sku может быть внутри variant или product
    const itemSku = item.sku || (item.product && item.product.sku) || (item.variant && item.variant.sku);
    if (itemSku) {
      inventoryBySku[itemSku] = item;
    }
  });

  // 4. Сборка финального массива данных
  const offersData = uniqueSkus.map(sku => {
    const row = rowBySku[sku];
    const wixItem = inventoryBySku[sku];
    
    // Базовый объект предложения
    const offer = {
        code: sku,
        max_pay_in_parts: 3, // Хардкод по требованию
        days_to_dispatch: defaultDaysToDispatch,
        delivery_methods: deliveryMethods
    };

    // Заполняем поля из Google Sheets согласно маппингу
    headers.forEach((header, colIdx) => {
        const jsonKey = fieldMapping[header];
        if (jsonKey) {
            let val = row[colIdx];
            // Преобразование типов для специфичных полей
            if (jsonKey === 'price' || jsonKey === 'old_price') {
                val = val ? Number(val.replace(/[^0-9.]/g, '')) : 0;
            }
            if (val !== undefined && val !== '') {
                offer[jsonKey] = val;
            }
        }
    });

    // Логика Availability (Наличие) из Wix
    // Если товара нет в ответе Wix или inStock = false -> availability: false
    let isAvailable = false;
    if (wixItem && wixItem.inStock === true) {
        isAvailable = true;
    }
    
    offer.availability = isAvailable;

    return offer;
  }).filter(o => o.price > 0); // Фильтруем товары без цены, если нужно

  // 5. Финальный JSON
  return JSON.stringify({
      total: offersData.length,
      data: offersData
  }, null, 2);
}
