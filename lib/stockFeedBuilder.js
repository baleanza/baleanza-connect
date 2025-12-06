// Функция для определения времени отгрузки
// Будни: < 14:00 (Киев) -> 0, >= 14:00 -> 1
// Суббота -> 2
// Воскресенье -> 1
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

// Функция очистки цены
function cleanPrice(val) {
  if (!val) return 0;
  let str = String(val).trim();
  str = str.replace(/\s/g, ''); // Убираем пробелы
  str = str.replace(',', '.');  // Запятая -> точка
  const numberStr = str.replace(/[^0-9.]/g, ''); // Только цифры и точка
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
    const skuStr = String(sku).trim(); // Убираем пробелы, чтобы "SKU1 " стало "SKU1"
    if (!skuStr) return;

    skuList.push(skuStr);
    rowBySku[skuStr] = row;
  });

  const uniqueSkus = [...new Set(skuList)];
  
  // Запрашиваем остатки (теперь через Products API, который вернет SKU в ответе)
  const inventoryItems = await getInventoryBySkus(uniqueSkus);
  
  const inventoryBySku = {};
  inventoryItems.forEach(item => {
    // В обновленном wixClient мы гарантируем поле sku
    if (item.sku) {
      inventoryBySku[String(item.sku).trim()] = item;
    }
  });

  const offersData = uniqueSkus.map(sku => {
    const row = rowBySku[sku];
    const wixItem = inventoryBySku[sku];
    
    // Временный объект для сбора данных
    const rawData = {};

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
    
    let oldPrice = null;
    if (rawData['old_price']) {
        const op = cleanPrice(rawData['old_price']);
        if (op > 0) oldPrice = op;
    }

    let warrantyPeriod = rawData['warranty_period'];
    if (warrantyPeriod) {
        warrantyPeriod = parseInt(String(warrantyPeriod).replace(/[^0-9]/g, ''), 10);
    }

    // Логика доступности: теперь надежная
    let isAvailable = false;
    if (wixItem && wixItem.inStock === true) {
        isAvailable = true;
    }

    // Формируем финальный объект БЕЗ поля name
    return {
        code: sku,
        // name: rawData['name'] || "", // УДАЛЕНО ПО ТРЕБОВАНИЮ
        price: price,
        old_price: oldPrice,
        availability: isAvailable,
        warranty_period: warrantyPeriod,
        warranty_type: "manufacturer",
        max_pay_in_parts: 3,
        days_to_dispatch: daysToDispatch,
        delivery_methods: deliveryMethods,
        // Остальные поля (если есть), кроме тех, что мы уже обработали или удалили
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
