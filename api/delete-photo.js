import { del } from '@vercel/blob';

export default async function handler(request, response) {
  if (request.method !== 'DELETE') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { url } = request.body;
    
    if (!url) {
      return response.status(400).json({ error: 'URL is required' });
    }

    // Deletes the blob at the specified URL
    await del(url, {
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return response.status(200).json({ success: true });
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
