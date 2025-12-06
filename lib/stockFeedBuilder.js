// Функция для определения времени отгрузки
function getDaysToDispatch() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv',
    hour: 'numeric',
    weekday: 'short',
    hour12: false
  });
  
  const parts = formatter.formatToParts(now);
  const hourPart = parts.find(p => p.type === 'hour').value;
  const weekdayPart = parts.find(p => p.type === 'weekday').value;
  
  const hour = parseInt(hourPart, 10);
  
  if (weekdayPart === 'Sat') return 2;
  if (weekdayPart === 'Sun') return 1;
  
  if (hour < 14) return 0;
  return 1;
}

function parseDeliveryMethods(deliveryValues) {
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

// Функция очистки цены (970,00 -> 970)
function cleanPrice(val) {
  if (!val) return 0;
  // Заменяем запятую на точку, удаляем пробелы
  const cleanStr = String(val).replace(',', '.').replace(/\s/g, '');
  // Оставляем только цифры и точку
  const numberStr = cleanStr.replace(/[^0-9.]/g, '');
  return parseFloat(numberStr) || 0;
}

export async function buildStockJson(importValues, controlValues, deliveryValues, getInventoryBySkus) {
  const daysToDispatch = getDaysToDispatch();
  const deliveryMethods = parseDeliveryMethods(deliveryValues || []);
  
  const headers = importValues[0] || [];
  const rows = importValues.slice(1);
  const controlHeaders = controlValues[0] || [];
  const controlRows = controlValues.slice(1);

  const idxImportField = controlHeaders.indexOf('Import field');
  const idxStock = controlHeaders.indexOf('Stock feed');
  const idxFeedName = controlHeaders.indexOf('Feed name');

  const fieldMapping = {};
  
  controlRows.forEach(row => {
    const importField = row[idxImportField];
    const stockEnabledRaw = row[idxStock];
    const jsonName = row[idxFeedName];

    if (!importField || !jsonName) return;

    const isEnabled = stockEnabledRaw && !['false', '0', 'no', 'ni', ''].includes(String(stockEnabledRaw).toLowerCase());
    
    if (isEnabled) {
       fieldMapping[String(importField).trim()] = String(jsonName).trim();
    }
  });

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
  const inventoryItems = await getInventoryBySkus(uniqueSkus);
  const inventoryBySku = {};
  
  inventoryItems.forEach(item => {
    const itemSku = item.sku || (item.product && item.product.sku) || (item.variant && item.variant.sku);
    if (itemSku) {
      inventoryBySku[itemSku] = item;
    }
  });

  const offersData = uniqueSkus.map(sku => {
    const row = rowBySku[sku];
    const wixItem = inventoryBySku[sku];
    
    // Временный объект для сбора данных
    const rawData = {};

    // Заполняем данными из таблицы
    headers.forEach((header, colIdx) => {
        const jsonKey = fieldMapping[header];
        if (jsonKey) {
            let val = row[colIdx];
            if (val !== undefined && val !== '') {
                rawData[jsonKey] = val;
            }
        }
    });

    // Обработка цен
    const price = rawData['price'] ? cleanPrice(rawData['price']) : 0;
    
    // Обработка старой цены
    let oldPrice = null;
    if (rawData['old_price']) {
        const op = cleanPrice(rawData['old_price']);
        if (op > 0) oldPrice = op;
    }

    // Обработка гарантии (превращаем в число)
    let warrantyPeriod = rawData['warranty_period'];
    if (warrantyPeriod) {
        warrantyPeriod = parseInt(String(warrantyPeriod).replace(/[^0-9]/g, ''), 10);
    }

    // Наличие
    let isAvailable = false;
    if (wixItem && wixItem.inStock === true) {
        isAvailable = true;
    }

    // --- СБОРКА И СОРТИРОВКА ОБЪЕКТА ---
    // Создаем новый объект в строгом порядке ключей (как любит Murkit)
    return {
        code: sku,
        name: rawData['name'] || "",
        price: price,
        old_price: oldPrice, // Теперь явно null, если нет цены
        // currency_id: "UAH", // Можно раскомментировать, если нужно явно
        availability: isAvailable,
        warranty_period: warrantyPeriod, // Число (Int)
        warranty_type: "manufacturer",   // Добавлено жестко
        max_pay_in_parts: 3,
        days_to_dispatch: daysToDispatch,
        delivery_methods: deliveryMethods,
        // Остальные поля, если они были в маппинге, но не попали выше
        ...Object.keys(rawData).reduce((acc, key) => {
            if (!['name', 'price', 'old_price', 'warranty_period'].includes(key)) {
                acc[key] = rawData[key];
            }
            return acc;
        }, {})
    };

  }).filter(o => o.price > 0);

  return JSON.stringify({
      total: offersData.length,
      data: offersData
  }, null, 2);
}
