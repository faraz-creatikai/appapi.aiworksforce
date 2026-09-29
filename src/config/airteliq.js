export const getAccessToken = async () => {
  const res = await fetch("https://openapi.airtel.in/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: process.env.AIRTEL_SERVICE_ID,
      client_secret: process.env.AIRTEL_SECRET_ID,
      grant_type: "client_credentials"
    })
  });

  const data = await res.json();
  console.log(data);

  return data.access_token;
};