import fetch from 'node-fetch';

const WIX_API_BASE = 'https://www.wixapis.com';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function getAccessToken() {
  return requireEnv('WIX_ACCESS_TOKEN');
}

function getSiteId() {
  return requireEnv('WIX_SITE_ID');
}

function getHeaders() {
  return {
    'Authorization': `Bearer ${getAccessToken()}`,
    'wix-site-id': getSiteId(),
    'Content-Type': 'application/json'
  };
}

// Получить ВСЕ товары (обход ограничений V1)
async function fetchAllProducts() {
  let allProducts = [];
  let skip = 0;
  const limit = 100;
  let hasMore = true;
  const MAX_PAGES = 50; // Увеличил лимит страниц, чтобы точно собрать все
  let page = 0;

  while (hasMore && page < MAX_PAGES) {
    try {
      // console.log(`Fetching page ${page}...`); // Можно раскомментировать для отладки
      const res = await fetch(`${WIX_API_BASE}/stores/v1/products/query`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          query: {
            limit: limit,
            skip: skip
            // filter убран намеренно, качаем всё
          }
        })
      });

      if (!res.ok) {
        console.error('Wix Products V1 Error:', res.status, await res.text());
        break;
      }

      const data = await res.json();
      const products = data.products || [];
      
      allProducts = allProducts.concat(products);

      if (products.length < limit) {
        hasMore = false;
      } else {
        skip += limit;
        page++;
      }
    } catch (e) {
      console.error('Network error fetching products page:', e);
      break;
    }
  }

  return allProducts;
}

// Поиск товаров по SKU (для вебхука)
export async function getProductsBySkus(skus) {
  if (!skus || skus.length === 0) return [];
  const targetSkus = skus.map(s => String(s).trim());

  const allProducts = await fetchAllProducts();
  
  return allProducts.filter(p => {
    const wixSku = p.sku ? String(p.sku).trim() : '';
    return targetSkus.includes(wixSku);
  });
}

// Получение остатков (для фида stock)
export async function getInventoryBySkus(skus) {
  if (!skus || skus.length === 0) return [];
  
  const targetSkus = new Set(skus.map(s => String(s).trim()));
  
  // 1. Скачиваем ВСЕ товары
  const allProducts = await fetchAllProducts();
  
  const inventoryMap = [];

  allProducts.forEach(p => {
    // --- Проверка вариантов (если есть) ---
    if (p.variants && p.variants.length > 0) {
      p.variants.forEach(v => {
        const vSku = v.sku ? String(v.sku).trim() : '';
        if (targetSkus.has(vSku)) {
          // У вариантов сток тоже может быть в объекте .stock, или в корне (зависит от версии)
          // Проверяем оба варианта
          const stockData = v.stock || v;
          
          inventoryMap.push({
            sku: vSku,
            inStock: (stockData.inStock === true), 
            quantity: (stockData.quantity !== undefined) ? stockData.quantity : 0
          });
        }
      });
    }

    // --- Проверка основного товара ---
    const pSku = p.sku ? String(p.sku).trim() : '';
    if (targetSkus.has(pSku)) {
      // ИСПРАВЛЕНИЕ: Данные лежат внутри объекта .stock!
      const stockData = p.stock || {}; 
      
      inventoryMap.push({
        sku: pSku,
        inStock: (stockData.inStock === true), // Теперь будет true
        quantity: (stockData.quantity !== undefined) ? stockData.quantity : 0 // Теперь будет 5
      });
    }
  });

  return inventoryMap;
}

// Создание заказа (V2 API)
export async function createWixOrder(orderData) {
  const res = await fetch(`${WIX_API_BASE}/stores/v2/orders`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ order: orderData })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create Wix order: ${res.status} ${text}`);
  }

  return await res.json();
}
