import fetch from 'node-fetch';

const WIX_API_BASE = 'https://www.wixapis.com';

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing env var ${name}`);
  }
  return v;
}

function getAccessToken() {
  return requireEnv('WIX_ACCESS_TOKEN');
}

// Получить инвентарь по списку SKU
export async function getInventoryBySkus(skus) {
  if (!skus || skus.length === 0) return [];

  const accessToken = getAccessToken();

  const res = await fetch(
    `${WIX_API_BASE}/stores/v3/inventory-items/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: {
          filter: {
            sku: { $in: skus }
          }
        }
      })
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Wix inventory error: ${res.status} ${text}`);
  }

  const data = await res.json();
  // см. структуру Inventory API: inventoryItems/ items
  return data.inventoryItems || data.items || [];
}
