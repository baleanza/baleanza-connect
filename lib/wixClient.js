// lib/wixClient.js (Оновлена логіка збору стоків)

// ... (частина з fetchAllProducts залишається без змін) ...

// ... (решта коду залишається без змін до функції getInventoryBySkus) ...

// Получение остатков (для фида stock)
export async function getInventoryBySkus(skus) {
  if (!skus || skus.length === 0) return [];
  
  // 1. Створюємо Set з "чистих" SKU таблиці для швидкого пошуку
  const targetSkus = new Set(skus.map(s => String(s).trim()));
  
  // 2. Скачуємо ВСІ товари
  const allProducts = await fetchAllProducts();
  
  const inventoryMap = [];

  allProducts.forEach(p => {
    // --- Перевірка варіантів (Variants) ---
    // Якщо manageVariants: true, то справжні SKU та сток знаходяться тут
    if (p.variants && p.variants.length > 0) {
      p.variants.forEach(v => {
        const vSku = v.sku ? String(v.sku).trim() : '';
        if (targetSkus.has(vSku)) {
          // У варіантів сток може бути в корені варіанту (v.inStock, v.quantity)
          const stockData = v.stock || v; 
          
          inventoryMap.push({
            sku: vSku,
            inStock: (stockData.inStock === true), 
            quantity: (stockData.quantity !== undefined) ? stockData.quantity : 0
          });
        }
      });
    }

    // --- Перевірка основного товару (якщо варіантів немає, або якщо це основний SKU) ---
    // Це потрібно для простих товарів.
    const pSku = p.sku ? String(p.sku).trim() : '';
    if (targetSkus.has(pSku)) {
      const stockData = p.stock || {}; 
      
      inventoryMap.push({
        sku: pSku,
        inStock: (stockData.inStock === true),
        quantity: (stockData.quantity !== undefined) ? stockData.quantity : 0
      });
    }
  });

  return inventoryMap;
}
// ... (кінець файлу) ...
