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

// Поиск товаров по SKU (для вебхука)
export async function getProductsBySkus(skus) {
  if (!skus || skus.length === 0) return [];

  try {
    const res = await fetch(`${WIX_API_BASE}/stores/v1/products/query`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        query: {
          filter: { sku: { $in: skus } }
        }
      })
    });

    if (!res.ok) {
      console.error('Wix Products V1 Error:', res.status, await res.text());
      return [];
    }

    const data = await res.json();
    return data.products || [];
  } catch (e) {
    console.error('Network error requesting Wix Products:', e);
    return [];
  }
}

// Получение остатков (для фида stock)
// ПЕРЕПИСАНО: Используем products/query (V1), так как в Catalog V1 
// остатки лежат внутри объекта Product. Это надежнее.
export async function getInventoryBySkus(skus) {
  if (!skus || skus.length === 0) return [];
  
  // Получаем сами товары
  const products = await getProductsBySkus(skus);
  
  // Превращаем товары в формат "SKU -> Остаток"
  const inventoryMap = [];

  products.forEach(p => {
    // 1. Если у товара есть варианты (размеры/цвета), ищем нужный SKU внутри
    if (p.variants && p.variants.length > 0) {
      p.variants.forEach(v => {
        // Добавляем, только если этот SKU был в нашем запросе
        if (skus.includes(v.sku)) {
          inventoryMap.push({
            sku: v.sku,
            inStock: v.inStock,
            quantity: v.quantity
          });
        }
      });
    }

    // 2. Также проверяем основной SKU товара (для простых товаров без вариантов)
    if (p.sku && skus.includes(p.sku)) {
      inventoryMap.push({
        sku: p.sku,
        inStock: p.inStock,
        quantity: p.quantity
      });
    }
  });

  return inventoryMap;
}

// Создание заказа (V2 API - совместимо с Catalog V1)
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
