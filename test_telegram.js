const https = require('https');

const token = "8545717939:AAEeRSWLxUlpS0FrDHTADpnAYHlbrAT-MmM";
const url = `https://api.telegram.org/bot${token}/getMe`;

console.log("Fetching Telegram getMe API...");
https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log("Status Code:", res.statusCode);
    console.log("Response:", data);
  });
}).on('error', (err) => {
  console.error("Network Error:", err.message);
  console.error(err);
});
