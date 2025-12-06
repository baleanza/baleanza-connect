import { getInventoryBySkus } from '../lib/wixClient.js';

export default async function handler(req, res) {
  const { sku } = req.query;

  if (!sku) {
    return res.status(400).json({ error: 'Please provide ?sku=...' });
  }

  try {
    const startTime = Date.now();
    
    // Мы вызываем ровно ту функцию, которую использует фид
    const results = await getInventoryBySkus([sku]);
    
    const duration = Date.now() - startTime;

    // Ищем результат для конкретного SKU
    const foundItem = results.find(item => String(item.sku).trim() === String(sku).trim());

    res.status(200).json({
      test_sku: sku,
      found_in_wix: !!foundItem,
      
      // ЧЕТКИЙ ОТВЕТ:
      stock_status: foundItem ? {
        available: foundItem.inStock,
        quantity: foundItem.quantity
      } : "SKU not found in Wix product list",

      // Техническая инфа
      execution_time_ms: duration,
      items_found_total: results.length, // Если 0, значит скрипт вообще ничего не нашел по этому артикулу
      debug_raw: foundItem // Чистые данные из базы
    });

  } catch (e) {
    res.status(500).json({ 
      error: 'Script failed', 
      message: e.message,
      stack: e.stack
    });
  }
}
