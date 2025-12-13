import fetch from 'node-fetch';
import { requireEnv } from './sheetsClient.js'; 

const WIX_API_BASE = 'https://www.wixapis.com';

function getAccessToken() {
  return requireEnv('WIX_ACCESS_TOKEN');
}

function getSiteId() {
  return requireEnv('WIX_SITE_ID');
}

export function getHeaders() {
  return {
    'Authorization': `Bearer ${getAccessToken()}`,
    'wix-site-id': getSiteId(),
    'Content-Type': 'application/json'
  };
}

// === Оновлення деталей замовлення ===
export async function updateWixOrderDetails(wixOrderId, updates) {
  const payload = { 
    order: {
      id: wixOrderId,
      ...updates
    }
  };
  try {
      const res = await fetch(`${WIX_API_BASE}/ecom/v1/orders/${wixOrderId}`, {
        method: 'POST', 
        headers: getHeaders(),
        body: JSON.stringify(payload)
      });
      if (res.ok) {
          console.log(`WIX Order ${wixOrderId} details updated.`);
          return true;
      }
      return false;
  } catch (e) {
      console.error("Network error updating order:", e);
      return false;
  }
}

// === ДОБАВЛЕНИЕ ОПЛАТЫ (FINAL FIX: regularPaymentDetails) ===
export async function addExternalPayment(wixOrderId, amountStr, currency, createdDate) {
    let transactionDate;
    try {
        transactionDate = createdDate ? new Date(createdDate).toISOString() : new Date().toISOString();
    } catch (e) {
        transactionDate = new Date().toISOString();
    }

    // ВАЖНО: Исправленная структура под новые требования Wix API
    // Мы убрали type: "OFFLINE" с верхнего уровня и добавили regularPaymentDetails
    const payload = {
        payments: [
            {
                amount: { 
                    amount: String(amountStr), 
                    currency: currency 
                },
                transactionDate: transactionDate,
                regularPaymentDetails: {
                    paymentMethod: "Monomarket", // Это название будет в админке Wix
                    status: "APPROVED"
                }
            }
        ]
    };

    const url = `${WIX_API_BASE}/ecom/v1/payments/orders/${wixOrderId}/add-payment`;
    
    console.log(`[DEBUG] Adding PAYMENT. URL: ${url}`);
    console.log(`[DEBUG] Payload:`, JSON.stringify(payload, null, 2));

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });

        const text = await res.text();

        if (!res.ok) {
            console.error(`[DEBUG] !!! FAILED to add payment. Status: ${res.status}`);
            console.error(`[DEBUG] Response Body: ${text}`);
            return null;
        }

        console.log(`[DEBUG] Payment SUCCESS. Response: ${text}`);
        return JSON.parse(text);

    } catch (e) {
        console.error("[DEBUG] Network error adding payment:", e);
        return null;
    }
}

// === [NEW] ПРИНУДИТЕЛЬНЫЙ ВОЗВРАТ (Force Refund Transaction) ===
// Создает транзакцию типа REFUND, чтобы обнулить баланс заказа.
export async function createExternalRefund(orderId, amount, currency, date = null) {
    const d = date ? new Date(date).toISOString() : new Date().toISOString();
    const amountStr = parseFloat(amount).toFixed(2); // Обеспечиваем правильный формат

    // API для добавления ручных транзакций (включая REFUND)
    const url = `${WIX_API_BASE}/ecom/v1/orders/${orderId}/transactions`;

    const payload = {
        transaction: {
            type: "REFUND", 
            amount: { amount: amountStr, currency: currency },
            date: d,
            customTransaction: {
                paymentProviderId: "External / Monomarket Forced Refund",
                paymentMethod: "System"
            }
        }
    };

    console.log(`[DEBUG] Attempting Forced REFUND transaction for order ${orderId}`);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });

        const text = await res.text();
        if (!res.ok) {
            console.error(`[DEBUG] !!! FAILED to create forced refund. Status: ${res.status}`);
            throw new Error(`Failed to create forced refund: Status ${res.status}, Body: ${text}`);
        }

        console.log(`[DEBUG] Forced REFUND SUCCESS. Response: ${text}`);
        return JSON.parse(text);

    } catch (e) {
        console.error("[DEBUG] Network error adding forced refund:", e);
        throw e;
    }
}


