import fetch from 'node-fetch';

export default async function handler(req, res) {
  const { sku } = req.query;
  const token = process.env.WIX_ACCESS_TOKEN;
  const siteId = process.env.WIX_SITE_ID;

  if (!token || !siteId) {
    return res.status(500).json({ error: 'Missing WIX_ACCESS_TOKEN or WIX_SITE_ID' });
  }

  if (!sku) return res.status(400).json({ error: 'Provide ?sku=...' });

  try {
    // Используем Products V1 API
    const response = await fetch('https://www.wixapis.com/stores/v1/products/query', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'wix-site-id': siteId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: {
          filter: { "sku": { "$in": [sku] } }
        }
      })
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = { error: "Failed to parse JSON", raw: text };
    }

    const products = data.products || [];
    const product = products[0];

    res.status(200).json({
      method: "stores/v1/products/query",
      status_code: response.status,
      site_id_used: siteId,
      found_count: products.length,
      
      // Показываем данные, которые мы будем использовать для фида
      stock_info: product ? {
        name: product.name,
        main_sku: product.sku,
        inStock: product.inStock,
        quantity: product.quantity,
        variants_count: product.variants ? product.variants.length : 0
      } : "Product Not Found",

      full_response: data
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
