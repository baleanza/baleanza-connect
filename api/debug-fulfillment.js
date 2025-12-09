import { getWixOrderFulfillments } from '../lib/wixClient.js';

export default async function handler(req, res) {
    // Аутентификация (checkAuth) намеренно удалена по запросу пользователя для целей отладки.

    // 1. Извлечение Wix ID из пути
    const wixId = req.query.wixId; // req.query.wixId соответствует :wixId из vercel.json
    
    if (!wixId) {
        return res.status(400).json({ error: 'Missing Wix Order ID in path.' });
    }

    console.log(`DEBUG: Fetching fulfillments for Wix ID: ${wixId}`);

    try {
        // 2. Вызов функции просмотра фулфилмента (использует WIX_ACCESS_TOKEN внутри)
        const fulfillments = await getWixOrderFulfillments(wixId);

        if (!fulfillments || fulfillments.length === 0) {
            return res.status(200).json({
                orderId: wixId,
                status: 'OK',
                message: 'No fulfillments found or error in data fetching.',
                rawResponse: fulfillments
            });
        }
        
        // 3. Возвращаем необработанные данные
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