// === Получение транзакций ===
// Оставляем старую, но не будем ее использовать для FULFILLED, так как она не находит наши оплаты.
export async function getWixOrderTransactions(wixOrderId) {
    try {
        const res = await fetch(`${WIX_API_BASE}/ecom/v1/orders/${wixOrderId}/transactions`, {
            method: 'GET',
            headers: getHeaders()
        });
        
        if (!res.ok) return [];
        
        const data = await res.json();
        return data.orderTransactions || [];
    } catch (e) {
        return [];
    }
}

// === REFUND ===
// Оставляем для совместимости, но не будем ее вызывать
export async function createWixRefund(orderId, paymentId, amount, currency) {
    console.warn("createWixRefund called but is relying on the old flow, using createExternalRefund logic instead.");
    // На всякий случай, если где-то используется, вызываем новую функцию
    return createExternalRefund(orderId, amount, currency);
}

// ... Остальной код (продукты, поиск и т.д.) без изменений ...

export async function fetchAllProducts() { 
  let allProducts = [];
  let skip = 0;
  const limit = 100;
  let hasMore = true;
  const MAX_PAGES = 50; 
  let page = 0;

  while (hasMore && page < MAX_PAGES) {
    try {
      const res = await fetch(`${WIX_API_BASE}/stores/v1/products/query`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          includeVariants: true, 
          includeHiddenProducts: true,
          query: {
            limit: limit,
            skip: skip,
            fields: ["variants", "id", "sku", "name", "priceData", "stock", "options", "productType", "media"] 
          }
        })
      });

      if (!res.ok) break;

      const data = await res.json();
      const products = data.products || [];
      allProducts = allProducts.concat(products);

      if (products.length < limit) hasMore = false; else { skip += limit; page++; }
    } catch (e) { break; }
  }
  return allProducts;
}

export async function getProductsBySkus(skus) {
  if (!skus || skus.length === 0) return [];
  const targetSkus = skus.map(s => String(s).trim());
  const allProducts = await fetchAllProducts();
  return allProducts.filter(p => {
    const pSku = p.sku ? String(p.sku).trim() : '';
    if (targetSkus.includes(pSku)) return true;
    if (p.variants && p.variants.length > 0) {
      return p.variants.some(v => targetSkus.includes(String(v.variant?.sku || '').trim()));
    }
    return false;
  });
}

export async function getInventoryBySkus(skus) {
  if (!skus || skus.length === 0) return [];
  const targetSkus = new Set(skus.map(s => String(s).trim()));
  const allProducts = await fetchAllProducts();
  const inventoryMap = [];

  allProducts.forEach(p => {
    const basePrice = p.priceData?.price || p.price?.price || 0;
    if (p.variants && p.variants.length > 0) {
      p.variants.forEach(v => {
        const vSku = v.variant?.sku ? String(v.variant.sku).trim() : '';
        if (targetSkus.has(vSku)) {
          const stockData = v.stock || {}; 
          inventoryMap.push({
            sku: vSku,
            inStock: (stockData.inStock === true), 
            quantity: (stockData.quantity !== undefined) ? stockData.quantity : 0,
            price: v.variant.priceData?.price || basePrice
          });
          targetSkus.delete(vSku); 
        }
      });
    }
    const pSku = p.sku ? String(p.sku).trim() : '';
    if (targetSkus.has(pSku)) {
      const stockData = p.stock || {}; 
      inventoryMap.push({
        sku: pSku,
        inStock: (stockData.inStock === true), 
        quantity: (stockData.quantity !== undefined) ? stockData.quantity : 0,
        price: basePrice 
      });
      targetSkus.delete(pSku);
    }
  });
  return inventoryMap;
}

