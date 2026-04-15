import { list } from '@vercel/blob';

export default async function handler(request, response) {
  try {
    // Fetches all blobs with the 'gallery/' prefix
    const { blobs } = await list({ 
      prefix: 'gallery/',
      token: process.env.BLOB_READ_WRITE_TOKEN 
    });
    
    // Send the list of image URLs back to your gallery page
    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return response.status(200).json(blobs);
  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
}
