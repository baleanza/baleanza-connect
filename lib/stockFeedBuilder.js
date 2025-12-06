// Функция для определения времени отгрузки
// Будни: < 14:00 (Киев) -> 0, >= 14:00 -> 1
// Суббота -> 2
// Воскресенье -> 1
function getDaysToDispatch() {
  const now = new Date();
  // Получаем время в часовом поясе Киева
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    hour: 'numeric',
    weekday: 'short', // 'Mon', 'Tue', ... 'Sat', 'Sun'
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const hourPart = parts.find(p => p.type === 'hour').value;
  const weekdayPart = parts.find(p => p.type === 'weekday').value;
  
  const hour = parseInt(hourPart, 10);
  
  // Логика выходных
  if (weekdayPart === 'Sat') return 2;
  if (weekdayPart === 'Sun') return 1;
  
  // Логика будних дней
  if (hour < 14) {
    return 0;
  } else {
    return 1;
  }
}

function parseDeliveryMethods(deliveryValues) {
  // Ожидаем формат: [shipping_method, is_active, price]
  // Пропускаем заголовок (1-ю строку)
  const rows = deliveryValues.slice(1);
  
  const methods = [];
  
  rows.forEach(row => {
    const method = row[0] ? String(row[0]).trim() : '';
    const isActiveRaw = row[1] ? String(row[1]).trim().toLowerCase() : 'false';
    const priceRaw = row[2] ? String(row[2]).trim() : '0';

    // Считаем активным, если true/1/yes/так
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
  // 1. Подготовка общих данных
  const daysToDispatch = getDaysToDispatch();
  const deliveryMethods = parseDeliveryMethods(deliveryValues || []);
  
  // Маппинг колонок из Feed Control List
  // A: Import field, C: Stock feed, D: Feed name
  const headers = importValues[0] || [];
  const rows = importValues.slice(1);
  const controlHeaders = controlValues[0] || [];
  const controlRows = controlValues.slice(1);

  const idxImportField = controlHeaders.indexOf('Import field');
  const idxStock = controlHeaders.indexOf('Stock feed');
  const idxFeedName = controlHeaders.indexOf('Feed name');

  // Карта: имя_колонки_в_гугл_шите -> имя_поля_в_json
  const fieldMapping = {};
  
  controlRows.forEach(row => {
    const importField = row[idxImportField];
    const stockEnabledRaw = row[idxStock];
    const jsonName = row[idxFeedName];

    if (!importField || !jsonName) return;

    // Проверяем, включено ли поле для Stock feed (TRUE/1 и т.д.)
    const isEnabled = stockEnabledRaw && !['false', '0', 'no', 'ni', ''].includes(String(stockEnabledRaw).toLowerCase());
    
    if (isEnabled) {
       fieldMapping[String(importField).trim()] = String(jsonName).trim();
    }
  });

  // 2. Сбор SKU из таблицы
  const skuHeaderIndex = headers.indexOf('SKU'); // Убедитесь, что в Import есть колонка 'SKU'
  if (skuHeaderIndex === -1) {
    // Если SKU нет, возвращаем пустой список
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

  // 3. Получение остатков из Wix по списку SKU
  const inventoryItems = await getInventoryBySkus(uniqueSkus);
  const inventoryBySku = {};
  
  inventoryItems.forEach(item => {
    // Wix может вернуть sku в разных вложенностях
    const itemSku = item.sku || (item.product && item.product.sku) || (item.variant && item.variant.sku);
    if (itemSku) {
      inventoryBySku[itemSku] = item;
    }
  });

  // 4. Сборка финального массива товаров
  const offersData = uniqueSkus.map(sku => {
    const row = rowBySku[sku];
    const wixItem = inventoryBySku[sku];
    
    // Базовый объект предложения
    const offer = {
        code: sku,
        max_pay_in_parts: 3,
        days_to_dispatch: daysToDispatch,
        delivery_methods: deliveryMethods
    };

    // Заполняем поля из Google Sheets (price, old_price, name и т.д.)
    headers.forEach((header, colIdx) => {
        const jsonKey = fieldMapping[header];
        if (jsonKey) {
            let val = row[colIdx];
            
            // Чистим цену от лишних символов, если это цена
            if (jsonKey === 'price' || jsonKey === 'old_price') {
                val = val ? Number(String(val).replace(/[^0-9.]/g, '')) : 0;
            }
            
            if (val !== undefined && val !== '') {
                offer[jsonKey] = val;
            }
        }
    });

    // Логика Availability (Наличие)
    // Товар есть, если Wix вернул запись и inStock = true
    let isAvailable = false;
    if (wixItem && wixItem.inStock === true) {
        isAvailable = true;
    }
    offer.availability = isAvailable;

    return offer;
  }).filter(o => o.price > 0); // (Опционально) исключаем товары без цены

  // 5. Возвращаем JSON строку
  return JSON.stringify({
      total: offersData.length,
      data: offersData
  }, null, 2);
}
