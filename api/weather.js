// api/weather.js
export default async function handler(req, res) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const lat = "34.86"; // Blue Ridge Lat
  const lon = "-84.32"; // Blue Ridge Lon
  
  // Using the "One Call" API (standard for paid keys)
  const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${apiKey}&units=imperial&exclude=minutely,hourly`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch weather' });
  }
}
