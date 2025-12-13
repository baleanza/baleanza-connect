import fetch from 'node-fetch';

const WIX_API_BASE = 'https://www.wixapis.com';

function getHeaders() {
    return {
        'Authorization': `Bearer ${process.env.WIX_ACCESS_TOKEN}`,
        'wix-site-id': process.env.WIX_SITE_ID,
        'Content-Type': 'application/json'
    };
}

export default async function handler(req, res) {
    const orderId = req.query.id || '9347737c-06e1-457d-8f02-49347d1ee942';

    const results = {
        orderId: orderId,
        checks: []
    };

    const addLog = (method, url, status, data) => {
        results.checks.push({
            method,
            url,
            status,
            data
        });
    };

    try {
        // 1. Check Order (Ecom V1)
        const orderRes = await fetch(`${WIX_API_BASE}/ecom/v1/orders/${orderId}`, {
            method: 'GET',
            headers: getHeaders()
        });
        let orderData = {};
        try { orderData = await orderRes.json(); } catch (e) { orderData = { error: 'Parse error' }; }
        addLog('GET Order (Ecom V1)', `/ecom/v1/orders/${orderId}`, orderRes.status, orderData);

        // 2. Check Payments (Ecom V1 - Payments)
        // Именно этот метод мы планируем использовать для поиска ID перед VOID
        const paymentsRes = await fetch(`${WIX_API_BASE}/ecom/v1/payments/orders/${orderId}`, {
            method: 'GET',
            headers: getHeaders()
        });
        let paymentsData = {};
        try { paymentsData = await paymentsRes.json(); } catch (e) { paymentsData = { error: 'Parse error' }; }
        addLog('GET Payments (Ecom V1)', `/ecom/v1/payments/orders/${orderId}`, paymentsRes.status, paymentsData);

        // 3. Check Transactions (Stores V1 - Old School)
        const transRes = await fetch(`${WIX_API_BASE}/stores/v1/orders/${orderId}/transactions`, {
            method: 'GET',
            headers: getHeaders()
        });
        let transData = {};
        try { transData = await transRes.json(); } catch (e) { transData = { error: 'Parse error' }; }
        addLog('GET Transactions (Stores V1)', `/stores/v1/orders/${orderId}/transactions`, transRes.status, transData);

        // 4. Check Transactions (Ecom V1 - Query)
        const queryPayload = {
            query: {
                filter: { "orderId": { "$eq": orderId } }
            }
        };
        // ВАЖНО: Проверим, существует ли этот эндпоинт вообще, так как он выдавал 404
        const queryRes = await fetch(`${WIX_API_BASE}/ecom/v1/transactions/query`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(queryPayload)
        });
        let queryData = {};
        try { queryData = await queryRes.json(); } catch (e) { queryData = { error: 'Parse/404 error' }; }
        addLog('POST Query Transactions', `/ecom/v1/transactions/query`, queryRes.status, queryData);

        return res.status(200).json(results);

    } catch (error) {
        return res.status(500).json({ 
            error: error.message, 
            stack: error.stack,
            results 
        });
    }
}
