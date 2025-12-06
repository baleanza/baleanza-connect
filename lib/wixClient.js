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

// Поиск товаров по SKU (для вебхука создания заказа)
// Здесь используем products/query, так как нам нужны ID товаров, а не остатки
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
// ИСПРАВЛЕНО: Используем правильное поле фильтра 'product.variantSku'
export async function getInventoryBySkus(skus) {
  if (!skus || skus.length === 0) return [];
  
  const stringSkus = skus.map(s => String(s).trim());
  const accessToken = getAccessToken();
  
  try {
    const res = await fetch(`${WIX_API_BASE}/stores/v3/inventory-items/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: {
          // В документации V3 поле артикула называется product.variantSku
          filter: { 
            "product.variantSku": { "$in": stringSkus } 
          },
          // Запрашиваем поля, чтобы убедиться, что они вернутся
          fields: ['id', 'product', 'stock'] 
        }
      })
    });

    if (!res.ok) {
        console.error('Wix Inventory Error:', res.status, await res.text());
        return [];
    }

    const data = await res.json();
    const items = data.inventoryItems || [];

    // Преобразуем ответ в простой вид
    return items.map(item => {
        // Пытаемся достать SKU из разных возможных мест ответа
        const itemSku = item.product?.variantSku || item.product?.sku || item.externalId;
        
        return {
            sku: itemSku,
            inStock: item.stock ? item.stock.inStock : false,
            quantity: item.stock ? item.stock.quantity : 0
        };
    });

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
