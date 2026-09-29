export const makeCall = async (customerNumber) => {

  const SID = process.env.EXOTEL_SID;
  const API_KEY = process.env.EXOTEL_API_KEY;
  const TOKEN = process.env.EXOTEL_TOKEN;

  const customerNo = 9602182969

  const callerid = process.env.EXOTEL_VIRTUAL_NUMBER

  console.log(" naruto is",callerid)

  const url = `https://api.exotel.com/v1/Accounts/${SID}/Calls/connect`;

  const body = new URLSearchParams({
    From: "+91"+customerNo,
    To:  "+91"+customerNo,
    CallerId: "+911414940093",
      Url: "https://noncharitable-genesis-overplausibly.ngrok-free.dev/api/v1/messages/exotel/voice"
  });

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Basic " + Buffer.from(`${API_KEY}:${TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await response.text();

  if (!response.ok) {
    throw new Error(data);
  }

  return data;
};