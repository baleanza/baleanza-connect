import fetch from 'node-fetch';

const WIX_API_BASE = 'https://www.wixapis.com';

export default async function handler(req, res) {
  // 1. Получаем ID из параметров адресной строки
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ 
      error: "Не указан ID заказа. Пример ссылки: /api/debug-order?id=ВАШ_ID_ЗАКАЗА" 
    });
  }

  // 2. Формируем заголовки прямо здесь (автономно)
  const headers = {
    'Authorization': `Bearer ${process.env.WIX_ACCESS_TOKEN}`,
    'wix-site-id': process.env.WIX_SITE_ID,
    'Content-Type': 'application/json'
  };

  try {
    console.log(`Debug: Fetching Order ID: ${id}...`);
    
    // 3. Делаем запрос к Wix
    const wixRes = await fetch(`${WIX_API_BASE}/ecom/v1/orders/${id}`, {
      method: 'GET',
      headers: headers
    });

    if (!wixRes.ok) {
      const text = await wixRes.text();
      return res.status(wixRes.status).json({ 
        error: "Ошибка от Wix", 
        details: text 
      });
    }

    const orderData = await wixRes.json();
    
    // 4. Возвращаем JSON
    res.status(200).json(orderData);

  } catch (e) {
    console.error("Debug Error:", e);
    res.status(500).json({ error: e.message });
  }
}
