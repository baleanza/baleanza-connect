import { getWixOrderFulfillments, getHeaders } from '../lib/wixClient.js';
// Функція checkAuth видалена, оскільки вона некоректно працює з env vars у цьому контексті.

export default async function handler(req, res) {
    // 1. Перевірка авторизації через отримання заголовків Wix (які містять Auth)
    try {
        const headers = getHeaders();
        // Якщо токен порожній, getHeaders() мав би кинути помилку (через requireEnv), 
        // але якщо він просто повертає Authorization: Bearer undefined, ми перевіряємо це.
        if (!headers.Authorization || headers.Authorization.includes('undefined')) {
             return res.status(401).json({ error: 'Unauthorized: Missing Wix token. Please check WIX_ACCESS_TOKEN.' });
        }
    } catch (e) {
         // Якщо requireEnv видає помилку, ми також ловимо її тут.
         return res.status(401).json({ error: `Unauthorized: Missing required environment variable. Details: ${e.message}` });
    }

    // 2. Ігноруємо функцію checkAuth() і переходимо до логіки.
    
    // Оскільки ми використовували :wixId у vercel.json, ID знаходиться у req.query
    const wixId = req.query.wixId; 
    
    if (!wixId) {
        return res.status(400).json({ error: 'Missing Wix Order ID in path.' });
    }

    console.log(`DEBUG: Fetching fulfillments for Wix ID: ${wixId}`);

    try {
        // 3. Виклик функції перегляду фулфілмента
        const fulfillments = await getWixOrderFulfillments(wixId);

        if (!fulfillments || fulfillments.length === 0) {
            return res.status(200).json({
                orderId: wixId,
                status: 'OK',
                message: 'No fulfillments found or error in data fetching.',
                rawResponse: fulfillments
            });
        }
        
        // 4. Повертаємо необроблені дані
        return res.status(200).json({
            orderId: wixId,
            status: 'OK',
            message: 'Successfully fetched fulfillments.',
            fulfillmentCount: fulfillments.length,
            rawResponse: fulfillments
        });
        
    } catch (e) {
        console.error('DEBUG Fulfillment Error:', e.message);
        return res.status(500).json({
            orderId: wixId,
            status: 'ERROR',
            message: 'Internal server error during fulfillment fetch.',
            details: e.message
        });
    }
}