export async function createWixOrder(orderData) {
  const payload = { order: orderData };
  const res = await fetch(`${WIX_API_BASE}/ecom/v1/orders`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const text = await res.text();
    console.error('WIX API Error Response:', text);
    throw new Error(`Failed to create Wix order (${res.status}): ${text}`);
  }
  return await res.json();
}

export async function findWixOrderByExternalId(externalId) {
  try {
    const res = await fetch(`${WIX_API_BASE}/ecom/v1/orders/query`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        query: {
          filter: { "channelInfo.externalOrderId": { "$eq": String(externalId) } },
          fields: ["id", "number", "channelInfo", "status", "fulfillmentStatus", "shippingInfo", "priceSummary"] 
        }
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.orders && data.orders.length > 0) ? data.orders[0] : null;
  } catch (e) { return null; }
}

export async function findWixOrderById(wixId) { 
  try {
    const res = await fetch(`${WIX_API_BASE}/ecom/v1/orders/${wixId}`, {
      method: 'GET',
      headers: getHeaders()
    });
    if (!res.ok) return null; 
    const data = await res.json();
    return data.order || null; 
  } catch (e) { return null; }
}

export async function getWixOrderFulfillments(wixOrderId) {
    try {
        const res = await fetch(`${WIX_API_BASE}/ecom/v1/fulfillments/orders/${wixOrderId}`, {
            method: 'GET', headers: getHeaders(),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return data.fulfillments || []; 
    } catch (e) { return []; }
}

export async function getWixOrderFulfillmentsBatch(orderIds) {
    if (!orderIds || orderIds.length === 0) return [];
    try {
        const res = await fetch(`${WIX_API_BASE}/ecom/v1/fulfillments/list-by-ids`, {
            method: 'POST', headers: getHeaders(),
            body: JSON.stringify({ orderIds: orderIds })
        });
        if (!res.ok) return [];
        const data = await res.json();
        const fulfillmentsList = [];
        if (data.ordersWithFulfillments) {
             data.ordersWithFulfillments.forEach(order => {
                if (order.fulfillments) order.fulfillments.forEach(f => fulfillmentsList.push({ ...f, orderId: order.orderId }));
             });
        }
        return data.ordersWithFulfillments || []; 
    } catch (e) { throw e; }
}

export async function cancelWixOrderById(wixOrderId) {
    const basicOrderInfo = await findWixOrderById(wixOrderId); 
    if (!basicOrderInfo) return { status: 404, wixOrderId: null };

    if (basicOrderInfo.status === 'CANCELED') return { status: 409, code: 'ORDER_ALREADY_CANCELED' };
    if (basicOrderInfo.fulfillmentStatus === 'FULFILLED' || basicOrderInfo.fulfillmentStatus === 'DELIVERED') return { status: 409, code: 'CANNOT_CANCEL_ORDER' }; 

    const cancelRes = await fetch(`${WIX_API_BASE}/ecom/v1/orders/${wixOrderId}/cancel`, { 
        method: 'POST', headers: getHeaders(),
        body: JSON.stringify({
            "restockAllItems": true, 
            "cancellationReason": 'Canceled by Monomarket partner request',
            "sendOrderCanceledEmail": true 
        })
    });
    if (cancelRes.ok) return { status: 200, wixOrderId: wixOrderId }; 
    const errorText = await cancelRes.text();
    throw new Error(`Wix API Error during cancellation: ${errorText}`);
}

export async function adjustInventory(adjustments) {
    if (!adjustments || adjustments.length === 0) return;
    const inventoryAdjustments = adjustments.map(adj => ({
        inventoryItemId: adj.productId, variantId: adj.variantId, adjustment: -adj.quantity, reason: 'ORDER_PLACED'
    }));
    try {
        const res = await fetch(`${WIX_API_BASE}/inventory/v1/inventoryItems/bulkAdjustQuantity`, {
            method: 'POST', headers: getHeaders(),
            body: JSON.stringify({ inventoryAdjustments: inventoryAdjustments })
        });
        if (!res.ok) throw new Error(`Failed to adjust inventory`);
    } catch (e) { throw e; }
}
