const { put } = require('@vercel/blob');

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { searchParams } = new URL(request.url, `http://${request.headers.host}`);
    const filename = searchParams.get('filename') || 'cabin-photo.jpg';

    const blob = await put(`gallery/${filename}`, request, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return response.status(200).json(blob);
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
};
