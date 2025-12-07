import { getHeaders } from '../lib/wixClient.js';
import fetch from 'node-fetch';

const WIX_API_BASE = 'https://www.wixapis.com';

export default async function handler(req, res) {
  // Получаем ID заказа из параметров ссылки (например ?id=123...)
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ 
      error: "Пожалуйста, укажите ID заказа в ссылке. Пример: /api/debug-order?id=8354c25b-ae5c..." 
    });
  }

  try {
    console.log(`Debug: Fetching Order ID: ${id}...`);
    
    const wixRes = await fetch(`${WIX_API_BASE}/ecom/v1/orders/${id}`, {
      method: 'GET',
      headers: getHeaders()
    });

    if (!wixRes.ok) {
      const text = await wixRes.text();
      return res.status(wixRes.status).json({ error: text });
    }

    const orderData = await wixRes.json();

    // Возвращаем красивый JSON прямо в браузер
    res.status(200).json(orderData);

  } catch (e) {
    console.error("Debug Error:", e);
    res.status(500).json({ error: e.message });
  }
}
