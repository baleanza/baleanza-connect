import fetch from 'node-fetch';

const WIX_API_BASE = 'https://www.wixapis.com';
const WIX_APP_ID = '1380b703-ce81-ff05-f115-39571d94dfcd'; // Стандартный ID приложения Wix Stores

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

function getAccessToken() {
  return requireEnv('WIX_ACCESS_TOKEN');
}

// Поиск товаров по SKU (нужен, чтобы получить ID товара для создания заказа)
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
export async function getInventoryBySkus(skus) {
  if (!skus || skus.length === 0) return [];
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
          filter: { sku: { $in: skus } }
        }
      })
    });

    if (!res.ok) {
        console.error('Wix Inventory Error:', res.status, await res.text());
        return [];
    }

    const data = await res.json();
    return data.inventoryItems || [];
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
