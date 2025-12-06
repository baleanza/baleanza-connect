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

// Поиск товаров по SKU (для вебхука)
export async function getProductsBySkus(skus) {
  if (!skus || skus.length === 0) return [];
  const accessToken = getAccessToken();

  try {
    const res = await fetch(`${WIX_API_BASE}/stores/v3/products/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: {
          filter: { sku: { $in: skus } }
        }
      })
    });

    if (!res.ok) {
      console.error('Wix Products Query Error:', res.status, await res.text());
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
// ПЕРЕПИСАНО: Используем products/query вместо inventory-items, 
// так как inventory часто не возвращает SKU в ответе, что ломает сопоставление.
export async function getInventoryBySkus(skus) {
  if (!skus || skus.length === 0) return [];
  
  // Приводим все SKU к строке, чтобы избежать проблем типов
  const stringSkus = skus.map(s => String(s).trim());
  const accessToken = getAccessToken();
  
  try {
    const res = await fetch(`${WIX_API_BASE}/stores/v3/products/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: {
          filter: { sku: { $in: stringSkus } },
          // Запрашиваем только нужные поля для скорости
          fields: ['sku', 'stock', 'name'] 
        }
      })
    });

    if (!res.ok) {
        console.error('Wix Inventory (Products) Error:', res.status, await res.text());
        return [];
    }

    const data = await res.json();
    const products = data.products || [];

    // Преобразуем формат Product в формат, который ждет наш скрипт
    return products.map(p => ({
        sku: p.sku,
        inStock: p.stock ? p.stock.inStock : false,
        quantity: p.stock ? p.stock.quantity : 0
    }));

  } catch (e) {
    console.error('Network error requesting Wix Inventory:', e);
    return [];
  }
}

// Создание заказа
export async function createWixOrder(orderData) {
  const accessToken = getAccessToken();

  const res = await fetch(`${WIX_API_BASE}/stores/v3/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ order: orderData })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create Wix order: ${res.status} ${text}`);
  }

  return await res.json();
}
