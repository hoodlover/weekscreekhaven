import { put } from '@vercel/blob';

// IMPORTANT: Disable the default body parser so we can read the raw stream
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get filename from query string since body is now raw binary
    const { searchParams } = new URL(request.url, `http://${request.headers.host}`);
    const filename = searchParams.get('filename') || 'unnamed-file';

    // Upload to Vercel Blob
    // We pass 'request' directly because it is a readable stream
    const blob = await put(`gallery/${filename}`, request, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });

    return response.status(200).json(blob);
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
