import fetch from 'node-fetch';

export default async function handler(req, res) {
  const { sku } = req.query;
  const token = process.env.WIX_ACCESS_TOKEN;
  const siteId = process.env.WIX_SITE_ID;

  if (!token || !siteId) return res.status(500).json({ error: 'Configs missing' });
  if (!sku) return res.status(400).json({ error: 'Provide ?sku=...' });

  try {
    // Делаем простой запрос без фильтров, но с лимитом 100,
    // чтобы посмотреть, какие вообще товары приходят
    const response = await fetch('https://www.wixapis.com/stores/v1/products/query', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'wix-site-id': siteId,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        query: {
          limit: 100,
          skip: 0
        }
      })
    });

    const data = await response.json();
    const products = data.products || [];

    // Ищем наш SKU вручную в полученном списке
    const foundProduct = products.find(p => p.sku === sku || (p.variants && p.variants.some(v => v.sku === sku)));

    res.status(200).json({
      method: "Fetch ALL & Filter in Memory",
      status_code: response.status,
      total_products_in_first_page: products.length,
      
      // Нашли ли мы товар?
      search_result: foundProduct ? {
        name: foundProduct.name,
        sku: foundProduct.sku,
        inStock: foundProduct.inStock,
        quantity: foundProduct.quantity
      } : "Not found in first 100 items (if you have more, real feed will find it)",

      // Пример первого товара (чтобы видеть структуру)
      sample_product: products[0]
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
