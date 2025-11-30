export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  res.status(200).json({
    status: 'ok',
    message: 'monomarket-stock endpoint stub. To be implemented later.'
  });
}
